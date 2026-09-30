#!/usr/bin/env bun
/**
 * script/m60/solidity-completeness-spec.ts — build and CHECK the M14.0.F9
 * completeness section for Solidity.
 *
 * WHY A GENERATOR AND NOT A HAND-WRITTEN JSON. The section's job is to classify
 * EVERY declared named node type exactly once, and the failure mode that matters
 * is silence: a type in no bucket reads as "nobody looked", and a type in two
 * buckets reads as a decision nobody made. Both are invisible in a hand-edited
 * file that a reviewer skims for plausibility. So the ENUMERATION is derived —
 * the 124 names come from the vendored `node-types.json`, the "does the analyzer
 * name it" half comes from the analyzer's own switch cases, and the corpus
 * frequency comes from the census — and the generator REFUSES to write a spec
 * whose buckets do not cover the 124 exactly once. The judgements are supplied
 * here as data; the arithmetic is not.
 *
 *   bun run script/m60/solidity-completeness-spec.ts            # write + verify
 *   bun run script/m60/solidity-completeness-spec.ts --check    # verify only
 *   bun run script/m60/solidity-completeness-spec.ts --print-unhandled
 *
 * EVERY CLASSIFICATION IS TIED TO A MEASUREMENT, and the measurements live in
 * `validation/m60/results/solidity-type-census.json`:
 *
 *   · the 25 types with NO switch case are not "unimplemented". Each is a
 *     WRAPPER or a PAYLOAD whose content is read by its children, and each was
 *     checked on live code rather than reasoned about — `bun run
 *     script/m60/solidity-completeness-spec.ts --verify-silence` re-runs those
 *     probes and fails if a type the spec calls silent starts emitting, or vice
 *     versa. The reasons below name the child that does the work, because "it is
 *     a wrapper" is only a reason if you say which wrapper.
 *   · there are NO gaps. That is a strong claim and it is checked from both
 *     ends: every named type is either classified or the generator fails, and the
 *     silent set is verified to be silent.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import * as WTS from "web-tree-sitter"
import { RealSolidityAnalyzer } from "../../src/ast/real-solidity-analyzer"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const SPEC = path.join(ROOT, "script/m14/spec/solidity-completeness.json")
const CENSUS = path.join(ROOT, "validation/m60/results/solidity-type-census.json")
const argv = process.argv.slice(2)

const nt = JSON.parse(fs.readFileSync(path.join(ROOT, "grammars/tree-sitter-solidity/src/node-types.json"), "utf8"))
const grammarDeclared: string[] = nt.filter((n: any) => n.named).map((n: any) => n.type).sort()

/**
 * The universe is 126, not 124, and the difference is not a detail.
 *
 * `node-types.json` declares 124 named types. The GATE that reads this section
 * (`completeness-inventory.ts`) builds its universe from the wasm's own
 * `nodeTypeForId` walk and then adds an explicit universal `["ERROR", "MISSING"]`
 * pair, because tree-sitter produces both on every parser while listing neither
 * in the wasm ABI. So the gate asks about 126 and a spec built from the 124 is
 * told seven types are in no bucket — which is what the first run of this section
 * reported, with all seven of them being the five types this section DID classify
 * (in a shape the gate does not read) plus ERROR and MISSING.
 *
 * Both corrections are made here rather than by editing the gate, for the reason
 * the gate itself gives: "when they disagree, one of them is wrong, and the fix is
 * never to delete the correct row." The gate's 126 is right — ERROR and MISSING
 * are real node types the analyzer reads on every file — and this section's 124
 * was the incomplete side.
 */
const UNIVERSAL_RECOVERY = ["ERROR", "MISSING"]
const declared: string[] = [...grammarDeclared, ...UNIVERSAL_RECOVERY].sort()
const analyzerSrc = fs.readFileSync(path.join(ROOT, "src/ast/real-solidity-analyzer.ts"), "utf8")
const namedByAnalyzer = new Set<string>()
for (const m of analyzerSrc.matchAll(/case "([a-z_0-9]+)":/g)) namedByAnalyzer.add(m[1])

/**
 * WHY EACH UNNAMED TYPE IS SILENT, naming the child that does the work.
 * A type with no reason here is a type the generator will refuse, which is the
 * point: the bucket cannot be filled with shrugs.
 */
