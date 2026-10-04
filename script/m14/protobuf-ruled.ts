/**
 * PROTOBUF RULING TABLE — the five relationship types this analyzer does not emit,
 * each with the corpus probe that makes its ruling falsifiable.
 *
 * ## Why this file exists and why it is separate
 *
 * `script/m14/ontology-coverage-gate.ts` is the workstream's arbiter, and its header
 * records why: `overrides` was missing from Bash for a whole wave and the
 * differential stayed green, because the analyzer omitted it and the oracle was
 * written after that ruling — nothing agrees with nothing. It reads this file from
 * `RULED_BY_LANG`, which is SHARED and the supervisor's. So the table lives here,
 * lane-owned, and wiring it is one import and one map entry:
 *
 *   import { PROTOBUF_RULED } from "./protobuf-ruled"
 *   const RULED_BY_LANG: Record<string, Ruled[]> = { …, protobuf: PROTOBUF_RULED }
 *
 * Nothing else in the gate changes. This is the same shape bash, json, css, nim,
 * powershell, julia, markdown, scss, solidity, yaml, clean, sql and the rest of this
 * wave use.
 *
 * ## The gate's `Ruled` shape, restated
 *
 * The gate declares `type Ruled` and `type Instrument` as LOCALS and exports
 * neither, so they are restated here rather than imported. If the supervisor exports
 * them, this file should import them instead of keeping a second copy that can drift
 * — a restated type that nobody compares is a tautology wearing a type annotation.
 *
 * ## Corpus these numbers come from
 *
 * 821 `.proto` files in 18 repositories under `$HOME/fixtures/repositories`,
 * walked as a working tree (three of the corpora are sparse checkouts, where
 * `git ls-files` — which the gate uses — lists 8,694 tracked paths that are not on
 * disk). Every probe below reads the SAME tree in ONE streaming pass, so a construct
 * can never be counted on one parse and the inventory taken on another.
 *
 * Reproduce: `npx tsx script/m14/protobuf-construct-probes.mts` (the lane's own
 * instrument harness, which measures every probe in this file and more).
 *
 * ## WHY EVERY `countOnTree` BELOW REFUSES TO REPORT A ZERO FROM THE WRONG GRAMMAR
 *
 * The gate picks its wasm with
 *
 *   const wasmPath = (LANGS as any)[LANG]?.wasm ?? "tree-sitter-bash.wasm"
 *
 * and `LANGS` is `script/m14/differential.ts`'s. `protobuf` is not in it, so unless
 * the supervisor adds it, BOTH instruments are handed the bash grammar and a corpus
 * of `.proto` files — a `.proto` file parsed as bash yields `program`/`word`/
 * `comment`, 2,975 ERROR nodes and 81 node types, none of which is a protobuf
 * construct. Measured by `script/m14/tmp/protobuf/probe/_wasm-fallback.mts`:
 *
 *   - instrument A would report "the grammar produced N distinct node types and NONE
 *     expresses it" for four of these five types — while measuring bash.
 *   - instrument B would report a construct count of 0 for every probe here — while
 *     measuring a language in which the construct cannot occur by construction.
 *
 * Both are RULED-SOUND verdicts reached without reading protobuf at all. A gate that
 * cannot tell "the construct is absent" from "the probe was pointed at the wrong
 * grammar" reports the first as the second. So each `countOnTree` below checks that
 * the tree it was handed is a protobuf tree — `rootNode.type === "source_file"`,
 * which is protobuf's root rule and cannot be produced by any other grammar in this
 * repository's `wasm/` — and records a HIT rather than a zero when it is not. That
 * turns a silent false pass into a visible FALSIFIED with the reason attached.
 *
 * Instrument A cannot defend itself the same way: the gate intersects the observed
 * node types with the `nodeTypesThatWouldMeanIt` list itself, and no value in that
 * array can carry a guard. Under the bash fallback the `calls` entry below is
 * FALSIFIED for the wrong reason — `function_definition` is a real BASH node type and
 * 2,975 ERROR nodes is what a `.proto` file looks like to a bash parser. That is
 * reported rather than worked around, because the fix is one entry in a shared file
 * and working around it here would mean writing a list that is wrong under the right
 * grammar in order to be quiet under the wrong one.
 */

