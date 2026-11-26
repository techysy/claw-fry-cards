/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * 未识别模型兜底智能体图标（从 feige-fry-cards 平移）的离线测试：
 *
 * - 取图口径：厂商命中优先 → 模型串/agentId 的智能体词 → 本宿主品牌图 openclaw.png；
 * - 上传缓存键含文件内容摘要（换像素必须重新上传，否则老进程永远命中旧 image_key）；
 * - 路径穿越守卫（`../feige.py` 之类一律拒绝）；
 * - 资产守卫：两目录 PNG 白底可见（深色像素占比阈值）、文件名零交集（重名会串图）；
 * - `panel.vendorLogo === false`：厂商图与兜底图都不出（resolve 链根本不被调用）。
 *
 * 像素解析只用 node:zlib + 手写 PNG chunk 解析，不引入任何 npm 依赖
 * （算法平移 feige-fry-cards tests/test_interactive.py 的 logo_pixels / logo_luminance）。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import type { OpenClawConfig } from 'openclaw/plugin-sdk/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks（上传打桩计数；controller 的重型基础设施依赖一并 mock）
// ---------------------------------------------------------------------------

vi.mock('../src/core/lark-logger', () => ({
  larkLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const uploadImageLarkMock = vi.fn();
vi.mock('../src/messaging/outbound/media', () => ({
  uploadImageLark: (...args: unknown[]) => uploadImageLarkMock(...args),
  fetchRemoteImageBuffer: vi.fn(),
}));

vi.mock('openclaw/plugin-sdk/reply-runtime', () => ({ SILENT_REPLY_TOKEN: 'NO_REPLY' }));
vi.mock('../src/core/lark-client', () => ({ LarkClient: {} }));
vi.mock('../src/core/shutdown-hooks', () => ({ registerShutdownHook: () => () => {} }));
vi.mock('../src/messaging/outbound/send', () => ({
  sendCardFeishu: vi.fn(),
  updateCardFeishu: vi.fn(),
  deleteMessageFeishu: vi.fn(),
}));
vi.mock('../src/card/cardkit', () => ({
  createCardEntity: vi.fn(),
  sendCardByCardId: vi.fn(),
  setCardStreamingMode: vi.fn(),
  streamCardContent: vi.fn(),
  updateCardKitCard: vi.fn(),
}));
vi.mock('../src/card/card-journal', () => ({
  recordStreamingCard: vi.fn(),
  removeStreamingCard: vi.fn(),
  loadStreamingCards: vi.fn(() => []),
  CARD_JOURNAL_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,
}));
vi.mock('../src/card/flush-controller', () => ({
  FlushController: class {
    cancelPendingFlush() {}
    complete() {}
    waitForFlush() {
      return Promise.resolve();
    }
    setCardMessageReady() {}
    throttledUpdate() {
      return Promise.resolve();
    }
  },
}));
vi.mock('../src/card/image-resolver', () => ({
  ImageResolver: class {
    resolveImages(t: string) {
      return t;
    }
    resolveImagesAwait(t: string) {
      return Promise.resolve(t);
    }
  },
}));
vi.mock('../src/card/unavailable-guard', () => ({
  UnavailableGuard: class {
    shouldSkip() {
      return false;
    }
    terminate() {
      return false;
    }
    get isTerminated() {
      return false;
    }
  },
}));

import { StreamingCardController } from '../src/card/streaming-card-controller';
import {
  AGENT_LOGO_FILES,
  logoAssetPath,
  resolveAgentLogoAsset,
  resolveLogoAsset,
  resolveVendorDisplayName,
  resolveVendorLogoAsset,
  resolveVendorLogoImageKey,
} from '../src/card/vendor-logos';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR_DIR = path.join(REPO, 'assets', 'vendor-logos');
const AGENT_DIR = path.join(REPO, 'assets', 'agent-logos');
const CFG = {} as OpenClawConfig;

beforeEach(() => {
  uploadImageLarkMock.mockReset();
  uploadImageLarkMock.mockImplementation(async () => ({ imageKey: `img_${uploadImageLarkMock.mock.calls.length}` }));
  // vendor-logos 的 image_key memo 是模块级的：重置模块注册表，让每个用例拿到
  // 干净缓存（否则上一个用例上传过的同摘要资产会让本用例的上传计数为 0）
  vi.resetModules();
});

/** 取一份缓存干净的 vendor-logos 模块（配合 beforeEach 的 resetModules） */
async function freshVendorLogos() {
  return import('../src/card/vendor-logos');
}

/** 取一份缓存干净的 controller 模块（其 vendor-logos 依赖同样是新实例） */
async function freshController() {
  return (await import('../src/card/streaming-card-controller')).StreamingCardController;
}

// ---------------------------------------------------------------------------
// 兜底解析口径
// ---------------------------------------------------------------------------

describe('resolveLogoAsset 兜底优先级', () => {
  it('10router 的宿主/组合模型串走 agent 资产', () => {
    expect(resolveLogoAsset('10router/openclaw')).toEqual({ file: 'openclaw.png', dir: 'agent-logos' });
    expect(resolveLogoAsset('10router/combo/Hermes')).toEqual({ file: 'hermes.png', dir: 'agent-logos' });
  });

  it('全不认识的模型串回退本宿主品牌图 openclaw.png（左侧不再空着）', () => {
    expect(resolveLogoAsset('10router/10r-free')).toEqual({ file: 'openclaw.png', dir: 'agent-logos' });
    expect(resolveLogoAsset('')).toEqual({ file: 'openclaw.png', dir: 'agent-logos' });
    expect(resolveLogoAsset('zzz/whatever-model')).toEqual({ file: 'openclaw.png', dir: 'agent-logos' });
  });

  it('厂商命中口径不变（厂商优先于智能体词）', () => {
    expect(resolveLogoAsset('tencent/hy4-flash:free')).toEqual({ file: 'hunyuan.png', dir: 'vendor-logos' });
    expect(resolveLogoAsset('openclaw/deepseek-v4.1-flash')).toEqual({ file: 'deepseek.png', dir: 'vendor-logos' });
    // 模型串同时含宿主词与厂商词时，厂商赢（口径：厂商命中优先）
    expect(resolveLogoAsset('10router/combo/qwen4-max')).toEqual({ file: 'qwen.png', dir: 'vendor-logos' });
  });

  it('未识别模型 + agentId 含智能体词 → 该智能体图', () => {
    expect(resolveLogoAsset('10router/10r-free', 'claude-code-runner')).toEqual({
      file: 'claude-code.png',
      dir: 'agent-logos',
    });
    expect(resolveLogoAsset('unknown/pool', 'zcode-agent')).toEqual({ file: 'zcode.png', dir: 'agent-logos' });
    expect(resolveLogoAsset('unknown/pool', 'agy')).toEqual({ file: 'antigravity.png', dir: 'agent-logos' });
  });

  it('模型串里的智能体词优先于 agentId', () => {
    expect(resolveLogoAsset('10router/combo/Hermes', 'claude-code-runner')).toEqual({
      file: 'hermes.png',
      dir: 'agent-logos',
    });
  });

  it('长词优先：kimi-code 不被 kimi 抢走，claude-code 不被 claude 抢走', () => {
    expect(resolveAgentLogoAsset('kimi-code')).toBe('kimi-code.png');
    expect(resolveAgentLogoAsset('KIMI')).toBe('kimi-code.png');
    expect(resolveAgentLogoAsset('claude-code')).toBe('claude-code.png');
    expect(resolveAgentLogoAsset('antigravity')).toBe('antigravity.png');
    expect(resolveAgentLogoAsset('AGY')).toBe('antigravity.png');
    // 词表本身按长度降序登记（守卫：短词插到长词前面会让长词永远命不中）
    const words = AGENT_LOGO_FILES.map(([w]) => w);
    for (const [i, word] of words.entries()) {
      for (const longer of words.filter((w) => w.length > word.length && w.includes(word))) {
        expect(words.indexOf(longer)).toBeLessThan(i);
      }
    }
  });

  it('认不出智能体词时 resolveAgentLogoAsset 返回 undefined（由 resolveLogoAsset 兜底）', () => {
    expect(resolveAgentLogoAsset('10router/10r-free')).toBeUndefined();
    expect(resolveAgentLogoAsset('10router/10r-free', 'agent-1')).toBeUndefined();
    expect(resolveAgentLogoAsset('', '')).toBeUndefined();
  });

  it('官方名映射与 logo 显隐解耦：兜底不影响 resolveVendorDisplayName', () => {
    expect(resolveVendorDisplayName('tencent/hy4-flash:free')).toBe('Hy4 flash');
    expect(resolveVendorDisplayName('10router/10r-free')).toBeUndefined();
    expect(resolveVendorLogoAsset('10router/openclaw')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 上传缓存键含内容摘要
// ---------------------------------------------------------------------------

/** 临时资产根目录（<root>/<dir>/<file> 布局），用完即删 */
function makeAssetRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claw-logo-assets-'));
  fs.mkdirSync(path.join(root, 'agent-logos'), { recursive: true });
  fs.mkdirSync(path.join(root, 'vendor-logos'), { recursive: true });
  return root;
}

describe('resolveVendorLogoImageKey 缓存键含内容摘要', () => {
  it('同字节命中缓存只上传一次；换像素后重新上传（不再命中旧 image_key）', async () => {
    const { resolveVendorLogoImageKey } = await freshVendorLogos();
    const root = makeAssetRoot();
    try {
      const target = path.join(root, 'agent-logos', 'openclaw.png');
      // 模型串每次不同 → 排除「按模型名缓存」的干扰，只验字节摘要
      fs.writeFileSync(target, Buffer.from('logo-bytes-v1'));
      const first = await resolveVendorLogoImageKey(CFG, undefined, 'zzz/model-a', { assetRoot: root });
      const again = await resolveVendorLogoImageKey(CFG, undefined, 'zzz/model-b', { assetRoot: root });
      expect(first).toBeTruthy();
      expect(again).toBe(first);
      expect(uploadImageLarkMock).toHaveBeenCalledTimes(1);

      // 换像素（这里换字节即可代表资产内容变化）
      fs.writeFileSync(target, Buffer.from('logo-bytes-v2-visible'));
      const after = await resolveVendorLogoImageKey(CFG, undefined, 'zzz/model-c', { assetRoot: root });
      expect(after).toBeTruthy();
      expect(after).not.toBe(first);
      expect(uploadImageLarkMock).toHaveBeenCalledTimes(2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('多账号不串图：image_key 属于上传它的飞书 app，缓存键必须带 app 维度', async () => {
    const { resolveVendorLogoImageKey } = await freshVendorLogos();
    const root = makeAssetRoot();
    try {
      fs.writeFileSync(path.join(root, 'agent-logos', 'openclaw.png'), Buffer.from('same-bytes'));
      // 两个账号配的是**不同 app**：同一份资产必须各自上传一次
      const multi = {
        channels: {
          feishu: {
            appId: 'cli_app_a',
            appSecret: 'secret-a',
            accounts: { b: { appId: 'cli_app_b', appSecret: 'secret-b' } },
          },
        },
      } as unknown as OpenClawConfig;
      const keyA = await resolveVendorLogoImageKey(multi, undefined, 'zzz/pool', { assetRoot: root });
      const keyB = await resolveVendorLogoImageKey(multi, 'b', 'zzz/pool', { assetRoot: root });
      expect(keyA).toBeTruthy();
      expect(keyB).toBeTruthy();
      expect(keyB).not.toBe(keyA);
      expect(uploadImageLarkMock).toHaveBeenCalledTimes(2);
      // 同 app 再取仍命中缓存（不因账号名不同而重复上传）
      await resolveVendorLogoImageKey(multi, undefined, 'zzz/pool-2', { assetRoot: root });
      expect(uploadImageLarkMock).toHaveBeenCalledTimes(2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('厂商目录与智能体目录同名文件不串图（缓存键带目录前缀）', async () => {
    const { resolveVendorLogoImageKey } = await freshVendorLogos();
    const root = makeAssetRoot();
    try {
      // 人为制造两目录同名（真实资产零重名，这里验证缓存键本身不会串）
      fs.writeFileSync(path.join(root, 'vendor-logos', 'claude.png'), Buffer.from('vendor-claude'));
      fs.writeFileSync(path.join(root, 'agent-logos', 'claude.png'), Buffer.from('agent-claude'));
      // 厂商命中（claude → vendor-logos/claude.png）
      const vendorKey = await resolveVendorLogoImageKey(CFG, undefined, 'claude-sonnet-4', { assetRoot: root });
      // 厂商不命中、agentId 智能体词命中（claude-code → agent-logos/claude-code.png）。
      // 把 agent 侧内容写成与 vendor/claude.png 完全相同的字节：只有目录不同，
      // 摘要相同 → 若缓存键漏了目录前缀就会串图（只上传一次）
      fs.writeFileSync(path.join(root, 'agent-logos', 'claude-code.png'), Buffer.from('vendor-claude'));
      const agentKey = await resolveVendorLogoImageKey(CFG, undefined, '10router/10r-free', {
        assetRoot: root,
        agentId: 'claude-code-runner',
      });
      expect(vendorKey).toBeTruthy();
      expect(agentKey).toBeTruthy();
      expect(agentKey).not.toBe(vendorKey);
      expect(uploadImageLarkMock).toHaveBeenCalledTimes(2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('真实资产可解析并上传；读不到文件时静默 null（不抛错）', async () => {
    const { resolveVendorLogoImageKey } = await freshVendorLogos();
    const key = await resolveVendorLogoImageKey(CFG, undefined, '10router/10r-free');
    expect(key).toBeTruthy();
    expect(uploadImageLarkMock).toHaveBeenCalledTimes(1);

    const empty = makeAssetRoot();
    try {
      const missing = await resolveVendorLogoImageKey(CFG, undefined, 'zzz/no-such-asset', { assetRoot: empty });
      expect(missing).toBeNull();
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('上传抛错时静默返回 null（渲染降级纯文本）', async () => {
    const { resolveVendorLogoImageKey } = await freshVendorLogos();
    uploadImageLarkMock.mockRejectedValue(new Error('upload boom'));
    const key = await resolveVendorLogoImageKey(CFG, undefined, 'zzz/upload-fails');
    expect(key).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 路径穿越守卫
// ---------------------------------------------------------------------------

describe('logoAssetPath 防穿越', () => {
  it('拒绝含路径分隔符 / .. 的文件名', () => {
    for (const bad of ['../feige.py', '..\\feige.py', 'a/b.png', 'a\\b.png', '..', '', '   ', 'x/../y.png']) {
      expect(logoAssetPath(bad, 'agent-logos')).toBeUndefined();
      expect(logoAssetPath(bad, 'vendor-logos')).toBeUndefined();
    }
  });

  it('拒绝穿越的目录名与 assetRoot', () => {
    expect(logoAssetPath('openclaw.png', '../vendor-logos' as 'vendor-logos')).toBeUndefined();
    expect(logoAssetPath('openclaw.png', 'agent-logos', '/tmp/../etc')).toBeUndefined();
    expect(logoAssetPath('openclaw.png', 'agent-logos', '')).toBeUndefined();
  });

  it('合法输入解析到对应目录，且仍在 assets 根内', () => {
    const agent = logoAssetPath('openclaw.png', 'agent-logos');
    const vendor = logoAssetPath('hunyuan.png', 'vendor-logos');
    expect(agent).toBeTruthy();
    expect(vendor).toBeTruthy();
    expect(path.basename(agent!)).toBe('openclaw.png');
    expect(path.basename(path.dirname(agent!))).toBe('agent-logos');
    expect(path.basename(path.dirname(vendor!))).toBe('vendor-logos');
    // src/card/ → ../../assets/<dir>/<file>
    expect(fs.existsSync(agent!)).toBe(true);
    expect(fs.existsSync(vendor!)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 资产守卫：手写 PNG 解析（只用 node:zlib，零新增依赖）
// ---------------------------------------------------------------------------

interface DecodedPng {
  width: number;
  height: number;
  /** 可见像素（透明度 >40）的 RGB 列表 */
  pixels: Array<[number, number, number]>;
}

/**
 * 解 8 位调色板 PNG 的可见像素——只支持资产实际形态（depth 8 / colorType 3 /
 * 行滤波 0,1,2），换了编码方式明确报错而不是静默放行。
 * 算法平移 feige-fry-cards tests/test_interactive.py::logo_pixels。
 */
function decodePalettePng(file: string): DecodedPng {
  const data = fs.readFileSync(file);
  expect(data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  let pos = 8;
  let ihdr: Buffer | undefined;
  let plte: Buffer | undefined;
  let trns: Buffer | undefined;
  const idat: Buffer[] = [];
  while (pos + 8 <= data.length) {
    const length = data.readUInt32BE(pos);
    const kind = data.toString('ascii', pos + 4, pos + 8);
    const body = data.subarray(pos + 8, pos + 8 + length);
    if (kind === 'IHDR') ihdr = body;
    else if (kind === 'PLTE') plte = body;
    else if (kind === 'tRNS') trns = body;
    else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    pos += 12 + length;
  }
  expect(ihdr, `${path.basename(file)} 缺 IHDR`).toBeTruthy();
  expect(plte, `${path.basename(file)} 缺 PLTE`).toBeTruthy();
  const width = ihdr!.readUInt32BE(0);
  const height = ihdr!.readUInt32BE(4);
  const depth = ihdr![8];
  const color = ihdr![9];
  expect({ depth, color }, `${path.basename(file)} 需为 8 位调色板 PNG`).toEqual({ depth: 8, color: 3 });

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width;
  let at = 0;
  let prev = Buffer.alloc(stride);
  const pixels: Array<[number, number, number]> = [];
  for (let y = 0; y < height; y++) {
    const filter = raw[at];
    at += 1;
    const row = Buffer.from(raw.subarray(at, at + stride));
    at += stride;
    if (filter === 1) {
      for (let x = 1; x < stride; x++) row[x] = (row[x] + row[x - 1]) & 0xff;
    } else if (filter === 2) {
      for (let x = 0; x < stride; x++) row[x] = (row[x] + prev[x]) & 0xff;
    } else {
      expect(filter, `${path.basename(file)} 用了未支持的行滤波类型 ${filter}`).toBe(0);
    }
    prev = row;
    for (const idx of row) {
      const alpha = trns && idx < trns.length ? trns[idx] : 255;
      if (alpha <= 40) continue; // 圆角外的透明像素不计入
      pixels.push([plte![3 * idx], plte![3 * idx + 1], plte![3 * idx + 2]]);
    }
  }
  return { width, height, pixels };
}

/**
 * 可见像素的深色占比（亮度 <200 的比例）。
 *
 * 飞书面板头是浅底：整片接近白色的图标（lobehub dark 变体＝纯白）画上去等于没画，
 * 也就是用户看到的「模型那头空着」。算法平移 feige 的 logo_luminance。
 */
function darkPixelRatio(file: string): number {
  const { pixels } = decodePalettePng(file);
  if (pixels.length === 0) return 0;
  const dark = pixels.filter(([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b < 200).length;
  return dark / pixels.length;
}

function pngFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .sort();
}

describe('logo 资产守卫（白底可见 + 零重名）', () => {
  it('vendor-logos 每张深色像素占比 >0.2（白底上看得见）', () => {
    const files = pngFiles(VENDOR_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const ratio = darkPixelRatio(path.join(VENDOR_DIR, file));
      expect(ratio, `${file} 深色像素占比 ${ratio.toFixed(3)} 过低（白底上等于没画）`).toBeGreaterThan(0.2);
    }
  });

  it('agent-logos 每张深色像素占比 >0.5（兜底图必须显眼）', () => {
    const files = pngFiles(AGENT_DIR);
    // 目录内容 = 词表登记的文件集合（多一张没人用、少一张兜底就断）
    expect(files).toEqual([...new Set(AGENT_LOGO_FILES.map(([, f]) => f))].sort());
    for (const file of files) {
      const ratio = darkPixelRatio(path.join(AGENT_DIR, file));
      expect(ratio, `${file} 深色像素占比 ${ratio.toFixed(3)} 过低`).toBeGreaterThan(0.5);
    }
  });

  it('两目录文件名零交集（重名会让缓存键串图）', () => {
    const vendor = new Set(pngFiles(VENDOR_DIR));
    const overlap = pngFiles(AGENT_DIR).filter((f) => vendor.has(f));
    expect(overlap).toEqual([]);
  });

  it('词表登记的每个 agent 文件都真实存在（随包分发不漏）', () => {
    for (const [, file] of AGENT_LOGO_FILES) {
      expect(fs.existsSync(path.join(AGENT_DIR, file)), `缺资产 ${file}`).toBe(true);
    }
    // npm files 数组必须含 agent-logos，否则装包后 readFileSync 抛错静默降级
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')) as { files?: string[] };
    expect(pkg.files).toContain('assets/agent-logos');
    expect(pkg.files).toContain('assets/vendor-logos');
  });
});

// ---------------------------------------------------------------------------
// vendorLogo=false 的关闭语义（controller 早退，resolve 链不被调用）
// ---------------------------------------------------------------------------

/** 只测 resolvePanelMetrics：把取指标一步打桩，避开真实 transcript SQLite */
async function makeController(vendorLogo: boolean | undefined, agentId = 'openclaw'): Promise<StreamingCardController> {
  const StreamingCardController = await freshController();
  const cfg = {
    plugins: {
      entries: {
        'claw-fry-cards': { config: { panel: vendorLogo === undefined ? {} : { vendorLogo } } },
      },
    },
  } as unknown as OpenClawConfig;
  const controller = new StreamingCardController({
    cfg,
    agentId,
    sessionKey: 'session-key',
    accountId: undefined,
    chatId: 'oc_test',
    replyToMessageId: undefined,
    replyInThread: undefined,
    toolUseDisplay: { mode: 'off', showToolUse: false, showFullPaths: false, showToolResultDetails: false },
    resolvedFooter: {
      status: false,
      elapsed: false,
      tokens: false,
      cache: false,
      context: false,
      model: false,
      provider: false,
    },
  });
  // 私有方法：本轮响应模型固定为未识别模型串，专测兜底/开关分支
  const internals = controller as unknown as {
    getFooterSessionMetrics: () => Promise<unknown>;
    resolvePanelMetrics: () => Promise<{ routingLogo?: { imageKey: string; model: string } }>;
  };
  internals.getFooterSessionMetrics = async () => ({ responseModel: '10router/10r-free', model: '10router/10r-free' });
  return controller;
}

async function panelMetrics(controller: StreamingCardController) {
  return (
    controller as unknown as {
      resolvePanelMetrics: () => Promise<{ routingLogo?: { imageKey: string; model: string } }>;
    }
  ).resolvePanelMetrics();
}

describe('panel.vendorLogo 开关语义（controller 早退）', () => {
  it('vendorLogo=false：厂商图与兜底图都不出，resolve/上传链完全不被调用', async () => {
    const controller = await makeController(false);
    const result = await panelMetrics(controller);
    expect(result.routingLogo).toBeUndefined();
    expect(uploadImageLarkMock).not.toHaveBeenCalled();
  });

  it('默认（未配置）开启：未识别模型也拿到宿主兜底图的 image_key', async () => {
    const result = await panelMetrics(await makeController(undefined));
    expect(result.routingLogo?.model).toBe('10router/10r-free');
    expect(result.routingLogo?.imageKey).toBeTruthy();
    expect(uploadImageLarkMock).toHaveBeenCalledTimes(1);
  });

  it('vendorLogo=true 显式开启：同样出兜底图', async () => {
    const result = await panelMetrics(await makeController(true));
    expect(result.routingLogo?.imageKey).toBeTruthy();
    expect(uploadImageLarkMock).toHaveBeenCalledTimes(1);
  });

  it('上传失败时 routingLogo 为空（回落右侧箭头 + 🍤），开关开启也一样', async () => {
    uploadImageLarkMock.mockRejectedValue(new Error('upload boom'));
    const result = await panelMetrics(await makeController(true, 'zzz-unknown-agent'));
    expect(result.routingLogo).toBeUndefined();
  });
});
