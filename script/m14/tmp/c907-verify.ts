import { parseFile } from "../../../src/ast/pool-worker"
const CASES: Array<[string, string, string[]]> = [
  ["jq/src/jv_print.c", "/home/ishaq2321/bb_tests/repositories/jq/src/jv_print.c", ["jv_dumpf", "jv_dump", "jv_show", "jv_dump_string", "jv_dump_string_trunc"]],
  ["sqlite/src/prepare.c", "/home/ishaq2321/bb_tests/repositories/sqlite/src/prepare.c", ["sqlite3Init", "sqlite3ReadSchema", "schemaIsValid", "sqlite3SchemaToIndex", "sqlite3ParseObjectReset", "sqlite3ParserAddCleanup", "sqlite3ParseObjectInit", "sqlite3Prepare", "sqlite3LockAndPrepare"]],
]
for (const [label, file, names] of CASES) {
  const root = file.replace(/\/src\/.*$/, "")
  const r: any = await parseFile(file, root)
  const fns = new Set((r.symbols ?? []).filter((s: any) => s.kind === "function").map((s: any) => String(s.name)))
  console.log(`\n${label}: ${fns.size} function symbols`)
  for (const n of names) console.log(`   ${fns.has(n) ? "PRESENT" : "MISSING"} ${n}`)
}
