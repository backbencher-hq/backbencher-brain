/**
 * script/m14/sql-grammar-binding-probe.ts — WHICH BYTES DOES SQL ACTUALLY LOAD?
 *
 * THE RULE THIS MEASURES. A grammar citation is the **sha256 of the bytes the REGISTRY SERVES**, never
 * a path and never a log line. The engine's own "language parser loaded" log prints a PATH, and the
 * path is not necessarily the file the bytes came from: `getParser` resolves a path and then asks the
 * wasm REGISTRY for the bytes, and the registry is keyed by FILE NAME FIRST — so two files with one
 * name in two directories are a live ambiguity, and the one that is LOADED is the registry's.
 *
 * This is the sql lane's generalisation of `script/m14/ts-grammar-binding-probe.ts`, which is
 * typescript-specific. It prints, side by side and for the `sql` language only:
 *   1. the PRODUCTION path's bytes  (`src/ast/engine.ts` → `resolveWasmAsset("tree-sitter-sql/…")`);
 *   2. the REGISTRY's bytes          (what the engine actually asks for);
 *   3. the FIXTURE SUITE's bytes     (`script/m14/run-fixtures.ts` → `wasm/<name>.wasm`);
 *   4. the NPM PACKAGE's bytes       (`node_modules/<pkg>/<pkg>.wasm`, if the package ships one);
 * and it states, in words, which of them are the same file and which are not.
 *
 * **⇒ THE NUMBER EVERY SQL CITATION MUST CARRY IS IN THIS OUTPUT**, and the lane's own measurement
 * (`script/m14/sql-grammar-remedy.ts`) is stated against the same registry bytes, so the two
 * instruments cannot disagree about which build they measured.
 */
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { hasWasmInRegistry, resolveWasmAsset } from "../../src/util/wasm.ts"

const ROOT = process.cwd()
const sha = (b: Uint8Array | Buffer) => createHash("sha256").update(b).digest("hex")
const L: string[] = []
const say = (s: string) => { L.push(s); console.log(s) }

const PRODUCTION_ASSET = "tree-sitter-sql/tree-sitter-sql.wasm"
const FIXTURE_WASM = join(ROOT, "wasm", "tree-sitter-sql.wasm")
const NPM_WASM = join(ROOT, "node_modules", "@derekstride", "tree-sitter-sql", "tree-sitter-sql.wasm")

say("== THE SQL GRAMMAR BINDING — WHICH BYTES ARE ACTUALLY LOADED ==")
say("")

// ── 1 · the production path
const productionPath = resolveWasmAsset(PRODUCTION_ASSET)
let productionSha = "(unreadable)"
try { productionSha = sha(readFileSync(productionPath)) } catch { /* declared below */ }
say(`  PRODUCTION's PATH  (src/ast/engine.ts -> resolveWasmAsset("${PRODUCTION_ASSET}"))`)
say(`    ${productionPath}`)
say(`    sha256 ${productionSha}`)

// ── 2 · the registry's bytes — WHAT THE ENGINE ACTUALLY LOADS
const registryBytes = hasWasmInRegistry(PRODUCTION_ASSET)
const registrySha = registryBytes ? sha(registryBytes) : "(no registry bytes)"
say(`  PRODUCTION's BYTES (the wasm REGISTRY — the file-NAME key wins, and the engine asks the registry)`)
say(`    sha256 ${registrySha}`)
say(`    ${productionSha === registrySha
  ? "the PATH and the BYTES agree"
  : "the PATH and the BYTES DIFFER — the engine's LOG prints the path, and the BYTES actually loaded are the registry's"}`)
say(`    ⇒ THE BUILD PRODUCTION LOADS: ${registrySha.slice(0, 16)}`)

// ── 3 · the fixture suite's build
let fixtureSha = "(unreadable)"
try { fixtureSha = sha(readFileSync(FIXTURE_WASM)) } catch { /* declared below */ }
say(`  THE FIXTURE SUITE's BUILD (script/m14/run-fixtures.ts -> Language.load(wasm/${"tree-sitter-sql.wasm"}))`)
say(`    ${FIXTURE_WASM}`)
say(`    sha256 ${fixtureSha}`)

// ── 4 · the npm package's build
let npmSha = "(unreadable)"
if (existsSync(NPM_WASM)) npmSha = sha(readFileSync(NPM_WASM))
say(`  THE NPM PACKAGE's BUILD (node_modules/@derekstride/tree-sitter-sql/tree-sitter-sql.wasm)`)
say(`    ${existsSync(NPM_WASM) ? NPM_WASM : "(not installed in this tree)"}`)
say(`    sha256 ${npmSha}`)

say("")
say(`  ⇒ THE BUILDS IN THIS TREE: production ${productionSha.slice(0, 16)} · registry ${registrySha.slice(0, 16)} · fixtures ${fixtureSha.slice(0, 16)} · npm ${npmSha.slice(0, 16)}`)
say(`    ${registrySha === fixtureSha
  ? "PRODUCTION and the FIXTURES load the SAME BYTES — sql is NOT one of the lanes where they differ"
  : "PRODUCTION and the FIXTURES load DIFFERENT BYTES — every sql number must say which build it came from"}`)
say(`    ${fixtureSha === npmSha
  ? "the fixtures and the npm package are the same bytes"
  : "the fixtures are NOT the npm package's bytes — the wired build is a LOCAL FORK (see grammars/tree-sitter-sql/PIN.md)"}`)

// ── 5 · the surface of the bytes the registry serves, because a citation is a sha AND a surface
try {
  const { measureSurface } = await import("./verify-grammar-pins.ts")
  const s = await measureSurface(FIXTURE_WASM)
  const surf: any = s.surface
  say("")
  say("  == THE SURFACE OF THE BYTES THE REGISTRY SERVES ==")
  say(`    named types ${surf.namedUnique ?? surf.namedIds} · ids ${surf.ids} · anonymous ${surf.anonIds} · fields ${surf.fieldCount}`)
  say(`    idOrderDigest ${surf.idOrderDigest}`)
  say(`    typeSetDigest ${surf.typeSetDigest}`)
  say(`    fieldSetDigest ${surf.fieldSetDigest}`)
} catch (e) {
  say("")
  say(`  (the surface could not be measured: ${(e as Error)?.message})`)
}
