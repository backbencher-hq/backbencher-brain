// ide/vscode/collect-server-deps.mjs — ships the bundled server's runtime deps.
//
// History (owner spot-check, 2026-09-05): the VSIX bundled dist/lsp/server.js
// but none of its runtime dependencies. Server resolution order (b) workspace
// dist always won in the E5 test rig (its workspace IS the repo, node_modules
// present), so E5 never saw it; a real workspace fell to (c) bundled and the
// server died with ERR_MODULE_NOT_FOUND before initialize. This script copies
// the exact runtime deps the bundled server graph needs into
// dist/server/node_modules so the packaged server is self-contained. The
// extension points NODE_PATH at that dir when spawning (extension.ts).
//
// Drift-gated by script/m25/verify-packaging.ts (rule: the staging dir must
// contain node_modules/better-sqlite3 and node_modules/drizzle-orm).
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "../..")
const staging = path.join(here, "dist/server")

const require = createRequire(path.join(repoRoot, "package.json"))

rmSync(path.join(staging, "node_modules"), { recursive: true, force: true })
mkdirSync(staging, { recursive: true })

function resolvePkgDir(name) {
  try {
    const pkgJson = require.resolve(`${name}/package.json`)
    return path.dirname(pkgJson)
  } catch {
    // Some packages (drizzle-orm) don't export ./package.json — resolve the
    // main entry and walk up to the package root.
    const entry = require.resolve(name)
    let dir = path.dirname(entry)
    while (dir !== "/" && !existsSync(path.join(dir, "package.json"))) dir = path.dirname(dir)
    return dir
  }
}

// better-sqlite3: the native N-API build. .node binaries ride along with the
// package copy — no rebuild needed (same platform assumption as the rest of
// the repo's tooling; declared in verify-packaging).
const sqliteDir = resolvePkgDir("better-sqlite3")
cpSync(sqliteDir, path.join(staging, "node_modules/better-sqlite3"), { recursive: true })

// its direct runtime deps that are NOT bundled by esbuild
for (const dep of ["bindings", "file-uri-to-path", "node-gyp-build", "prebuild-install", "tar-fs", "token-types"]) {
  try {
    const dir = resolvePkgDir(dep)
    cpSync(dir, path.join(staging, "node_modules", dep), { recursive: true })
    console.log(`  + ${dep}`)
  } catch {
    console.log(`  (skipped ${dep}: not resolvable — may be bundled already)`)
  }
}

// drizzle-orm: pure JS, imported at runtime via dynamic import in brain core.
const drizzleDir = resolvePkgDir("drizzle-orm")
cpSync(drizzleDir, path.join(staging, "node_modules/drizzle-orm"), { recursive: true })
console.log("  + drizzle-orm")
console.log("  + better-sqlite3")

// web-tree-sitter: dynamic import in src/util/wasm.ts. NOT bundled by esbuild
// and NOT under better-sqlite3's subtree, so nothing above ships it — the
// owner's demo hit exactly this: the bundled server booted, served db-backed
// hover/hub, then died on the first parse request (documentHighlight, call
// hierarchy, occurrence-first hover) with ERR_MODULE_NOT_FOUND. NODE_PATH
// cannot fix it: Node ignores NODE_PATH for ESM imports, so the staged
// node_modules next to the server entry is the only reliable location.
// (Grammar wasms are NOT staged here — esbuild-extension.mjs derives the
// launch-set grammar list from src/lsp/launch_languages.ts and stages
// dist/wasm; one owner per concern.)
try {
  const wtsDir = resolvePkgDir("web-tree-sitter")
  cpSync(wtsDir, path.join(staging, "node_modules/web-tree-sitter"), { recursive: true })
  console.log("  + web-tree-sitter")
} catch (e) {
  console.log(`  ERROR staging web-tree-sitter: ${e.message}`)
  process.exitCode = 1
}
console.log(`server runtime deps staged into ${path.join(here, "dist/server/node_modules")}`)
