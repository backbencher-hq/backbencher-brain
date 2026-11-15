/**
 * ZIG WAVE 2 PROBE — which oracle derives which row, for named targets.
 *
 * F5 reported `uses (expr) -> seed` MISSING on lib/std/Random/Sfc64.zig, where
 * `seed` is a METHOD of the file's own `Sfc64` and every appearance of the name
 * is either a declaration, a member read on a receiver, or a call target. The
 * bare-read oracle excludes member leaves and callees, and the field oracle
 * emits `calls` for a callee — so neither should derive a `uses`. This prints
 * the three oracles' rows for chosen target names, plus the tree shape at the
 * sites, so the disagreement is named rather than inferred.
 *
 * Usage: npx tsx script/m14/tmp/zigw-which-oracle.ts <path.zig> <target...>
 */
import * as fs from "fs"
import { init, parser, analyzer } from "./zigw-harness"
import { deriveZigEdges, deriveZigBareUses, deriveZigReferenceEdges } from "../differential"

async function main(): Promise<void> {
  await init()
  const file = process.argv[2]
  const targets = new Set(process.argv.slice(3))
  if (!file || targets.size === 0) {
    console.log("usage: zigw-which-oracle.ts <path.zig> <target...>")
    return
  }
  const src = fs.readFileSync(file, "utf8")
  const tree = parser().parse(src)
  const res: any = analyzer().analyze(tree.rootNode, src, file)
  const root = tree.rootNode
  const show = (label: string, rows: { label: string; from: string; target: string }[]): void => {
    for (const r of rows) if (targets.has(r.target)) console.log(`  ${label.padEnd(10)} ${r.label} ${r.from} -> ${r.target}`)
  }
  console.log("=== truth rows for the named targets ===")
  show("edges", deriveZigEdges(root))
  show("bareuses", deriveZigBareUses(root, res.symbols ?? []))
  show("references", deriveZigReferenceEdges(root))
  console.log("\n=== analyzer rows for the named targets ===")
  for (const r of res.relationships as any[]) {
    const leaf = String(r.target ?? "").split(".").pop()
    if (targets.has(r.target) || targets.has(leaf)) {
      console.log(`  analyzer   ${r.type} ${r.source} -> ${r.target}`)
    }
  }
  console.log("\n=== tree shape at each site that mentions a target ===")
  const lineOf = (n: any): number => {
    let l = 0
    for (let i = 0; i < n.startIndex; i++) if (src[i] === "\n") l++
    return l + 1
  }
  const walk = (n: any): void => {
    if ((n.type === "identifier" || n.type === "field_identifier") && targets.has(n.text)) {
      const chain: string[] = []
      let cur: any = n
      while (cur && chain.length < 5) {
        chain.push(cur.type)
        cur = cur.parent
      }
      const txt = src.slice(n.startIndex, Math.min(n.endIndex, n.startIndex + 40)).split("\n")[0]
      console.log(`  L${lineOf(n)}  ${n.text.padEnd(10)} ${chain.join(" < ")}   |  ${txt}`)
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) walk(c)
    }
  }
  walk(root)
  tree.delete()
}
void main()
