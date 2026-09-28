// Corpus-scale check that LUA-01 is fixed: what fraction of real relationships
// carry a line? A gate on one fixture can be green while the corpus is not.
import { execFileSync } from "node:child_process"
import { parseFile } from "../../src/ast/pool-worker"
async function main(): Promise<void> {
  const repo = process.argv[2] || "$HOME/fixtures/repositories/luvit"
  const files = execFileSync("git", ["-C", repo, "ls-files", "*.lua", "*.luau"], { encoding: "utf8", maxBuffer: 1 << 28 }).trim().split("\n").filter(Boolean)
  let total = 0, withLine = 0, missing = 0
  const samples: string[] = []
  for (const rel of files) {
    const r: any = await parseFile(`${repo}/${rel}`, repo)
    for (const e of r.relationships ?? []) {
      total++
      if (e.line_number !== undefined) withLine++
      else { missing++; if (samples.length < 8) samples.push(`${rel}: ${e.type} ${e.source}->${e.target}`) }
    }
  }
  const pct = total ? ((withLine / total) * 100).toFixed(2) : "n/a"
  console.log(`  files=${files.length} relationships=${total} withLine=${withLine} (${pct}%) missing=${missing}`)
  for (const s of samples) console.log(`    NO LINE  ${s}`)
  if (total && missing > 0) process.exitCode = 1
}
main()
