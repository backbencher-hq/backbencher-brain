/**
 * ZIG WAVE 2 PROBE — the SYMBOL PAYLOAD audit.
 *
 * The differential reported 1,029 MISSING on a 200-file draw where it had
 * reported 0 before, with BOTH sides growing by ~1,000. That shape has one
 * cause: a set of symbols became resolvable-by-scope but not-by-ownerName, so
 * the analyzer resolved a read through `scope` while the F5 truth inventory
 * (which only trusts `ownerName`/`owner`) treated the name as a file-scope
 * value. This counts the payload classes that can produce that split.
 *
 * Usage: npx tsx script/m14/tmp/zigw-payload.ts [limit]
 */
import * as fs from "fs"
import { init, zigFiles, parser, analyzer } from "./zigw-harness"

async function main(): Promise<void> {
  await init()
  const limit = Number(process.argv[2] ?? 400)
  const files = zigFiles(["zig", "zls", "ghostty"], limit)
  const byKind = new Map<string, number>()
  let total = 0
  let scopeOnly = 0
  const samples: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser().parse(src)
    const res: any = analyzer().analyze(tree.rootNode, src, f)
    const rel = f.split("/repositories/")[1] ?? f
    for (const s of res.symbols as any[]) {
      total++
      byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + 1)
      const ownerTruthy = Boolean(s.ownerName || s.owner)
      if (!ownerTruthy && s.scope) {
        scopeOnly++
        if (samples.length < 15) {
          samples.push(
            `${rel}:${s.range?.startLine ?? 0}  ${s.kind} "${s.name}"  scope=${s.scope}  ownerKind=${s.ownerKind ?? "-"}`,
          )
        }
      }
    }
    tree.delete()
  }
  console.log(`files: ${files.length}  symbols: ${total}`)
  console.log(`kinds: ${JSON.stringify(Object.fromEntries([...byKind].sort((a, b) => b[1] - a[1]).slice(0, 12)))}`)
  console.log(`SCOPE-ONLY (scope set, ownerName/owner empty): ${scopeOnly}  <- the class that splits the two contract readings`)
  if (samples.length) {
    console.log("\n=== samples ===")
    for (const s of samples) console.log("  " + s)
  }
}
void main()
