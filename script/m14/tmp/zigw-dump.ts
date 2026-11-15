/**
 * ZIG WAVE 2 PROBE — the SYMBOL/EDGE DUMP, for A/B of a behavioural change.
 *
 * Usage: npx tsx script/m14/tmp/zigw-dump.ts <out.json> [limit]
 *
 * The dump is the lane's A/B instrument: a behavioural change is measured by
 * diffing two dumps, so "what did this cost and what did it buy" is a set
 * difference and not an opinion. Keyed by (kind, name, scope, line) for symbols
 * and (type, source, target) for relationships, because those are the fields a
 * consumer resolves on.
 */
import * as fs from "fs"
import { init, zigFiles, parser, analyzer } from "./zigw-harness"

async function main(): Promise<void> {
  await init()
  const out = process.argv[2] ?? "/tmp/zigw-dump.json"
  const limit = Number(process.argv[3] ?? 800)
  const files = zigFiles(["zig", "zls", "ghostty"], limit)
  const syms: string[] = []
  const rels: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser().parse(src)
    const res: any = analyzer().analyze(tree.rootNode, src, f)
    const rel = f.split("/repositories/")[1] ?? f
    for (const s of res.symbols as any[]) {
      syms.push(`${rel}|${s.kind}|${s.name}|${s.scope ?? "-"}|${s.range?.startLine ?? 0}|${s.ownerKind ?? "-"}`)
    }
    for (const r of res.relationships as any[]) {
      rels.push(`${rel}|${r.type}|${r.source}|${r.target}`)
    }
    tree.delete()
  }
  syms.sort(); rels.sort()
  fs.writeFileSync(out, JSON.stringify({ files: files.length, symbols: syms, relationships: rels }, null, 0))
  console.log(`${out}: files=${files.length} symbols=${syms.length} relationships=${rels.length}`)
}
void main()
