// ide/vscode/esbuild-extension.mjs — M25.E1/E4 build.
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the bb_lsp VS Code extension build: bundles src/
// extension.ts (and the panel/test bridges) with esbuild, and stages the
// compiled bb_lsp server, its grammar wasms, and the indexer pool worker
// into dist/ so collect-server-deps.mjs can ship runtime deps next to them.
//
// WHICH TOOL IT SERVES — bb-lsp-vscode (the VS Code-family extension client).
//
// WHY IT IS SHAPED THIS WAY — esbuild bundles the extension entry with vscode
// external (the editor supplies it); the server dist is CHUNKED (tsup), so the
// whole relative import closure is staged, preserving layout; grammar wasms
// are NOT discoverable by any import walk (data loaded by string paths from
// src/util/bb-data-dir.ts) — they are DERIVED from the single launch-set
// owner src/lsp/launch_languages.ts at build time, so a wave adding language
// N+1 cannot ship a server that cannot parse its files; the pool worker's
// same-dir chunk imports are rewritten one level up for the nested
// dist/server/ layout. package.json cannot import TS, so activationEvents
// lockstep with the launch set is ASSERTED here and the build fails on drift
// — no second language list is maintained anywhere.
//
// WHERE ITS EVIDENCE LIVES — language list: src/lsp/launch_languages.ts
// (derived here with the same derivation as script/m25/verify-packaging.ts);
// grammar mapping: GRAMMAR_BY_LANGUAGE in this file (declared, per language);
// lockstep: the manifest assertion below, run on every build; the built
// dist/extension.js sha256 is the release identity recorded after a green
// build (task-4 verification).
//
// EDIT TOGETHER WHEN THIS FILE CHANGES — ide/vscode/package.json
// (activationEvents must match the launch set; this file fails the build on
// drift), src/lsp/launch_languages.ts (single owner of the launch set — a
// wave change here requires a grammar mapping here and a manifest change),
// script/m25/verify-packaging.ts (independently re-derives the same set and
// asserts the staged wasms).
//
// CONTRACTS IT MUST NOT BREAK — contract §9 language onboarding (the client
// surface covers exactly the launch set); the bundled server parses every
// launch language (staged grammar wasms cover the set).
//
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

  // Lockstep with the manifest: package.json cannot import TS, so its
  // activationEvents are asserted against the single launch-set owner and the
  // build FAILS on drift. A language missing from activationEvents is a
  // language the extension never activates on (the 7-vs-14 defect).
  const manifest = JSON.parse(readFileSync(path.join(here, "package.json"), "utf8"))
  const declared = (manifest.activationEvents ?? [])
    .map((e) => { const m = /^onLanguage:([a-z0-9+]+)$/.exec(e); return m ? m[1] : null })
    .filter((e) => e !== null)
  const missing = launchLanguages.filter((l) => !declared.includes(l))
  const extra = declared.filter((d) => !launchLanguages.includes(d))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `bb_lsp activation drift: package.json activationEvents do not match the launch set ` +
      `(src/lsp/launch_languages.ts, ${launchLanguages.length} languages). ` +
      `Missing: ${missing.join(", ") || "none"}. Extra: ${extra.join(", ") || "none"}. ` +
      `Update package.json activationEvents to cover every launch language; do not maintain a second list.`,
    )
  }
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
