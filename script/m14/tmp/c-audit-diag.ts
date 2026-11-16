import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { parseFile } from "../../../src/ast/pool-worker"
const Z = "<corpus-root>/bb_tests/repositories/zig"
const files = execFileSync("bash", ["-c", `find ${Z} -name '*.c' -size +1k -not -path '*/.git/*' | sort | head -400`], { encoding: "utf8" }).split("\n").filter(Boolean)
const msgs: Record<string, number> = {}
const zero: Array<{ f: string; first: string }> = []
let namedErr = 0
for (const f of files) {
  const r: any = await parseFile(f, Z)
  if ((r.symbols ?? []).length === 0) {
    const src = readFileSync(f, "utf8").split("\n").filter((l) => l.trim() && !l.trim().startsWith("//") && !l.trim().startsWith("/*") && !l.trim().startsWith("*")).slice(0, 2).join(" | ")
    zero.push({ f: f.slice(f.indexOf("/zig/") + 5), first: src.slice(0, 100) })
  }
  for (const e of (r.errors ?? [])) {
    namedErr++
    const k = (e.message ?? String(e)).replace(/[0-9]+/g, "N").slice(0, 90)
    msgs[k] = (msgs[k] ?? 0) + 1
  }
}
console.log(`error entries total ${namedErr}`)
for (const [m, n] of Object.entries(msgs).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${String(n).padStart(4)}  ${m}`)
console.log(`\nzero-symbol files (${zero.length}):`)
for (const z of zero) console.log(`  ${z.f}\n      first non-comment line: ${z.first}`)
