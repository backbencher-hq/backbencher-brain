// #901: two MISSING `uses` edges on all-caps macro names in expression
// position (sqlite: `SQLITE_EXTENSION_INIT1;` in basexx.c, `SQLITE_TCLAPI` as a
// declaration token in tclsqlite.c). Both files DO define the macro, so the
// question is which gate drops the read. Shapes are varied one axis at a time.
//
// Run: bun script/m14/tmp/c901-macro-uses.ts
import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"

const CASES: Array<[string, string]> = [
  ["1: bare macro statement, defined AFTER use (basexx.c shape)", `void f(void) { SQLITE_EXTENSION_INIT1; }\n#undef SQLITE_EXTENSION_INIT1\n#define SQLITE_EXTENSION_INIT1 /* */\n`],
  ["2: bare macro statement, defined BEFORE use", `#define SQLITE_EXTENSION_INIT1\nvoid f(void) { SQLITE_EXTENSION_INIT1; }\n`],
  ["3: macro token between return type and name (tclsqlite shape)", `#define SQLITE_TCLAPI\nstatic int SQLITE_TCLAPI g(int x) { return x; }\n`],
  ["4: macro token, function-like use with args", `#define INIT(x) x\nvoid f(void) { INIT(3); }\n`],
  ["5: macro with no in-file definition (should stay silent)", `void f(void) { UNDEFINED_MACRO_HERE; }\n`],
  ["6: macro only in #if condition", `#define SQLITE_TCLAPI\n#if defined(SQLITE_TCLAPI)\nint x;\n#endif\n`],
]

const dir = mkdtempSync(join(tmpdir(), "c901-"))
for (const [name, src] of CASES) {
  const file = join(dir, `case${name.split(":")[0]}.c`)
  writeFileSync(file, src)
  const r: any = await parseFile(file, dir)
  const uses = (r.relationships ?? []).filter((x: any) => String(x.type) === "uses" || String(x.type) === "references")
  const syms = (r.symbols ?? []).map((s: any) => `${s.name}:${s.kind}`)
  console.log(`\n=== ${name} ===`)
  console.log(`  symbols: ${syms.join(", ") || "(none)"}`)
  for (const u of uses) console.log(`  ${u.type} ${u.source} -> ${u.target}`)
  if (!uses.length) console.log("  (no uses/references edges)")
}
