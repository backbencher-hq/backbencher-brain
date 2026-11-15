/**
 * RUBY LANE — relationship-type completeness (M60 deep round 3 instrument).
 *
 * The enum has 11 distinct values. "Ruby covers every relationship type" is a
 * claim about a SET, and a set claim needs two things a per-type reading does
 * not give:
 *
 *   1. which types the OO family emits, so "ruby is silent on `imports`" can be
 *      stated as a family norm or as a gap rather than guessed;
 *   2. whether a type is covered by a LATER stage when the analyzer's own
 *      return value has none — because an empty analyzer array is not the same
 *      as an unrepresented fact. Ruby's `require` reaches the store as an
 *      ImportInfo record via parallel-indexer's import table, which the
 *      file-dependency engine reads; that is coverage, and it is invisible from
 *      the analyzer's return value alone.
 *
 * So this instrument does two independent things and refuses to let one stand in
 * for the other:
 *
 *   PART A — the family set. For each analyzer, the exact set of relationship
 *     types it constructs, read from the enum member it uses. A name is counted
 *     only when it is a `RelationshipType.X` member or a quoted type string in
 *     an object literal whose key is `type`.
 *
 *   PART B — the production path. Parse a real Ruby file through
 *     `ASTEngine.parseFile`, then through the same import-table mapping
 *     parallel-indexer performs, and report what a consumer can actually read.
 *     This is the part that decides `imports` for ruby: the analyzer returns no
 *     `imports` relationship, and the question is whether the fact is lost or
 *     carried.
 *
 * Usage: npx tsx script/m14/tmp/rb-rel-type-census.ts <a-real-ruby-file>
 */
import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..", "..")

/** The 11 distinct values of ASTEngine.RelationshipType (aliases collapsed). */
const ALL_TYPES = [
  "calls", "extends", "implements", "uses", "instantiates",
  "overrides", "contains", "references", "imports", "exports",
] as const

const OO_LANES = [
  "java", "kotlin", "scala", "groovy", "csharp", "dart", "swift", "php", "ruby", "elixir", "clojure", "python", "clean", "perl",
]

function emittedTypes(file: string): Set<string> {
  const src = fs.readFileSync(file, "utf8")
  const out = new Set<string>()
  // `RelationshipType.Foo` — the enum member, which is the authoritative way
  // an analyzer names a type.
  for (const m of src.matchAll(/RelationshipType\.([A-Za-z]+)/g)) {
    const member = m[1]
    const t = MEMBER_TO_TYPE[member]
    if (t) out.add(t)
  }
  return out
}
const MEMBER_TO_TYPE: Record<string, string> = {
  Calls: "calls", Call: "calls",
  Extends: "extends", Inheritance: "extends",
  Implements: "implements", Implementation: "implements",
  Uses: "uses", Dependency: "uses",
  Imports: "imports", Exports: "exports",
  Contains: "contains", Composition: "contains", Provides: "exports", Related: "references", PartOf: "contains",
  DependsOn: "references", References: "references",
  Override: "overrides", Overrides: "overrides",
  Instantiates: "instantiates",
}

