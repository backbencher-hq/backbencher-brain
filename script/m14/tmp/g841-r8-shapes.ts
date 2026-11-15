// #841 round 8 — constructs nominated from the NEXT tranche of small
// single-error-node gap files. Same two-sided judgement as rounds 5-6: our
// grammar must reject a candidate and real Groovy must accept it, or the
// candidate is DISCARDED. Controls are included so a candidate cannot be
// credited for a failure the surrounding boilerplate caused.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

const SHAPES: Array<[string, string]> = [
  // RxDatastoreClient / RxDatastoreClientImplementor row ~1:
  //   `def ObservableProxy proxy(Query query)` — `def` BEFORE a declared type.
  ["A def followed by a declared return type",
    `class W {\n    def ObservableProxy proxy(Query query) {\n        return null\n    }\n}\n`],
  ["B control: def with no return type",
    `class W {\n    def proxy(Query query) {\n        return null\n    }\n}\n`],
  ["C control: declared type with no def",
    `class W {\n    ObservableProxy proxy(Query query) {\n        return null\n    }\n}\n`],
  // CreateAppCommandSpec: `def (previewFeature, communityFeature) = ...`
  ["D multiple-assignment declaration with def",
    `class W {\n    def m() {\n        def (first, second) = getBean()\n        return first\n    }\n}\n`],
  ["E control: single declarator with def",
    `class W {\n    def m() {\n        def first = getBean()\n        return first\n    }\n}\n`],
  // FormFieldsTagLib: `g.formatBoolean(boolean: model.value)` — a KEYWORD as a
  // named-argument key.
  ["F keyword as a named-argument key",
    `class W {\n    def m(g, model) {\n        g.formatBoolean(boolean: model.value)\n    }\n}\n`],
  ["G control: ordinary named-argument key",
    `class W {\n    def m(g, model) {\n        g.formatBoolean(value: model.value)\n    }\n}\n`],
  // DetachedCriteriaJoinSpec: `new Contract(salary: 5_000_000G, ...)` — the
  // Groovy 3 `G` (BigInteger) numeric suffix.
  ["H BigInteger numeric literal suffix G",
    `class W {\n    def m() {\n        return new Contract(salary: 5_000_000G, name: 'x')\n    }\n}\n`],
  ["I control: same literal with L suffix",
    `class W {\n    def m() {\n        return new Contract(salary: 5_000_000L, name: 'x')\n    }\n}\n`],
  // HasManyInheritanceSpec: `void "test canary"()` — a STRING method name.
  ["J string literal as a method name with void",
    `class W {\n    void "test canary"() {\n        expect(\"x\")\n    }\n}\n`],
  ["K control: string literal as a method name with def",
    `class W {\n    def "test canary"() {\n        expect(\"x\")\n    }\n}\n`],
  // ClosureEventTriggeringInterceptorSpec / MultipleDataSourceSpec: a continued
  // call chain whose next line STARTS with a dot.
  ["L continued chain, line starts with a dot",
    `class W {\n    def m(c) {\n        return c.getSessionFactory()\n            .getListeners()\n            .size()\n    }\n}\n`],
  ["M control: same chain on one line",
    `class W {\n    def m(c) {\n        return c.getSessionFactory().getListeners().size()\n    }\n}\n`],
  // HibernateMappingContextSpec: constructor with a typed param and a one-line
  // `super(...)` body (the census records MISSING ; here).
  ["N constructor with a typed param and one-line super call",
    `class W extends B {\n    W(Class targetType) { super(targetType) }\n}\n`],
  ["O control: constructor with a simple param",
    `class W extends B {\n    W(targetType) { super(targetType) }\n}\n`],
]

async function main() {
  const dir = path.join(os.tmpdir(), "bb-shapes-r8")
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
    if (err) console.log(`         ${err.isMissing ? "MISSING" : "ERROR"} row ${err.startPosition.row + 1} col ${err.startPosition.column + 1} :: ${JSON.stringify(String(err.text).replace(/\n/g, "\\n").slice(0, 80))}`)
  }
  writeFileSync(path.join(dir, "list.txt"), list.join("\n") + "\n")
  console.log(`\nwritten for the real-Groovy oracle: ${path.join(dir, "list.txt")}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
