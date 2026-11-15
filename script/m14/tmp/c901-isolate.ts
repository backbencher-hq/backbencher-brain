// #901 basexx isolation: which factor suppresses the top-level macro read?
// factors: (1) read inside #ifndef region, (2) #undef present, (3) define AFTER
// the read, (4) top level vs inside a function.
// Run: bun script/m14/tmp/c901-isolate.ts
import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"

const M = "SQLITE_EXTENSION_INIT1"
const CASES: Array<[string, string]> = [
  ["P1: exact basexx prefix (region read + undef + define after)", `#ifndef G\n# include "sqlite3ext.h"\n${M};\n#endif\n\n#undef ${M}\n#define ${M} /* */\n`],
  ["P2: region read + define after, NO undef", `#ifndef G\n${M};\n#endif\n#define ${M}\n`],
  ["P3: top-level bare read, define BEFORE", `#define ${M}\n${M};\n`],
  ["P4: read inside a function, define before", `#define ${M}\nvoid f(void) { ${M}; }\n`],
  ["P5: region read, define BEFORE region", `#define ${M}\n#ifndef G\n${M};\n#endif\n`],
  ["P6: region read + undef after (define before)", `#define ${M}\n#ifndef G\n${M};\n#endif\n#undef ${M}\n`],
  ["P8: bare forward ref, no region", `${M};\n#define ${M}\n`],
  ["P9: forward ref of a VALUED macro", `FWD;\n#define FWD 1\n`],
  ["P10: forward ref of a function", `int z = later();\nint later(void) { return 1; }\n`],
  ["P11: forward ref of a global variable", `int z = gv2;\nint gv2 = 3;\n`],
  ["P12: read before AND after the define", `${M};\n#define ${M}\n${M};\n`],
]
const dir = mkdtempSync(join(tmpdir(), "c901iso-"))
for (const [name, src] of CASES) {
  const file = join(dir, `p${name.split(":")[0]}.c`)
  writeFileSync(file, src)
  const r: any = await parseFile(file, dir)
  const rels = (r.relationships ?? []).filter((x: any) => ["uses", "references", "calls"].includes(String(x.type)))
  const syms = (r.symbols ?? []).filter((s: any) => String(s.name) === M || String(s.name) === "FWD" || String(s.name) === "later" || String(s.name) === "gv2")
  console.log(`\n=== ${name} ===`)
  console.log(`  symbols: ${syms.map((s: any) => `${s.name}:${s.kind}`).join(",") || "(none)"}`)
  console.log(`  edges: ${rels.length}`)
  for (const u of rels) console.log(`    ${u.type} ${u.source} -> ${u.target}`)
}
