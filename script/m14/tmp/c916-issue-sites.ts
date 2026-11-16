// #916 close-out: every site the issue names, measured through the production
// entry against the fixed analyzer — real symbol present? phantom gone? control
// untouched?
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const { parseFile } = await import(path.join(ROOT, "src/ast/engine.ts"))
const R = "<corpus-root>/bb_tests/repositories/sqlite"

const SITES: Array<[string, string, string]> = [
  // file, real symbol the issue says was lost, phantom the site emitted
  ["src/btmutex.c", "btreeLockCarefully", "SQLITE_NOINLINE"],
  ["src/btree.c", "sqlite3SharedCacheList", "SQLITE_WSD"],
  ["src/notify.c", "sqlite3BlockedList", "SQLITE_WSD"],
  ["src/os.c", "vfsList", "SQLITE_WSD"],
  ["src/main.c", "sqlite3IoTrace", "SQLITE_CDECL"],
  ["ext/jni/src/c/sqlite3-jni.c", "Java_org_sqlite_jni_capi", "JNICALL"],
  ["ext/jni/src/c/sqlite3-jni.c", "SQLITE_MISUSE", "SQLITE_MISUSE"],
  ["ext/misc/zipfile.c", "ZIPFILE_SCHEMA", "ZIPFILE_SCHEMA"], // control: real static char[] MUST stay
]

const cache = new Map<string, any>()
for (const [rel, real, phantom] of SITES) {
  const abs = path.join(R, rel)
  if (!cache.has(abs)) cache.set(abs, await parseFile(abs, readFileSync(abs, "utf8"), { language: "c" }))
  const res: any = cache.get(abs)
  const syms: any[] = res.symbols ?? []
  const realHits = syms.filter((s) => s.name === real || s.name.startsWith(real))
  const phantomHits = syms.filter((s) => s.name === phantom)
  const kindOf = (arr: any[]) => arr.map((s) => `${s.kind}@${s.range?.startLine}`).join(", ") || "-"
  console.log(`${rel}`)
  console.log(`   real   "${real}": ${realHits.length ? "PRESENT " + kindOf(realHits) : "ABSENT"}`)
  console.log(`   phantom "${phantom}": ${phantomHits.length ? "PRESENT " + kindOf(phantomHits) : "gone"}`)
}