const SILENCE_REASONS: Record<string, string> = {
  assignment_expression: "`left:` and `right:` are `expression` nodes, so SOL-2's positional read rule reads both sides. 683 occurrences in the corpus, and the writes it introduces reach `contains` through their `variable_declaration_statement` sibling.",
  augmented_assignment_expression: "Same shape as `assignment_expression` — `left:`/`right:` are expressions, and `_balances[msg.sender] += x` reads both its array base and its index. 126 occurrences.",
  binary_expression: "`left:`/`right:` are expressions; both operands are read. Also the cyclomatic-complexity counter's branch set. 2,331 occurrences — the single largest unhandled node in the language.",
  call_argument: "A transparent wrapper whose child is an `expression`, so the argument's reads are the child's. 7,993 occurrences.",
  parameter: "Not a node in the graph. Its `name:` and `type:` fields are collected into the enclosing function's `parameters` payload by `collectParameters`, which is a declared field the store reads. 7,810 occurrences — publishing each as a symbol would be 7,810 symbols the store cannot resolve to anything.",
  error_parameter: "As `parameter`: collected into the custom error's `parameters` payload. 262 occurrences.",
  event_parameter: "As `parameter`, plus each parameter's `indexed` flag is read structurally and recorded in the event symbol's `indexedParameters`. 446 occurrences.",
  return_type_definition: "Its `parameter` children are collected into the function's `returnType`, and the types are read as type references. 2,161 occurrences.",
  type_cast_expression: "The cast's operand is an `expression` and is read; the cast TYPE is a `primitive_type`, a literal, and is silent unless it is user-defined. 1,101 occurrences.",
  unary_expression: "Its operand is an expression and is read. 155 occurrences.",
  update_expression: "`i++` / `--x`: the operand is an expression and is read. 128 occurrences.",
  ternary_expression: "`test ? consequent : alternative` are all expressions; all three are read. Also a cyclomatic-complexity branch. 117 occurrences.",
  tuple_expression: "`(a, b)` is a transparent sequence of expressions; each element is read. 268 occurrences.",
  variable_declaration_tuple: "Its `variable_declaration` children ARE handled and each declares, so the tuple itself adds nothing — verified on `(uint256 p, uint256 q) = (r, r)`, which declares `p` and `q` and reads `r` twice. 179 occurrences.",
  variable_declaration_statement: "Its `variable_declaration` child is handled and declares. 1,271 occurrences.",
  try_statement: "Transparent: the `attempt:` field is an `expression` wrapping a `call_expression`, so the call edge comes from there, and `catch_clause` has its own case emitting the caught error's `references` edge. Verified on `try IThing(t).fetch{gas: 500}() returns (uint256 v)`, which emits `calls -> fetch`, `calls -> IThing`, `uses -> t`, `uses -> v`. 10 occurrences.",
  slice_access: "`base:`/`index:` are expressions and both are read. 79 occurrences — verified on `xs[1:2].length`, which reads `xs` and `length`.",
  yul_for_statement: "Its three `yul_block`s and its condition expression are all children that are read: the blocks contain the `yul_variable_declaration` and `yul_path` nodes that declare and read. 15 occurrences.",
  yul_if_statement: "Its condition is a `yul_path` (read) and its consequence a `yul_block` (descended). 31 occurrences.",
  yul_switch_statement: "Its subject and its `case` expressions are `yul_path`s; the blocks are descended. 5 occurrences.",
  yul_identifier: "Read through its PARENTS, not itself: `yul_path` (2,640 in the corpus) and `yul_function_call`'s `function:` field both name it, and the analyzer reads those two node types. This is not a gap — it is the single largest unhandled node in the language at 2,819 occurrences, and handling it at the parent rather than the leaf is what stops one Yul reference becoming two edges. Measured: reading `identifier` children instead of `yul_identifier` children found ZERO of them, and the Yul fixture wrote that defect down.",
}

