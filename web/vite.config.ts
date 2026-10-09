import { defineConfig, type Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";

/** Dev-only: the flight recorder posts runs, events and screenshots here (web/recordings/). */
function recordings(): Plugin {
  const root = path.resolve(__dirname, "recordings");
  return {
    name: "fftt-recordings",
    configureServer(server) {
      server.middlewares.use("/__rec", (req, res) => {
        const rel = decodeURIComponent((req.url ?? "").replace(/^\/+/, ""));
        const file = path.resolve(root, rel);
        if (!file.startsWith(root)) { res.statusCode = 400; res.end(); return; }
        if (req.method === "GET") {
          if (!fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
          res.setHeader("Content-Type", file.endsWith(".json") ? "application/json" : "image/jpeg");
          fs.createReadStream(file).pipe(res);
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          const body = Buffer.concat(chunks).toString("utf8");
          if (body.startsWith("data:image/")) fs.writeFileSync(file, Buffer.from(body.split(",")[1], "base64"));
          else fs.writeFileSync(file, body);
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [recordings()],
  build: { target: "esnext", chunkSizeWarningLimit: 2000 },
  server: { port: 5173 },
});
