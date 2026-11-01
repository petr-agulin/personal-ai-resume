// Builds the admin page into admin/dist/ (git-ignored), which the admin
// Worker serves after its login check: the HTML, styles and icon from
// admin/client/, the site's colour tokens and fonts, and app.ts compiled to
// app.js. Run: npm run admin:build (admin:dev and the deploy run it too).

import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const out = "admin/dist";
const require = createRequire(import.meta.url);
const font = (pkg: string, file: string) => join(dirname(require.resolve(`${pkg}/package.json`)), "files", file);

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "fonts"), { recursive: true });

for (const file of ["index.html", "admin.css", "favicon.svg"]) copyFileSync(join("admin/client", file), join(out, file));
copyFileSync("src/styles/tokens.css", join(out, "tokens.css"));
copyFileSync(font("@fontsource-variable/geist", "geist-latin-wght-normal.woff2"), join(out, "fonts/geist.woff2"));
copyFileSync(font("@fontsource-variable/geist-mono", "geist-mono-latin-wght-normal.woff2"), join(out, "fonts/geist-mono.woff2"));

await build({
  entryPoints: ["admin/client/app.ts"],
  outfile: join(out, "app.js"),
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  logLevel: "warning",
});

console.log(`Admin page built into ${out}/`);
