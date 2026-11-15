// #841 round 14: does any existing groovy fixture already exercise the
// degraded-class recovery? Run each fixture through the baseline analyzer
// (--root=/tmp/bb-base) and the working tree, and report fixtures where the
// class symbol count differs.
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

const ROOT = process.argv.find((a) => a.startsWith("--root="))?.slice("--root=".length) ?? "/home/ishaq2321/mcp/backbencher-brain"
const FIXTURES = path.join(ROOT, "validation/m14/fixtures/groovy")

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".groovy")).sort()
let degraded = 0
for (const f of files) {
  const src = readFileSync(path.join(FIXTURES, f), "utf8")
  let res: any
  try { res = await ASTEngine.parseFile(path.join(FIXTURES, f), src) } catch (e) { console.log(`ERROR ${f}: ${(e as Error).message}`); continue }
  const classes = (res.symbols ?? []).filter((s: any) => s.kind === "class" && !s.name.startsWith("anonymous"))
  const parser = await ASTEngine.getParser("groovy" as any)
  const tree = parser.parse(src)
  const rootKids: string[] = []
  for (const c of tree.rootNode.children) if (c) rootKids.push(c.type)
  if (rootKids.includes("class") && rootKids.includes("ERROR")) {
    degraded++
    console.log(`DEGRADED ${f}  classes=${classes.length} [${classes.map((c: any) => c.name).join(",")}]`)
  }
}
console.log(`\nROOT=${ROOT}`)
console.log(`groovy fixtures: ${files.length}, degraded shapes among them: ${degraded}`)
