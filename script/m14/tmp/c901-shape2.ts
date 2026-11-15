import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"
const dir = mkdtempSync(join(tmpdir(), "c901s2-"))
const CASES: Array<[string, string]> = [
  ["V2: multiline signature, body brace on next line", `#define M60_API\nstatic int M60_API m60_one(\n  int x\n)\n{\n  return x;\n}\n`],
  ["V3: one-line body (current fixture shape)", `#define M60_API\nstatic int M60_API m60_one(void) { return 0; }\n`],
  ["V4: multiline signature, one-line body", `#define M60_API\nstatic int M60_API m60_one(\n  int x\n) { return x; }\n`],
  ["V5: preceding doc comment + multiline", `/* doc */\n#define M60_API\nstatic int M60_API m60_one(\n  int x\n)\n{\n  return x;\n}\n`],
]
for (const [label, src] of CASES) {
  const file = join(dir, `${label.split(":")[0]}.c`)
  writeFileSync(file, src)
  const r: any = await parseFile(file, dir)
  const syms = (r.symbols ?? []).filter((s: any) => s.name === "m60_one").map((s: any) => s.kind)
  const edges = (r.relationships ?? []).filter((x: any) => x.target === "M60_API").map((x: any) => `${x.type} ${x.source}`)
  console.log(`${label}\n   symbol: ${syms.join(",") || "(none)"}   edges: ${edges.join(" | ") || "(none)"}`)
}
