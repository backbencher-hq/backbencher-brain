/** Print full range payloads for named symbols — expectation authoring aid that
 *  reads the ANALYZER, so every pinned number is one the analyzer really emits. */
import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = "/home/sano/ishaq/backbencher-brain"
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const FILE = arg("file")!
const ONLY = (arg("only") ?? "").split(",").filter(Boolean)
async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const text = fs.readFileSync(FILE, "utf8")
  const res: any = await ASTEngine.parseFile(FILE, text)
  for (const s of res.symbols ?? []) {
    if (ONLY.length && !ONLY.includes(s.name)) continue
    const cr = s.metadata?.clauseRanges
    console.log(`${s.kind} ${s.name} owner=${s.ownerName ?? "-"} arity=${s.metadata?.arity ?? "-"} heads=${s.metadata?.heads ?? "-"}`)
    console.log(`   range=${JSON.stringify(s.range)}`)
    if (cr) console.log(`   clauseRanges=${JSON.stringify(cr)}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
