/**
 * ZIG WAVE 2 PROBE — one file, every published relationship, with the line.
 *
 * The F5 differential reported `uses (expr) -> seed` MISSING for
 * lib/std/Random/Sfc64.zig, where `x.seed(init_s)` and `self.next()` are plain
 * field reads of a local receiver. This prints what the analyzer actually
 * published for a file so the disagreement can be read directly instead of
 * inferred from a count.
 *
 * Usage: npx tsx script/m14/tmp/zigw-file-edges.ts <path.zig>
 */
import * as fs from "fs"
import { init, parser, analyzer } from "./zigw-harness"

async function main(): Promise<void> {
  await init()
  const file = process.argv[2]
  if (!file) {
    console.log("usage: zigw-file-edges.ts <path.zig>")
    return
  }
  const src = fs.readFileSync(file, "utf8")
  const tree = parser().parse(src)
  const res: any = analyzer().analyze(tree.rootNode, src, file)
  console.log(`symbols: ${res.symbols.length}  relationships: ${res.relationships.length}`)
  console.log("\n=== symbols ===")
  for (const s of res.symbols as any[]) {
    console.log(
      `  L${String(s.range?.startLine ?? 0).padStart(4)}  ${String(s.kind).padEnd(12)} ${s.name}` +
        `${s.scope ? `  scope=${s.scope}` : ""}${s.ownerName ? `  owner=${s.ownerName}` : ""}`,
    )
  }
  console.log("\n=== relationships ===")
  for (const r of res.relationships as any[]) {
    console.log(`  L${String(r.line ?? 0).padStart(4)}  ${String(r.type).padEnd(12)} ${r.source} -> ${r.target}`)
  }
  tree.delete()
}
void main()
