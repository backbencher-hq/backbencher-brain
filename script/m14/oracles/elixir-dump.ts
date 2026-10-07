/**
 * ELIXIR_EXPORTS — single-file symbol/relationship dump on the PRODUCTION entry.
 *
 * Same shape as the lane's older `script/m14/tmp/elixir-dump.ts`, re-homed here
 * because that copy hardcodes a ROOT that no longer exists on this machine
 * (`$HOME/ishaq/...`) and is excluded from git, so it cannot be re-run by
 * anyone else. ROOT comes from BB_LANE_ROOT (default: the cwd).
 *
 * Usage: npx tsx script/m14/oracles/elixir-dump.ts --file=<abs path> [--filter=substr]
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = process.env.BB_LANE_ROOT ?? path.resolve(process.cwd())
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
    const arity = s.metadata?.arity !== undefined ? ` /${s.metadata.arity}` : ""
    const unres = s.metadata?.unresolvedName ? " UNRESOLVED_NAME" : ""
    console.log(`  ${String(s.kind).padEnd(9)} name=${JSON.stringify(s.name).padEnd(34)} owner=${String(s.ownerName ?? "-").padEnd(30)} lines=${s.range.startLine}..${s.range.endLine} vis=${s.visibility}${arity}${unres}`)
  }
  console.log("--- RELATIONSHIPS ---")
  for (const r of res.relationships ?? []) {
    if (FILTER && !`${r.type} ${r.source} ${r.target}`.includes(FILTER)) continue
    console.log(`  ${String(r.type).padEnd(13)} ${String(r.source).padEnd(46)} -> ${String(r.target).padEnd(40)} line=${r.line_number ?? "-"} c=${r.confidence} meta=${JSON.stringify(r.metadata ?? {})}`)
  }
  console.log("--- IMPORTS ---")
  for (const i of res.imports ?? []) console.log(`  ${i.module}`)
  console.log("--- ERRORS ---", (res.errors ?? []).length)
}
main().catch((e) => { console.error(e); process.exit(1) })