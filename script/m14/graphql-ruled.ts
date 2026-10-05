/**
 * GRAPHQL RULING TABLE — the three types `src/ast/real-graphql-analyzer.ts` does not
 * emit, each with the instrument the workstream defines and the measurement behind it.
 *
 *     extends      RULED  instrument B (parse-tree-count)
 *     calls        RULED  instrument A (grammar-inventory)
 *     instantiates RULED  instrument A (grammar-inventory)
 *
 * `imports` is NOT here. It was on this list until this round and is now EMITTED: the
 * `#import "<file>"` convention is 170 directives across 131 corpus files. Over the 1,905 admitted
 * files, 156 of those 170 targets name a file that EXISTS on disk — 91.76% — resolved against the
 * importing file's own directory, which is what eslint-plugin-graphql does. The same 170 targets
 * resolved against the REPOSITORY root give 0 of 170, which is the base an earlier pass used and
 * the reason an earlier artifact reported the type at 0% on disk. The 14 that miss are configured
 * aliases (`@b-schema`, `@circular/b.graphql`, `@multiple-levels/level2.graphql`,
 * `graphql-import-test/b.graphql`, `shared`, `/b.graphql`) that a per-file analyzer cannot resolve.
 *
 * ## RUN THE ARBITER WITH `--fresh`, OR IT REPORTS THIS LANE AS EMITTING NOTHING
 *
 *     npx tsx script/m14/ontology-coverage-gate.ts graphql --fresh
 *
 * Without `--fresh` the arbiter resumed from `validation/m14/measurements/walk-graphql.txt`, which
 * already held all 1,905 files, so `resumableWalk` never called its `run()` callback, the `observed`
 * tally stayed empty, and it printed `emitted 0/10` with `RULED-UNJUSTIFIED` on the seven types
 * this analyzer emits — while exiting non-zero for a reason that had nothing to do with any of them.
 * Every accumulator in that gate is populated inside `run()`, so a resumed walk measures nothing and
 * reports a full-looking table over a population it never walked. `--fresh` is not optional for any arbiter whose results are not
 * persisted. Shared machinery, so this is recorded here rather than edited.
 *
 * The other six types (`uses`, `contains`, `references`, `exports`, `implements`,
 * `overrides`) are EMITTED and the gate counts them from production `parseFile`, so they
 * take no row here. Per-type verdicts, the six questions and the declared limitations are
 * in `docs/analyzers/real-graphql-analyzer.md`.
 *
 * ## A MEASUREMENT DEFECT THAT AFFECTS EVERY `A` AND `B` ROW IN THIS FILE — read this first
 *
 * `script/m14/ontology-coverage-gate.ts:322` resolves its grammar as
 * `(LANGS as any)[LANG]?.wasm ?? "tree-sitter-bash.wasm"`, and `graphql` is NOT an entry in
 * `LANGS` in `script/m14/differential.ts:740` — the LANGS map in `script/m14/run-fixtures.ts`
 * has graphql, the one in differential.ts does not, and they are separate maps. So when the
 * arbiter is run as `... ontology-coverage-gate.ts graphql`, BOTH of its instruments parse
 * every corpus file with the BASH grammar.
 *
 * What that means per instrument, precisely:
 *
 *   - Instrument A (`grammarNodeTypes`) collects the node types the BASH grammar produces.
 *     Every name in this file's `nodeTypesThatWouldMeanIt` is absent from it, so the A rows
 *     report RULED-SOUND for a reason that has nothing to do with GraphQL.
 *   - Instrument B (`countOnTree`) is handed a bash tree. The `extends` probe below looks
 *     for `Definition`, `ObjectTypeDefinition`, `ImplementsInterfaces` and `Extension`
 *     nodes; a bash tree has none, so it reports 0x and RULED-SOUND for the wrong language.
 *
 * Neither is a false EMITTED. Both are vacuous passes, which is the failure this project
 * exists to avoid: a green verdict that moved without the evidence moving. The fix is one
 * entry in shared machinery and is §8, not this lane's to apply:
 *
 *     // script/m14/differential.ts:740, in LANGS
 *     graphql: { wasm: "tree-sitter-graphql.wasm", analyzerFile: "real-graphql-analyzer", className: "RealGraphqlAnalyzer", ext: "graphql,graphqls,gql" },
 *
 * Until that lands, every number in this file is the LANE'S OWN, measured by
 * `script/m14/tmp/graphql/probe/extends-condition.mts` and the census in
 * `script/m14/tmp/graphql/out/`, and they are published here so the arbiter can compare
 * rather than trust: `publishedCount` / `publishedFiles` on the B row are the numbers the
 * gate is accountable to, read the way julia-ruled reads its own.
 *
 * THE SYMPTOM, so the next reader recognises it: a correct `--fresh` run of
 * `ontology-coverage-gate.ts graphql` prints, for the two `A` rows, "the grammar produced
 * **57** distinct node types across the corpus". The graphql grammar produces **98**. 57 is
 * the BASH grammar's inventory — the same run prints it for every lane, because the value is
 * `(LANGS as any)[LANG]?.wasm ?? "tree-sitter-bash.wasm"` with no `graphql` entry to find.
 * So an `A` row reading "57 node types, none of them a call" is a statement about bash.
 *
 * ## WHAT INSTRUMENT A CAN AND CANNOT SEE IN THIS LANGUAGE
 *
 * Instrument A asks one question: does the grammar PRODUCE any node type in the list?
 * For `calls` and `instantiates` that is the right question and the answer is positive
 * evidence: the graphql grammar yields **98 distinct node types over 882,672 nodes on
 * 1,905 admitted files**, and the whole inventory is in
 * `script/m14/tmp/graphql/out/ontology-census.json` under `instrumentA.inventory`. It
 * contains `Field`, `Arguments`, `Argument`, `Directive`, `OperationDefinition` and 92
 * others, and it contains no call node and no construction node.
 *
 * CALIBRATION, because "absent from a list I wrote" is only evidence if the list can hold
 * a present entry: the same instrument-A vocabulary, matched against the corpus's own
 * anonymous-token inventory (`instrumentA.anonymousTokens`, 57 distinct tokens), holds
 * **9 of 9** of GraphQL's own keywords — `type` 5,691, `extend` 355, `implements` 1,156,
 * `union` 528, `enum` 846, `scalar` 411, `interface` 437, `fragment` 1,166,
 * `directive` 603 — so "not in the list" means the grammar does not produce it, not that
 * the list is inert.
 *
 * WHAT A CANNOT SEE, and it is the whole reason `calls` carries a caveat rather than a
 * clean verdict: a grammar cannot see a CONVENTION. The `#import` case is the proof — the
 * grammar has no import node (`A:import_node: 0`) and the corpus has 170 real import
 * directives. So for `calls` the inventory is paired with a parse-tree count of the
 * construct's nearest real form, and both numbers are published below.
 */
