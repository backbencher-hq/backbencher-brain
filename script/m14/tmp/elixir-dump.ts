/**
 * ELIXIR lane — single-file symbol/relationship dump with range arithmetic.
 * Usage: npx tsx script/m14/tmp/elixir-dump.ts --file=<abs path> [--filter=substr]
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/sano/ishaq/backbencher-brain"
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const FILE = arg("file")!
const FILTER = arg("filter")

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const text = fs.readFileSync(FILE, "utf8")
  const res: any = await ASTEngine.parseFile(FILE, text)
  const lines = text.split("\n")
  console.log(`FILE ${FILE}  lines=${lines.length}`)
  console.log("--- SYMBOLS ---")
  for (const s of res.symbols ?? []) {
    if (FILTER && !`${s.kind} ${s.name} ${s.ownerName ?? ""}`.includes(FILTER)) continue
    const complexity = s.metadata?.complexity !== undefined ? ` cx=${s.metadata.complexity}` : ""
    const arity = s.metadata?.arity !== undefined ? ` /${s.metadata.arity}` : ""
    console.log(
      `  ${String(s.kind).padEnd(9)} name=${JSON.stringify(s.name).padEnd(34)} owner=${String(s.ownerName ?? "-").padEnd(30)} scope=${String(s.scope ?? "-").padEnd(30)} lines=${s.range.startLine}..${s.range.endLine} vis=${s.visibility}${arity}${complexity}`,
    )
  }
  console.log("--- RELATIONSHIPS ---")
  for (const r of res.relationships ?? []) {
    if (FILTER && !`${r.type} ${r.source} ${r.target}`.includes(FILTER)) continue
    console.log(`  ${String(r.type).padEnd(13)} ${String(r.source).padEnd(44)} -> ${String(r.target).padEnd(40)} line=${r.line_number ?? "-"} c=${r.confidence} meta=${JSON.stringify(r.metadata ?? {})}`)
  }
  console.log("--- METADATA ---")
  console.log(JSON.stringify({ ...res.metadata, patterns: undefined, frameworkPatterns: undefined }, null, 1))
  console.log("--- ERRORS ---", (res.errors ?? []).length, JSON.stringify((res.errors ?? []).slice(0, 5)))
}
main().catch((e) => { console.error(e); process.exit(1) })
