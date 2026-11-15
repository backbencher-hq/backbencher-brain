// #901 follow-up: (a) does a macro with a VALUE mint a symbol and do its reads
// emit `uses` (the claimed CGD26 behavior)? (b) what does the analyzer do on the
// two REAL corpus files the lane reported missing?
//
// Run: bun script/m14/tmp/c901-macro-uses2.ts
import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"

const CASES: Array<[string, string]> = [
  ["A: object-like macro WITH value, read in expr", `#define MAXN 100\nint x = MAXN;\n`],
  ["B: object-like macro with value, read as statement", `#define FOO 1\nvoid f(void) { FOO; }\n`],
  ["C: empty-bodied macro, bare statement", `#define BAR\nvoid f(void) { BAR; }\n`],
  ["D: empty-bodied macro, declaration token", `#define API\nstatic int API g(int x) { return x; }\n`],
  ["E: function-like macro invocation", `#define SQ(a) ((a)*(a))\nint y = SQ(3);\n`],
]
const dir = mkdtempSync(join(tmpdir(), "c901b-"))
for (const [name, src] of CASES) {
  const file = join(dir, `c${name.split(":")[0]}.c`)
  writeFileSync(file, src)
  const r: any = await parseFile(file, dir)
  const rels = (r.relationships ?? []).filter((x: any) => ["uses", "references", "calls"].includes(String(x.type)))
  console.log(`\n=== ${name} ===`)
  console.log(`  symbols: ${(r.symbols ?? []).map((s: any) => `${s.name}:${s.kind}`).join(", ") || "(none)"}`)
  for (const u of rels) console.log(`  ${u.type} ${u.source} -> ${u.target}`)
  if (!rels.length) console.log("  (no uses/references/calls edges)")
}

const R = "/home/ishaq2321/bb_tests/repositories"
const REAL: Array<[string, string, string[]]> = [
  ["REAL basexx.c", `${R}/sqlite/ext/misc/basexx.c`, ["SQLITE_EXTENSION_INIT1"]],
  ["REAL tclsqlite.c", `${R}/sqlite/src/tclsqlite.c`, ["SQLITE_TCLAPI"]],
]
for (const [name, file, targets] of REAL) {
  const r: any = await parseFile(file, `${R}/sqlite`)
  const rels = (r.relationships ?? []).filter((x: any) => targets.includes(String(x.target)))
  const syms = (r.symbols ?? []).filter((s: any) => targets.includes(String(s.name)))
  console.log(`\n=== ${name} ===`)
  console.log(`  symbols matching: ${syms.map((s: any) => `${s.name}:${s.kind}:${s.visibility}`).join(", ") || "(none)"}`)
  console.log(`  edges matching: ${rels.length}`)
  for (const u of rels.slice(0, 8)) console.log(`  ${u.type} ${u.source} -> ${u.target} line=${u.line_number ?? "-"}`)
}
