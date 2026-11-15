// #903 class 1: is the missing `dayjs` a vue-specific delegation hole, or a
// general TSX one? Three shapes, same call `dayjs(date).format(...)`:
//   (a) plain script statement   (b) inside a JSX expression container
//   (c) as a JSX attribute value
//
// Run: bun script/m14/tmp/v903-tsx-nested.ts
import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"

const CASES: Array<[string, string]> = [
  ["a: plain statement", `import dayjs from "dayjs"\nexport const x = dayjs(d).format("y")\n`],
  ["b: JSX child expression", `import dayjs from "dayjs"\nexport const C = () => <div>{dayjs(d).format("y")}</div>\n`],
  ["c: JSX attribute value", `import dayjs from "dayjs"\nexport const C = () => <ElTooltip content={dayjs(d).format("y")} />\n`],
  ["d: member call only", `const arr = [1]\nexport const y = arr.map(v => v)\n`],
]

const dir = mkdtempSync(join(tmpdir(), "v903-"))
for (const [name, src] of CASES) {
  const file = join(dir, `${name.split(":")[0]}.tsx`)
  writeFileSync(file, src)
  const r: any = await parseFile(file, dir)
  const calls = (r.relationships ?? []).filter((x: any) => String(x.type) === "calls")
  console.log(`\n=== ${name} ===`)
  for (const c of calls) console.log(`  calls ${c.source} -> ${c.target} line=${c.line_number ?? "-"} ${JSON.stringify(c.metadata?.calleeExpression ?? "")}`)
  if (calls.length === 0) console.log("  (no calls edge)")
}
