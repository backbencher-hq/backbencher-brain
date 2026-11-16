// #916: for each site, is the REAL symbol actually absent? The context dump
// showed jni:6244's next sibling is a real function_definition, so the issue's
// "lost" claim has to be checked per site rather than assumed.
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const { parseFile } = await import(path.join(ROOT, "src", "ast", "engine.ts"))

const SITES: Array<[string, number, string]> = [
  ["<corpus-root>/bb_tests/repositories/sqlite/src/btmutex.c", 53, "btreeLockCarefully"],
  ["<corpus-root>/bb_tests/repositories/sqlite/src/btree.c", 87, "sqlite3SharedCacheList"],
  ["<corpus-root>/bb_tests/repositories/sqlite/src/notify.c", 40, "sqlite3BlockedList"],
  ["<corpus-root>/bb_tests/repositories/sqlite/src/os.c", 355, "vfsList"],
  ["<corpus-root>/bb_tests/repositories/sqlite/src/main.c", 138, "sqlite3IoTrace"],
  ["<corpus-root>/bb_tests/repositories/sqlite/ext/jni/src/c/sqlite3-jni.c", 6244,
   "Java_org_sqlite_jni_capi_SQLTester_installCustomExtensions"],
]

for (const [file, line, realName] of SITES) {
  const src = readFileSync(file, "utf8")
  const res: any = await parseFile(file, src, { language: "c" })
  const syms = (res.symbols ?? []).filter((s: any) => s.range.startLine >= line - 4 && s.range.startLine <= line + 4)
  const nameHit = (res.symbols ?? []).filter((s: any) => s.name === realName)
  console.log(`\n=== ${path.basename(file)}:${line}  real=${realName}`)
  console.log(`    real symbol present? ${nameHit.length ? "YES " + JSON.stringify(nameHit.map((s: any) => `${s.range.startLine}:${s.kind}`)) : "NO"}`)
  console.log(`    symbols in ±4 lines:`)
  for (const s of syms) console.log(`      @${s.range.startLine} ${s.kind} ${s.name}`)
}
