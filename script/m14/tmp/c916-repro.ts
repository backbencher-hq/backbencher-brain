// #916 minimal repros, one per sub-class, run through the production entry so
// the analyzer's own answer (not the tree) decides what is actually wrong.
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const { parseFile } = await import(path.join(ROOT, "src", "ast", "engine.ts"))

const CASES: Array<[string, string, string]> = [
  ["A-global-variable", "/tmp/c916-A.c", `typedef struct BtShared BtShared;
#define SQLITE_WSD
static BtShared *SQLITE_WSD sqlite3SharedCacheList = 0;
static BtShared *plainControl = 0;
`],
  ["B-prototype", "/tmp/c916-B.c", `typedef struct Btree Btree;
#define SQLITE_NOINLINE
static void SQLITE_NOINLINE btreeLockCarefully(Btree *p);
static void plainProto(Btree *p);
`],
  ["B2-definition", "/tmp/c916-B2.c", `#define JNIEXPORT
#define JNICALL
JNIEXPORT void JNICALL
Java_entry(int x){ return; }
JNIEXPORT void plainEntry(int x){ return; }
`],
  ["C-fn-pointer", "/tmp/c916-C.c", `#define SQLITE_API
#define SQLITE_CDECL
SQLITE_API void (SQLITE_CDECL *sqlite3IoTrace)(const char*, ...) = 0;
SQLITE_API void (*plainTrace)(const char*, ...) = 0;
`],
]

for (const [label, file, src] of CASES) {
  writeFileSync(file, src)
  const res: any = await parseFile(file, src, { language: "c" })
  console.log(`\n=== ${label}  (${file})`)
  for (const line of src.split("\n")) console.log(`    | ${line}`)
  console.log(`    symbols:`)
  for (const s of (res.symbols ?? []).sort((a: any, b: any) => a.range.startLine - b.range.startLine)) {
    console.log(`      @${s.range.startLine} ${s.kind} ${s.name}${s.visibility ? " " + s.visibility : ""}`)
  }
  const errs = res.errors ?? []
  console.log(`    errors: ${errs.length}`)
}
