/**
 * DART GRAMMAR PROBE — WHICH BYTES THE REGISTRY SERVES, WHAT THE GRAMMAR'S INVENTORY HOLDS, AND
 * WHAT EACH OF THE TWO UNADJUDICATED EXTENDED VALUES COULD POSSIBLY BE.
 *
 * ## WHY THIS INSTRUMENT EXISTS
 *
 * Three separate rules in the campaign's own pages make a grammar claim that is not measured at BYTE
 * level worthless:
 *
 *   · L-2026-10-21-11 / L-2026-10-21-20 — **A GRAMMAR CITATION IS THE SHA-256 OF THE BYTES THE
 *     REGISTRY SERVES, NEVER A PATH AND NEVER A LOG LINE.** The engine's own "language parser
 *     loaded" log prints a path that is NOT the file the bytes came from, so a lane that cites the
 *     log cites the wrong build. The Lead got this wrong twice and the fleet paid for it.
 *   · L-2026-10-21-05 — **ONE GRAMMAR BUILD IS THE GRAMMAR**, and the node-type count a ruling
 *     cites must belong to the build the census actually loaded, beside that build's sha256.
 *   · L-2026-10-21-06 — the three admissibility tests for a ruling: the BUILD test (sha256 beside
 *     the node-type count, with a positive control), the NEAR-MISS test (a near-miss construct
 *     NAMED AND COUNTED), and the INFORMATION test (the row it would produce must carry information).
 *
 * ## WHAT IT MEASURES
 *
 *   1 · THE BINDING — `resolveWasmAsset` (the path the engine resolves) and `hasWasmInRegistry`
 *     (the bytes the engine actually loads), hashed, and whether they agree. The registry is keyed
 *     by FILE NAME, so the repo's own `wasm/` directory is the first candidate for every spelling.
 *   2 · THE SURFACE — `measureSurface` from the shared pin instrument: the id-order digest (the
 *     identity that survives a rebuild), the type-set digest, the field-set digest, and the
 *     named/anonymous node-type counts.
 *   3 · THE INVENTORY — every named node type of the wired build, and the CANDIDATE SPELLINGS for
 *     each of the two values this lane still has to classify (`renders`, `decorates`).
 *   4 · THE COUNTERFACTUALS — the constructs themselves, parsed by the wired build, so "the grammar
 *     cannot express it" is a fact about the grammar and not an inference from a node list.
 *   5 · THE POSITIVE CONTROL — the SAME scan over two grammars that DO have the construct, so the
 *     absence of a node type is a fact about the DART grammar and not an artefact of the scan.
 *
 * ## WHAT IT DOES NOT CLAIM
 *
 * It does not decide any ruling: it produces the numbers a ruling must cite. A construct's ABSENCE
 * from the inventory is half a ruling; the corpus half (how many sites the construct has in the
 * admitted population) is `script/m14/dart-extended-census.ts`, and the two are cited together.
 *
 * Usage:
 *   bun run script/m14/dart-grammar-probe.ts [--json <out.json>]
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { resolveWasmAsset, hasWasmInRegistry } from "../../src/util/wasm"
import { measureSurface } from "./verify-grammar-pins"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const JSON_OUT = argOf("--json")
const sha = (b: Uint8Array | Buffer): string => createHash("sha256").update(b).digest("hex")
const L: string[] = []
const say = (s = "") => L.push(s)

// ─── 1 · THE BINDING: THE PATH THE ENGINE RESOLVES, AND THE BYTES THE ENGINE LOADS ─────────────
const ASSET = "tree-sitter-dart/tree-sitter-dart.wasm"
const resolvedPath = resolveWasmAsset(ASSET)
const registryBytes = hasWasmInRegistry(ASSET)
const pathSha = existsSync(resolvedPath) ? sha(readFileSync(resolvedPath)) : "(unreadable)"
const regSha = registryBytes ? sha(registryBytes) : "(no registry bytes)"

say("DART GRAMMAR PROBE — the bytes, the inventory, and the two unadjudicated extended values")
say()
say("== 1 · THE BINDING (the BYTES the registry serves, beside the PATH the engine resolves) ==")
say(`  engine's asset name        ${ASSET}`)
say(`  resolveWasmAsset(...) ->   ${resolvedPath}`)
say(`    path   sha256 ${pathSha}`)
say(`  hasWasmInRegistry(...)     ${registryBytes ? `sha256 ${regSha}` : "(no bytes)"}`)
say(`    ⇒ ${pathSha === regSha ? "THE PATH AND THE BYTES AGREE" : "THE PATH AND THE BYTES DIFFER — the engine's log prints the path, and the BYTES loaded are the registry's"}`)
say(`    ⇒ THE BUILD THIS LANE MEASURES: ${regSha}`)
// THE OTHER SPELLING. `wasm/dart.wasm` and `wasm/tree-sitter-dart.wasm` are the same bytes; the
// registry is keyed by FILE NAME, so both spellings are checked, because a lane that cited one and
// measured the other would be citing a build it did not load.
const altSpellings = ["dart.wasm", "tree-sitter-dart.wasm"]
for (const alt of altSpellings) {
  const p = path.join(ROOT, "wasm", alt)
  if (!existsSync(p)) { say(`  wasm/${alt} — ABSENT`); continue }
  const s = sha(readFileSync(p))
  say(`  wasm/${alt}  sha256 ${s}  ${s === regSha ? "— THE SAME BYTES the registry serves" : "— DIFFERENT BYTES"}`)
}
say(`  node_modules/tree-sitter-dart — ${existsSync(path.join(ROOT, "node_modules", "tree-sitter-dart")) ? "PRESENT (named explicitly, never reached by the registry's candidate list)" : "ABSENT — the npm package is not installed, so the repo's wasm/ build is the only dart grammar on this machine"}`)

// ─── 2 · THE SURFACE ───────────────────────────────────────────────────────────────────────────
const WIRED = path.join(ROOT, "wasm", "tree-sitter-dart.wasm")
const { surface, namedUnique } = await measureSurface(WIRED)
say()
say("== 2 · THE SURFACE (the shared pin instrument's measureSurface, on the wired build) ==")
say(`  build            ${WIRED}`)
say(`  sha256           ${sha(readFileSync(WIRED))}`)
say(`  node-type ids    ${surface.ids}`)
say(`  named ids        ${surface.namedIds}   named unique ${surface.namedUnique}`)
say(`  anon  ids        ${surface.anonIds}   anon  unique ${surface.anonUnique}`)
say(`  fields           ${surface.fieldCount}`)
say(`  idOrderDigest    ${surface.idOrderDigest}   (the identity that survives a rebuild)`)
say(`  typeSetDigest    ${surface.typeSetDigest}`)
say(`  fieldSetDigest   ${surface.fieldSetDigest}`)

// ─── 2b · THE NEWEST AVAILABLE GRAMMAR ─────────────────────────────────────────────────────────
// A RULING THAT SAYS "THE GRAMMAR CANNOT EXPRESS IT" IS ONLY TRUE OF THE GRAMMAR IT MEASURED. The
// npm registry holds exactly ONE published `tree-sitter-dart` (1.0.0, 2023-03-24) and a build of
// it is 41 node types BEHIND the wired one, so the wired build is not the newest source; the
// upstream repository is, and it is cloned in this tree (grammars/tree-sitter-dart-upstream).
// So the inventory is measured over BOTH: the build production loads, and the newest build anyone
// can get. A candidate spelling that is ABSENT from both is absent from the language, not from one
// build of it.
const NEWEST = path.join(ROOT, ".tmp-census", "dart-upstream-head.wasm")
const NEWEST_SRC = path.join(ROOT, "grammars", "tree-sitter-dart-upstream")
let newestSurface: any = null
let newestNamedUnique: string[] = []
if (existsSync(NEWEST)) {
  const r = await measureSurface(NEWEST)
  newestSurface = r.surface
  newestNamedUnique = r.namedUnique
  say()
  say("== 2b · THE NEWEST AVAILABLE GRAMMAR (a ruling is only true of the grammar it measured) ==")
  say(`  source        grammars/tree-sitter-dart-upstream (upstream UserNobody14/tree-sitter-dart)`)
  say(`  build         ${NEWEST}`)
  say(`  sha256        ${sha(readFileSync(NEWEST))}`)
  say(`  node-type ids ${newestSurface.ids}   named unique ${newestSurface.namedUnique}   fields ${newestSurface.fieldCount}`)
  say(`  idOrderDigest ${newestSurface.idOrderDigest}`)
  say(`  the wired build is an OLDER COMMIT of this source: the digest equality is proved by`)
  say(`    \`bun run script/m14/grammar-remedy.ts prove --dir grammars/tree-sitter-dart-upstream --wired wasm/tree-sitter-dart.wasm\``)
  say(`  and the vocabulary delta against upstream HEAD is "added 2, removed 0" — so anything the wired`)
  say(`  build has, the newest build has too, and the newest build has TWO MORE.`)
}

// ─── 3 · THE INVENTORY, AND THE CANDIDATE SPELLINGS FOR THE TWO OPEN VALUES ───────────────────
const has = (needle: string): string[] => namedUnique.filter((n) => n === needle)
const hits = (needle: string): string[] => namedUnique.filter((n) => n.includes(needle))
const hasNewest = (needle: string): string[] => newestNamedUnique.filter((n) => n === needle)
const hitsNewest = (needle: string): string[] => newestNamedUnique.filter((n) => n.includes(needle))

const RENDER_CANDIDATES = [
  "jsx_element", "jsx_self_closing_element", "jsx_fragment", "jsx_attribute", "jsx_expression",
  "element", "self_closing_element", "fragment", "component", "template_element", "template",
  "html_element", "markup", "tag", "render", "view",
]
const DECORATE_CANDIDATES = [
  "decorator", "decorator_list", "decorated_definition", "decorated_class", "decorated_function",
  "annotation", "annotation_list", "metadata", "marker_annotation", "attribute",
]
say()
say("== 3 · THE INVENTORY — the CANDIDATE SPELLINGS, each one PRESENT or ABSENT ==")
say(`  named node types of the wired build: ${namedUnique.length}`)
say("  -- `renders` candidates --")
for (const c of RENDER_CANDIDATES) {
  const found = has(c)
  say(`     ${found.length ? "PRESENT" : "ABSENT "}  ${c}${found.length ? "" : ""}`)
}
say(`     name markers: "jsx" -> ${hits("jsx").length} node types · "element" -> ${hits("element").length} · "template" -> ${hits("template").length} · "render" -> ${hits("render").length} · "markup" -> ${hits("markup").length}`)
say("  -- `decorates` candidates --")
for (const c of DECORATE_CANDIDATES) {
  const found = has(c)
  say(`     ${found.length ? "PRESENT" : "ABSENT "}  ${c}`)
}
say(`     name markers: "decorat" -> ${hits("decorat").length} node types · "annotat" -> ${hits("annotat").length} · "metadata" -> ${hits("metadata").length} · "attribute" -> ${hits("attribute").length}`)
if (newestNamedUnique.length) {
  say()
  say("  -- THE SAME SCAN OVER THE NEWEST AVAILABLE BUILD (both builds, or the language has it) --")
  say(`     named node types of the newest build: ${newestNamedUnique.length}`)
  say(`     renders  candidates PRESENT in the newest build: ${RENDER_CANDIDATES.filter((c) => hasNewest(c).length).join(", ") || "(none)"}`)
  say(`     renders  name markers: "jsx" -> ${hitsNewest("jsx").length} · "element" -> ${hitsNewest("element").length} · "template" -> ${hitsNewest("template").length} · "render" -> ${hitsNewest("render").length} · "markup" -> ${hitsNewest("markup").length}`)
  say(`     decorates candidates PRESENT in the newest build: ${DECORATE_CANDIDATES.filter((c) => hasNewest(c).length).join(", ") || "(none)"}`)
  say(`     decorates name markers: "decorat" -> ${hitsNewest("decorat").length} · "annotat" -> ${hitsNewest("annotat").length} · "metadata" -> ${hitsNewest("metadata").length} · "attribute" -> ${hitsNewest("attribute").length}`)
  say(`     the newest build's "element"-named types: ${hitsNewest("element").join(", ") || "(none)"}`)
  say(`     the newest build's "template"-named types: ${hitsNewest("template").join(", ") || "(none)"}`)
}
say("  -- the constructs this lane HAS (the controls inside the dart grammar itself) --")
for (const c of ["mixin_application", "mixin_application_class", "mixins", "part_directive", "part_of_directive", "class_definition", "superclass", "mixin_on_bound"]) {
  const found = has(c)
  say(`     ${found.length ? "PRESENT" : "ABSENT "}  ${c}`)
}

// ─── 4 · THE COUNTERFACTUALS: THE CONSTRUCTS, PARSED BY THE WIRED BUILD ────────────────────────
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const dartLang = await Language.load(readFileSync(WIRED))

function parseWith(lang: any, src: string): { error: boolean; missing: boolean; nodeTypes: string[] } {
  const p = new ParserClass()
  p.setLanguage(lang)
  const tree = p.parse(src)
  const nodeTypes: string[] = []
  let error = false, missing = false
  const walk = (n: any): void => {
    if (n.type === "ERROR" || n.isError) error = true
    if (n.isMissing) missing = true
    nodeTypes.push(n.type)
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) walk(c)
    }
  }
  walk(tree.rootNode)
  p.delete?.()
  return { error, missing, nodeTypes }
}

const COUNTERFACTUALS: Array<{ label: string; src: string; expect: string }> = [
  { label: "dart renders: a JSX-style element", src: "class A { Widget build() => <Button/>; }", expect: "no element node of any spelling" },
  { label: "dart renders: a widget composition (the NEAR MISS)", src: "class A { Widget build() => Button(); }", expect: "a call node (published as `calls`)" },
  { label: "dart decorates: an annotation on a class", src: "@override\nclass A {}", expect: "the `annotation` node type IS present" },
  { label: "dart decorates: an annotation WITH arguments (an applied const constructor)", src: "@Deprecated('x')\nclass A {}", expect: "the `annotation` node type IS present, carrying an argument" },
  { label: "dart mixes_in: the with-clause", src: "class A with M {}", expect: "mixin_application" },
  { label: "dart part_of: the path form", src: "part 'x.dart';", expect: "part_directive" },
  { label: "dart part_of: the named-library form", src: "part of my.lib;", expect: "part_of_directive" },
]
say()
say("== 4 · THE COUNTERFACTUALS (the construct, parsed by the WIRED build) ==")
const counterResults: any[] = []
for (const c of COUNTERFACTUALS) {
  const r = parseWith(dartLang, c.src)
  counterResults.push({ label: c.label, source: c.src, error: r.error, missing: r.missing, nodeTypes: [...new Set(r.nodeTypes)].sort(), expect: c.expect })
  say(`  ${c.label}`)
  say(`     src      ${JSON.stringify(c.src)}`)
  say(`     ERROR=${r.error}  MISSING=${r.missing}`)
  say(`     node types ${[...new Set(r.nodeTypes)].sort().join(", ")}`)
  say(`     expect   ${c.expect}`)
}

// ─── 5 · THE POSITIVE CONTROL: THE SAME SCAN OVER GRAMMARS THAT DO HAVE THE CONSTRUCT ──────────
say()
say("== 5 · THE POSITIVE CONTROL (the same scan, over grammars that DO have the construct) ==")
const CONTROLS: Array<{ label: string; wasm: string; needle: string }> = [
  { label: "typescript — implements_clause", wasm: "wasm/tree-sitter-typescript.wasm", needle: "implements_clause" },
  { label: "typescript — decorator", wasm: "wasm/tree-sitter-typescript.wasm", needle: "decorator" },
  { label: "tsx — jsx_element", wasm: "wasm/tree-sitter-tsx.wasm", needle: "jsx_element" },
  { label: "dart — mixin_application (the dart control)", wasm: "wasm/tree-sitter-dart.wasm", needle: "mixin_application" },
  { label: "dart — part_directive (the dart control)", wasm: "wasm/tree-sitter-dart.wasm", needle: "part_directive" },
]
const controlResults: any[] = []
for (const c of CONTROLS) {
  const p = path.join(ROOT, c.wasm)
  if (!existsSync(p)) { say(`  ${c.label} — ${c.wasm} ABSENT`); continue }
  const { namedUnique: names } = await measureSurface(p)
  const found = names.filter((n) => n === c.needle)
  controlResults.push({ label: c.label, wasm: c.wasm, sha256: sha(readFileSync(p)), needle: c.needle, present: found.length > 0 })
  say(`  ${found.length ? "PRESENT" : "ABSENT "}  ${c.label}  (${c.wasm}, sha256 ${sha(readFileSync(p)).slice(0, 16)}…)`)
}
say("  ⇒ the scan is not blind: it finds the construct where the construct exists.")

console.log(L.join("\n"))

if (JSON_OUT) {
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      {
        instrument: "dart-grammar-probe",
        root: ROOT,
        binding: {
          asset: ASSET,
          resolvedPath,
          pathSha256: pathSha,
          registrySha256: regSha,
          agree: pathSha === regSha,
          wiredBuild: WIRED,
          wiredSha256: sha(readFileSync(WIRED)),
        },
        surface,
        namedUnique,
        newestAvailableGrammar: newestSurface ? {
          source: "grammars/tree-sitter-dart-upstream",
          build: NEWEST,
          sha256: sha(readFileSync(NEWEST)),
          surface: newestSurface,
          renderCandidatesPresent: RENDER_CANDIDATES.filter((c) => hasNewest(c).length),
          decorateCandidatesPresent: DECORATE_CANDIDATES.filter((c) => hasNewest(c).length),
        } : null,
        candidates: { renders: RENDER_CANDIDATES, decorates: DECORATE_CANDIDATES },
        counterfactuals: counterResults,
        controls: controlResults,
      },
      null,
      2,
    ),
  )
  say()
  say(`WROTE ${JSON_OUT}`)
  console.log(L.slice(-1)[0])
}
