// ide/vscode/esbuild-extension.mjs — M25.E1/E4 build.
// Bundles the extension entry and copies the compiled bb_lsp server into the
// VSIX layout (dist/server/lsp/server.js) so resolution order (c) works.
import { build } from "esbuild"
import { mkdirSync, copyFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "../..")

const result = await build({
  entryPoints: [path.join(here, "src/extension.ts")],
  bundle: true,
  outfile: path.join(here, "dist/extension.js"),
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: false,
  minify: false,
  logLevel: "info",
})

// Bundle the compiled server alongside (bundled-dist resolution leg). The
// dist server must exist first: run `npm run build` at the repo root.
const serverDist = path.join(repoRoot, "dist/lsp/server.js")
if (existsSync(serverDist)) {
  mkdirSync(path.join(here, "dist/server/lsp"), { recursive: true })
  copyFileSync(serverDist, path.join(here, "dist/server/lsp/server.js"))
} else {
  console.warn("[bb-lsp] repo dist/lsp/server.js not found — bundled leg omitted (build repo dist first)")
}

void result
