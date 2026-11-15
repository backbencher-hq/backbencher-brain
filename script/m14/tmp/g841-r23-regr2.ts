// #841 round 23: refine toward the SbomPlugin:211 shape
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const CASES: Array<[string, string]> = [
  ["S1 cmd + typed-closure", `class C {\n  def m() {\n    project.tasks.register('bom', CyclonedxDirectTask) { CyclonedxDirectTask task ->\n      Provider<Directory> reportDir = project.layout.buildDirectory.dir('reports')\n      task.xmlOutput.convention(reportDir)\n    }\n  }\n}\n`],
  ["S2 paren-call + typed-closure", `class C {\n  def m() {\n    project.tasks.register('bom', CyclonedxDirectTask, { CyclonedxDirectTask task ->\n      Provider<Directory> reportDir = project.layout.buildDirectory.dir('reports')\n      task.xmlOutput.convention(reportDir)\n    })\n  }\n}\n`],
  ["S3 cmd + untyped-closure", `class C {\n  def m() {\n    project.tasks.register('bom') { task ->\n      Provider<Directory> reportDir = project.layout.buildDirectory.dir('reports')\n      task.xmlOutput.convention(reportDir)\n    }\n  }\n}\n`],
  ["S4 cmd + typed-closure short", `class C {\n  def m() {\n    foo.register('bom', Bar) { Bar task ->\n      task.doIt(1)\n    }\n  }\n}\n`],
  ["S5 reportDir.map closure", `class C {\n  def m() {\n    def reportDir = project.layout.buildDirectory.dir('reports')\n    task.xmlOutput.convention(reportDir.map { it.file('bom.xml') })\n  }\n}\n`],
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
    console.log(`  ${name.padEnd(30)} ${errs.length === 0 ? "CLEAN" : "ERR " + errs.slice(0, 2).join(",")}`)
  }
}
