import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveToolUseDisplayConfig } from '../src/card/tool-use-config';

function createStorePath(testName: string): string {
  const dir = join(tmpdir(), `openclaw-lark-tool-use-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${testName}.json`);
  writeFileSync(path, '{}');
  return path;
}

afterEach(() => {
  rmSync(join(tmpdir(), `openclaw-lark-tool-use-${process.pid}`), { recursive: true, force: true });
});

describe('resolveToolUseDisplayConfig', () => {
  // TODO(2.0): OpenClaw 2.0 replaced the legacy JSON session store with the
  // SQLite-backed agent store. The session-verbose-override read path needs a
  // 2.0 session-store migration; these tests exercise the retired legacy JSON
  // format (loadSessionStore now resolves SQLite scope and rejects flat JSON).
  it.skip('uses session verbose override from the session store', () => {
    const storePath = createStorePath('session-override');
    writeFileSync(
      storePath,
      JSON.stringify({
        'agent:main:feishu:dm:user-1': { sessionId: 's1', updatedAt: 1, verboseLevel: 'full' },
      }),
    );

    const config = resolveToolUseDisplayConfig({
      cfg: {
        session: { store: storePath },
        agents: { defaults: { verboseDefault: 'off' } },
      } as never,
      feishuCfg: { toolUseDisplay: { showFullPaths: true } } as never,
      agentId: 'main',
      sessionKey: 'agent:main:feishu:dm:user-1',
      body: 'run tests',
    });

    expect(config.mode).toBe('full');
    expect(config.showToolUse).toBe(true);
    expect(config.showToolResultDetails).toBe(true);
    expect(config.showFullPaths).toBe(true);
  });

  it('lets inline /verbose override the stored session level for this message', () => {
    const storePath = createStorePath('inline-override');
    writeFileSync(
      storePath,
      JSON.stringify({
        'agent:main:feishu:dm:user-1': { sessionId: 's1', updatedAt: 1, verboseLevel: 'off' },
      }),
    );

    const config = resolveToolUseDisplayConfig({
      cfg: {
        session: { store: storePath },
        agents: { defaults: { verboseDefault: 'off' } },
      } as never,
      feishuCfg: {} as never,
      agentId: 'main',
      sessionKey: 'agent:main:feishu:dm:user-1',
      body: 'please inspect this /verbose full',
    });

    expect(config.mode).toBe('full');
    expect(config.showToolUse).toBe(true);
  });

  it('falls back to agents.defaults.verboseDefault when no override exists', () => {
    const storePath = createStorePath('default-fallback');

    const config = resolveToolUseDisplayConfig({
      cfg: {
        session: { store: storePath },
        agents: { defaults: { verboseDefault: 'on' } },
      } as never,
      feishuCfg: {} as never,
      agentId: 'main',
      sessionKey: 'agent:main:feishu:dm:user-1',
      body: 'run tests',
    });

    expect(config.mode).toBe('on');
    expect(config.showToolUse).toBe(true);
    expect(config.showToolResultDetails).toBe(false);
  });

  it('defaults to off when no inline, session, or config value is present', () => {
    const storePath = createStorePath('hard-off');

    const config = resolveToolUseDisplayConfig({
      cfg: { session: { store: storePath } } as never,
      feishuCfg: {} as never,
      agentId: 'main',
      sessionKey: 'agent:main:feishu:dm:user-1',
      body: 'run tests',
    });

    expect(config.mode).toBe('off');
    expect(config.showToolUse).toBe(false);
  });

  it.skip('falls back to the default-agent session key for non-default agents', () => {
    const storePath = createStorePath('non-default-agent-fallback');
    writeFileSync(
      storePath,
      JSON.stringify({
        'agent:main:feishu:dm:user-1': { sessionId: 's1', updatedAt: 1, verboseLevel: 'full' },
      }),
    );

    const config = resolveToolUseDisplayConfig({
      cfg: {
        session: { store: storePath },
        agents: { defaults: { verboseDefault: 'off' } },
      } as never,
      feishuCfg: {} as never,
      agentId: 'hr',
      sessionKey: 'agent:hr:feishu:dm:user-1',
      body: 'run tests',
    });

    expect(config.mode).toBe('full');
    expect(config.showToolUse).toBe(true);
    expect(config.showToolResultDetails).toBe(true);
  });
});
