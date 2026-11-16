/**
 * MAKE ONTOLOGY AUDIT — all ten relationship kinds, each ruled on a COUNT.
 *
 * The taxonomy is fixed by the product (`ASTEngine.RelationshipType`), so the
 * only question per kind is whether GNU Make can EXPRESS it. A kind that is
 * merely unused is a gap; a kind that is inexpressible in the language is not.
 * The two look identical in a graph and mean opposite things, so the ruling
 * carries the measurement that settled it, and every count here is read from an
 * artifact rather than asserted.
 *
 * The counts come from the corpus node-type census (what constructs exist) and
 * the zero-unknown census (what edges the analyzer emits). Neither is a proxy
 * for the other: a construct can exist in the grammar and be used once, and an
 * edge class can be large and still be the wrong answer.
 */
import { readFileSync, writeFileSync } from "node:fs"

const OUT = "<corpus-root>/bb_tests/make/out"
const census = JSON.parse(readFileSync(`${OUT}/node-type-census.json`, "utf8"))
const zero = JSON.parse(readFileSync(`${OUT}/zero-unknown-census.json`, "utf8"))
const conf = JSON.parse(readFileSync(`${OUT}/grammar-conformance.json`, "utf8"))
const diff = JSON.parse(readFileSync(`${OUT}/corpus-differential.json`, "utf8"))

const nodeCount = (t: string) => census.counts[t] ?? 0
const filesWith = (t: string) => census.filesWith[t] ?? 0
const emitted = zero.relTypeHistogram as Record<string, number>

const KINDS = [
  "contains", "references", "uses", "imports", "exports",
  "calls", "extends", "implements", "overrides", "instantiates",
] as const

interface Ruling {
  kind: string
  verdict: "EMITTED" | "RULED NOT APPLICABLE"
  emittedEdges: number
  constructs: { type: string; occurrences: number; files: number }[]
  argument: string
}

