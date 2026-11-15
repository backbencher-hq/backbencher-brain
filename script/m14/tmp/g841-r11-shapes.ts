// #841 round 11 — candidates from the next tranche of small gap files.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

const SHAPES: Array<[string, string]> = [
  // MongoClientOptionsBuilder.groovy: the failing line is a lone backslash.
  ["A backslash line continuation",
    `class W {\n    def m(a, b) {\n        def total = a + \\\n            b\n        return total\n    }\n}\n`],
  ["B control: same expression without the continuation",
    `class W {\n    def m(a, b) {\n        def total = a +\n            b\n        return total\n    }\n}\n`],
  // HasManyInheritanceSpec.groovy: `void "test canary"() { expect: true }` — a
  // statement LABEL (Spock block), on one line, in a string-named method.
  ["C statement label inside a method",
    `class W {\n    def "test canary"() {\n        expect: true\n    }\n}\n`],
  ["D control: same body without the label",
    `class W {\n    def "test canary"() {\n        expect(true)\n    }\n}\n`],
  ["E statement label, one-line body",
    `class W {\n    def "test canary"() { expect: true }\n}\n`],
  // Neo4jQuery.groovy: `}.call()` — a closure literal followed by a call.
  ["F closure literal then .call()",
    `class W {\n    def m() {\n        def runnable = { return 1 }.call()\n        return runnable\n    }\n}\n`],
  ["G control: closure assigned then called",
    `class W {\n    def m() {\n        def c = { return 1 }\n        return c.call()\n    }\n}\n`],
  // RxQueryUtils.groovy: `observables.add datastoreClient.get(a, b)` — a
  // command call whose single argument is a dotted method invocation.
  ["H command call with a dotted invocation argument",
    `class W {\n    def m(observables, client) {\n        observables.add client.get(a, b)\n    }\n}\n`],
  ["I control: same with parentheses",
    `class W {\n    def m(observables, client) {\n        observables.add(client.get(a, b))\n    }\n}\n`],
  // GrailsClasspathToolingModelBuilder: `artifact.file.toURI().toURL()`.
  ["J call chain of two invocations",
    `class W {\n    def m() {\n        return { artifact -> artifact.file.toURI().toURL() }\n    }\n}\n`],
  // BomManagedVersions.groovy: arguments AND a trailing closure, wrapped.
  ["K call with arguments and a trailing closure",
    `class W {\n    def m(dependencies, name, coordinate) {\n        dependencies.constraints.add(name, coordinate) {\n            withSomething()\n        }\n    }\n}\n`],
]

async function main() {
  const dir = path.join(os.tmpdir(), "bb-shapes-r11")
  mkdirSync(dir, { recursive: true })

  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-groovy.wasm")))
  const parser = new P()
  parser.setLanguage(lang)

  const firstError = (root: any): any => {
    let found: any = null
    const walk = (n: any): void => {
      if (found) return
      if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex) { found = n; return }
      for (let i = 0; i < n.childCount && !found; i++) walk(n.child(i))
    }
    walk(root)
    return found
  }

  const list: string[] = []
  console.log("shape                                          OURS")
  for (let i = 0; i < SHAPES.length; i++) {
    const [name, src] = SHAPES[i]
    const file = path.join(dir, `${String(i + 1).padStart(2, "0")}.groovy`)
    writeFileSync(file, src)
    list.push(file)
    const root = parser.parse(src)?.rootNode
    const err = firstError(root)
    console.log(`${(root?.hasError ? "REJECTS" : "accepts").padEnd(8)} ${name}`)
    if (err) console.log(`         ${err.isMissing ? "MISSING" : "ERROR"} row ${err.startPosition.row + 1} col ${err.startPosition.column + 1} :: ${JSON.stringify(String(err.text).replace(/\n/g, "\\n").slice(0, 70))}`)
  }
  writeFileSync(path.join(dir, "list.txt"), list.join("\n") + "\n")
  console.log(`\nwritten for the real-Groovy oracle: ${path.join(dir, "list.txt")}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
