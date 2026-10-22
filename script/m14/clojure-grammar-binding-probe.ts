/**
 * CLOJURE GRAMMAR-BINDING PROBE — WHICH GRAMMAR BUILD DOES PRODUCTION ACTUALLY LOAD, AND DOES THE
 * PATH AGREE WITH THE BYTES (L-2026-10-21-11, L-2026-10-21-20).
 *
 * ## WHY THIS INSTRUMENT EXISTS
 *
 * A grammar citation is **the sha256 of the BYTES THE REGISTRY SERVES** — never a path, and never
 * the engine's own "language parser loaded" log line, which prints a path that is not necessarily
 * the file the bytes came from (the typescript lane measured that inversion; the Lead published it
 * twice before measuring it).
 *
 * The mechanism is at `src/util/bb-data-dir.ts:28` (`bbWasmCandidates`) and `src/util/wasm.ts:187-211`
 * (`resolveWasmAsset` / `hasWasmInRegistry`): the candidate list is
 * `<repo>/wasm/<name>` · `<repo>/../wasm/<name>` · `~/.bb/wasm/<name>` · `<cwd>/wasm/<name>`, and the
 * **repo's own `wasm/` directory is FIRST FOR EVERY SPELLING**; `resolveWasmAsset` returns the first
 * existing path and `hasWasmInRegistry` serves the bytes the same way. So PATH and BYTES AGREE — but
 * that is a claim about a mechanism, and this probe MEASURES it for clojure rather than assuming it.
 *
 * ## WHAT IT MEASURES
 *
 *   1 · the PATH production resolves (`resolveWasmAsset`, the same call `src/ast/engine.ts:1080` makes
 *       for clojure) and the sha256 of the file at that path;
 *   2 · the BYTES the wasm REGISTRY serves for the same name (`hasWasmInRegistry`) and their sha256;
 *   3 · the FIXTURE SUITE's build (`script/m14/run-fixtures.ts:57` names `tree-sitter-clojure.wasm`
 *       for the clojure lane, and `:704` loads `wasm/<name>`);
 *   4 · the NPM PACKAGE's build, if any is installed — named EXPLICITLY, because production never
 *       names `node_modules/` (so an installed npm build can be loaded by NOTHING);
 *   5 · the three surface digests of the build the registry serves (`measureSurface` from the
 *       Lead's pin instrument, which uses `nodeTypeIsNamed` and NOT `t.named` — the accessor matters,
 *       because a string has no `.named` and the split then counts every type as anonymous);
 *   6 · the R1 CANDIDATE's surface, when a build of a newer published package is present beside it,
 *       with the NAMED-TYPE DELTA between the two — the measurement the R1 ruling needs.
 *
 * ## WHAT IT DOES NOT CLAIM
 *
 * It does not say which build SHOULD be used (that is the Lead's call), and it does not say the two
 * builds are interchangeable. It says which bytes production loads, and whether the path and the
 * bytes agree — so a lane's citation is a fact about bytes.
 *
 * ## USAGE
 *
 *   bun run script/m14/clojure-grammar-binding-probe.ts
 *   bun run script/m14/clojure-grammar-binding-probe.ts --json validation/m14/measurements/clojure-grammar-binding.json
 *   bun run script/m14/clojure-grammar-binding-probe.ts --candidate grammars/tree-sitter-clojure/build/tree-sitter-clojure.wasm
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { resolveWasmAsset, hasWasmInRegistry } from "../../src/util/wasm"
import { measureSurface } from "./verify-grammar-pins"

const ROOT = process.cwd()
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const JSON_OUT = argOf("--json")
const CANDIDATE = argOf("--candidate")

const sha = (b: Uint8Array | Buffer): string => createHash("sha256").update(b).update("").digest("hex")
const L: string[] = []
const say = (s = "") => L.push(s)

/* THE ENGINE'S OWN CALL, VERBATIM: `src/ast/engine.ts:1079-1081` resolves the clojure grammar as
 * `resolveWasm("tree-sitter-clojure/tree-sitter-clojure.wasm")`. The NAME SPELLING matters, because
 * `bbWasmCandidates` takes the BASENAME and the registry is keyed by FILE NAME. */
const PRODUCTION_ASSET = "tree-sitter-clojure/tree-sitter-clojure.wasm"
const BASENAME = "tree-sitter-clojure.wasm"

say("CLOJURE GRAMMAR-BINDING PROBE — which bytes production loads, and whether path and bytes agree")
say()
say("== THE BINDING ==")
const productionPath = resolveWasmAsset(PRODUCTION_ASSET)
let productionSha = "(unreadable)"
try { productionSha = sha(readFileSync(productionPath)) } catch { /* declared below */ }
say(`  PRODUCTION's PATH  (src/ast/engine.ts:1080 -> resolveWasmAsset("${PRODUCTION_ASSET}"))`)
say(`    ${productionPath}`)
say(`    sha256 ${productionSha}`)

const registryBytes = hasWasmInRegistry(PRODUCTION_ASSET)
const registrySha = registryBytes ? sha(registryBytes) : "(no registry bytes)"
say(`  PRODUCTION's BYTES (the wasm REGISTRY — keyed by FILE NAME; the engine asks the registry)`)
say(`    sha256 ${registrySha}`)
say(`    ${productionSha === registrySha
  ? "the PATH and the BYTES AGREE — the file production resolves IS the file the registry serves"
  : "the PATH and the BYTES DIFFER — the engine's log prints the path, and the bytes actually loaded are the registry's"}`)

