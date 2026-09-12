// Discovery shim: OpenClaw's external contract loader prefers this file at the
// plugin root over `dist/secret-contract-api.mjs` when scanning for the
// channel's secret contract. Plain JS so the loader can require/import it
// without relying on a TypeScript runtime.
export {
  collectRuntimeConfigAssignments,
  secretTargetRegistryEntries,
} from './dist/secret-contract-api.mjs';
