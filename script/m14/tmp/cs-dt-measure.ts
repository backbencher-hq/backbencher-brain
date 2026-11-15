// script/m14/tmp/cs-dt-measure.ts — measure the R9 declared-type graph on
// validation/m14/fixtures/csharp/declared-type-graph.cs and print the expectation JSON.
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const FILE = path.join(ROOT, "validation/m14/fixtures/csharp/declared-type-graph.cs")

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const src = readFileSync(FILE, "utf8")
const res: any = await ASTEngine.parseFile(FILE, src)

const refs = (res.relationships ?? []).filter(
  (r: any) => r.type === "references" && ["declared_type", "return_type"].includes(String(r.metadata?.relationshipType)),
)
console.log(`declared-type refs: ${refs.length}`)
const rows = refs
  .map((r: any) => ({
    type: "references",
    from: r.source,
    target: r.target,
    line_number: r.line_number,
    declaredOn: r.metadata?.declaredOn,
    marker: r.metadata?.relationshipType,
    line: src.split("\n")[(r.line_number ?? 1) - 1]?.trim() ?? "",
  }))
  .sort((a: any, b: any) => (a.line_number - b.line_number) || a.target.localeCompare(b.target))
console.log(`${"line".padStart(4)}  ${"from".padEnd(14)} ${"target".padEnd(14)} ${"marker".padEnd(14)} ${"declaredOn".padEnd(26)} source text`)
for (const r of rows) {
  console.log(`${String(r.line_number).padStart(4)}  ${String(r.from).padEnd(14)} ${String(r.target).padEnd(14)} ${String(r.marker).padEnd(14)} ${String(r.declaredOn).padEnd(26)} ${r.line}`)
}

// The two shapes that MUST stay silent.
const silent = (res.relationships ?? []).filter(
  (r: any) => r.type === "references" && ["int", "string", "var", "dynamic"].includes(String(r.target)),
)
console.log(`\nsilent-shape violations (int/string/var/dynamic emitted): ${silent.length}`)
for (const s of silent) console.log("  !!", JSON.stringify({ from: s.source, target: s.target, line: s.line_number }))

const expectation = {
  fixtureId: "csharp/declared-type-graph",
  language: "csharp",
  authoredBeforeAnalyzerRun: true,
  rationale:
    "R9 (#804) — the declared-type reference graph, a family standard the csharp lane was missing entirely " +
    "(rust's R13 header: \"family standard, mirrors go/c/zig\"; ten lanes implement it, measured by " +
    "script/m60/declared-type-refs-census.ts). This fixture pins every position that WRITES a type name " +
    "(field / variable declaration, parameter, return type, property, indexer, event, delegate), every shape a " +
    "written type can take (bare, array, nullable, qualified, generic base AND argument, tuple, pointer, ref), " +
    "the source-attribution contract measured off java/kotlin/python (a member's dependency belongs to the " +
    "enclosing TYPE, a parameter's / return's / local's to the enclosing CALLABLE), the two markers " +
    "(declared_type, and return_type for returns — java/kotlin/python/typescript all use return_type), and the " +
    "four ways this walk can publish a NAME that is not a type: a tuple element's name, a bound type parameter, " +
    "a predefined type, and `var`. Measured 2026-09-22 before the pins were written; the tuple-element and " +
    "bound-parameter defects below were FOUND BY THIS FIXTURE'S OWN FIRST MEASUREMENT.",
  expectRelationships: rows.map((r: any) => ({
    type: "references",
    from: r.from,
    target: r.target,
    line_number: r.line_number,
    "meta.relationshipType": r.marker,
    "meta.declaredOn": r.declaredOn,
  })),
  forbidRelationships: [
    // The two silent spellings.
    { type: "references", target: "int" },
    { type: "references", target: "string" },
    { type: "references", target: "void" },
    { type: "references", target: "var" },
    // A bound type parameter is not a dependency (class-level T used in a method body,
    // and a method's own U): pinned because the first measurement got this wrong.
    { type: "references", target: "T" },
    { type: "references", target: "U" },
    // A TUPLE ELEMENT'S NAME is not a type: `(Dep First, int Count)` depends on Dep.
    // Pinned because the first measurement published First and Count as types.
    { type: "references", target: "First" },
    { type: "references", target: "Count" },
    // A qualified name publishes its LEAF, never the whole path.
    { type: "references", target: "System.Text.StringBuilder" },
    { type: "references", target: "System" },
    { type: "references", target: "Text" },
    // The primitive type ARGUMENT of a generic is still a primitive.
    { type: "references", target: "String" },
  ],
  comment:
    "The delegate line (Factory) carries the return reference and its parameter reference on ONE line, so the " +
    "(source, target, line) dedupe key collapses them to a single edge; that is the documented consequence of " +
    "keying on the line rather than the pair (M59.A7: a collapsed pair would lose a line).",
}
const out = path.join(ROOT, "validation/m14/fixtures/csharp/declared-type-graph.expectation.json")
writeFileSync(out, JSON.stringify(expectation, null, 2) + "\n")
console.log(`\nwrote ${path.relative(ROOT, out)} with ${rows.length} expectRelationships`)
