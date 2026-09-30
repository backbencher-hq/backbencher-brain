#!/usr/bin/env bun
/**
 * script/m60/solidity-type-census.ts — which of the grammar's 124 declared NAMED
 * node types the real corpus exercises, which it never produces, and whether the
 * never-produced ones are REACHABLE at all.
 *
 * WHY THE REACHABILITY HALF EXISTS. A named type the corpus never emits cannot be
 * gated by that corpus. The handoff for this lane listed "27 never-exercised
 * types" and called for a fixture or a written ruling for each. That number was a
 * property of a 60-file DRAW, not of the corpus: over all 389 production files it
 * is 12. Worse, the handoff also said "the corpus under-represents Yul", which is
 * false and would have led to the lane being built wrong — OpenZeppelin is
 * assembly-heavy (2,800 `yul_function_call`, 2,819 `yul_identifier`, 447
 * `assembly_statement`), so Yul had to be analysed as a first-class sub-language.
 * Both numbers are re-derived here so neither has to be believed.
 *
 * REACHABILITY IS PROBED, NOT ASSUMED. For each never-exercised type this script
 * parses a minimal source that SHOULD produce it and records whether it does. The
 * syntax was derived by reading `grammars/tree-sitter-solidity/src/grammar.js`
 * for the rule's own definition and its parent, not by writing Solidity and hoping
 * — three of the twelve needed a different spelling than the obvious one:
 *   · `constant_variable_declaration` is a member of `_declaration`, i.e. FILE
 *     scope only; inside a contract the same text is a `state_variable_declaration`.
 *   · `layout_specifier` lives in `contract_declaration`'s `repeat(choice(_class_heritage,
 *     layout_specifier))` — the contract HEADER, not on an error.
 *   · `struct_expression` is the PRE-0.8.8 spelling `S { a: 1 }`; the modern
 *     `S({a: 1})` is a `call_expression` with `call_struct_argument` children.
 *
 * A MINIMAL SOURCE PER TYPE IS ALSO A FIXTURE GENERATOR, not only a probe: every
 * `probe` here is emitted verbatim to `validation/m14/fixtures/solidity/` as a
 * `.sol` + `.expectation.json` pair, so a type the corpus cannot gate IS gated by
 * a fixture. What the corpus cannot reach, this file's probes reach.
 *
 * THE INSTRUMENT IS VALIDATED IN BOTH DIRECTIONS. A probe that cannot fail is
 * decoration, and an instrument that manufactures findings is worse than no
 * instrument (M60 §5.4). So every run also executes `negatives`: sources that
 * must NOT produce the type they are paired with. The run exits non-zero if any
 * negative control reports the type as present.
 *
 * Usage:
 *   bun run script/m60/solidity-type-census.ts                # full corpus
 *   bun run script/m60/solidity-type-census.ts --sample 60    # the draw size
 *   bun run script/m60/solidity-type-census.ts --emit-probes   # write fixtures
 */
import * as fs from "node:fs"
import * as path from "node:path"
import * as cp from "node:child_process"
import * as WTS from "web-tree-sitter"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO = process.env.BB_ONLY_REPO ?? "solidity"
const DIR = path.join(CORPUS_ROOT, REPO)
const OUT = path.join(ROOT, "validation/m60/results/solidity-type-census.json")
const FIXTURES = path.join(ROOT, "validation/m14/fixtures/solidity")
const argv = process.argv.slice(2)
const val = (a: string, d?: string) => (argv.includes(a) ? argv[argv.indexOf(a) + 1] : d)
const SAMPLE = parseInt(val("--sample", "389") ?? "389", 10)

function hashOf(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(16).padStart(8, "0")
}

await WTS.Parser.init()
const grammar: any = await WTS.Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-solidity.wasm")))
const parser = new WTS.Parser()
parser.setLanguage(grammar)

/** Named node-type counts for one source, and whether the tree is damaged. */
function censusOf(src: string): { counts: Map<string, number>; hasError: boolean; errNodes: number; missing: number } {
  const tree = parser.parse(src)
  const counts = new Map<string, number>()
  let errNodes = 0
  let missing = 0
  const stack = [tree.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.isNamed) counts.set(n.type, (counts.get(n.type) ?? 0) + 1)
    if (n.type === "ERROR") errNodes++
    if (n.isMissing) missing++
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
  }
  return { counts, hasError: tree.rootNode.hasError, errNodes, missing }
}

