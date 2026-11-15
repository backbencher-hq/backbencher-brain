/**
 * 2026-09-29: CS-D11 probe — does the analyzer emit `instantiates` for a QUALIFIED `new A.B()`?
 *
 * Found by `cs-deep-60-undercompared-labels`, which measures per-label coverage for the labels
 * csharp's oracle derives but the compared-label set does not include. `instantiates` came back
 * 107/110 with three disagreements, and all three were qualified construction targets:
 *
 *   new DiagnosticHelper.LocalizableStringWithArguments(   (x2, real roslyn)
 *   new Text.TextSpan(                                     (real roslyn)
 *
 * The oracle takes `leafOf(typeNode.text)`, so it expects the LEAF. The question is what the
 * analyzer does, and a three-row corpus finding cannot answer it on its own — so this is the
 * minimal case, with a plain `new` alongside as the control. If the control appears and the
 * qualified one does not, the analyzer is dropping qualified construction targets and the
 * disagreement is an ANALYZER gap, not an oracle over-derivation. That distinction decides
 * which side is wrong, so it is worth a file that answers it in one run.
 */
import * as fs from "fs"
import * as path from "path"
import { Language } from "web-tree-sitter"

const ROOT = process.cwd()
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c_sharp.wasm")))
const parser = new P()
parser.setLanguage(g)

const mod: any = await import(path.join(ROOT, "src/ast/real-csharp-analyzer.ts"))
const diff: any = await import(path.join(ROOT, "script/m14/differential.ts"))

const src = `class Holder { public class Inner { } }
class Inner2 { }
class C {
    void M() {
        var a = new Holder.Inner();
        var b = new Inner2();
        var c = new System.Text.StringBuilder();
    }
}
`
const file = "/tmp/opencode/q/qualified.cs"
fs.writeFileSync(file, src)
const root = parser.parse(src)!.rootNode
const a = new mod.RealCSharpAnalyzer()
const an: any[] = (await a.analyze(root, file, src))?.relationships ?? []
const or: any[] = diff.deriveCSharpEdges(root)

const inst = (rows: any[]) => rows.filter((r) => (r.type ?? r.label) === "instantiates").map((r) => r.target).sort()
const aT = inst(an)
const oT = inst(or)
console.log(`  analyzer instantiates: ${JSON.stringify(aT)}`)
console.log(`  oracle   instantiates: ${JSON.stringify(oT)}`)
const missing = oT.filter((t: string) => !aT.includes(t))
const extra = aT.filter((t: string) => !oT.includes(t))
console.log(`\n  truth-not-emitted: ${JSON.stringify(missing)}`)
console.log(`  emitted-not-truth: ${JSON.stringify(extra)}`)
if (missing.length > 0) {
  console.log(`\n  CS-D11 CONFIRMED — the analyzer drops the qualified target(s) ${JSON.stringify(missing)}`)
  console.log(`  while emitting the plain one. The oracle's leaf is the right expectation: the type`)
  console.log(`  being constructed IS \`Inner\`, and the qualifier is a path, not a different type.`)
} else {
  console.log(`\n  not reproduced`)
}
