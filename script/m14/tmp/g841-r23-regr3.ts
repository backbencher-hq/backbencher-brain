// #841 round 23: exact SbomPlugin shapes
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const CASES: Array<[string, string]> = [
  ["T1 jar.doFirst bare-stmt", `class C {\n  def m() {\n    jar.doFirst {\n      if (!publishesJavaComponent.get()) {\n        jar.manifest.attributes.remove('Sbom-Location')\n      }\n    }\n  }\n}\n`],
  ["T2 doFirst simple", `class C {\n  def m() {\n    jar.doFirst {\n      jar.manifest.attributes.remove('Sbom-Location')\n    }\n  }\n}\n`],
  ["T3 convention(map-closure)", `class C {\n  def m() {\n    def reportDir = project.layout.buildDirectory.dir('reports')\n    task.xmlOutput.convention(reportDir.map { it.file('bom.xml') })\n    task.jsonOutput.convention(reportDir.map { it.file('j.json') })\n  }\n}\n`],
  ["T4 provider closure GString", `class C {\n  def m() {\n    project.layout.buildDirectory.file(project.provider {\n      "\${artifactId.get()}-\${project.findProperty('v')}-sbom.json" as String\n    })\n  }\n}\n`],
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
    console.log(`  ${name.padEnd(28)} ${errs.length === 0 ? "CLEAN" : "ERR " + errs.slice(0, 3).join(",")}`)
  }
}
