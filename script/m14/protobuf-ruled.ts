/**
 * PROTOBUF RULING TABLE — the five relationship types this analyzer does not emit,
 * each with the corpus probe that makes its ruling falsifiable.
 *
 * ## Why this file exists and why it is separate
 *
 * `script/m14/ontology-coverage-gate.ts` is the workstream's arbiter, and its header
 * records why: `overrides` was missing from Bash for a whole wave and the differential
 * stayed green, because the analyzer omitted it and the oracle was written after that
 * ruling — nothing agrees with nothing. It reads this file from `RULED_BY_LANG`, which
 * is SHARED and the supervisor's. So the table lives here, lane-owned, and wiring it is
 * one import and one map entry:
 *
 *   import { PROTOBUF_RULED } from "./protobuf-ruled"
 *   const RULED_BY_LANG: Record<string, Ruled[]> = { …, protobuf: PROTOBUF_RULED }
 *
 * ## Corpus these numbers come from
 *
 * The arbiter's OWN population, reproduced rather than re-chosen: same corpus root,
 * same `git ls-files` walk, same 512 KB size cut, same
 * `detectLanguageFromPath(abs, text) !== "protobuf"` admission test. **847 files**, and
 * `script/m14/protobuf-arbiter-grammar-wiring.mts` prints the arbiter's own count beside
 * it and asserts the two are the same set. Every count below is over those 847 files.
 *
 * ## WHY EVERY ENTRY IS INSTRUMENT B, AND WHY THE PROBES BRING THEIR OWN GRAMMAR
 *
 * ### The defect, measured
 *
 * The gate chooses the grammar for both its instruments with one expression:
 *
 *   const wasmPath = (LANGS as any)[LANG]?.wasm ?? "tree-sitter-bash.wasm"   // :247
 *
 * `protobuf` is not a key of `LANGS` (`script/m14/differential.ts:740`), so the
 * expression takes its DEFAULT BRANCH and every instrument parses `.proto` text with
 * the BASH grammar. Measured over the same 847 files by
 * `script/m14/protobuf-arbiter-grammar-wiring.mts`:
 *
 *   root node, tree-sitter-bash.wasm        {"program":836,"ERROR":11}
 *   root node, tree-sitter-protobuf.wasm    {"source_file":847}
 *   distinct node types            bash 81   protobuf 94
 *   trees carrying an ERROR node   bash 736  protobuf 2
 *
 * ### What that did to the verdict, measured
 *
 * Instrument A intersects this table's `nodeTypesThatWouldMeanIt` with the node types
 * the gate OBSERVED. Under bash, `function_definition` is a real bash node and it
 * occurs once on proto text, so the `calls` row came back
 * `FALSIFIED — the grammar DOES produce function_definition`. Under protobuf the same
 * node type occurs **0** times. The arbiter was reporting a bash fact as a protobuf one.
 *
 * The three A-instrument rows that came back clean (`extends`, `implements`,
 * `references`) were clean BY SPELLING, not by evidence: their node-type lists name
 * snake_case heritage nodes that bash happens not to emit, so the intersection was
 * empty for a reason that has nothing to do with protobuf. The sibling IDL lane's
 * `calls` list is CamelCase (`CallExpression`, `FunctionDefinition`), which is why that
 * lane's identically-wrong verdict passes and this one fails. A pass that depends on the
 * case convention of a list is not a measurement, so those three rows were passing for
 * the same reason `calls` was failing and are re-registered here as measurements.
 *
 * ### What this table does about it, inside this lane's own file
 *
 * `countOnTree` is a SYNC callback handed one already-parsed tree. It does not get to
 * choose the grammar — except that it can decline the tree it is handed and measure the
 * same FILE under the grammar this lane actually ships. `wasm/tree-sitter-protobuf.wasm`
 * is in this repository and the arbiter's fallback ignores it. So:
 *
 *   1. if the handed root is `source_file`, that IS a protobuf tree and is used as-is;
 *   2. otherwise the file is re-read from the corpus root the gate names and parsed with
 *      `wasm/tree-sitter-protobuf.wasm`, and the tree the gate handed is discarded;
 *   3. if neither is possible, the probe REFUSES and the gate fails. See below.
 *
 * This is not a workaround that disappears when the wiring is fixed: if `protobuf` is
 * added to `LANGS`, branch 1 is taken and the probe measures the arbiter's own tree.
 * The verdicts are the same either way, which is the property worth having.
 *
 * ### WHY A PROBE THAT CANNOT MEASURE FAILS THE GATE
 *
 * The arbiter's contract is `hit.occurrences = hits.length`: every element of the `hits`
 * array is one occurrence of the construct, and `occurrences > 0` is FALSIFIED. This
 * table used to exploit that array to carry a refusal — `guardWrongGrammar` pushed a
 * `WRONG GRAMMAR — …` line and returned — and the arbiter duly reported the `instantiates`
 * construct as occurring `1x across 1 file(s)`, with the refusal quoted as its example.
 * A refusal graded as a construction is strictly worse than no answer: it turns "the
 * instrument was pointed at the wrong grammar" into "the ruling is wrong", which is the
 * opposite of the truth and lands in a shared verdict table.
 *
 * So the refusal channel is kept but inverted. A probe that cannot measure pushes a
 * `NOT MEASURED — …` line naming the reason, which FAILS the gate. Failing closed is the
 * only safe direction: an unmeasured corpus may never be reported as a zero.
 *
 * ### The provenance line
 *
 * `countOnTree` is the only channel the arbiter gives a probe, so this module also
 * registers one `process.on("exit")` line that prints which grammar measured how many
 * files with how many hits. Without it the arbiter's own table would read "the construct
 * occurs 0x on the parse tree" for a verdict whose parse tree this module chose. The
 * gate's exit code does NOT carry that line: a lane whose probe cannot measure fails the
 * gate, but a lane whose probe measures correctly reports its zero through the arbiter's
 * own `basis` string, which names the tree and not the grammar. Reading the two
 * together is the intended use, and `script/m14/protobuf-arbiter-grammar-wiring.mts`
 * reproduces the arbiter's verdict under BOTH grammars for exactly that reason.
 *
 * ## STILL NEEDED, AND NOT THIS LANE'S TO APPLY (§8 shared machinery)
 *
 *   file     script/m14/differential.ts, the `LANGS` record at line 740
 *   change   + protobuf: { wasm: "tree-sitter-protobuf.wasm", analyzerFile:
 *             "real-protobuf-analyzer", className: "RealProtobufAnalyzer", ext: "proto" },
 *   why      ontology-coverage-gate.ts:247 resolves a lane's grammar from that record
 *             and falls back to `tree-sitter-bash.wasm` for any lane absent from it, so
 *             an unregistered lane's instruments measure bash's parse of that lane's
 *             source. Both of this lane's FALSIFIED verdicts came from it.
 *   also     that `??` default should FAIL LOUDLY for an unregistered lane rather than
 *             silently measuring the wrong language. The complaint this table used to
 *             file against a corpus FILE was correct and was aimed at the wrong target:
 *             the check belongs where the grammar is chosen, not in a lane's probe.
 *
 * The four fields above already exist for this lane at `script/m14/run-fixtures.ts:91`,
 * so the change is a copy of a value in the repository rather than a new claim.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"

/** Restated from `script/m14/ontology-coverage-gate.ts`, which exports neither. */
export type Instrument = "A:grammar-inventory" | "B:parse-tree-count"