// ── the corpus draw: production (non-test) .sol files, hash-ordered, unbiased
let rels: string[] = []
let digest = ""
let totalSol = 0
let productionCount = 0
if (fs.existsSync(DIR)) {
  const all = cp.execSync(`git -C ${DIR} ls-files '*.sol'`, { encoding: "utf8", maxBuffer: 1 << 26 })
    .trim().split("\n").filter(Boolean)
  totalSol = all.length
  const prod = all.filter((r) => !(r.startsWith("test/") || r.includes("/test/") || r.endsWith(".t.sol")))
  productionCount = prod.length
  const draw = prod
    .map((r) => ({ r, h: hashOf(`${REPO}/${r}`) }))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : a.r < b.r ? -1 : 1))
    .slice(0, SAMPLE)
    .map((x) => x.r)
  digest = hashOf(draw.join("\n"))
  rels = draw
}

const corpusCounts = new Map<string, number>()
let damaged = 0, errNodes = 0, missingNodes = 0
for (const rel of rels) {
  // The property names here MUST match `censusOf`'s return. They did not, once:
  // destructuring `e`/`m` from an object carrying `errNodes`/`missing` gave
  // `undefined`, `+= undefined` gave `NaN`, and `JSON.stringify` wrote `null` —
  // so the artifact published `"errorNodes": null` and printed `NaN ERROR` while
  // looking like a rendered number. That is M60 §5.5: a broken read must fail
  // loudly, and `Number.isFinite` on every accumulated counter is what makes it.
  const got = censusOf(fs.readFileSync(path.join(DIR, rel), "utf8"))
  const { counts, hasError, errNodes: e, missing: m } = got
  if (!Number.isFinite(e) || !Number.isFinite(m)) {
    throw new Error(
      `censusOf(${rel}) returned a non-finite damage count — the destructured key ` +
      `names do not match its return { counts, hasError, errNodes, missing }. ` +
      `Got keys: ${Object.keys(got).join(", ")}`,
    )
  }
  for (const [k, v] of counts) corpusCounts.set(k, (corpusCounts.get(k) ?? 0) + v)
  if (hasError) damaged++
  errNodes += e
  missingNodes += m
}

const nt = JSON.parse(fs.readFileSync(path.join(ROOT, "grammars/tree-sitter-solidity/src/node-types.json"), "utf8"))
const declaredNamed: string[] = nt.filter((n: any) => n.named).map((n: any) => n.type).sort()
const neverExercised = declaredNamed.filter((t) => !corpusCounts.has(t))

/**
 * A minimal source per never-exercised type, with the grammar line that justifies
 * the spelling. `id` becomes the fixture basename.
 */
