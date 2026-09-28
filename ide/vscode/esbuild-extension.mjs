// ide/vscode/esbuild-extension.mjs — M25.E1/E4 build.
// Bundles the extension entry and copies the compiled bb_lsp server into the
// VSIX layout (dist/server/lsp/server.js) so resolution order (c) works.
import { build } from "esbuild"
import { mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
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

// E5 test bridge: the pure status model + fixture constants bundled CJS so
// the in-editor test (extension host) can require them without tsx.
await build({
  entryPoints: [path.join(here, "src/status-model.ts")],
  bundle: true,
  outfile: path.join(here, "dist/test/status-model.js"),
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: false,
  minify: false,
  logLevel: "silent",
})

// X1 test bridge: the graph panel's pure core (bb/graph + render through the
// ONE W1 renderer core) bundled CJS for the in-editor graph leg.
await build({
  entryPoints: [path.join(here, "src/graph-panel.ts")],
  bundle: true,
  outfile: path.join(here, "dist/test/graph-panel.js"),
  external: ["vscode", "vscode-languageclient/node"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: false,
  minify: false,
  logLevel: "silent",
})

// M42.H4 test bridge: the impact panel's pure core (bb/impact + render
// through the ONE core's renderImpact) bundled CJS for the in-editor leg.
await build({
  entryPoints: [path.join(here, "src/impact-panel.ts")],
  bundle: true,
  outfile: path.join(here, "dist/test/impact-panel.js"),
  external: ["vscode", "vscode-languageclient/node"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: false,
  minify: false,
  logLevel: "silent",
})

// M42.H5 test bridge: the hub panel's pure core (usages-mode bb/graph +
// render of the three hub sections + staleness) bundled CJS for the in-editor
// leg.
await build({
  entryPoints: [path.join(here, "src/hub-panel.ts")],
  bundle: true,
  outfile: path.join(here, "dist/test/hub-panel.js"),
  external: ["vscode", "vscode-languageclient/node"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: false,
  minify: false,
  logLevel: "silent",
})

// M42.H6 test bridge: the webview→editor navigation handler (pure core +
// real vscode bindings) bundled CJS so the in-editor leg drives the SAME
// executeHubMessage the webview messages dispatch to — one code path, two
// doors (headless verifier + real editor).
await build({
  entryPoints: [path.join(here, "src/hub-navigation.ts")],
  bundle: true,
  outfile: path.join(here, "dist/test/hub-navigation.js"),
  external: ["vscode", "vscode-languageclient/node"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: false,
  minify: false,
  logLevel: "silent",
})

// Bundle the compiled server alongside (bundled-dist resolution leg). The
// dist server must exist first: run `npm run build` at the repo root.
// The tsup dist is CHUNKED (server.js imports shared chunk-*.js files), so we
// stage the server's whole import closure — server.js plus every chunk it
// references, preserving relative layout (dist/server/lsp/server.js +
// dist/server/chunk-*.js). A single-file copy cannot execute (M25.E5 found
// this: ERR_MODULE_NOT_FOUND for the first chunk import).
const serverDist = path.join(repoRoot, "dist/lsp/server.js")
if (existsSync(serverDist)) {
  // Walk the TRANSITIVE relative-import closure of the dist server (chunks
  // import other chunks) and stage every file, preserving the layout
  // relative to dist/ (lsp/server.js → ../chunk-X.js ⇒ server/chunk-X.js).
  const distRoot = path.join(repoRoot, "dist")
  const staged = new Set()
  const queue = [serverDist]
  while (queue.length > 0) {
    const src = queue.pop()
    if (staged.has(src) || !existsSync(src)) continue
    staged.add(src)
    const relFromDist = path.relative(distRoot, src)
    const dest = path.join(here, "dist/server", relFromDist)
    mkdirSync(path.dirname(dest), { recursive: true })
    copyFileSync(src, dest)
    const code = readFileSync(src, "utf8")
    // Static (from "./x") AND dynamic (import("./x")) relative imports —
    // tsup keeps dynamic imports as separate lazy chunks (the freshness
    // monitor is one), so missing this class of import silently breaks the
    // staged server at runtime (found live by E5's staleness leg).
    for (const m of code.matchAll(/(?:from|import)\s*\(?\s*"(\.{1,2}\/[^"]+)"/g)) {
      queue.push(path.resolve(path.dirname(src), m[1]))
    }
  }
  // Runtime WASM assets: the parser stack resolves grammars by STRING-CONSTRUCTED
  // paths relative to the module dir (src/util/bb-data-dir.ts bbWasmCandidates:
  // moduleDir/../wasm/<basename> for the compiled flat layout). No import walk
  // can see these — they are data, not code. The list is DERIVED from
  // src/lsp/launch_languages.ts (the single owner of the launch set) at build
  // time, so a wave adding language N+1 cannot ship a server whose grammars
  // are missing — the exact drift found live: the wave-1 languages (javascript,
  // python) were missing here and the bundled server could not parse their
  // files. Everything else stays absent — the server's declared-absence
  // contract covers it honestly, and the VSIX stays small (not the full 97 MB
  // registry). verify-packaging.ts (E4) asserts the staged set equals this
  // same derived set.
  // Found live by E5's staleness leg: the parallel-indexer pool workers died
  // (exit 1) on first reindex because tree-sitter core was unresolvable from
  // the staged layout, so reindex completed with indexed: 0 and files stayed
  // stale forever.
  const launchSrc = readFileSync(path.join(repoRoot, "src/lsp/launch_languages.ts"), "utf8")
  const launchMatch = /LAUNCH_LANGUAGES = \[([\s\S]*?)\]/.exec(launchSrc)
  const launchLanguages = launchMatch ? [...launchMatch[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]) : []
  if (launchLanguages.length === 0) throw new Error("could not derive LAUNCH_LANGUAGES from src/lsp/launch_languages.ts — keep the derivation in sync")
  const GRAMMAR_BY_LANGUAGE = {
    typescript: ["tree-sitter-typescript.wasm", "tree-sitter-tsx.wasm"], // tsx shares the typescript package (engine.ts case "tsx")
    javascript: ["tree-sitter-javascript.wasm"],
    java: ["tree-sitter-java.wasm"],
    kotlin: ["tree-sitter-kotlin.wasm"],
    scala: ["tree-sitter-scala.wasm"],
    python: ["tree-sitter-python.wasm"],
    groovy: ["tree-sitter-groovy.wasm"],
    zig: ["tree-sitter-zig.wasm"],
    go: ["tree-sitter-go.wasm"],
    rust: ["tree-sitter-rust.wasm"],
    c: ["tree-sitter-c.wasm"],
    cpp: ["tree-sitter-cpp.wasm"],
    vue: ["tree-sitter-vue.wasm"],
    svelte: ["tree-sitter-svelte.wasm"],
  }
  const LAUNCH_LANGUAGE_WASM = [
    "tree-sitter.wasm", // parser core
    ...launchLanguages.flatMap((lang) => {
      const files = GRAMMAR_BY_LANGUAGE[lang]
      if (!files) throw new Error(`launch language "${lang}" has no grammar mapping in esbuild-extension.mjs GRAMMAR_BY_LANGUAGE — add it`)
      return files
    }),
  ]
  const wasmDestDir = path.join(here, "dist/wasm")
  mkdirSync(wasmDestDir, { recursive: true })
  for (const f of LAUNCH_LANGUAGE_WASM) {
    const src = path.join(repoRoot, "wasm", f)
    if (existsSync(src)) copyFileSync(src, path.join(wasmDestDir, f))
    else console.warn(`[bb-lsp] declared wasm asset missing from repo registry: wasm/${f}`)
  }

  // Fork target for the parallel indexer's worker pool: resolvePoolWorkerFork()
  // (src/ast/parallel-indexer.ts) expects pool-worker.js in the SERVER'S OWN
  // directory for any dist layout. tsup nests the server (dist/lsp/server.js),
  // so the flat dist/pool-worker.js must ALSO be staged next to server.js —
  // with its same-dir chunk imports rewritten one level up (chunks live in
  // dist/server/). Found live by E5: without it the fork test fails, indexing
  // falls back to in-process parsing, which blocks the event loop and stalls
  // every LSP request for the whole first reindex (20 s request timeouts).
  const workerSrc = path.join(repoRoot, "dist/pool-worker.js")
  if (existsSync(workerSrc)) {
    const workerDest = path.join(here, "dist/server/lsp/pool-worker.js")
    mkdirSync(path.dirname(workerDest), { recursive: true })
    const workerCode = readFileSync(workerSrc, "utf8").replaceAll('"./chunk-', '"../chunk-')
    writeFileSync(workerDest, workerCode)
  } else {
    console.warn("[bb-lsp] dist/pool-worker.js not found — indexer will fall back to in-process (slow, request-blocking)")
  }
} else {
  console.warn("[bb-lsp] repo dist/lsp/server.js not found — bundled leg omitted (build repo dist first)")
}

void result
