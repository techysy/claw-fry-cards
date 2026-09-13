// 模拟 OpenClaw 插件加载器：import 插件入口 → 调用 register(mockApi)
// 递归 Proxy 记录插件触碰的 API 面；任何真实宿主不存在的能力
// 会以两种方式显形：① import 阶段 ERR_MODULE_NOT_FOUND / 缺命名导出
// ② register 阶段对宿主 API 的形状假设被记录下来，与 7.1 d.ts 对照。
import { pathToFileURL } from 'node:url';

const pluginPath = process.argv[2];
const withCfg = process.argv[3] === 'withcfg';

const apiTouches = new Set();
const calls = [];

function makeProxy(path) {
  const fn = function () {};
  return new Proxy(fn, {
    get(_t, p) {
      if (typeof p === 'symbol' || p === 'then' || p === 'toJSON') return undefined;
      const next = `${path}.${String(p)}`;
      apiTouches.add(next);
      if (next === 'api.pluginConfig') return withCfg ? { feishu: { brand: 'feishu', app_id: 'cli_test', app_secret: 'test' } } : {};
      if (next === 'api.logger') return makeProxy(next); // logger 本身也走 proxy，可调用可取属性
      return makeProxy(next);
    },
    apply(_t, _thisArg, args) {
      apiTouches.add(`${path}()`);
      calls.push(path);
      return makeProxy(`${path}()`);
    },
    construct() {
      return makeProxy(`${path}#new`);
    },
  });
}

const api = makeProxy('api');

const mod = await import(pathToFileURL(pluginPath).href);
const def = mod.default ?? mod;

console.log('── import 阶段: OK（所有裸包导入在 7.1 宿主下解析成功）');
console.log('── 插件标识:', def.id ?? '(no id)');
console.log('── 定义键:', Object.keys(def).join(', '));

if (typeof def.register === 'function') {
  await def.register(api);
  console.log('── register 阶段: OK');
  const interesting = [...apiTouches].filter((t) => /^api\.[a-zA-Z]+$/.test(t)).sort();
  console.log('── 顶层 API 面:', interesting.join(', '));
  const callsNamed = calls.filter((c) => /^api\.[a-zA-Z]+\(\)$/.test(c));
  console.log('── 调用的注册方法:', [...new Set(callsNamed)].map((c) => c.replace('api.', '').replace('()', '')).join(', ') || '(无)');
} else {
  console.log('── register: 不是函数');
}
console.log('RESULT: PASS');
