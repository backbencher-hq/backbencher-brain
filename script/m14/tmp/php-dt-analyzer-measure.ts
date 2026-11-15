// script/m14/tmp/php-dt-analyzer-measure.ts — measure the R9 declared-type graph on
// validation/m14/fixtures/php/declared-type-graph.php through the REAL analyzer and write
// the expectation JSON from the measurement (never transcribed by hand).
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const FILE = path.join(ROOT, "validation/m14/fixtures/php/declared-type-graph.php")

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const src = readFileSync(FILE, "utf8")
const res: any = await ASTEngine.parseFile(FILE, src)

const refs = (res.relationships ?? []).filter(
  (r: any) => r.type === "references" && ["declared_type", "return_type"].includes(String(r.metadata?.relationshipType)),
)
console.log(`php declared-type refs: ${refs.length}`)
const rows = refs
  .map((r: any) => ({
    type: "references",
    from: r.source,
    target: r.target,
    line_number: r.line_number,
    "meta.relationshipType": r.metadata?.relationshipType,
    "meta.declaredOn": r.metadata?.declaredOn,
    line: src.split("\n")[(r.line_number ?? 1) - 1]?.trim() ?? "",
  }))
  .sort((a: any, b: any) => a.line_number - b.line_number || a.target.localeCompare(b.target))
for (const r of rows) {
  console.log(`  L${String(r.line_number).padStart(3)} ${String(r.from).padEnd(13)} -> ${String(r.target).padEnd(7)} ${r["meta.relationshipType"]}/${r["meta.declaredOn"]}`)
}

const silent = refs.filter((r: any) => ["int", "string", "void", "mixed", "bool", "float", "array", "parent"].includes(String(r.target)))
console.log(`\nsilent-shape violations: ${silent.length}`)
for (const s of silent) console.log("  !!", JSON.stringify({ from: s.source, target: s.target, line: s.line_number }))

const expectation = {
  fixtureId: "php/declared-type-graph",
  language: "php",
  authoredBeforeAnalyzerRun: true,
  rationale:
    "R9 (#835) — the declared-type reference graph, a family standard this lane was missing entirely " +
    "(rust's R13 header: \"family standard, mirrors go/c/zig\"; measured by script/m60/declared-type-refs-census.ts). " +
    "php has no generics and no type parameters, so the two name-as-type traps csharp's fixture had to pin cannot " +
    "arise here; what CAN is php's own shape set — the optional/union/intersection wrappers, a qualified name whose " +
    "LEAF is what every other php edge keys on, and `self`/`static`/`parent`, which name no symbol in the file and " +
    "resolve through this lane's own probe-verified relative-type rule (self/static -> the enclosing CLASS, parent -> " +
    "its declared base, and NOTHING when the base is not resolvable). The attribution contract is the one measured off " +
    "java/kotlin/python for csharp: a property's dependency belongs to the enclosing TYPE, a parameter's / return's to " +
    "the enclosing CALLABLE. Measured before the pins were written; the `self` resolution was corrected BY this " +
    "fixture's first measurement (the prototype published `copy -> copy` for `function copy(): self`).",
  expectRelationships: rows.map(({ line, ...r }: any) => r),
  forbidRelationships: [
    // The primitive spellings this grammar tags separately.
    { type: "references", target: "int" },
    { type: "references", target: "string" },
    { type: "references", target: "void" },
    { type: "references", target: "mixed" },
    // A relative type names no symbol: it must be RESOLVED (to the class, or to the
    // declared base) or be silent — never published verbatim.
    { type: "references", target: "self" },
    { type: "references", target: "static" },
    { type: "references", target: "parent" },
    // The un-leafed qualified path is not the published name.
    { type: "references", target: "\\App\\Lib\\Dep" },
    { type: "references", target: "App" },
    { type: "references", target: "Lib" },
    // The attribution trap the first prototype hit: a relative type attributed to the
    // METHOD it was written in.
    { type: "references", from: "copy", target: "copy" },
  ],
}
const out = path.join(ROOT, "validation/m14/fixtures/php/declared-type-graph.expectation.json")
writeFileSync(out, JSON.stringify(expectation, null, 2) + "\n")
console.log(`\nwrote ${path.relative(ROOT, out)} with ${rows.length} expectRelationships`)
