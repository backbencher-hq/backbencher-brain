// #903 class 1, isolating the layer: the SAME script body taken out of
// cell-templating.vue, (a) via the engine's normal .tsx path and (b) inside the
// .vue through the SFC delegation. If (a) has the `dayjs` call and (b) does not,
// the defect is in the delegation seam, not in the TS analyzer's JSX handling.
//
// Run: bun script/m14/tmp/v903-script-body.ts
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"

const VUE = "/home/ishaq2321/bb_tests/repositories/element-plus/docs/examples/table-v2/cell-templating.vue"
const ROOT = "/home/ishaq2321/bb_tests/repositories/element-plus"

const src = readFileSync(VUE, "utf8")
const m = src.indexOf("<script")
const end = src.indexOf("</script>")
const body = src.slice(src.indexOf(">", m) + 1, end)
const dir = mkdtempSync(join(tmpdir(), "v903-body-"))
const tsxFile = join(dir, "cell-templating.tsx")
writeFileSync(tsxFile, body)

const show = (label: string, r: any) => {
  const calls = (r.relationships ?? []).filter((x: any) => String(x.type) === "calls")
  console.log(`\n=== ${label} ===`)
  for (const c of calls) console.log(`  calls ${c.source} -> ${c.target} line=${c.line_number ?? "-"} callee=${JSON.stringify(String(c.metadata?.calleeExpression ?? "").slice(0, 60))}`)
  if (!calls.length) console.log("  (no calls)")
}

show("(a) engine path, standalone .tsx", await parseFile(tsxFile, dir))
show("(b) inside the .vue (SFC delegation)", await parseFile(VUE, ROOT))
