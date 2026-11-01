// Astro integration for the content folder:
// - serves <content>/files/ at /files/ during `npm run dev`
// - copies it to dist/files/ on build (these files are public)
// - reloads the browser when a content file changes

import type { AstroIntegration } from "astro";
import { cpSync, createReadStream, existsSync, statSync } from "node:fs";
import { basename, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveContentDir } from "./load.ts";

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export function contentIntegration(): AstroIntegration {
  const contentDir = resolveContentDir();
  const filesDir = join(contentDir, "files");

  return {
    name: "content",
    hooks: {
      "astro:server:setup": ({ server }) => {
        server.watcher.add(contentDir);
        server.watcher.on("change", (path) => {
          if (path.startsWith(contentDir)) server.ws.send({ type: "full-reload" });
        });

        server.middlewares.use("/files", (req, res, next) => {
          const rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
          const path = normalize(join(filesDir, rel));
          if (!path.startsWith(filesDir + sep) || !existsSync(path) || !statSync(path).isFile()) return next();
          res.setHeader("Content-Type", TYPES[extname(path).toLowerCase()] ?? "application/octet-stream");
          createReadStream(path).pipe(res);
        });
      },
      "astro:build:done": ({ dir }) => {
        if (!existsSync(filesDir)) return;
        cpSync(filesDir, join(fileURLToPath(dir), "files"), {
          recursive: true,
          filter: (src) => !basename(src).startsWith("."),
        });
      },
    },
  };
}