export type Ruled = {
  type: "calls" | "uses" | "contains" | "imports" | "references" | "exports" | "extends" | "implements" | "overrides" | "instantiates"
  instrument: Instrument
  /** Node types that would express the construct — and, on instrument B, the probe's own
   *  target vocabulary: `countOnTree` counts exactly these, so the list is the probe's
   *  definition rather than a list nothing reads. */
  nodeTypesThatWouldMeanIt?: string[]
  /** B: count occurrences on the tree. A: unused. */
  countOnTree?: (root: any, fileLabel: string, hits: string[]) => void
  describe: string
}

// ---------------------------------------------------------------- the grammar this lane ships
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const ROOT = path.resolve(import.meta.dirname, "../..")
const PROTOBUF_WASM = "wasm/tree-sitter-protobuf.wasm"
/** The start rule of `grammars/tree-sitter-proto/grammar.js`. Bash's is `program`, which is
 *  why this value is the whole guard: no other grammar vendored in `wasm/` emits it. */
const PROTOBUF_ROOT = "source_file"

let laneParser: any = null
let laneGrammarError = ""
try {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  laneParser = new P()
  laneParser.setLanguage(await L.load(readFileSync(path.join(ROOT, PROTOBUF_WASM))))
} catch (e) {
  laneParser = null
  laneGrammarError = String((e as any)?.message ?? e)
}

