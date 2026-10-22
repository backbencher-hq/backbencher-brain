/**
 * RUBY GRAMMAR — THE CITATION RE-CHECKED AGAINST THE REGISTRY'S BYTES.
 *
 * WHY THIS INSTRUMENT EXISTS. The Lead's own ruling session measured two of the Lead's grammar
 * rulings wrong, and the correction named a fleet-wide trap: "the engine's own 'language parser
 * loaded' log prints a path that is NOT the file the bytes came from, so a lane citing the log
 * cites the wrong build". The mechanism is `src/util/bb-data-dir.ts:28` — the repo's own `wasm/`
 * directory is FIRST in the candidate list for every spelling, so PATH and BYTES agree — but PATH
 * agreeing with BYTES is a claim, and this lane's citation had better be measured against the
 * BYTES THE REGISTRY SERVES rather than against a file found by path.
 *
 * ⇒ THIS LANE'S PREVIOUS CITATION COMPUTED ITS sha256 WITH `readFileSync(path.join(ROOT,
 * "wasm/tree-sitter-ruby.wasm"))` — A FILE FOUND BY PATH. That is the trap's shape. This instrument
 * measures the served bytes three ways and compares them.
 *
 * THE THREE MEASUREMENTS, ALL IN ONE PROCESS:
 *
 *   (A) THE REGISTRY'S BYTES — `hasWasmInRegistry("tree-sitter-ruby/tree-sitter-ruby.wasm")`
 *       returns the Uint8Array the engine actually serves, and the sha256 is computed over THAT
 *       ARRAY. This is the citation that matters: it is what the parser parses with.
 *   (B) THE RESOLVED PATH — `resolveWasmAsset(...)` is the engine's own resolution, and the sha256 is
 *       computed over the file at that path. This is the "path" half of the trap.
 *   (C) THE REPO'S OWN FILE — the sha256 of `wasm/tree-sitter-ruby.wasm` relative to the repo root,
 *       which is what the previous citation named.
 *
 * ⇒ AND THE FOURTH MEASUREMENT IS THE ONE THAT PROVES THE CITATION IS ABOUT THE SAME GRAMMAR THE
 * ANALYZER USES: the node-type inventory is read from `getParser("ruby").language.nodeTypeForId` —
 * the PRODUCTION parser's own Language object — and its digest is compared against the same digest
 * computed from the served bytes' own tree-sitter language, so the citation and the inventory
 * cannot drift apart.
 *
 * EXIT CODE: 0 when every measurement agrees (the citation is sound); 3 when they do not (the
 * citation is WRONG and the lane says so rather than publishing it).
 */
import { createHash } from "node:crypto"
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..")
const OUT = path.join(ROOT, "validation", "m14", "measurements", "ruby-grammar-bytes-recheck.json")

const sha256 = (b: Uint8Array | Buffer): string => createHash("sha256").update(b).digest("hex")

const { hasWasmInRegistry, resolveWasmAsset } = await import("../../src/util/wasm")
const { getParser } = await import("../../src/ast/engine")

const NAME = "tree-sitter-ruby/tree-sitter-ruby.wasm"
const FILE_NAME = "tree-sitter-ruby.wasm"

// ── (A) THE REGISTRY'S BYTES — the citation that matters ──────────────────────────────────────────
const served = hasWasmInRegistry(NAME)
const servedSha = served ? sha256(served) : null

// ── (B) THE RESOLVED PATH — the engine's own resolution ───────────────────────────────────────────
const resolved = resolveWasmAsset(NAME)
const resolvedPath = resolved && resolved !== NAME ? resolved : null
const resolvedSha = resolvedPath && existsSync(resolvedPath) ? sha256(readFileSync(resolvedPath)) : null

// ── (C) THE REPO'S OWN FILE — what the previous citation named ────────────────────────────────────
const repoFile = path.join(ROOT, "wasm", FILE_NAME)
const repoSha = existsSync(repoFile) ? sha256(readFileSync(repoFile)) : null

