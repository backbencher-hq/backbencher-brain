// #841 round 23: regression repro — bare-arg conditionals and dotted bare-arg calls
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const CASES: Array<[string, string]> = [
  ["R1 if bare args", `class C {\n  def m(x) {\n    if (compilationUnit != null && !isRxEntity) {\n      TraitComposer.doExtendTraits classNode, sourceUnit, compilationUnit\n    }\n  }\n}\n`],
  ["R2 if paren args", `class C {\n  def m(x) {\n    if (compilationUnit != null && !isRxEntity) {\n      TraitComposer.doExtendTraits(classNode, sourceUnit, compilationUnit)\n    }\n  }\n}\n`],
  ["R3 dotted bare-arg stmt", `class C {\n  def m(task, output) {\n    task.outputs.file output\n  }\n}\n`],
  ["R4 dotted paren-arg stmt", `class C {\n  def m(task, output) {\n    task.outputs.file(output)\n  }\n}\n`],
]
for (const W of [process.argv[2] ?? "/tmp/x23c.wasm"]) {
  const lang = await L.load(fs.readFileSync(W))
  const parser = new P(); parser.setLanguage(lang)
  console.log(`===== ${W}`)
  for (const [name, src] of CASES) {
    const t = parser.parse(src).rootNode
    const errs: string[] = []
    const walk = (n: any): void => {
      if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex) errs.push(`${n.type}[${n.startPosition.row + 1}] len=${n.endIndex - n.startIndex}`)
      for (let i = 0; i < n.childCount; i++) walk(n.child(i))
    }
    walk(t)
    console.log(`  ${name.padEnd(24)} ${errs.length === 0 ? "CLEAN" : "ERR " + errs.slice(0, 2).join(",")}`)
  }
}