/** Restated from `script/m14/ontology-coverage-gate.ts`, which exports neither. */
export type Instrument = "A:grammar-inventory" | "B:parse-tree-count"

export type Ruled = {
  type: "calls" | "uses" | "contains" | "imports" | "references" | "exports" | "extends" | "implements" | "overrides" | "instantiates"
  instrument: Instrument
  /** A: node types that would express the construct. B: unused. */
  nodeTypesThatWouldMeanIt?: string[]
  /** B: count occurrences on the tree. A: unused. */
  countOnTree?: (root: any, fileLabel: string, hits: string[]) => void
  describe: string
}

/**
 * The root node type of a well-formed protobuf parse. `source_file` is the grammar's
 * own start rule (`grammars/tree-sitter-proto/grammar.js`), and no other grammar
 * vendored in `wasm/` declares it, so a probe that sees anything else was handed the
 * wrong parser and must not report a zero.
 */
const PROTOBUF_ROOT = "source_file"
let wrongGrammarReported = false
const guardWrongGrammar = (root: any, fileLabel: string, hits: string[]): boolean => {
  if (root?.type === PROTOBUF_ROOT) return true
  // Once, not once per file: the gate prints the first three examples of a
  // construct hit, and 821 identical lines would bury the one that matters.
  if (!wrongGrammarReported) {
    wrongGrammarReported = true
    hits.push(
    `${fileLabel}: WRONG GRAMMAR — this probe was handed a tree whose root node is \`${root?.type}\`, not \`${PROTOBUF_ROOT}\`. ` +
      `It refuses to report a construct count of 0 from a language in which the construct cannot occur. ` +
      `Add \`protobuf: { wasm: "tree-sitter-protobuf.wasm", analyzerFile: "real-protobuf-analyzer", className: "RealProtobufAnalyzer", ext: "proto" }\` ` +
      `to LANGS in script/m14/differential.ts (run-fixtures.ts:91 already carries those four fields for this lane).`,
    )
  }
  return false
}