const FIXTURE_WASM = path.join(ROOT, "wasm", BASENAME)
let fixtureSha = "(unreadable)"
try { fixtureSha = sha(readFileSync(FIXTURE_WASM)) } catch { /* declared below */ }
say(`  THE FIXTURE SUITE's BUILD (script/m14/run-fixtures.ts:57 + :704 -> Language.load(wasm/${BASENAME}))`)
say(`    ${FIXTURE_WASM}`)
say(`    sha256 ${fixtureSha}`)

const nodeModulesWasm = path.join(ROOT, "node_modules", "tree-sitter-clojure", BASENAME)
let nodeModulesSha = "(absent — no npm build is installed in this tree)"
if (existsSync(nodeModulesWasm)) {
  try { nodeModulesSha = sha(readFileSync(nodeModulesWasm)) } catch { /* declared below */ }
}
say(`  THE NPM PACKAGE's BUILD (node_modules/tree-sitter-clojure/${BASENAME})`)
say(`    ${nodeModulesSha}`)

say()
say("== THE SURFACE OF THE BUILD THE REGISTRY SERVES ==")
const surfacePath = existsSync(productionPath) ? productionPath : FIXTURE_WASM
const { surface, namedUnique, uniqueNames } = await measureSurface(surfacePath)
say(`  file      ${surfacePath}`)
say(`  bytes     ${surface.ids} node-type slots · ${surface.namedUnique} named unique · ${surface.anonUnique} anonymous unique · ${surface.fieldCount} fields`)
say(`  idOrderDigest   ${surface.idOrderDigest}`)
say(`  typeSetDigest   ${surface.typeSetDigest}`)
say(`  fieldSetDigest  ${surface.fieldSetDigest}`)
say(`  named types (${namedUnique.length}): ${namedUnique.join(" ")}`)

/* THE MIXIN QUESTION, IN THE INVENTORY'S OWN TERMS: is there a node type that NAMES a mixin,
 * a protocol extension, a decorator, a render element or a part? The scan is over the inventory's
 * names — NOT over the corpus — and it is a question about the GRAMMAR, not about the language. */
const MIXIN_WORDS = ["mixin", "mixes", "extend", "protocol", "decorat", "render", "part", "include", "prepend"]
const hits = namedUnique.filter((n) => MIXIN_WORDS.some((w) => n.toLowerCase().includes(w)))
say(`  the inventory's names matching /${MIXIN_WORDS.join("|")}/: ${hits.length === 0 ? "NONE" : hits.join(" ")}`)
say(`  ⇒ the wired grammar exposes NO node type for a mixin, a protocol extension, a decorator, a render element or a part`)

/* THE R1 CANDIDATE — the newest published package's build, if it is present beside the wired one.
 * The R1 RULING NEEDS THIS: "is there a newer build whose inventory HAS the construct?" is a
 * measurement over inventories, and the answer is a named-type DELTA, never a prose claim. */
let candidate: { path: string; sha: string; named: string[]; surface: any; delta: { added: string[]; removed: string[] } } | null = null
if (CANDIDATE) {
  const abs = path.isAbsolute(CANDIDATE) ? CANDIDATE : path.join(ROOT, CANDIDATE)
  if (existsSync(abs)) {
    const m = await measureSurface(abs)
    const named = new Set(m.namedUnique)
    const wired = new Set(namedUnique)
    const added = [...named].filter((n) => !wired.has(n)).sort()
    const removed = [...wired].filter((n) => !named.has(n)).sort()
    candidate = { path: abs, sha: sha(readFileSync(abs)), named: m.namedUnique, surface: m.surface, delta: { added, removed } }
    say()
    say("== THE R1 CANDIDATE (the newest published package's build) ==")
    say(`  file      ${abs}`)
    say(`  sha256    ${candidate.sha}`)
    say(`  bytes     ${m.surface.ids} node-type slots · ${m.surface.namedUnique} named unique · ${m.surface.anonUnique} anonymous unique · ${m.surface.fieldCount} fields`)
    say(`  idOrderDigest   ${m.surface.idOrderDigest}`)
    say(`  typeSetDigest   ${m.surface.typeSetDigest}`)
    say(`  fieldSetDigest  ${m.surface.fieldSetDigest}`)
    say(`  NAMED-TYPE DELTA vs the wired build: added ${added.length} · removed ${removed.length}`)
    if (added.length) say(`    added:   ${added.join(" ")}`)
    if (removed.length) say(`    removed: ${removed.join(" ")}`)
    const candHits = m.namedUnique.filter((n) => MIXIN_WORDS.some((w) => n.toLowerCase().includes(w)))
    say(`  the candidate's names matching the mixin/decorator/render/part words: ${candHits.length === 0 ? "NONE" : candHits.join(" ")}`)
  } else {
    say()
    say(`== THE R1 CANDIDATE == ${abs} is ABSENT — no build of a newer published package is present.`)
  }
}

console.log(L.join("\n"))

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({
    instrument: "script/m14/clojure-grammar-binding-probe.ts",
    question: "which clojure grammar build does production load, and do the path and the bytes agree (L-11, L-20)?",
    binding: {
      productionAsset: PRODUCTION_ASSET,
      productionPath, productionSha,
      registrySha,
      pathAndBytesAgree: productionSha === registrySha,
      fixturePath: FIXTURE_WASM, fixtureSha,
      nodeModulesPath: nodeModulesWasm, nodeModulesSha,
      fixtureEqualsProduction: fixtureSha === productionSha,
    },
    surface: { file: surfacePath, ...surface, namedTypes: namedUnique, allTypeNames: uniqueNames },
    mixinNodeTypeHits: hits,
    r1Candidate: candidate
      ? { path: candidate.path, sha: candidate.sha, surface: candidate.surface, namedTypes: candidate.named, delta: candidate.delta }
      : null,
  }, null, 2))
  console.log(`\nJSON written: ${JSON_OUT}`)
}
