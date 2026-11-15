// G7 completeness: Groovy has SIX string forms; three interpolate and three
//   do not ('single', '''triple''' never interpolate; they are the controls).
//   "double", """triple-double", /slashy/ interpolate.
// `$/dollar-slashy/$` also interpolates per the Groovy docs — but the corpus
// says otherwise about its importance: the two files my first source-side regex
// flagged are regex ANCHORS (`~/^.+\.adoc$/`, where `$/` is an end anchor inside
// a pattern slashy), and a grep over ALL corpus repos for a true `$/ … /$`
// opener finds ZERO sites. The form does not occur in the corpus. The case is
// kept below so its grammar behaviour is on record (pre-slashy-rule it errored
// with fabricated calls; after the rule it parses as a plain slashy token whose
// content stays literal), measured rather than assumed.
import { ASTEngine } from "../../../src/ast/engine"

import { createRequire } from "node:module"
const require = createRequire(import.meta.url)

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
// `style` is a FREE name here on purpose: a parameter would be bound, and the
// binding gate would (correctly) suppress the read and hide the measurement.
const CASES: Array<[string, string]> = [
  ["double", 'def f() { return "a ${style} b" }'],
  ["double-short", 'def f() { return "a $style b" }'],
  ["triple-double", 'def f() { return """a ${style} b""" }'],
  ["single", "def f() { return 'a ${style} b' }"],
  ["triple-single", "def f() { return '''a ${style} b''' }"],
  ["slashy", "def f() { return /a ${style} b/ }"],
  ["slashy-short", "def f() { return /a $style b/ }"],
  ["dollar-slashy", 'def f() { return $/a ${style} b/$ }'],
]

async function main(): Promise<void> {
  for (const [name, src] of CASES) {
    const p = `${ROOT}/validation/m14/fixtures/groovy/__g7slashy.groovy`
    require("fs").writeFileSync(p, src + "\n")
    const res: any = await ASTEngine.parseFile(p, require("fs").readFileSync(p, "utf8"))
    const rels = (res.relationships ?? []).filter((r: any) => /uses|calls/.test(String(r.type)))
    const errs = [...(res.errors ?? []), ...(res.metadata?.errors ?? [])]
    console.log(`${name.padEnd(15)} errs=${errs.length} reads=${JSON.stringify(rels.map((r: any) => `${r.type}->${r.target}@${r.line_number}`))}`)
  }
  require("fs").unlinkSync(`${ROOT}/validation/m14/fixtures/groovy/__g7slashy.groovy`)

  // TREE SHAPE of the slashy interpolation, so the analyzer contract is grounded
  // in the node kinds the grammar actually produces (not assumed from the
  // double-quoted family's shape). Same loader the fixture runner uses, so the
  // tree here is exactly what the analyzer walks.
  const m: any = await import("../run-fixtures")
  const parser: any = await (m as any).getParser?.("groovy")
  if (!parser) { console.log("(parser loader not exported; tree shape via parseFile only)") } else {
    const t2: any = parser.parse('def f(x) { return /a ${x} b $x c/ }\n')
    const show = (n: any, d: number): void => {
      const leaf = n.childCount === 0 ? ` "${n.text.slice(0, 24)}"` : ""
      console.log("  ".repeat(d) + n.type + leaf)
      for (let i = 0; i < n.childCount; i++) { const c: any = n.child(i); if (c) show(c, d + 1) }
    }
    show(t2.rootNode, 0)
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