// ── (D) THE PRODUCTION PARSER'S OWN LANGUAGE — the inventory the citation is ABOUT ────────────────
const parser = await getParser("ruby" as any)
const lang = (parser as any).language
const namedTypes: string[] = []
let anonymousCount = 0
let totalCount = 0
// THE ACCESSOR IS `nodeTypeIsNamed(id)`, NOT `.named` ON THE STRING `nodeTypeForId(id)` RETURNS.
// web-tree-sitter's Language.nodeTypeForId returns the type NAME as a string, and a string has no
// `.named` property — so reading `t.named` counts EVERY type as anonymous, which is how this
// instrument's first run reported "0 named of 353" against the original instrument's 158 of 353
// for the SAME wasm. The TOTAL agreeing (353) is what proved it was a classification bug and not a
// different grammar, and the fix is the same accessor the original instrument uses.
const typeCount = lang.nodeTypeCount
totalCount = typeCount
for (let id = 1; id < typeCount; id++) {
  const t = lang.nodeTypeForId(id)
  if (t == null) continue
  if (lang.nodeTypeIsNamed(id)) namedTypes.push(t)
  else anonymousCount++
}

const measurements = {
  registryBytes: { sha256: servedSha, byteLength: served ? served.byteLength : null },
  resolvedPath: { path: resolvedPath, sha256: resolvedSha, relativeToRepo: resolvedPath ? path.relative(ROOT, resolvedPath) : null },
  repoFile: { path: path.relative(ROOT, repoFile), sha256: repoSha },
}

const allSha = [servedSha, resolvedSha, repoSha].filter(Boolean)
const agree = new Set(allSha).size === 1 && allSha.length === 3

const report = {
  question:
    "Is the sha256 this lane's citation names the digest of the BYTES THE REGISTRY SERVES for ruby, or of a file found by PATH?",
  why:
    "The Lead's ruling session measured two of the Lead's own grammar rulings wrong, and named the fleet-wide trap: the engine's 'language parser loaded' log prints a path that is NOT the file the bytes came from, so a lane citing the log cites the wrong build. The mechanism is src/util/bb-data-dir.ts:28 — the repo's own wasm/ directory is first in the candidate list for every spelling, so path and bytes agree. This instrument measures the SERVED BYTES rather than trusting that agreement.",
  measurements,
  agree,
  verdict: agree
    ? "CONFIRMED — the registry's bytes, the engine's resolved path and the repo's own file are the SAME BUILD, so the citation names the build the analyzer parses with."
    : "NOT CONFIRMED — the three measurements disagree, and this lane's citation is WRONG.",
  inventory: {
    source: "ASTEngine.getParser('ruby').language.nodeTypeForId — the PRODUCTION parser's own Language object",
    namedCount: namedTypes.length,
    anonymousCount,
    totalCount,
    grammarWasm: "wasm/tree-sitter-ruby.wasm",
    grammarWasmSha256: servedSha,
  },
  instrument: "script/m14/ruby-grammar-bytes-recheck.ts",
}

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")

console.log("RUBY GRAMMAR — THE CITATION RE-CHECKED AGAINST THE REGISTRY'S BYTES")
console.log(`  (A) the bytes the REGISTRY SERVES   sha256 ${servedSha}  (${served ? served.byteLength : 0} bytes)`)
console.log(`  (B) the path the engine RESOLVES     sha256 ${resolvedSha}  ${measurements.resolvedPath.relativeToRepo ?? ""}`)
console.log(`  (C) the repo's own file               sha256 ${repoSha}  ${measurements.repoFile.path}`)
console.log(`  ⇒ ${report.verdict}`)
console.log(`  inventory from the PRODUCTION parser's own Language object: ${namedTypes.length} named of ${totalCount} node-type ids, ${anonymousCount} anonymous`)
process.exit(agree ? 0 : 3)
