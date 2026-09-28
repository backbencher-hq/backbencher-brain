// Reduce a file while PRESERVING A RELATIONSHIP LOSS between two grammar
// builds — the property that matters when a grammar change makes a file's
// recovery worse even though the file was failing before and after. `hasError`
// cannot see that (it is true on both sides), so the reducer's property is
// `rels(new) < rels(baseline)` measured through the real analyzer on both
// parses, in one process, from two wasm builds.
//
// Usage: bun script/m14/tmp/g841-rel-loss-reduce.ts <file>
import * as fs from "fs"

const BASE_WASM = "/tmp/groovy-baseline.wasm"
const NEW_WASM = "/tmp/w22-groovy.wasm"

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const langBase = await L.load(fs.readFileSync(BASE_WASM))
  const langNew = await L.load(fs.readFileSync(NEW_WASM))
  const pBase = new P(); pBase.setLanguage(langBase)
  const pNew = new P(); pNew.setLanguage(langNew)

  const mod: any = await import("../../src/ast/real-groovy-analyzer")
  const analyzer = new (mod as any).RealGroovyAnalyzer()

  const rels = async (parser: any, src: string): Promise<number> => {
    try {
      const root = parser.parse(src)?.rootNode
      const res = await analyzer.analyze(root, src, "/tmp/x.groovy")
      return (res.relationships ?? []).length
    } catch {
      return -1
    }
  }
  const loses = async (src: string): Promise<boolean> => {
    const b = await rels(pBase, src)
    const n = await rels(pNew, src)
    return b >= 0 && n >= 0 && n < b
  }

  const orig = fs.readFileSync(process.argv[2], "utf8").split("\n")
  const src0 = orig.join("\n")
  console.log(`original ${orig.length} lines · rels base=${await rels(pBase, src0)} new=${await rels(pNew, src0)}`)
  if (!(await loses(src0))) {
    console.log("no relationship loss on this input at full size — nothing to reduce")
    return
  }

  let best = orig.slice()
  let gran = Math.max(1, Math.floor(best.length / 2))
  while (gran >= 1) {
    let i = 0
    let changed = false
    while (i < best.length) {
      const cand = best.slice(0, i).concat(best.slice(i + gran))
      if (cand.length > 0 && (await loses(cand.join("\n")))) {
        best = cand
        changed = true
      } else {
        i += gran
      }
    }
    if (!changed) gran = Math.floor(gran / 2)
  }

  const out = best.join("\n")
  console.log(`\nreduced to ${best.length} lines · rels base=${await rels(pBase, out)} new=${await rels(pNew, out)}`)
  console.log("-".repeat(60))
  console.log(out)
  console.log("-".repeat(60))
  fs.writeFileSync("/tmp/g841-rel-loss.groovy", out + "\n")
  for (const [label, p] of [["BASE", pBase], ["NEW ", pNew]] as const) {
    const root: any = p.parse(out)?.rootNode
    const bad: string[] = []
    const stack: any[] = [root]
    while (stack.length) {
      const x = stack.pop()!
      if (x.type === "ERROR" || x.isMissing) bad.push(`${x.isMissing ? "MISSING" : "ERROR"} ${x.type}@${x.startPosition.row + 1}`)
      for (let i = 0; i < x.childCount; i++) stack.push(x.child(i))
    }
    console.log(`${label} hasError=${root?.hasError} bad=${bad.length} ${bad.slice(0, 8).join(", ")}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
