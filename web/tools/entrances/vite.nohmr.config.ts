// The game's Vite config without hot reload, for screenshot sessions while other files are being edited:
//   npx vite --config tools/entrances/vite.nohmr.config.ts --port 5181
import { mergeConfig } from "vite";
import base from "../../vite.config";
export default mergeConfig(base, { root: process.cwd(), server: { hmr: false } });