export const PROTOBUF_RULED: Ruled[] = [
  {
    type: "calls",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: [
      "function_definition",
      "method_definition",
      "call_expression",
      "call",
      "invocation",
      "function_body",
      "block",
      "expression_statement",
      "argument_list",
      "body_statement",
    ],
    describe:
      "a function definition or a call expression. A `.proto` file declares a SCHEMA and has no executable body: the closest thing to an operation is `rpc Foo(Req) returns (Res)`, and `rpc` names two message types rather than invoking anything, so both of its types are `uses` edges onto declarations (role `rpcRequest` / `rpcResponse`). PROBE: walk every node of every corpus file, collect `node.type` into a set, intersect with the list above. MEASURED: 94 distinct node types observed across 821 files, 117 declared by the wasm, intersection EMPTY. The full observed vocabulary is recorded in the corpus run so the emptiness can be re-checked rather than taken on trust. OVERTURN: any observed node type in that list, or any corpus file containing an invocation.",
  },
  {
    type: "extends",
    instrument: "A:grammar-inventory",
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
    describe:
      "a class-heritage clause. Protobuf has no inheritance: a message cannot be declared from another message, and there is no node type that would carry one. The vocabulary's `extend` (420 blocks observed at pass 1, 214 `extend` nodes at pass 2's count) is the proto2 FIELD-EXTENSION BLOCK, which adds MEMBERS to a type declared elsewhere — it is read as `contains` with `metadata.viaExtension` on both the edge and the member, and the extended type is never declared a subclass of anything. PROBE: the same intersection as `calls`. MEASURED: intersection EMPTY. OVERTURN: any observed node type expressing heritage or a superclass.",
  },
  {
    type: "implements",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: [
      "implements_clause",
      "superclass",
      "interface_implementation",
      "protocol_reference_list",
      "base_class",
      "satisfies_clause",
    ],
    describe:
      "an interface-satisfaction clause, separately or as part of a heritage clause. Protobuf's only contract type is `service`, and a service declares `rpc`s — it does not name another type as a contract it satisfies, so nothing on the tree can carry the relation even though a service is semantically an interface (hence `SymbolKind.Interface` for it). PROBE: the same intersection. MEASURED: intersection EMPTY. OVERTURN: any observed node type expressing an implements clause, or any `service` node naming a supertype.",
  },
  {
    type: "instantiates",
    // B, not A, and the reason is worth stating because A would be the lazy answer.
    // A grammar inventory for this type has to guess at NAMES: `new_expression`,
    // `constructor_invocation`, and so on. Protobuf's own aggregate-literal node is
    // called `block_lit`, which is in none of those lists, so an A ruling here would
    // be a name list failing to recognise the one construct that could have matched
    // it. B counts the construct instead of inferring its absence from spelling —
    // the gate's own JSON entry records the same lesson, where a first probe matched
    // a SHAPE (any string in the document) rather than a ROLE (the value of a `$ref`
    // key) and reported 2,651 occurrences of something that was not the construct.
    instrument: "B:parse-tree-count",
    countOnTree: (root, fileLabel, hits) => {
      if (!guardWrongGrammar(root, fileLabel, hits)) return
      // `block_lit` is protobuf's AGGREGATE LITERAL — `{ field: value … }` — and the
      // only place a `.proto` file writes a VALUE OF A MESSAGE TYPE. It is a
      // construction only when it is not the value of an option: `option (x) = {
      // a: 1 }` is a code-generation directive's payload, and a field option's
      // aggregate is a default value. The ancestor chain decides it, never the text,
      // so a `{ … }` inside a string or a comment cannot produce a hit.
      //
      // MEASURED at pass 1 over 627 files: 1,133 `block_lit` nodes, EVERY ONE of
      // them under a `constant`. Pass 2, 821 files: 1,909, and
      // `aggregateLiteralsByParentNode` is `{ constant: 1909 }` — one key.
      const visit = (n: any): void => {
        if (n.type === "block_lit") {
          const chain: string[] = []
          let p = n.parent
          while (p && chain.length < 8) {
            chain.push(p.type)
            if (p.type === "option" || p.type === "constant" || p.type === "field_option" || p.type === "enum_value_option") break
            p = p.parent
          }
          const asOptionValue = chain.some((t) => t === "option" || t === "constant" || t === "field_option" || t === "enum_value_option")
          if (!asOptionValue) {
            hits.push(`${fileLabel}:${n.startPosition.row + 1} aggregate literal outside an option value: ${String(n.text).slice(0, 70)}`)
          }
        }
        for (let i = 0; i < n.childCount; i++) visit(n.child(i))
      }
      visit(root)
    },
    describe:
      "a construct that PRODUCES a value of a message type. Protobuf declares; it does not construct — the schema is the artifact and the values arrive at run time in a language this analyzer does not read. The nearest construct the grammar HAS is the aggregate literal `block_lit`, so this ruling counts it rather than trusting a name list: a `block_lit` outside an option or constant value would be a written message value and would make this ruling false. PROBE: count `block_lit` nodes whose ancestor chain reaches no `option`, `constant`, `field_option` or `enum_value_option`. MEASURED: 1,909 `block_lit` nodes, 1,909 of them under `constant`, so 0 construct occurrences. The 10,166 message-TYPED DECLARATIONS the same walk counts are REFERENCES, not constructions — a field whose type is a message holds one and declaring the field creates nothing — and every one of them is already emitted as `uses`. OVERTURN: a `block_lit` outside an option value, or any node type that constructs a value.",
  },
  {
    type: "references",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: [
      "type_identifier",
      "reference",
      "identifier_reference",
      "scoped_identifier",
      "qualified_identifier",
      "type_annotation",
      "value_reference",
    ],
    describe:
      "NOT A MISSING CONSTRUCT, and the distinction matters more than the verdict. Protobuf's only references are TYPE references — there is no expression, no variable read and no value use, because there is no expression. The construct occurs constantly (10,006 `message_or_enum_type` nodes at pass 1, 10,166 message-typed declarations at pass 2) and it is EMITTED, under the label `uses`, which is this family's convention for a type reference and what the sibling IDL lane does. The separate `references` label stays unused because there is no SECOND KIND of reference for it to name; emitting both labels on one node would make one edge mean two things, which is the same conflation `contains` is forbidden from making between membership and grouping. PROBE: the same intersection, for the node types that would carry a non-declaring reference. MEASURED: intersection EMPTY, and the 94 observed types contain no value-reference node. OVERTURN: any observed construct that references a name other than a type — a value read, a symbol use in an expression.",
  },
]

export default PROTOBUF_RULED