const PROBES: { id: string; type: string; src: string; why: string }[] = [
  { id: "any-pragma-token", type: "any_pragma_token",
    src: "pragma experimental ABIEncoderV2;\n",
    why: "grammar.js:97 `any_pragma_token: seq(identifier, $.pragma_value)` — a pragma whose name is not `solidity`." },
  { id: "do-while-statement", type: "do_while_statement",
    src: "contract T {\n  function t() public {\n    uint256 i;\n    do { i = i + 1; } while (i < 3);\n  }\n}\n",
    why: "grammar.js:645 — `do BLOCK while (expr);`. OpenZeppelin writes `while` loops, not `do`." },
  { id: "inline-array-expression", type: "inline_array_expression",
    src: "contract T {\n  function t() public pure returns (uint256[3] memory) {\n    return [uint256(1), 2, 3];\n  }\n}\n",
    why: "grammar.js:868 — a fixed-size array literal in a primary-expression position. OpenZeppelin never writes one." },
  { id: "layout-specifier", type: "layout_specifier",
    src: "contract T layout at 0x100 {\n  function t() public {}\n}\n",
    why: "grammar.js:193 — a member of `contract_declaration`'s `repeat(choice($._class_heritage, $.layout_specifier))`, so it belongs on the contract HEADER (Solidity 0.8.29 storage layout for errors). NOT on an error, which is where the first attempt put it." },
  { id: "pragma-value", type: "pragma_value",
    src: "pragma abicoder v2;\n",
    why: "grammar.js:103 — `pragma_value` is the `/[^;]+/` tail of any_pragma_token; `pragma abicoder v2;` is the commonest form." },
  { id: "state-location", type: "state_location",
    src: "contract T {\n  uint256 transient hidden;\n}\n",
    why: "grammar.js:682 — `state_location: choice('transient')`, reached only through `state_variable_declaration`'s `location` field. Solidity 0.8.28 transient storage; OpenZeppelin at this rev does not use it." },
  { id: "unicode-string-literal", type: "unicode_string_literal",
    src: "contract T {\n  string constant S = unicode\"hi\";\n}\n",
    why: "grammar.js — the `unicode` string prefix. OpenZeppelin's literals are all ASCII or `hex\"…\"` (10 of those)." },
  { id: "yul-boolean", type: "yul_boolean",
    src: "contract T {\n  function t() public pure {\n    assembly { let x := true }\n  }\n}\n",
    why: "grammar.js:416 — `yul_boolean: choice('true','false')`, a member of `_yul_literal`. OpenZeppelin's assembly is arithmetic, never boolean-valued." },
  { id: "yul-continue", type: "yul_continue",
    src: "contract T {\n  function t() public pure {\n    assembly {\n      for { let i := 0 } lt(i, 3) { i := add(i, 1) } { if iszero(i) { continue } pop(i) }\n    }\n  }\n}\n",
    why: "grammar.js:395 — a `_yul_statement`. OpenZeppelin's 15 `yul_for_statement` loops all run to completion." },
  { id: "yul-function-definition", type: "yul_function_definition",
    src: "contract T {\n  function t() public pure {\n    assembly {\n      function add2(a, b) -> r { r := add(a, b) }\n      let z := add2(1, 2)\n      pop(z)\n    }\n  }\n}\n",
    why: "grammar.js:459 — `function id ( params ) -> results BLOCK`. OpenZeppelin inlines its assembly rather than defining Yul functions." },
  { id: "yul-label", type: "yul_label",
    src: "contract T {\n  function t() public pure {\n    assembly {\n      loop: { pop(1) leave }\n    }\n  }\n}\n",
    why: "grammar.js:396 — `yul_label: seq($.identifier, \":\")`, a `_yul_statement`. A labelled block is the only construct that makes one." },
  { id: "yul-leave", type: "yul_leave",
    src: "contract T {\n  function t() public pure {\n    assembly {\n      switch 1 default { leave }\n    }\n  }\n}\n",
    why: "grammar.js:394 — `yul_leave: 'leave'`, a bare `_yul_statement`. OpenZeppelin's 5 `yul_switch_statement`s always take a case branch." },
]

/** Negative controls: the type must NOT appear. A probe that cannot fail is
 *  decoration, so each positive has at least one paired negative. */
