import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"
const dir = mkdtempSync(join(tmpdir(), "c901d-"))
const CASES: Array<[string, string]> = [
  ["V1: the two functions alone", `void jv_dump_term(int x, void *f, int flags, int indent, void *s);\nvoid jv_dumpf(int x, void *f, int flags) {\n  jv_dump_term(x, f, flags, 0, 0);\n}\n\nvoid jv_dump(int x, int flags) {\n  jv_dumpf(x, 0, flags);\n}\n`],
  ["V2: after a sibling function (file order)", `void jv_show(int x, int flags) {\n  if (flags == -1)\n    flags = 2;\n  jv_dumpf(x, 0, flags);\n}\n\nvoid jv_dumpf(int x, void *f, int flags) {\n  jv_dump_term(x, f, flags, 0, 0);\n}\n\nvoid jv_dump(int x, int flags) {\n  jv_dumpf(x, 0, flags);\n}\n`],
  ["V3: exact file text from L388 to L395", `void jv_dumpf(jv x, FILE *f, int flags) {\n  jv_dump_term(tsd_dtoa_context_get(), x, flags, 0, f, 0);\n}\n\nvoid jv_dump(jv x, int flags) {\n  jv_dumpf(x, stdout, flags);\n}\n`],
]
for (const [label, src] of CASES) {
  const file = join(dir, `${label.split(":")[0]}.c`)
  writeFileSync(file, src)
  const r: any = await parseFile(file, dir)
  const names = (r.symbols ?? []).filter((s: any) => s.kind === "function").map((s: any) => s.name)
  console.log(`${label}\n   functions: ${names.join(", ") || "(none)"}`)
}