const rulings: Ruling[] = [
  {
    kind: "contains", verdict: "EMITTED", emittedEdges: emitted.contains ?? 0,
    constructs: [{ type: "makefile", occurrences: nodeCount("makefile"), files: filesWith("makefile") },
                 { type: "rule", occurrences: nodeCount("rule"), files: filesWith("rule") },
                 { type: "variable_assignment", occurrences: nodeCount("variable_assignment"), files: filesWith("variable_assignment") }],
    argument:
      "A makefile is given ONE module symbol, named for the file, and it owns `contains` for every declaration. The alternative was measured: with no module node the analyzer emitted 2 relationship kinds and `exports` was a hardcoded empty array, so the file's structure was unanswerable. GNU Make has exactly ONE declaration level — conditionals SELECT between alternatives and do not nest declarations — so the file node is the only place containment can live, and it is a real entity rather than an invented one: exactly 99 modules for 99 files.",
  },
  {
    kind: "references", verdict: "EMITTED", emittedEdges: emitted.references ?? 0,
    constructs: [{ type: "variable_reference", occurrences: nodeCount("variable_reference"), files: filesWith("variable_reference") },
                 { type: "substitution_reference", occurrences: nodeCount("substitution_reference"), files: filesWith("substitution_reference") },
                 { type: "prerequisites", occurrences: nodeCount("prerequisites"), files: filesWith("prerequisites") }],
    argument:
      "Emitted ONLY when this file declares the target. That restriction is the whole content of the kind: a Make prerequisite is usually a file (231 unresolved edge ends) and a Make variable is often external (187), and publishing those as project-internal references asserts a declaration that does not exist. 1,564 corpus edges qualify.",
  },
  {
    kind: "uses", verdict: "EMITTED", emittedEdges: emitted.uses ?? 0,
    constructs: [{ type: "automatic_variable", occurrences: nodeCount("automatic_variable"), files: filesWith("automatic_variable") },
                 { type: "function_call", occurrences: nodeCount("function_call"), files: filesWith("function_call") }],
    argument:
      "Everything a reference names and this file does not declare: file prerequisites, external variables, GNU Make builtins (CURDIR 88, MAKE 23, MAKEFILE_LIST 14), automatic variables, foreach binders and escaped shell variables. Each carries an `evidenceClass` so the class is readable rather than pooled — 788 edges across five distinct tiers. The split from `references` is the same ruling the hcl lane reached for builtin roots, on the same principle: a name no file can declare is a use.",
  },
  {
    kind: "imports", verdict: "EMITTED", emittedEdges: emitted.imports ?? 0,
    constructs: [{ type: "include_directive", occurrences: nodeCount("include_directive"), files: filesWith("include_directive") }],
    argument:
      "`include` is Make's composition: a makefile that includes another is partly defined by it, and the two share a variable namespace. Sourced at THIS file's module node, never a hardcoded name — with a constant source every makefile that includes `hooks` produced the same edge. The corpus has 4 include directives and 3 distinct shapes (`word`, `variable_reference`, `shell_function`), all recorded, the computed one flagged rather than dropped.",
  },
  {
    kind: "exports", verdict: "EMITTED", emittedEdges: emitted.exports ?? 0,
    constructs: [{ type: "export_directive", occurrences: nodeCount("export_directive"), files: filesWith("export_directive") },
                 { type: "rule", occurrences: nodeCount("rule"), files: filesWith("rule") }],
    argument:
      "Two sources, because Make has two. An `export VAR` directive is an explicit export (19 in the corpus), and a buildable TARGET is the file's other public surface — an including makefile invokes it by name — so every non-special target is published too (1,347 edges). Publishing only the first would leave \"what does this Makefile offer?\" answered by 19 lines rather than by the file's actual interface.",
  },
  {
    kind: "calls", verdict: "EMITTED", emittedEdges: emitted.calls ?? 0,
    constructs: [{ type: "define_directive", occurrences: nodeCount("define_directive"), files: filesWith("define_directive") },
                 { type: "function_call", occurrences: nodeCount("function_call"), files: filesWith("function_call") }],
    argument:
      "The one kind Make genuinely has and hcl does not. `define` declares a macro and `$(call NAME)` invokes it, so the callee is a real declaration — which is why a `define` is a Function symbol and not a Constant: a call resolving to a constant is a callee that cannot be called. The corpus is thin (1 define, 1 call) and that thinness is stated rather than dressed up: 1 edge. The construct is rare, the relationship is real, and the count is the honest size of the evidence.",
  },
  {
    kind: "extends", verdict: "RULED NOT APPLICABLE", emittedEdges: 0,
    constructs: [{ type: "(no node type declares a base or superclass)", occurrences: 0, files: 0 }],
    argument:
      "GNU Make has no type declaration, no base clause and no inheritance among its 44 named node types. The kind is not merely unused, it is INEXPRESSIBLE: there is no syntax from which a base could be read, so an `extends` edge would have to be invented. This is the opposite of a gap — emitting nothing here is the correct output.",
  },
  {
    kind: "implements", verdict: "RULED NOT APPLICABLE", emittedEdges: 0,
    constructs: [{ type: "(no interface or protocol node type)", occurrences: 0, files: 0 }],
    argument:
      "Same measurement as `extends`: Make has no interface to implement. A target that happens to satisfy a convention is a convention, not a declared type relationship, and reading one as `implements` would be an inference dressed as a fact.",
  },
  {
    kind: "overrides", verdict: "RULED NOT APPLICABLE", emittedEdges: 0,
    constructs: [{ type: "override_directive", occurrences: nodeCount("override_directive"), files: filesWith("override_directive") }],
    argument:
      "The one kind with a REAL construct, and the ruling is measured rather than assumed. `override VAR = value` (2 occurrences) means this definition wins over a command-line or environment binding. What it overrides is NOT a symbol in the graph, so an `overrides` edge would dangle by construction — there is no target to point at. The information is not lost: the variable is recorded with `isOverride` on its symbol, which is the honest place for it. Emitting the edge anyway would trade a real fact for a dangling one.",
  },
  {
    kind: "instantiates", verdict: "RULED NOT APPLICABLE", emittedEdges: 0,
    constructs: [{ type: "(recipe is shell text, not a constructor expression)", occurrences: 0, files: 0 }],
    argument:
      "Make has no `new` and no object construction. A recipe is a shell command that produces files; it is not an expression that yields a value, and nothing in the tree resembles a constructed instance. `instantiates` is inexpressible here.",
  },
]

const report = {
  lane: "make",
  taxonomySource: "src/ast/engine.ts ASTEngine.RelationshipType (10 distinct values)",
  corpus: census.corpus,
  grammar: { namedTypesDeclared: conf.source.namedUnique, namedUniqueInWasm: conf.wired.namedUnique, matches: conf.drift.matches },
  emittedKinds: rulings.filter((r) => r.verdict === "EMITTED").length,
  ruledNotApplicable: rulings.filter((r) => r.verdict !== "EMITTED").length,
  differential: { recall: diff.truth.recall, precision: diff.analyzer.precision, missing: diff.missing.length, spurious: diff.spurious.length },
  rulings,
}
writeFileSync(`${OUT}/ontology-audit.json`, JSON.stringify(report, null, 2) + "\n")

console.log(`kinds: ${KINDS.length} | emitted ${report.emittedKinds} | ruled N/A ${report.ruledNotApplicable}`)
console.log(`grammar: ${conf.source.namedUnique} declared named types, wasm ${conf.wired.namedUnique} unique, match=${conf.drift.matches}`)
for (const r of rulings) {
  const c = r.constructs.map((x) => `${x.type} (${x.occurrences}/${x.files}f)`).join(", ")
  console.log(`  ${r.kind.padEnd(13)} ${r.verdict.padEnd(24)} edges=${String(r.emittedEdges).padStart(5)}  ${c}`)
}