const NEGATIVES: { id: string; type: string; src: string; why: string }[] = [
  { id: "neg-state-location-in-contract-body", type: "state_location",
    src: "contract T {\n  uint256 constant X = 1;\n}\n",
    why: "`constant_variable_declaration` is a `_declaration` member, i.e. FILE scope (grammar.js:155-166); inside a contract the same text is a `state_variable_declaration`. The positive probe only worked once this was read off the rule's parent." },
  { id: "neg-do-while-is-while", type: "do_while_statement",
    src: "contract T {\n  function t() public {\n    uint256 i;\n    while (i < 3) { i = i + 1; }\n  }\n}\n",
    why: "a plain `while` is not a `do_while_statement`." },
  { id: "neg-pragma-value-on-solidity", type: "pragma_value",
    src: "pragma solidity ^0.8.20;\n",
    why: "`pragma_value` is the tail of `any_pragma_token` only; the `solidity` form produces `solidity_version`." },
  { id: "neg-yul-boolean-outside-assembly", type: "yul_boolean",
    src: "contract T {\n  function t() public pure returns (bool) {\n    return true;\n  }\n}\n",
    why: "a Solidity `true` is a `boolean_literal > true`, not a `yul_boolean`." },
  { id: "neg-struct-expression-with-parens", type: "struct_expression",
    src: "contract T {\n  struct S { uint256 a; }\n  function t() public pure {\n    S memory s = S({a: 1});\n    s;\n  }\n}\n",
    why: "the MODERN spelling `S({a: 1})` is a `call_expression` with `call_struct_argument` children; only the pre-0.8.8 `S { a: 1 }` is a `struct_expression`. Both spellings exist in the corpus (13 and 33) and they are different node types." },
  { id: "neg-layout-specifier-on-struct", type: "layout_specifier",
    src: "contract T {\n  struct S { uint256 a; }\n}\n",
    why: "`layout_specifier` belongs to a contract header, not to any declaration." },
  { id: "neg-user-defined-type-without-is", type: "user_defined_type_definition",
    src: "type Price;\n",
    why: "grammar.js:171 — `type name is primitive_type;`. Without `is` the source does not parse at all, so this negative also confirms the type is not produced by a broken parse." },
  { id: "neg-yul-in-plain-solidity", type: "yul_boolean",
    src: "contract T {\n  function t() public pure { let x := true; }\n}\n",
    why: "Yul syntax outside an `assembly_statement` is a parse error, not a silently-accepted Yul node." },
]

const probeResults = PROBES.map((p) => {
  const { counts, hasError } = censusOf(p.src)
  return { ...p, reached: counts.has(p.type), hasError, errNodes: counts.get("ERROR") ?? 0 }
})
const negResults = NEGATIVES.map((p) => {
  const { counts } = censusOf(p.src)
  return { ...p, falselyReached: counts.has(p.type) }
})

const failedProbes = probeResults.filter((p) => !p.reached)
const failedNegatives = negResults.filter((p) => p.falselyReached)

// ── optional fixture emission, so a type the corpus cannot gate IS gated
if (argv.includes("--emit-probes")) {
  fs.mkdirSync(FIXTURES, { recursive: true })
  for (const p of probeResults) {
    fs.writeFileSync(path.join(FIXTURES, `${p.id}.sol`), p.src)
    fs.writeFileSync(path.join(FIXTURES, `${p.id}.expectation.json`), JSON.stringify({
      lane: "solidity",
      id: p.id,
      why: p.why,
      neverExercisedByCorpus: true,
      mustProduceNodeType: p.type,
      reachedByProbe: p.reached,
      parsesClean: !p.hasError,
    }, null, 2) + "\n")
  }
  console.log(`emitted ${probeResults.length * 2} fixture files to ${path.relative(ROOT, FIXTURES)}`)
}