import type { Ruled, Type } from "./ontology-coverage-gate"

export const GRAPHQL_RULED: Ruled[] = [
  // ─────────────────────────────────────────────────────────────── extends
  //
  // The one ruling here that the language CAN express and this corpus simply does not use
  // in the way the analyzer reads — so instrument B, not A. GraphQL has exactly one
  // supertype clause, `implements`, and the grammar proves it: `A:supertype_clause_node: 0`
  // over 882,672 nodes, so there is no `extends` clause to rule about. The analyzer does
  // emit `extends`, and the branch is worth stating because "emitted 0 times" and "cannot
  // be emitted" are different claims.
  //
  // The branch: `emitHeritage` (real-graphql-analyzer.ts:336-344) labels a clause `extends`
  // when `supertypeKindOf` says the supertype IS a `Class` (object or input object) or a
  // `Type` (union or scalar) IN THIS DOCUMENT. GraphQL writes `A implements B` and
  // `A extends B` with the same grammar rule, so the label is a decision about what `B` is,
  // and a per-file analyzer can only read that off the document it is parsing.
  //
  // The measurement is a replication of that condition, per document, over the same 1,905
  // admitted files (`script/m14/tmp/graphql/probe/extends-condition.mts`):
  //
  //     all_implements_clauses                    3,330 occurrences / 163 files
  //     implements_supertype_is_interface_here    3,225 occurrences / 147 files
  //     extends_condition_met                         0 occurrences /   0 files
  //     extends_supertype_object                       0
  //     extends_supertype_union_or_scalar               0
  //     extends_owner_declares_no_field                  0
  //
  // The census also reports
  // `B:implements_an_unambiguously_object_type_in_the_same_document: 0`, which agrees — but
  // it cannot be the instrument, because that probe counts a NARROWER thing than the branch
  // it would rule on, in two ways: it recognises an inheritance-shaped supertype only as
  // Object/InputObject (ontology-census.mts:699) while `supertypeKindOf` also returns `Type`
  // for Union and Scalar; and its pass opens `if (!hereFields) continue` (line 696) because
  // it reuses `hereFields` for the member check below, so a field-less implementor is never
  // counted. Both gaps measure 0 on this corpus, so its verdict is right by luck. A probe
  // that counts less than the branch cannot falsify that branch.
  //
  // THE 105-CLAUSE REMAINDER, stated rather than left implicit: 3,330 clauses resolve to an
  // interface declared in the same document 3,225 times, and the remaining 105 name a
  // supertype this document says nothing about — a split schema, where the supertype is
  // declared in another file. Deciding those needs a project-scope join, which a per-file
  // analyzer does not have. Guessing `extends` for an unclassifiable supertype is the
  // fabrication the workstream's rule exists to prevent.
  //
  // WHAT `extend type N` IS NOT: a type-system EXTENSION is not inheritance. It is the same
  // type continued — `extend type Todo` adds members to a `Todo` — and the analyzer already
  // carries it as `contains` on the added members with `metadata.extension: true`. Measured
  // on the corpus: `extend_type_of_a_type_declared_in_this_document: 76 occurrences / 13
  // files`, and `extend_type_of_a_type_declared_elsewhere: 176 / 153` (the split-schema
  // shape). Neither is an `extends` edge, and this row says so because a reader who knows
  // `extend` will ask.
  //
  // OVERTURN CONDITION — satisfiable by a CORRECT implementation, which is the test:
  // one document in which an `implements` clause names a supertype that THE SAME DOCUMENT
  // declares, with a unique kind, as an object type, an input object type, a union or a
  // scalar. Every clause in the corpus that could satisfy this names its supertype in
  // another file; merging one such split schema into a single document satisfies it, and the
  // correct analyzer then emits `extends` for it. The number that would overturn the ruling
  // is therefore `extends_condition_met` >= 1 over the same corpus — currently 0 over 1,905
  // files — and it is this probe that measures it, not a count of `implements` clauses,
  // which is 3,330 and proves nothing either way.
  {
    type: "extends",
    instrument: "B:parse-tree-count",
    publishedCount: 0,
    publishedFiles: 0,
    // Replicates `emitHeritage`'s condition verbatim: `kindOfNameHere` from
    // `topLevelDeclarations()` (an extension never declares, real-graphql-analyzer.ts:1114),
    // then `supertypeKindOf` (exactly one kind, and that kind Interface/Class/Type), then
    // `emitHeritage` (Extends when Class or Type).
    countOnTree: (root, fileLabel, hits) => {
      const WRAPPERS = new Set(["Document", "Definition", "ExecutableDefinition", "TypeSystemDefinition", "TypeSystemExtension", "TypeDefinition", "TypeExtension"])
      const unwrap = (n: any): any => {
        let cur = n
        for (;;) {
          if (!WRAPPERS.has(cur.type)) return cur
          const kids = (n.namedChildren ?? []).filter((c: any) => c)
          if (kids.length !== 1) return cur
          cur = kids[0]
        }
      }
      const nameOf = (n: any): string | undefined => {
        for (const c of n.namedChildren ?? []) if (c && c.type === "Name") return c.text
        return undefined
      }
      const EXT_TO_DEF: Record<string, string> = {
        ObjectTypeExtension: "ObjectTypeDefinition",
        InterfaceTypeExtension: "InterfaceTypeDefinition",
        UnionTypeExtension: "UnionTypeDefinition",
        EnumTypeExtension: "EnumTypeDefinition",
        ScalarTypeExtension: "ScalarTypeDefinition",
        InputObjectTypeExtension: "InputObjectTypeDefinition",
      }
      const KIND_OF: Record<string, string> = {
        ObjectTypeDefinition: "Class",
        InputObjectTypeDefinition: "Class",
        InterfaceTypeDefinition: "Interface",
        UnionTypeDefinition: "Type",
        ScalarTypeDefinition: "Type",
        EnumTypeDefinition: "Enum",
      }
      const doc = root.type === "Document" ? root : (root.namedChildren ?? []).find((c: any) => c && c.type === "Document")
      if (!doc) return
      const defs = (doc.namedChildren ?? []).filter((c: any) => c && c.type === "Definition").map(unwrap)

      const kindOfNameHere = new Map<string, Set<string>>()
      const clauses: Array<{ node: any; name: string }> = []
      for (const def of defs) {
        const isExt = def.type.endsWith("Extension")
        const typeNode = isExt ? EXT_TO_DEF[def.type] : def.type
        if (!typeNode || !KIND_OF[typeNode]) continue
        const nm = nameOf(def)
        if (!nm) continue
        if (!isExt) {
          const kinds = kindOfNameHere.get(nm) ?? new Set<string>()
          kinds.add(KIND_OF[typeNode])
          kindOfNameHere.set(nm, kinds)
        }
        clauses.push({ node: def, name: nm })
      }
      if (kindOfNameHere.size === 0) return
      for (const { node, name } of clauses) {
        const visit = (n: any) => {
          if (n.type !== "ImplementsInterfaces") {
            for (const c of n.namedChildren ?? []) if (c) visit(c)
            return
          }
          const collect = (m: any) => {
            if (m.type === "NamedType") {
              const nm = nameOf(m)
              const kinds = nm ? kindOfNameHere.get(nm) : undefined
              // supertypeKindOf(): undefined unless exactly one kind, and only
              // Interface/Class/Type are classifiable. emitHeritage(): Extends for
              // Class or Type.
              if (kinds && kinds.size === 1) {
                const only = [...kinds][0]
                if (only === "Class" || only === "Type") {
                  hits.push(`${fileLabel}: ${name} implements ${nm} (${only}) line ${n.startPosition.row + 1}`)
                }
              }
              return
            }
            for (const c of m.namedChildren ?? []) if (c) collect(c)
          }
          collect(n)
        }
        visit(node)
      }
    },
    describe:
      "an `implements` clause whose supertype THIS DOCUMENT declares — with a unique kind — as an object type, input object type, union or scalar. GraphQL has no `extends` clause at all (`A:supertype_clause_node: 0` over 882,672 nodes / 98 node types), so this is the only shape that could carry the edge; 3,330 `implements` clauses exist on the corpus and 0 of them resolve to an inheritance-shaped supertype in the same document.",
  },

  // ─────────────────────────────────────────────────────────────── calls
  //
  // RULED, and the honest reading of this row includes a population it does not create.
  //
  // The structural reason: a `.graphql` document has no callee. `user(id: 1) { name }`
  // names a MEMBER of the type the selection is written against; the entity that would be
  // called — the resolver — is server-side and appears nowhere in the document. The grammar
  // confirms the shape of that claim: 98 distinct node types over 882,672 nodes on 1,905
  // admitted files, and none of them is a call, an invocation or a callee reference.
  //
  // WHAT THE CONSTRUCT'S NEAREST REAL FORM MEASURES, because the ruling is worthless without
  // it (`script/m14/tmp/graphql/out/imports-and-calls.json`):
  //
  //     Field nodes                                      64,885
  //     Field nodes carrying an `Arguments` child          1,150  (1,112 in clean documents)
  //     files with an argument-bearing field                484
  //     Directive nodes carrying an `Arguments` child      2,682
  //
  // So 3,832 argument-bearing applications exist and NONE of them is labelled `calls`; all
  // are `uses`, with `metadata.relationshipRole` of `field_selection` or
  // `directive_application` (36,751 and 3,267 respectively, from the census
  // `rolesByType`). That is a LABELLING decision, and this analyzer already states it and
  // its reason: `addDeclaredType`'s docblock (real-graphql-analyzer.ts:217-241) records that
  // publishing one fact under two labels is the label-divergence class ledger rule R10
  // exists to catch, and that the family replaced such duplicates rather than adding them —
  // typescript suppresses the duplicate explicitly. `calls` and `uses` for the same
  // selection is that duplication.
  //
  // It is recorded here rather than buried because it is the strongest argument AGAINST this
  // ruling, and a ruling whose strongest counter-argument is only in a source comment is a
  // ruling wearing confidence it has not earned. What settles it is that GraphQL has no
  // call graph: the selection set describes a request, and the resolver that serves it is
  // not in the file. If the family decides otherwise, this row is wrong and the fix is a
  // relabelling, not a new edge.
  //
  // OVERTURN CONDITION — satisfiable by a correct implementation: a family ledger rule (an
  // R-number, alongside R9's declared_type and R10's label divergence) that assigns an
  // argument-bearing `Field` or `Directive` application to `calls` rather than `uses`. On
  // such a rule the same 3,832 sites are re-labelled and this row is void — satisfiable
  // without a grammar change and without a corpus change, which is the point: it names a
  // thing that can actually happen.
  //
  // NOT claimed: that the 3,832 sites are wrong where they are. They are one fact each,
  // labelled once, and the labelling is a family-level decision this lane does not own.
  {
    type: "calls",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: [
      "CallExpression",
      "Invocation",
      "MacroInvocation",
      "FunctionCall",
      "MethodInvocation",
      "Call",
      "FunctionDeclaration",
      "FunctionDefinition",
      "MethodDefinition",
      "CallableReference",
    ],
    describe:
      "a node naming a callee, or applying a named callee to arguments. GraphQL's 98 node types over 882,672 nodes carry none — a selection set DESCRIBES a request and the resolver that serves it is not in the document. The nearest real form is measured and NOT labelled `calls`: 1,150 `Field` nodes and 2,682 `Directive` nodes carry an `Arguments` child, and all 3,832 are `uses` with role `field_selection` / `directive_application`. That is a family labelling decision (one fact, one label, ledger R10), so the overturn condition is an R-number assigning them to `calls` — satisfiable by relabelling, with no grammar or corpus change.",
  },

  // ─────────────────────────────────────────────────────────────── instantiates
  //
  // The cleanest ruling in the table: GraphQL has no construction expression. There is no
  // `new`, no constructor, no object literal that instantiates a declared type — an
  // `ObjectValue` node exists (3,523 in the census inventory) and is an INPUT VALUE passed
  // to a field argument or a directive argument, which is a value, not an instance of a
  // declared type.
  //
  // OVERTURN CONDITION: the graphql grammar producing any node type above, on any corpus.
  // That is a property of the grammar rather than of an implementation, so no correct
  // analyzer can bring it about on this corpus — which is the honest reason it is
  // instrument A and not B: there is nothing on the tree to count. A language that gained
  // construction syntax, or a corpus using a construction convention the grammar cannot
  // see (the `#import` case, which is why `imports` is emitted rather than ruled), reverses
  // it. The word-boundary check that keeps a keyword scan honest is what the `imports`
  // fixture pins.
  {
    type: "instantiates",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: [
      "NewExpression",
      "ObjectCreationExpression",
      "ConstructorInvocation",
      "ObjectInstantiation",
      "Instantiation",
      "InstanceCreation",
      "NewObject",
      "Allocate",
    ],
    describe:
      "a node constructing an instance of a declared type. GraphQL's 98 node types over 882,672 nodes carry none: a schema document declares types and an executable document describes a request, and neither creates a value of a declared type. `ObjectValue` (3,523 nodes) is an argument value, not an instance. Overturn condition: the grammar producing any listed node, or a construction convention written outside the grammar the way `#import` is — which is what moved `imports` from ruled to emitted.",
  },
]

/** The three types this table rules, in the ontology's order. Typed so a typo is a compile error. */
export const GRAPHQL_RULED_TYPES: Type[] = GRAPHQL_RULED.map((r) => r.type)