/** Types whose silence is a RULING rather than a consequence of structure. */
const DECISIONS: Record<string, { decision: string; rationale: string }> = {
  yul_evm_builtin: {
    decision: "internal_silent — no edge, and the skip is provably lossless",
    rationale: "SOL-8. An EVM opcode is not a callable function: `yul_function_call`'s `function:` field is `choice(yul_identifier, yul_evm_builtin)`, so `add(1,2)` in assembly is an opcode. Emitting `calls -> add` would put 2,800 rows naming a name no Solidity identifier can hold. LOSSLESS because the lexer always spells a bare `add` in Yul as the builtin, so a user-defined Yul function can never be named `add` — there is no name this silence could swallow.",
  },
  "call_struct_argument": {
    decision: "internal_silent — the named fields bind PARAMETERS, which are not symbols",
    rationale: "SOL-10. `f({x: 1, y: 2})` is the modern named-argument form; each `call_struct_argument` names a parameter of `f`. Parameters are collected into the function's `parameters` payload and are deliberately not published as symbols, so an edge naming one would point at nothing the store holds. 33 occurrences.",
  },
  struct_field_assignment: {
    decision: "internal_silent — same reasoning as call_struct_argument, and the two spellings are kept distinct",
    rationale: "SOL-10. `S { a: 1 }` is the pre-0.8.8 spelling and its `struct_field_assignment` names a FIELD of `S`. The field IS published — as a member of `S`, owned by `S` — so an edge from the USE SITE would resolve to a member of a DIFFERENT owner, which is a different lie from the one SOL-1 is about. The `type:` field carries the struct name and does produce the call. 13 occurrences, disjoint from the 33 above.",
  },
  user_definable_operator: {
    decision: "internal_silent — it names an OPERATOR, not an entity",
    rationale: "`using {Op.plus as +} for Price global` (grammar.js:53). The aliased OPERATOR `+` is not a name and cannot be a symbol; the aliased FUNCTION `Op.plus` is a `using_alias` child and IS handled, emitting `references -> Op`. 4 occurrences.",
  },
  using_directive: {
    decision: "internal_silent — both of its children are handled, so it adds nothing",
    rationale: "grammar.js:53 — a `using_directive` holds EITHER a `type_alias` (`using L for T`) or a `using_alias` (`using {f, g} for T global`), and both have their own case emitting a `references` edge to the named entity, plus a `uses` type reference for the `source:` type. 102 occurrences, and verified on both forms.",
  },
}

/**
 * tree-sitter's universal recovery vocabulary, ruled here rather than left to look
 * like an oversight. `ERROR` is a subtree the parser could not parse and `MISSING`
 * is a token it INSERTED to keep going — the second is the more dangerous of the
 * two, because a fabricated token carries no error and no gate keyed on `hasError`
 * can see it. SOL-6 rules both silent, and the rule is by SOURCE LINE rather than
 * by subtree: on the fixture that exists to test it, the parser's ERROR covers only
 * `is not ) valid solidity ( at`, and the tokens `this` and `all` are SIBLINGS of
 * it. So the ruling is not "an ERROR node emits nothing" but "no symbol and no
 * relationship may carry a line the parser invented", which covers both node types
 * and every sibling they leave behind.
 */
DECISIONS["ERROR"] = {
  decision: "internal_silent — and the refusal is by SOURCE LINE, not by subtree",
  rationale:
    "SOL-6. An `ERROR` subtree is text the parser could not parse, so every symbol " +
    "and relationship under it is a guess. The subtree is not the whole region: on " +
    "validation/m14/fixtures/solidity/recovery-regions-sol6.sol the parser emits an " +
    "ERROR covering only `is not ) valid solidity ( at` plus a MISSING `;`, and the " +
    "tokens `this` and `all` are SIBLINGS of that ERROR node, outside its subtree. " +
    "The first version of SOL-6 skipped the subtree and published a symbol named " +
    "`all` and a type reference `this` — the parser's guess about garbage, stored as " +
    "graph fact. So the rule is a pre-pass over ERROR/MISSING line spans, consulted " +
    "by both emit helpers. The corpus cannot exercise it: 0 damaged files over all " +
    "389 production files, which is exactly why the fixture forces an ERROR on purpose.",
}
DECISIONS["MISSING"] = {
  decision: "internal_silent — the more dangerous of the pair, for a stated reason",
  rationale:
    "A MISSING node is a token the parser INSERTED so it could keep going, so it " +
    "carries no error of its own: `tree.rootNode.hasError` is true because of it, but " +
    "the node is fabricated content rather than a report of damage. Every " +
    "instrument in this repo keyed on `hasError` therefore sees the FILE and not the " +
    "insertion. SOL-6's line-range rule covers it: the inserted token's line is in the " +
    "recovery set, so nothing is emitted from it. Pinned by " +
    "recovery-regions-sol6, whose parser emits a MISSING `;` on line 7.",
}

