/**
 * Protobuf GRAMMAR GAPS.
 *
 * A grammar battery is only worth running if it can tell a GAP (valid protobuf
 * the grammar rejects) apart from a CORRECT REJECTION (invalid protobuf the
 * grammar rightly refuses). Lumping those together is how a lane declares itself
 * complete while missing half the language, so every case here carries BOTH
 * facts: whether the construct is valid, and whether it parsed.
 *
 * Three things are measured:
 *
 *   1. ACCEPTANCE — every VALID construct must parse with zero ERROR nodes on
 *      the wired grammar. One per patch, plus the core language, so a patch
 *      cannot be "needed" for a case the battery never ran.
 *   2. REJECTION — every INVALID construct must NOT parse. These are the
 *      negative controls: without them, a grammar that accepted everything
 *      would score 100% on (1).
 *   3. NECESSITY — each patch's construct must FAIL on the pre-patch grammar.
 *      A patch that changes nothing observable is dead weight in the grammar and
 *      a maintenance cost forever, so "the upstream build also fails here" is
 *      what earns a patch its place.
 *
 * Usage: tsx grammar-gaps.mts
 */
import { createHash } from "crypto"
import * as fs from "fs"
import * as path from "path"
import { OUT, PREVIOUS_WASM, ROOT, WASM } from "../paths.mts"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })

const errorNodes = (root: any): number => {
  let n = 0
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    for (const c of node.children) {
      if (!c) continue
      if (c.type === "ERROR" || c.isMissing) n++
      else stack.push(c)
    }
  }
  return n
}

interface Case {
  id: string
  valid: boolean
  /**
   * A rule the specification enforces SEMANTICALLY rather than syntactically.
   * A tree-sitter grammar is a recogniser for surface syntax, so "the first enum
   * value must be zero in proto3" is not something any grammar can reject
   * without a semantic predicate over sibling values. Such a case is reported
   * in its own count instead of as a failure — calling it a grammar gap would be
   * wrong, and keeping it in the negative controls would leave a gate that can
   * never pass, which is how gates get switched off.
   */
  semantic?: boolean
  /** Which patch this case exists to test; null for core-language cases. */
  patch: number | null
  spec: string
  src: string
}