// ---------------------------------------------------------------- one parse per file, shared by all five probes
/** The arbiter walks ruling-major (`for (const r of RULED) for (const f of files)`), so
 *  without this cache the same file is parsed once per ruling. Facts are counts, not
 *  trees, so nothing is retained but a number per node type. */
type FileFacts = {
  via: "handed" | "self-parsed"
  nodes: number
  /** every node type observed in this file, with its count */
  counts: Map<string, number>
  /** `block_lit` whose ancestor chain reaches no option/constant/field_option/enum_value_option */
  aggregateLiteralsOutsideOptionValue: { row: number; text: string }[]
}
/** A `string` is a refusal: the probe could not measure, and says why. */
const factsByFile = new Map<string, FileFacts | string>()

const OPTION_VALUE_ANCESTORS = new Set(["option", "constant", "field_option", "enum_value_option"])
const ANCESTOR_DEPTH = 8

const hasOptionValueAncestor = (n: any): boolean => {
  let p = n?.parent
  for (let depth = 0; p && depth < ANCESTOR_DEPTH; depth++) {
    if (OPTION_VALUE_ANCESTORS.has(p.type)) return true
    p = p.parent
  }
  return false
}

const walkFacts = (root: any, via: "handed" | "self-parsed"): FileFacts => {
  const counts = new Map<string, number>()
  const aggregateLiteralsOutsideOptionValue: { row: number; text: string }[] = []
  let nodes = 0
  const visit = (n: any): void => {
    nodes++
    counts.set(n.type, (counts.get(n.type) ?? 0) + 1)
    if (n.type === "block_lit" && !hasOptionValueAncestor(n)) {
      aggregateLiteralsOutsideOptionValue.push({ row: n.startPosition.row + 1, text: String(n.text).slice(0, 70) })
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(root)
  return { via, nodes, counts, aggregateLiteralsOutsideOptionValue }
}

const selfParse = (fileLabel: string): FileFacts | string => {
  if (!laneParser) return `NOT MEASURED — ${PROTOBUF_WASM} did not load: ${laneGrammarError}`
  const abs = path.join(CR, fileLabel)
  let text: string
  try {
    text = readFileSync(abs, "utf8")
  } catch (e) {
    return `NOT MEASURED — ${abs} is unreadable: ${String((e as any)?.message ?? e)}`
  }
  let tree: any
  try {
    tree = laneParser.parse(text)
  } catch (e) {
    return `NOT MEASURED — ${abs} did not parse: ${String((e as any)?.message ?? e)}`
  }
  const rootType = tree?.rootNode?.type
  if (!tree || rootType !== PROTOBUF_ROOT) {
    tree?.delete?.()
    return `NOT MEASURED — ${abs} parsed to root \`${rootType ?? "none"}\`, not \`${PROTOBUF_ROOT}\``
  }
  const facts = walkFacts(tree.rootNode, "self-parsed")
  tree.delete?.()
  return facts
}

const summarize = (handed: any, fileLabel: string): FileFacts | string => {
  const cached = factsByFile.get(fileLabel)
  if (cached !== undefined) return cached
  // Branch 1: the arbiter handed a protobuf tree, so its own measurement is used and
  // nothing is re-read. This is the branch that will be taken once `protobuf` is in
  // `LANGS`, which is why the verdicts do not depend on the wiring being fixed.
  const facts = handed?.type === PROTOBUF_ROOT ? walkFacts(handed, "handed") : selfParse(fileLabel)
  factsByFile.set(fileLabel, facts)
  // Accounted ONCE PER FILE, not once per probe call: the arbiter walks ruling-major, so
  // every file is summarized five times here and a per-call tally would print the same
  // corpus five times over as five different ones.
  if (typeof facts === "string") {
    stats.refused++
    stats.hitsByType.set("refusals", (stats.hitsByType.get("refusals") ?? 0) + 1)
  } else {
    stats.filesMeasured++
    if (facts.via === "handed") stats.filesViaHandedTree++
    else stats.filesSelfParsed++
    for (const t of facts.counts.keys()) stats.nodeTypesObserved.add(t)
    const blockLits = facts.counts.get("block_lit") ?? 0
    stats.blockLits += blockLits
    stats.blockLitsInsideOptionValue += blockLits - facts.aggregateLiteralsOutsideOptionValue.length
  }
  return facts
}

// ---------------------------------------------------------------- probe accounting
const stats = {
  probeCalls: 0,
  filesMeasured: 0,
  filesViaHandedTree: 0,
  filesSelfParsed: 0,
  refused: 0,
  hits: 0,
  hitsByType: new Map<string, number>(),
  nodeTypesObserved: new Set<string>(),
  blockLits: 0,
  blockLitsInsideOptionValue: 0,
}
process.on("exit", () => {
  if (stats.probeCalls === 0) return
  const perType = [...stats.hitsByType.entries()].sort().map(([t, n]) => `${t}=${n}`).join(" ")
  console.log(
    `[protobuf-ruled] instrument B measured under ${PROTOBUF_WASM} (root \`${PROTOBUF_ROOT}\`). ` +
      `probe calls ${stats.probeCalls}; files measured ${stats.filesMeasured} ` +
      `(the arbiter's own tree ${stats.filesViaHandedTree}, re-parsed by this lane ${stats.filesSelfParsed}); ` +
      `files NOT MEASURED ${stats.refused}; construct hits ${stats.hits}${perType ? ` (${perType})` : ""}. ` +
      `Across those files: ${stats.nodeTypesObserved.size} distinct node types, ` +
      `${stats.blockLits} \`block_lit\` of which ${stats.blockLitsInsideOptionValue} are an option or constant value.`,
  )
})

const refuse = (reason: string, fileLabel: string, hits: string[]): void => {
  hits.push(
    `${fileLabel}: ${reason}. This probe reports what it measured, so it fails the gate here rather ` +
      `than certify a zero it did not observe: the arbiter counts every element of \`hits\` as one ` +
      `occurrence of the construct.`,
  )
}

/** The probe every ruling below shares: measure once, then count the node types that
 *  would express the construct, and report each one it actually saw. */
const probe = (type: string, targets: string[]) => (handed: any, fileLabel: string, hits: string[]): void => {
  stats.probeCalls++
  const facts = summarize(handed, fileLabel)
  if (typeof facts === "string") {
    refuse(facts, fileLabel, hits)
    return
  }
  let seen = 0
  for (const t of targets) {
    const n = facts.counts.get(t) ?? 0
    if (n <= 0) continue
    seen += n
    hits.push(`${fileLabel}: ${n}x \`${t}\` — the node type that would express \`${type}\` is present`)
  }
  if (seen > 0) {
    stats.hits += seen
    stats.hitsByType.set(type, (stats.hitsByType.get(type) ?? 0) + seen)
  }
}

// ---------------------------------------------------------------- the table
export const PROTOBUF_RULED: Ruled[] = [
  {
    type: "calls",
    instrument: "B:parse-tree-count",
    nodeTypesThatWouldMeanIt: [
      "call_expression",
      "call",
      "function_call",
      "method_call",
      "method_invocation",
      "invocation",
      "invocation_expression",
      "macro_invocation",
      "function_definition",
      "method_definition",
      "function_declaration",
    ],
    countOnTree: probe("calls", [
      "call_expression",
      "call",
      "function_call",
      "method_call",
      "method_invocation",
      "invocation",
      "invocation_expression",
      "macro_invocation",
      "function_definition",
      "method_definition",
      "function_declaration",
    ]),
    describe:
      "a function definition or a call expression — anything on the tree that names a callee. A `.proto` file declares a SCHEMA and has no executable body: the closest thing to an operation is `rpc Foo(Req) returns (Res)`, and `rpc` names two message types rather than invoking anything, so both of its types are `uses` edges onto declarations (role `rpcRequest` / `rpcResponse`). MEASURED over 847 corpus files under `wasm/tree-sitter-protobuf.wasm`: 0 occurrences of each of the 11 node types above, over the 94 distinct node types the grammar produced. The same 11 names under the grammar the arbiter actually loaded (`tree-sitter-bash.wasm`, see the header) yield 1 occurrence of `function_definition`, which is how this row was FALSIFIED at commit 86c5f05f4. OVERTURN: any one of the 11 node types appearing on a protobuf parse tree, which this probe would report as a hit and the arbiter would grade FALSIFIED.",
  },
  {
    type: "extends",
    instrument: "B:parse-tree-count",
    nodeTypesThatWouldMeanIt: [
      "extends_clause",
      "superclass",
      "class_declaration",
      "interface_declaration",
      "struct_declaration",
      "inheritance_specifier",
      "base_class",
      "class_heritage",
    ],
    countOnTree: probe("extends", [
      "extends_clause",
      "superclass",
      "class_declaration",
      "interface_declaration",
      "struct_declaration",
      "inheritance_specifier",
      "base_class",
      "class_heritage",
    ]),
    describe:
      "a class-heritage clause. Protobuf has no inheritance: a message cannot be declared from another message, and there is no node type that would carry one. The vocabulary's `extend` (420 blocks observed at pass 1, 214 `extend` nodes at pass 2's count) is the proto2 FIELD-EXTENSION BLOCK, which adds MEMBERS to a type declared elsewhere — it is read as `contains` with `metadata.viaExtension` on both the edge and the member, and the extended type is never declared a subclass of anything. MEASURED over 847 corpus files: 0 occurrences of each of the 8 node types above. OVERTURN: any of the 8 on a protobuf parse tree.",
  },
  {
    type: "implements",
    instrument: "B:parse-tree-count",
    nodeTypesThatWouldMeanIt: [
      "implements_clause",
      "superclass",
      "interface_implementation",
      "protocol_reference_list",
      "base_class",
      "satisfies_clause",
    ],
    countOnTree: probe("implements", [
      "implements_clause",
      "superclass",
      "interface_implementation",
      "protocol_reference_list",
      "base_class",
      "satisfies_clause",
    ]),
    describe:
      "an interface-satisfaction clause, separately or as part of a heritage clause. Protobuf's only contract type is `service`, and a service declares `rpc`s — it does not name another type as a contract it satisfies, so nothing on the tree can carry the relation even though a service is semantically an interface (hence `SymbolKind.Interface` for it). MEASURED over 847 corpus files: 0 occurrences of each of the 6 node types above. OVERTURN: any of the 6 on a protobuf parse tree, or any `service` node naming a supertype — which no probe here counts, because a service naming another service would be an EDGE this analyzer would have to emit first.",
  },
  {
    type: "instantiates",
    instrument: "B:parse-tree-count",
    // B, and the reason is worth stating because A would be the lazy answer. A grammar
    // inventory for this type has to guess at NAMES: `new_expression`,
    // `constructor_invocation`, and so on. Protobuf's own aggregate-literal node is
    // called `block_lit`, which is in none of those lists, so an A ruling here would be a
    // name list failing to recognise the one construct that could have matched it. B
    // counts the construct instead of inferring its absence from spelling — the gate's
    // own JSON entry records the same lesson, where a first probe matched a SHAPE (any
    // string in the document) rather than a ROLE (the value of a `$ref` key) and reported
    // 2,651 occurrences of something that was not the construct.
    nodeTypesThatWouldMeanIt: [
      "new_expression",
      "object_creation_expression",
      "constructor_invocation",
      "message_literal",
      "aggregate_literal",
      "instantiation",
    ],
    countOnTree: (handed, fileLabel, hits) => {
      const before = hits.length
      probe("instantiates", [
        "new_expression",
        "object_creation_expression",
        "constructor_invocation",
        "message_literal",
        "aggregate_literal",
        "instantiation",
      ])(handed, fileLabel, hits)
      // `hits.length` against the SHARED array would be the arbiter's running total, so
      // the first file to push anything would suppress the check for every file after it.
      // The delta is this call's own.
      if (hits.length > before) return
      const facts = summarize(handed, fileLabel)
      if (typeof facts === "string") return // `probe` already refused, and said why
      // `block_lit` is protobuf's AGGREGATE LITERAL — `{ field: value … }` — and the only
      // place a `.proto` file writes a VALUE OF A MESSAGE TYPE. It is a construction only
      // when it is not the value of an option: `option (x) = { a: 1 }` is a
      // code-generation directive's payload, and a field option's aggregate is a default
      // value. The ancestor chain decides it, never the text, so a `{ … }` inside a string
      // or a comment cannot produce a hit.
      for (const a of facts.aggregateLiteralsOutsideOptionValue) {
        stats.hits++
        stats.hitsByType.set("instantiates", (stats.hitsByType.get("instantiates") ?? 0) + 1)
        hits.push(`${fileLabel}:${a.row} aggregate literal outside an option value: ${a.text}`)
      }
    },
    describe:
      "a construct that PRODUCES a value of a message type. Protobuf declares; it does not construct — the schema is the artifact and the values arrive at run time in a language this analyzer does not read. The nearest construct the grammar HAS is the aggregate literal `block_lit`, so this ruling counts it rather than trusting a name list: a `block_lit` outside an option or constant value would be a written message value and would make this ruling false. PROBE: count the 6 node types above, then count `block_lit` nodes whose ancestor chain reaches no `option`, `constant`, `field_option` or `enum_value_option`. MEASURED at pass 1 over 627 files: 1,133 `block_lit` nodes, EVERY ONE of them under a `constant`; pass 2, 821 files: 1,909, and `aggregateLiteralsByParentNode` was `{ constant: 1909 }` — one key. The 16,207 message-TYPED DECLARATIONS the same walk counts are REFERENCES, not constructions — a field whose type is a message holds one and declaring the field creates nothing. COVER, MEASURED at pass 13 by `script/m14/tmp/protobuf/probe/message-typed-coverage.mts`: 16,202 of 16,204 message-typed declaration rows carry a `uses` edge at their own row — 99.99%, not the 'every one' an earlier draft of this string asserted. THE 2 EXCEPTIONS are named in that probe's output and both are custom options naming an extension type. OVERTURN: any of the 6 node types, or any `block_lit` outside an option value — the same channel, so a correct protobuf corpus would move this row.",
  },
  {
    type: "references",
    instrument: "B:parse-tree-count",
    nodeTypesThatWouldMeanIt: [
      "type_identifier",
      "reference",
      "identifier_reference",
      "scoped_identifier",
      "qualified_identifier",
      "type_annotation",
      "value_reference",
    ],
    countOnTree: probe("references", [
      "type_identifier",
      "reference",
      "identifier_reference",
      "scoped_identifier",
      "qualified_identifier",
      "type_annotation",
      "value_reference",
    ]),
    describe:
      "NOT A MISSING CONSTRUCT, and the distinction matters more than the verdict. Protobuf's only references are TYPE references — there is no expression, no variable read and no value use, because there is no expression. The construct occurs constantly (10,006 `message_or_enum_type` nodes at pass 1, 10,166 message-typed declarations at pass 2) and it is EMITTED, under the label `uses`, which is this family's convention for a type reference and what the sibling IDL lane does. The separate `references` label stays unused because there is no SECOND KIND of reference for it to name; emitting both labels on one node would make one edge mean two things, which is the same conflation `contains` is forbidden from making between membership and grouping. MEASURED over 847 corpus files: 0 occurrences of each of the 7 node types above, and the 94 observed types contain no value-reference node — the corpus's own type-reference node is `message_or_enum_type`, which is on the `uses` edge, not on this list. OVERTURN: any of the 7, or any observed construct that references a name other than a type — a value read, a symbol use in an expression.",
  },
]

export default PROTOBUF_RULED