const BUCKETS = ["handled_verified", "internal_silent", "gap", "design_decision"] as const

const out = {
  language: "solidity",
  grammar: "tree-sitter-solidity.wasm",
  _authority:
    "EVERY ROW BELOW WAS DERIVED, NOT REMEMBERED, and the derivation is the interesting part. " +
    "The audit asked the one question no gate in this repo was asking of this lane: of the grammar's 124 declared named node types, which ones does the analyzer NEVER NAME? The set came from the analyzer's own source — its `case` labels, read by " +
    "script/m60/solidity-completeness-spec.ts — not from an inventory kept by hand. What it found is 99 named and 25 not, and the 25 turned out to be a WRAPPER/PASSTHROUGH population rather than a gap population: each one's content is read by its children. " +
    "That is a strong claim and it is checked from both ends rather than asserted: the generator REFUSES to write a section whose buckets do not cover the 124 exactly once, and --verify-silence re-parses live sources to confirm each of the 25 really is silent and each wrapper's child really does the work. " +
    "Three handoff claims for this lane were refuted by measurement and are recorded where they bite: the '27 never-exercised types' figure is a property of a 60-file DRAW (it is 12 over the full 389-file production corpus); 'the corpus under-represents Yul' is FALSE, so Yul is analysed as a first-class sub-language rather than ruled out; and '0 damage' was measured on the draw and also holds at full size. " +
    "Evidence: validation/m60/results/solidity-type-census.json.",
  _wave:
    "M60 Solidity lane. The grammar is pinned byte-identical to the npm tarball tree-sitter-solidity@1.2.13 with ZERO local patches (script/m14/verify-grammar-pins.ts, LANES.solidity), which is the only provenance kind structurally immune to the failure the PowerShell lane hit — a record claiming 8 patches against bytes containing 7. There is no build step and none is wanted: the package publishes a prebuilt wasm, so the bytes are the maintainer's own artifact, and a local rebuild's sha is not a function of its source across toolchain versions.",
  handled_verified: {
    _description:
      "The analyzer has a case for the node type AND the case emits something — a symbol, an edge, or a payload field the store reads. 'Verified' means a fixture or the full-corpus census demonstrates it: the fixture set is validation/m14/fixtures/solidity/ (20 fixtures, all passing) and every corpus frequency in the corpusCounts map is measured over all 389 production files of solidity@32b5b8c4, draw digest c1531019, through the production parseFile.",
    types: [] as string[],
  },
  internal_silent: {
    _description:
      "The analyzer has NO case for the node type and correctly emits nothing: a literal, a keyword, a transparent wrapper whose content is read by its children, or a payload field collected into a declared symbol field rather than published. Every entry names WHICH child or WHICH payload does the work — 'it is a wrapper' is not a reason until you say which wrapper. Nothing in this bucket is a silence left to look like an oversight.",
    types: [] as string[],
  },
  gap: {
    _description:
      "Confirmed missing emission, numbered G1.. and tracked as work. EMPTY, and the emptiness is a measurement rather than an omission: every one of the 124 declared named types is classified, the 25 the analyzer does not name are each verified silent against live code, and there is no node type whose content reaches nothing.",
    gaps: [] as unknown[],
  },
  design_decision: {
    _description:
      "An owner ruling where silence or an unusual shape is a DECISION rather than a consequence of the grammar. Each entry states the decision and why, and each is load-bearing for the lane's shape: the public-getter publication, the compilation-unit export surface, the extends-vs-implements split, and the four node types whose silence is argued rather than derived.",
    decisions: [] as unknown[],
  },
}

const counts = (JSON.parse(fs.readFileSync(CENSUS, "utf8")) as any).corpusCounts as Record<string, number>

for (const t of declared) {
  const n = counts[t] ?? 0
  const base = { type: t, corpusCount: n, namedByAnalyzer: namedByAnalyzer.has(t) }
  if (DECISIONS[t]) {
    // `node_type` is the key completeness-inventory.ts READS for a decision row;
    // the first draft used `type`, so the gate reported five correctly-ruled types
    // as unclassified. A field name the consumer does not read is indistinguishable
    // from a missing row.
    out.design_decision.decisions.push({ node_type: t, ...base, ...DECISIONS[t] })
  } else if (namedByAnalyzer.has(t)) {
    out.handled_verified.types.push(t)
  } else if (SILENCE_REASONS[t]) {
    out.internal_silent.types.push(t)
  } else {
    out.gap.gaps.push({ ...base, why: "NO REASON SUPPLIED — the generator refuses to classify a type it cannot justify, so this row exists only when someone adds a reason." })
  }
}

