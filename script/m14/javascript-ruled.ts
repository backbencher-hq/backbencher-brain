/**
 * JAVASCRIPT_RULED — the ruling table `script/m14/ontology-coverage-gate.ts` reads before it
 * will report this lane at all.
 *
 * ONE entry, and the lane's only un-emitted ontology member: `implements`. The other nine
 * fire on real JavaScript (measured 9/10 through the firing check; see
 * `docs/analyzers/javascript.md`), so there is nothing else to adjudicate.
 *
 * ## What the construct would need, and what this parser makes of it
 *
 * `implements` needs a supertype clause naming an implemented type — a node type in a
 * grammar that has one. The pinned `tree-sitter-javascript@0.23.1` declares **118 named
 * types** and the only supertype-shaped names among them are `class_heritage` and `super`
 * (A1). The same scan over the sibling `tree-sitter-typescript` returns **183** named types
 * including `implements_clause`, `interface_declaration` and `abstract_class_declaration`
 * (A2) — so A1 measures the grammar rather than failing to look, which is the only way an
 * absence measurement can be trusted.
 *
 * The counterfactual (E) is decisive and needs no corpus at all: with the pinned
 * `wasm/tree-sitter-javascript.wasm`,
 *
 *   `class A extends B { }`               parses,   class_heritage, no ERROR
 *   `class A implements B { }`            ERRORS,   no `class_heritage` node at all
 *   `class A extends B implements C { }`  ERRORS,   only `B` under `class_heritage`
 *   `class A extends B, C { }`            ERRORS,   class_heritage with an ERROR child
 *
 * So the falsifier is ONE structural predicate: **a `class_heritage` with more than one
 * named child and no ERROR anywhere in it.** A ruling that is testable is the point.
 *
 * ## The corpus measurement (this is why the table is instrument A and not prose)
 *
 * Over `$HOME/fixtures/repositories/typescript` (the lane's largest measured JS
 * surface, 6,124 admitted js-family files), every `class_heritage` is read off the tree:
 *
 *   heritage clauses            1,502   every anonymous token under one is `extends` (1:1)
 *   `implements` tokens             0
 *   multi-named-child clauses      23   ALL 23 inside an ERROR node
 *
 * The 23 are TypeScript EMIT baselines written to a `.js` path (`extends A, B`,
 * `extends (0, __extends)(A, B)` helper output) — syntax the JavaScript grammar rejects,
 * which is exactly what the ERROR flag shows. JSDoc is the one place the ecosystem spells
 * the word, so it is measured too: the corpus's `@implements` tags name types that no
 * JavaScript file in the corpus declares, so an edge built from them would be a graph of
 * unbindable targets — a decoration, not a relationship.
 *
 * Instrument: `script/m14/javascript-implements-ruling.ts` (writes
 * `validation/m14/tmp/javascript-implements-ruling.json`). Full reasoning: JSD33, JSD38,
 * JSD39 and JSD40 in `script/m14/spec/javascript-completeness.json`.
 *
 * ## Why an entry here changes the gate's verdict rather than decorating it
 *
 * `rulingFor` reads the TABLE first and the spec second. With this file registered, the
 * gate runs the instrument-A falsifier over the node types the corpus actually produced
 * (`implements_clause` / `superclass` / `interface_declaration` / `extends_clause`): if any
 * of them ever appears, the row becomes FALSIFIED and the gate exits non-zero. Before this
 * file the lane was ruled from spec prose, and the gate said so. An empty table would have
 * excused nothing, but a table with a wrong `nodeTypesThatWouldMeanIt` would excuse
 * everything — so the four node types are the spec's, not a convenience list.
 */
import type { Ruled } from "./ontology-coverage-gate"

export const JAVASCRIPT_RULED: Ruled[] = [
  {
    type: "implements",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: ["implements_clause", "superclass", "interface_declaration", "extends_clause"],
    describe: "a supertype clause naming an implemented (or otherwise second) type",
  },
]
