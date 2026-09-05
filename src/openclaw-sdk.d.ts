/** OpenClaw 插件 SDK 的最小类型声明 — 运行时由 openclaw 宿主提供（peerDependency 链接到 /app）。 */

declare module "openclaw/plugin-sdk/plugin-entry" {
  import type { HookRegistrar } from "./types";

  export type OpenClawPluginApi = {
    id: string;
    pluginConfig?: Record<string, unknown>;
    logger: {
      debug?(msg: string, ...args: unknown[]): void;
      info?(msg: string, ...args: unknown[]): void;
      warn?(msg: string, ...args: unknown[]): void;
      error?(msg: string, ...args: unknown[]): void;
    };
  } & HookRegistrar;

  export function definePluginEntry(def: {
    id: string;
    name: string;
    description: string;
    register: (api: OpenClawPluginApi) => void;
  }): unknown;
}