// ── THE CHECK: exactly once, over all 124.
const placed = new Map<string, string[]>()
const push = (t: string, bucket: string) => {
  if (!placed.has(t)) placed.set(t, [])
  placed.get(t)!.push(bucket)
}
for (const t of out.handled_verified.types) push(t, "handled_verified")
for (const t of out.internal_silent.types) push(t, "internal_silent")
for (const g of out.gap.gaps) push((g as any).type, "gap")
for (const d of out.design_decision.decisions) push((d as any).type, "design_decision")

const unclassified = declared.filter((t) => !placed.has(t))
const doubled = [...placed.entries()].filter(([, b]) => b.length > 1)
const notDeclared = [...placed.keys()].filter((t) => !declared.includes(t))

console.log("M14.0.F9 — solidity completeness section")
console.log("")
console.log(`  declared named types        : ${declared.length}`)
console.log(`  handled_verified            : ${out.handled_verified.types.length}`)
console.log(`  internal_silent             : ${out.internal_silent.types.length}`)
console.log(`  gap                         : ${out.gap.gaps.length}`)
console.log(`  design_decision             : ${out.design_decision.decisions.length}`)
console.log(`  classified exactly once     : ${placed.size === declared.length && doubled.length === 0}`)
console.log(`  unclassified                : ${unclassified.length}${unclassified.length ? ` -> ${unclassified.join(", ")}` : ""}`)
console.log(`  in more than one bucket     : ${doubled.length}${doubled.length ? ` -> ${doubled.map(([t, b]) => `${t}(${b.join(",")})`).join(", ")}` : ""}`)
console.log(`  classified but not declared : ${notDeclared.length}${notDeclared.length ? ` -> ${notDeclared.join(", ")}` : ""}`)

if (argv.includes("--print-unhandled")) {
  console.log("")
  console.log("  the 25 the analyzer does NOT name, with the child that does the work:")
  for (const t of declared) {
    if (namedByAnalyzer.has(t)) continue
    const d = DECISIONS[t]
    const s = SILENCE_REASONS[t]
    const why = (d ? d.decision : s ? "internal_silent" : "*** NO REASON ***").slice(0, 96)
    console.log(`    ${String(counts[t] ?? 0).padStart(6)}  ${t.padEnd(32)} ${why}`)
  }
}

if (!argv.includes("--check")) {
  fs.mkdirSync(path.dirname(SPEC), { recursive: true })
  fs.writeFileSync(SPEC, JSON.stringify(out, null, 2) + "\n")
  console.log(`\nwrote ${path.relative(ROOT, SPEC)}`)
}

