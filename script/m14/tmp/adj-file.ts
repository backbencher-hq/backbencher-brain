// Per-file like-for-like: analyze ONE file under two checkouts (--roots=A,B),
// print the edge-set diff. Used to adjudicate a rotation-drawn F5 anomaly as
// pre-existing-on-that-file vs introduced-by-the-new-commit.
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOTS = (process.argv.find(a => a.startsWith("--roots="))?.slice("--roots=".length) ?? "").split(",")
const FILE = process.argv.find(a => a.startsWith("--file="))!.slice("--file=".length)
async function run(root: string) {
  const { ASTEngine } = await import(path.join(root, "src/ast/engine.ts"))
  const res: any = await ASTEngine.parseFile(FILE, readFileSync(FILE, "utf8"))
  return (res?.relationships ?? []).map((r: any) => `${r.type}|${r.source}|${r.target}`).sort()
}
const out: Record<string, string[]> = {}
for (const r of ROOTS) out[r] = await run(r)
const keys = Object.keys(out)
if (keys.length === 2) {
  const [a, b] = keys
  const A = new Set(out[a]), B = new Set(out[b])
  const onlyA = out[a].filter(x => !B.has(x)), onlyB = out[b].filter(x => !A.has(x))
  console.log(`${path.basename(a)}: ${out[a].length} edges | ${path.basename(b)}: ${out[b].length} edges`)
  console.log(`only-in-${path.basename(a)}: ${onlyA.length}`); onlyA.slice(0, 12).forEach(x => console.log("  -", x))
  console.log(`only-in-${path.basename(b)}: ${onlyB.length}`); onlyB.slice(0, 12).forEach(x => console.log("  +", x))
}