const CASES: Case[] = [
  // ---- core language, no patch involved --------------------------------
  { id: "core-proto3-message", valid: true, patch: null, spec: "core", src: `syntax = "proto3";\nmessage M { string a = 1; }` },
  { id: "core-enum", valid: true, patch: null, spec: "core", src: `syntax = "proto3";\nenum E { A = 0; B = 1; }` },
  { id: "core-service-rpc", valid: true, patch: null, spec: "core", src: `syntax = "proto3";\nmessage M {}\nservice S { rpc Go(M) returns (M); }` },
  { id: "core-map", valid: true, patch: null, spec: "core", src: `syntax = "proto3";\nmessage M { map<string, int32> m = 1; }` },
  { id: "core-oneof", valid: true, patch: null, spec: "core", src: `syntax = "proto3";\nmessage M { oneof pick { int32 a = 1; string b = 2; } }` },
  { id: "core-nested-message", valid: true, patch: null, spec: "core", src: `syntax = "proto3";\nmessage O { message I { int32 x = 1; } }` },
  { id: "core-reserved-numbers", valid: true, patch: null, spec: "core", src: `syntax = "proto3";\nmessage M { reserved 2, 15, 9 to 11; }` },
  { id: "core-reserved-names", valid: true, patch: null, spec: "core", src: `syntax = "proto3";\nmessage M { reserved "foo", "bar"; }` } as any,
  { id: "core-import-public", valid: true, patch: null, spec: "core", src: `syntax = "proto3";\nimport public "a.proto";\nmessage M {}` },
  { id: "core-extend-relative", valid: true, patch: null, spec: "core", src: `syntax = "proto3";\nmessage M { extensions 100 to 199; }\nmessage E { extend M { int32 x = 100; } }` },
  { id: "core-streaming", valid: true, patch: null, spec: "core", src: `syntax = "proto3";\nmessage M {}\nservice S { rpc Go(stream M) returns (stream M); }` },
  { id: "core-proto2-optional", valid: true, patch: null, spec: "core", src: `syntax = "proto2";\nmessage M { optional int32 a = 1; }` },
  { id: "core-proto2-required", valid: true, patch: null, spec: "core", src: `syntax = "proto2";\nmessage M { required int32 a = 1; }` },
  { id: "core-field-options", valid: true, patch: null, spec: "core", src: `syntax = "proto3";\nmessage M { int32 a = 1 [deprecated = true]; }` },
  { id: "core-service-option", valid: true, patch: null, spec: "core", src: `syntax = "proto3";\nservice S { option deprecated = true; }` },

  // ---- the eight patches ------------------------------------------------
  {
    id: "p1-edition",
    valid: true,
    patch: 1,
    spec: "editions: `edition` replaces `syntax` in a 2023 editions file",
    src: `edition = "2023";\npackage p;\nmessage M { int32 a = 1; }`,
  },
  {
    id: "p2-negative-field-number",
    valid: true,
    patch: 2,
    spec: "field numbers are signed 32-bit; 19000-19999 is reserved, the rest is legal",
    src: `syntax = "proto2";\nmessage M { optional int32 a = -1; }`,
  },
  {
    id: "p3-import-option",
    valid: true,
    patch: 3,
    spec: "editions' `import option \"…\"` — the mechanism behind `features`",
    src: `edition = "2023";\nimport option "google/protobuf/cpp_features.proto";\nmessage M { int32 a = 1; }`,
  },
  {
    id: "p4-extensions-options",
    valid: true,
    patch: 4,
    spec: "an option list on `extensions` — how descriptor.proto declares its own range",
    src: `syntax = "proto2";\nmessage M { extensions 536000000 [declaration = { number: 1 }]; }`,
  },
  {
    id: "p5-group",
    valid: true,
    patch: 5,
    spec: "proto2 `group` — a field whose type is an inline nested message",
    src: `syntax = "proto2";\nmessage M { optional group G = 1 { optional int32 x = 2; } }`,
  },
  {
    id: "p5-group-repeated",
    valid: true,
    patch: 5,
    spec: "repeated group",
    src: `syntax = "proto2";\nmessage M { repeated group G = 1 { optional int32 x = 2; } }`,
  },
  {
    id: "p6-parenthesised-option-segment-first",
    valid: true,
    patch: null,
    spec: "a parenthesised (fullIdent) as the FIRST option-name segment — upstream allows this already, so it is a core case, not patch evidence",
    src: `syntax = "proto2";\nmessage M { int32 a = 1 [(foo).bar = 1]; }`,
  },
  {
    id: "p6-parenthesised-option-segment-later",
    valid: true,
    patch: 6,
    spec: "a parenthesised (fullIdent) as a LATER dotted option-name segment — this is the actual gap, and the first attempt at this case put the paren FIRST, which upstream already accepted, so the battery initially reported patch 6 as buying nothing",
    src: `syntax = "proto2";\nmessage M { int32 a = 1 [(a).(b) = 1]; }`,
  },
  {
    id: "p6-real-orca",
    valid: true,
    patch: 6,
    spec: "the shape that actually motivated the patch: features.(pb.cpp).repeated_type",
    src: `syntax = "proto2";\nmessage M { int32 a = 1 [features.(pb.cpp).repeated_type = true]; }`,
  },
  {
    id: "p7-leading-dot-extend",
    valid: true,
    patch: 7,
    spec: "a fully qualified extend target, written with a leading dot",
    src: `syntax = "proto2";\nmessage M { extensions 100 to 199; }\nmessage E { extend .M { int32 x = 100; } }`,
  },
  {
    id: "p8-local-modifier",
    valid: true,
    patch: 8,
    spec: "the editions `local` declaration modifier",
    src: `edition = "2023";\nlocal message M { int32 a = 1; }`,
  },

  // ---- NEGATIVE CONTROLS: invalid protobuf the grammar must reject ----
  { id: "neg-unclosed-message", valid: false, patch: null, spec: "unclosed message body", src: `syntax = "proto3";\nmessage M { int32 a = 1;` },
  { id: "neg-field-no-number", valid: false, patch: null, spec: "a field with no field number", src: `syntax = "proto3";\nmessage M { int32 a; }` },
  { id: "neg-enum-no-zero", valid: false, patch: null, semantic: true, spec: "a first enum value that is not 0 (proto3) — SEMANTIC rule, not syntactic", src: `syntax = "proto3";\nenum E { A = 1; }` },
  { id: "neg-dangling-comma", valid: false, patch: null, spec: "a trailing comma in an enum body", src: `syntax = "proto3";\nenum E { A = 0, B = 1, }` },
  { id: "neg-unterminated-string", valid: false, patch: null, spec: "an unterminated string literal", src: `syntax = "proto3";\nimport "a.proto;` },
  { id: "neg-unknown-keyword", valid: false, patch: null, spec: "a keyword that does not exist", src: `syntax = "proto3";\nmesage M { int32 a = 1; }` },
  { id: "neg-map-key-not-scalar", valid: false, patch: null, spec: "a message-typed map key (protobuf forbids it)", src: `syntax = "proto3";\nmessage K {}\nmessage M { map<K, int32> m = 1; }` },
  { id: "neg-field-number-in-group-range", valid: false, patch: null, spec: "a second field number on one field", src: `syntax = "proto3";\nmessage M { int32 a = 1 = 2; }` },
]

async function load(p: string) {
  const parser = new ParserClass()
  parser.setLanguage(await Language.load(fs.readFileSync(p)))
  return parser
}
const wired = await load(WASM)
const upstream = await load(PREVIOUS_WASM)