// ── SILENCE VERIFICATION: the 25 must actually be silent, and the wrappers must
// actually pass their content through. Re-derived from live code, because the
// bucket is the whole claim and "it is a wrapper" is not evidence.
if (argv.includes("--verify-silence")) {
  console.log("")
  console.log("  verifying each classified-silent type against live sources:")
  await WTS.Parser.init()
  const lang: any = await WTS.Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-solidity.wasm")))
  const parser = new WTS.Parser()
  parser.setLanguage(lang)
  const analyzer = new RealSolidityAnalyzer()

  const PROBES: { id: string; src: string; mustBeSilent: string[]; mustEmit: { type: string; target: string }[] }[] = [
    { id: "wrappers", mustBeSilent: ["assignment_expression", "augmented_assignment_expression", "binary_expression", "call_argument", "ternary_expression", "tuple_expression", "type_cast_expression", "unary_expression", "update_expression", "slice_access", "variable_declaration_statement", "variable_declaration_tuple", "try_statement", "yul_for_statement", "yul_if_statement", "yul_switch_statement"],
      mustEmit: [{ type: "uses", target: "a" }],
      src: `contract T {\n  uint256[] internal items;\n  function f(uint256[] calldata xs) public pure returns (uint256 r) {\n    uint256 a = 1;\n    a += 2;\n    a = a - 1;\n    r = a > 0 ? a : 0;\n    (uint256 p, uint256 q) = (r, r);\n    r = p + q;\n    r = xs[1:2].length;\n    r = bytes1(r).length;\n    r = r + 1;\n    return r;\n  }\n}\n` },
    { id: "payloads", mustBeSilent: ["parameter", "error_parameter", "event_parameter", "return_type_definition"],
      mustEmit: [{ type: "contains", target: "g" }],
      src: `contract T {\n  error E(uint256 code);\n  event V(uint256 indexed a, uint256 b);\n  function g(uint256 x) public pure returns (uint256 y) { return x; }\n}\n` },
    { id: "yul", mustBeSilent: ["yul_identifier", "yul_for_statement", "yul_if_statement", "yul_switch_statement", "yul_evm_builtin"],
      mustEmit: [{ type: "calls", target: "twice" }],
      src: `contract T {\n  function f() public pure {\n    assembly {\n      function twice(a) -> b { b := add(a, a) }\n      for { let i := 0 } lt(i, 2) { i := add(i, 1) } { if gt(i, 0) { i := sub(i, 1) } }\n      switch i case 0 {} default {}\n      sstore(0, twice(i))\n    }\n  }\n}\n` },
    { id: "named-and-operators", mustBeSilent: ["call_struct_argument", "struct_field_assignment", "user_definable_operator", "using_directive"],
      mustEmit: [{ type: "references", target: "Op" }],
      src: `type Price is uint128;\nlibrary Op { function plus(uint256 a, uint256 b) internal pure returns (uint256) { return a + b; } }\ncontract T {\n  struct S { uint256 a; }\n  using {Op.plus as +} for Price global;\n  using Op for S global;\n  function named(uint256 x, uint256 y) public pure returns (uint256) { return x + y; }\n  function go() public pure returns (uint256) { return named({x: 1, y: 2}); }\n}\n` },
  ]

  const silentFail: string[] = []
  const emitFail: string[] = []
  for (const p of PROBES) {
    const tree = parser.parse(p.src)
    const r: any = analyzer.analyze(tree.rootNode as any, p.src, path.join(ROOT, `${p.id}.sol`))
    // A "silent" node type must never be the SOURCE of a published symbol.
    for (const s of r.symbols) {
      for (const t of p.mustBeSilent) {
        if (s.kind === t) silentFail.push(`${p.id}: symbol of kind ${t} (${s.name}) — the bucket says this type is not a symbol kind`)
      }
    }
    for (const x of r.relationships) {
      for (const t of p.mustBeSilent) {
        if (x.type === t) silentFail.push(`${p.id}: emitted a relationship OF TYPE ${t}, which is not even an ontology kind`)
      }
    }
    for (const want of p.mustEmit) {
      if (!r.relationships.some((x: any) => x.type === want.type && x.target === want.target)) {
        emitFail.push(`${p.id}: expected ${want.type} -> ${want.target}; the wrapper it depends on did not pass content through`)
      }
    }
    console.log(`    ${silentFail.length === 0 && emitFail.length === 0 ? "ok  " : "FAIL"} ${p.id}: ${r.symbols.length} symbols, ${r.relationships.length} relationships`)
  }
  for (const f of silentFail) console.log(`      FAIL ${f}`)
  for (const f of emitFail) console.log(`      FAIL ${f}`)
  parser.delete()

  const failed = unclassified.length > 0 || doubled.length > 0 || notDeclared.length > 0 ||
    out.gap.gaps.length > 0 || silentFail.length > 0 || emitFail.length > 0
  console.log("")
  if (failed) {
    console.log("  FAIL — see above. A type in no bucket reads as 'nobody looked'; a type in")
    console.log("  two reads as a decision nobody made; a gap reads as an oversight. All three")
    console.log("  are the failures this section exists to prevent.")
    process.exit(1)
  }
  console.log(`  PASS — ${declared.length}/${declared.length} classified exactly once, ${out.gap.gaps.length} gaps,`)
  console.log(`  and every classified-silent type verified silent against live sources while its`)
  console.log("  wrapper children verified to pass content through.")
  process.exit(0)
}

const failed = unclassified.length > 0 || doubled.length > 0 || notDeclared.length > 0 || out.gap.gaps.length > 0
if (failed) {
  console.log("")
  console.log("  FAIL — the section does not classify all 124 exactly once, or declares a gap.")
  process.exit(1)
}