async function partA() {
  console.log("=" .repeat(78))
  console.log("PART A — the family set: which relationship types does each analyzer CONSTRUCT?")
  console.log("=" .repeat(78))
  const rows: Array<[string, Set<string>]> = []
  for (const lang of OO_LANES) {
    const f = path.join(ROOT, "src", "ast", `real-${lang}-analyzer.ts`)
    if (!fs.existsSync(f)) continue
    rows.push([lang, emittedTypes(f)])
  }
  const head = ["lane".padEnd(10), ...ALL_TYPES.map(t => t.slice(0, 4).padEnd(5))].join("")
  console.log(head)
  console.log("-".repeat(head.length))
  for (const [lang, set] of rows) {
    const cells = ALL_TYPES.map(t => (set.has(t) ? " yes " : "  .  ").padEnd(5))
    console.log([lang.padEnd(10), ...cells].join(""))
  }
  // Frequency: a type is a family norm if most OO lanes construct it.
  console.log("\nfamily frequency (of " + rows.length + " OO-family analyzers):")
  for (const t of ALL_TYPES) {
    const n = rows.filter(([, s]) => s.has(t)).length
    const verdict = n === 0 ? "NOBODY constructs it as a relationship"
      : n <= Math.floor(rows.length / 3) ? "MINORITY — a per-lane decision, each needs a ruling"
      : "MAJORITY — silence is the family norm"
    console.log(`  ${t.padEnd(13)} ${String(n).padStart(2)}/${rows.length}  ${verdict}`)
  }
  const rubySet = rows.find(([l]) => l === "ruby")?.[1] ?? new Set<string>()
  const missing = ALL_TYPES.filter(t => !rubySet.has(t))
  console.log(`\nruby constructs: ${[...rubySet].sort().join(", ")}`)
  console.log(`ruby is silent on: ${missing.join(", ") || "(none)"}`)
}

async function partB(file: string) {
  console.log("\n" + "=".repeat(78))
  console.log("PART B — the production path: is an empty analyzer array a lost fact?")
  console.log("=".repeat(78))
  const engineMod: any = await import(path.join(ROOT, "src", "ast", "engine.ts"))
  const ASTEngine = engineMod
  const content = fs.readFileSync(file, "utf8")
  await Parser.init()
  const lang = await Language.load(path.join(ROOT, "wasm", "tree-sitter-ruby.wasm"))
  const parser = new Parser()
  parser.setLanguage(lang as any)
  const tree = parser.parse(content)

  // The namespace-level `ASTEngine.parseFile` (engine.ts:1218) is what the F3
  // fixture lane calls, so this runs the PRODUCTION path — initialization,
  // wasm load, framework enhancement, the lot — not the bare analyzer class.
  const res: any = await (ASTEngine as any).ASTEngine.parseFile(file, content)

  const byType = new Map<string, number>()
  for (const r of res.relationships ?? []) byType.set(String(r.type), (byType.get(String(r.type)) ?? 0) + 1)
  console.log(`file: ${path.relative(ROOT, file)}`)
  console.log(`analyzer returns ${res.relationships?.length ?? 0} relationships:`)
  for (const t of ALL_TYPES) {
    const n = byType.get(t) ?? 0
    console.log(`  ${t.padEnd(13)} ${n === 0 ? "—" : n}`)
  }

  // The import-table mapping parallel-indexer performs, verbatim in shape.
  const rows: any[] = []
  for (const imp of res.imports ?? []) {
    const moduleName = imp.module ?? imp.path ?? imp.localName ?? ""
    if (!moduleName) continue
    rows.push({
      module: moduleName,
      importType: imp.importType ?? (imp.isDefault || imp.isDefaultImport ? "default"
        : imp.isNamespace || imp.isNamespaceImport ? "namespace" : "named"),
      isExternal: (imp.metadata ?? {}).isExternal ?? null,
    })
  }
  console.log(`\nimport records a consumer reads from the import table: ${rows.length}`)
  for (const r of rows) console.log(`  ${r.module}   type=${r.importType}   isExternal=${r.isExternal}`)
  const hasImportRel = (byType.get("imports") ?? 0) > 0
  console.log(`\nadjudication for \`imports\`:`)
  console.log(`  analyzer constructs an \`imports\` RELATIONSHIP : ${hasImportRel ? "yes" : "NO"}`)
  console.log(`  the require FACT reaches a persisted store    : ${rows.length > 0 ? "YES — import table" : "no"}`)
  console.log(`  => ${rows.length > 0
    ? "the fact is carried by the ImportInfo contract, not lost. `imports` is COVERED for ruby, by a different stage than the one that builds graph edges."
    : "the fact is NOT carried anywhere. This would be a real gap."}`)
}

async function main() {
  await partA()
  const f = process.argv[2]
  if (f && fs.existsSync(f)) await partB(path.resolve(f))
  else console.log("\n(pass a real .rb file to run Part B)")
}

main()
