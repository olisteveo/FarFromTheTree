// A second dev server for testing the people without live reloads (other work saving files
// won't reload the page mid-measurement): npx vite --config tools/people/vite.solo.config.ts
// Keeps the main config's /__rec endpoint, so a page can POST a canvas grab to web/recordings/.
import { defineConfig, mergeConfig } from "vite";
import path from "node:path";
import base from "../../vite.config";

export default mergeConfig(base, defineConfig({
  root: path.resolve(import.meta.dirname, "../.."),
  server: { port: 5174, strictPort: true, hmr: false },
}));