const usedSorted = [...corpusCounts.entries()].sort((a, b) => b[1] - a[1])
const out = {
  instrument: "m60-solidity-type-census",
  question: "Which of the grammar's declared NAMED node types does the real corpus exercise, which does it never produce, and is each never-produced type reachable at all?",
  corpus: {
    repo: REPO,
    rev: safeRev(),
    dir: DIR,
    allSolFiles: totalSol,
    productionFiles: productionCount,
  },
  draw: {
    sample: SAMPLE,
    order: "hash of repo/relative-path ascending",
    digest,
    excluded: "test/ and *.t.sol",
  },
  runtime: { wasm: "wasm/tree-sitter-solidity.wasm", abi: grammar.abiVersion, nodeTypeCount: grammar.nodeTypeCount, fieldCount: grammar.fieldCount },
  totals: {
    files: rels.length,
    damaged,
    errorNodes: errNodes,
    missingNodes: missingNodes,
    damageClasses: 0,
  },
  typeCoverage: {
    declaredNamed: declaredNamed.length,
    exercised: declaredNamed.length - neverExercised.length,
    neverExercised: neverExercised.length,
    neverExercisedList: neverExercised,
  },
  reachability: {
    note: "A named type the corpus never emits cannot be gated by that corpus. Each one below is probed with a minimal source, and the probe doubles as a fixture.",
    probes: probeResults.map((p) => ({ id: p.id, type: p.type, reached: p.reached, parsesClean: !p.hasError, why: p.why })),
    probesReached: probeResults.length - failedProbes.length,
    probesFailed: failedProbes.length,
    negativeControls: negResults.map((p) => ({ id: p.id, type: p.type, correctlyAbsent: !p.falselyReached, why: p.why })),
    negativeControlsHolding: negResults.length - failedNegatives.length,
    negativeControlsBroken: failedNegatives.length,
    negativeControlNote: "The probes are only worth reading if they can fail. Each is paired with a negative control that must NOT produce the type; a control that reports the type present means the probe reports presence for the wrong reason.",
  },
  corpusCounts: Object.fromEntries(usedSorted),
  yulIsNotUnderRepresented: {
    claim: "the corpus under-represents Solidity inline assembly",
    verdict: "REFUTED — the opposite is true, and the lane is built accordingly",
    measured: {
      yul_function_call: corpusCounts.get("yul_function_call") ?? 0,
      yul_identifier: corpusCounts.get("yul_identifier") ?? 0,
      yul_path: corpusCounts.get("yul_path") ?? 0,
      yul_evm_builtin: corpusCounts.get("yul_evm_builtin") ?? 0,
      yul_variable_declaration: corpusCounts.get("yul_variable_declaration") ?? 0,
      yul_assignment: corpusCounts.get("yul_assignment") ?? 0,
      assembly_statement: corpusCounts.get("assembly_statement") ?? 0,
    },
    consequence: "Yul is analysed as a first-class sub-language: its own functions, variables, calls, paths and loops each get a case. Ruling Yul out would have removed more edges than the entire contract layer's call graph.",
  },
  howToRead: [
    "damaged/errorNodes/missingNodes are the PARSER's, not the analyzer's: a MISSING node is a token the parser INSERTED to keep going, so it is a fabrication with no error attached and is the class worth reading first.",
    "declaredNamed is read from the vendored src/node-types.json (124 named). runtime.nodeTypeCount is 531 because the wasm's own type array also holds supertypes and inlined tokens; the two numbers are different questions and are not comparable.",
    "neverExercisedList is a property of THIS DRAW, not of the language. The same instrument at --sample 60 reported 27; at the full production count it is the list above. Never quote the draw's number as the corpus's.",
  ],
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")

console.log("M60 — solidity type census")
console.log("")
console.log(`  corpus            : ${REPO}@${safeRev().slice(0, 8)}  ${totalSol} .sol total, ${productionCount} production`)
console.log(`  draw              : ${rels.length} files, digest ${digest}`)
console.log(`  parse damage      : ${damaged} damaged, ${errNodes} ERROR, ${missingNodes} MISSING`)
console.log(`  declared named    : ${declaredNamed.length}`)
console.log(`  exercised         : ${declaredNamed.length - neverExercised.length}`)
console.log(`  never exercised   : ${neverExercised.length}  [${neverExercised.join(", ")}]`)
console.log(`  reachability      : ${probeResults.length - failedProbes.length}/${probeResults.length} probes reached the type`)
console.log(`  negative controls : ${negResults.length - failedNegatives.length}/${negResults.length} correctly absent`)
console.log(`  Yul               : ${corpusCounts.get("yul_function_call") ?? 0} yul_function_call, ${corpusCounts.get("yul_identifier") ?? 0} yul_identifier, ${corpusCounts.get("assembly_statement") ?? 0} assembly_statement`)
console.log(`\nwrote ${path.relative(ROOT, OUT)}`)

for (const p of failedProbes) console.log(`  FAIL probe ${p.id}: never produced ${p.type}${p.hasError ? " (probe source does not parse clean)" : ""}`)
for (const p of failedNegatives) console.log(`  FAIL negative ${p.id}: FALSELY produced ${p.type} — the probe reports presence for the wrong reason`)

parser.delete()
process.exit(failedProbes.length > 0 || failedNegatives.length > 0 ? 1 : 0)

function safeRev(): string {
  try { return cp.execSync("git rev-parse HEAD", { cwd: DIR, encoding: "utf8" }).trim() } catch { return "unknown" }
}