const rows: any[] = []
const fails: string[] = []
/** Semantic rules a surface grammar cannot enforce; counted, not failed. */
let semanticNotEnforced = 0

for (const c of CASES) {
  const wErr = errorNodes(wired.parse(c.src).rootNode)
  const uErr = errorNodes(upstream.parse(c.src).rootNode)
  const wiredAccepts = wErr === 0
  const upstreamAccepts = uErr === 0
  const row = {
    id: c.id,
    valid: c.valid,
    patch: c.patch,
    ...(c.semantic ? { semantic: true } : {}),
    spec: c.spec,
    wiredErrors: wErr,
    upstreamErrors: uErr,
    wiredAccepts,
    upstreamAccepts,
    verdict: "",
  }
  if (c.semantic) {
    row.verdict = wiredAccepts
      ? "NOT ENFORCED (semantic rule, outside a grammar's remit) — documented, not a failure"
      : "rejected"
    if (wiredAccepts) semanticNotEnforced++
  } else if (c.valid) {
    if (!wiredAccepts) {
      row.verdict = "GRAMMAR GAP: valid protobuf the wired grammar rejects"
      fails.push(`${c.id}: valid construct rejected with ${wErr} error node(s)`)
    } else if (c.patch !== null && upstreamAccepts) {
      // Necessity: the patch is supposed to be what makes this parse.
      row.verdict = "PATCH UNNECESSARY: the pre-patch grammar already accepted it"
      fails.push(`${c.id} (patch ${c.patch}): upstream already accepted it, so the patch buys nothing`)
    } else if (c.patch !== null) {
      row.verdict = "PASS: valid, and the pre-patch grammar fails it (the patch is necessary)"
    } else {
      row.verdict = "PASS: core construct"
    }
  } else {
    if (wiredAccepts) {
      row.verdict = "OVER-PERMISSIVE: invalid protobuf the wired grammar accepted"
      fails.push(`${c.id}: invalid construct ACCEPTED (${wErr === 0 ? 0 : wErr} errors)`)
    } else {
      row.verdict = "PASS: correctly rejected"
    }
  }
  rows.push(row)
}

const validCases = rows.filter((r) => r.valid && !r.semantic)
const invalidCases = rows.filter((r) => !r.valid && !r.semantic)
const patchCases = rows.filter((r) => r.patch !== null)
const semanticCases = rows.filter((r) => r.semantic)

const out = {
  generatedAt: new Date().toISOString(),
  wired: { path: WASM, sha256Prefix: sha(WASM) },
  upstream: { path: PREVIOUS_WASM, sha256Prefix: sha(PREVIOUS_WASM) },
  counts: {
    cases: rows.length,
    valid: validCases.length,
    invalid: invalidCases.length,
    patchCases: patchCases.length,
    validAccepted: validCases.filter((r) => r.wiredAccepts).length,
    validRejected: validCases.filter((r) => !r.wiredAccepts).length,
    invalidRejected: invalidCases.filter((r) => !r.wiredAccepts).length,
    invalidAccepted: invalidCases.filter((r) => r.wiredAccepts).length,
    patchesProvenNecessary: patchCases.filter((r) => r.upstreamAccepts === false).length,
    semanticCases: semanticCases.length,
    semanticRulesNotEnforced: semanticNotEnforced,
  },
  rows,
  fails,
  pass: fails.length === 0,
}
function sha(p: string): string {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 16)
}

fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, "grammar-gaps.json"), JSON.stringify(out, null, 2))

console.log(`\n  cases: ${rows.length}  (${validCases.length} valid, ${invalidCases.length} invalid, ${patchCases.length} patch cases)`)
console.log(`  valid constructs accepted by wired:  ${out.counts.validAccepted}/${validCases.length}`)
console.log(`  invalid constructs rejected by wired: ${out.counts.invalidRejected}/${invalidCases.length}`)
console.log(`  patches proven NECESSARY (upstream fails the case): ${out.counts.patchesProvenNecessary}/${patchCases.length}`)
console.log(`  semantic rules not enforced by any grammar: ${semanticNotEnforced}/${semanticCases.length} (documented, not a failure)`)
console.log(`\n  per-patch:`)
for (const r of patchCases) {
  console.log(`    patch ${r.patch}  ${r.id.padEnd(32)} upstream=${String(r.upstreamErrors).padStart(2)} wired=${String(r.wiredErrors).padStart(2)}  ${r.verdict}`)
}
if (fails.length) {
  console.log(`\n  FAIL (${fails.length}):`)
  for (const f of fails) console.log(`    - ${f}`)
} else {
  console.log(`\n  PASS: every valid construct parses, every invalid one is rejected, every patch is necessary`)
}
console.log(`\n  wrote ${path.join(OUT, "grammar-gaps.json")}`)
process.exit(fails.length ? 1 : 0)
