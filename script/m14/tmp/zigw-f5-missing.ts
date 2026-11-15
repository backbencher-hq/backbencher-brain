/**
 * ZIG WAVE 2 PROBE — the DETERMINISTIC F5 comparison, with provenance.
 *
 * F5 draws a rotating cold pool, so its totals move run to run and a row it
 * reports cannot be looked up in a file you still have. This compares the same
 * three oracles against the analyzer over a FIXED corpus slice and prints the
 * uncovered rows with the tree site that produced them, so a class can be named
 * and then fixed on purpose instead of inferred from a percentage.
 *
 * The compared set is F5's zig set: calls, uses, references. Source is not part
 * of the key, so a bare `uses -> x` from the truth is covered by any analyzer
 * edge labelled `uses` whose target normalises to `x`.
 *
 * Usage: npx tsx script/m14/tmp/zigw-f5-missing.ts [files]
 */
import * as fs from "fs"
import { init, zigFiles, parser, analyzer } from "./zigw-harness"
import { deriveZigEdges, deriveZigBareUses, deriveZigReferenceEdges } from "../differential"

const norm = (t: string): string =>
  String(t ?? "").trim().replace(/^@"/, "").replace(/"$/, "").split(".").pop() ?? ""

async function main(): Promise<void> {
  await init()
  const files = zigFiles(["zig", "zls", "ghostty"], Number(process.argv[2] ?? 400))
  let truthN = 0
  let cov = 0
  let unexp = 0
  const missEx: string[] = []
  const unexpEx: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser().parse(src)
    const res: any = analyzer().analyze(tree.rootNode, src, f)
    const rel = f.split("/repositories/")[1] ?? f
    const truth = [
      ...deriveZigEdges(tree.rootNode),
      ...deriveZigBareUses(tree.rootNode, res.symbols ?? []),
      ...deriveZigReferenceEdges(tree.rootNode),
    ]
    const have = new Set<string>()
    for (const r of res.relationships as any[]) {
      if (r.type !== "calls" && r.type !== "uses" && r.type !== "references") continue
      have.add(`${r.type}|${norm(r.target)}`)
    }
    // provenance for the truth rows the analyzer does not cover
    const site = new Map<string, string>()
    const walk = (n: any): void => {
      if (n.type === "identifier" || n.type === "field_identifier") {
        const k = `uses|${n.text}`
        if (!site.has(k)) {
          const chain: string[] = []
          let cur: any = n
          while (cur && chain.length < 4) {
            chain.push(cur.type)
            cur = cur.parent
          }
          site.set(k, chain.join(" < "))
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c)
      }
    }
    walk(tree.rootNode)
    const tset = new Set(truth.map((t) => `${t.label}|${norm(t.target)}`))
    truthN += tset.size
    for (const k of tset) if (have.has(k)) cov++
    for (const t of truth) {
      const k = `${t.label}|${norm(t.target)}`
      if (!have.has(k) && missEx.length < 20) {
        missEx.push(`${rel}  MISSING ${t.label} -> ${t.target}   truth-site: ${site.get(`uses|${t.target}`) ?? "(not a bare identifier)"}`)
      }
    }
    for (const k of have) {
      if (!tset.has(k)) {
        unexp++
        if (unexpEx.length < 12) unexpEx.push(`${rel}  UNEXPLAINED ${k}`)
      }
    }
    tree.delete()
  }
  console.log(`files: ${files.length}  truth: ${truthN}  covered: ${cov} (${((cov / truthN) * 100).toFixed(1)}%)  MISSING: ${truthN - cov}  unexplained: ${unexp}`)
  if (missEx.length) {
    console.log("\n=== uncovered truth rows (first 20) ===")
    for (const e of missEx) console.log("  " + e)
  }
  if (unexpEx.length) {
    console.log("\n=== analyzer rows with no truth row (first 12) ===")
    for (const e of unexpEx) console.log("  " + e)
  }
}
void main()
