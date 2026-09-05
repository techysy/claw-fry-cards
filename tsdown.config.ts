import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  fixedExtension: true,
  hash: false,
  dts: true,
  platform: "node",
  target: "node22",
  external: ["openclaw", "openclaw/*"],
});
