// #841 round 6 — candidates read off the corpus's SINGLE-error-node files.
//
// Those files are the purest signal: exactly one ERROR node, and its row is
// recorded, so the failing construct is nearly isolated already (no reduction
// needed). Each candidate below is the minimal COMPLETE program for what that
// row showed. Judgement is two-sided, as in round 5: our grammar must reject,
// real Groovy must accept, or the candidate is DISCARDED as not-a-gap.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

const SHAPES: Array<[string, string]> = [
  // GrailsCodeStylePlugin.groovy row 158 — closure header carried a
  // FULLY-QUALIFIED type: `{ org.gradle.api.file.FileTreeElement element ->`
  ["A fully-qualified type in a closure parameter",
    `class W {\n    def m(l) {\n        l.each { org.gradle.api.file.FileTreeElement element -> element.getFile() }\n    }\n}\n`],
  ["B control: simple type in a closure parameter",
    `class W {\n    def m(l) {\n        l.each { File f -> f.name }\n    }\n}\n`],
  ["C control: fully-qualified type in a formal parameter",
    `class W {\n    def m(org.gradle.api.file.FileTreeElement element) {\n        return element\n    }\n}\n`],
  // RxJava{2,3}PromiseSpec.groovy row 147/161 — a COMMAND after a
  // closure-argument: `p.then { it * 2 } then { it + 6 }`.
  ["D command name after a closure argument",
    `class W {\n    def m(p) {\n        p.then { it * 2 } then { it + 6 }\n    }\n}\n`],
  ["E control: single closure-argument call",
    `class W {\n    def m(p) {\n        p.then { it * 2 }\n    }\n}\n`],
  ["F control: dotted chain of closure-argument calls",
    `class W {\n    def m(p) {\n        p.then { it * 2 }.then { it + 6 }\n    }\n}\n`],
  // ResourceUtils.groovy row 72 — safe-nav call with a trailing closure and
  // empty parens: `dirFiles?.find() { File f -> ... }`.
  ["G safe-nav call with empty parens and a trailing closure",
    `class W {\n    def m(d) {\n        boolean b = d?.find() { File f -> f.name.endsWith('.groovy') }\n        return b\n    }\n}\n`],
  ["H control: call with empty parens and a trailing closure",
    `class W {\n    def m(d) {\n        boolean b = d.find() { File f -> f.name.endsWith('.groovy') }\n        return b\n    }\n}\n`],
  // Controller.groovy row 482 — a cast whose type is parameterized and whose
  // expression continues on the NEXT line: `= (List<Foo>\n  expr)`.
  ["I multiline parenthesised cast with a parameterized type",
    `class W {\n    def m(c) {\n        final List<Foo> x = (List<Foo>\n            c.y.isAssignableFrom(c.z)\n        )\n        return x\n    }\n}\n`],
  ["J control: same cast on one line",
    `class W {\n    def m(c) {\n        final List<Foo> x = (List<Foo>) c.y\n        return x\n    }\n}\n`],
  // CoreAutoConfigurationSpec.groovy row 56 — closure `as` a PARAMETERIZED
  // type: `return { Ctx c -> ... } as Init<Ctx>`.
  ["K closure as-coercion to a parameterized type",
    `class W {\n    def m() {\n        return { Ctx c -> c.x } as Init<Ctx>\n    }\n}\n`],
  ["L control: closure as-coercion to a plain type",
    `class W {\n    def m() {\n        return { Ctx c -> c.x } as Init\n    }\n}\n`],
  // AbstractHibernateGormValidationApi.groovy row 129 — an `abstract` method
  // with NO return type and no `def`: `abstract applyManualFlush(Session s)`.
  ["M abstract method with no type and no def",
    `abstract class W {\n    abstract applyManualFlush(Session session)\n}\n`],
  ["N control: abstract method with def",
    `abstract class W {\n    abstract def applyManualFlush(Session session)\n}\n`],
  ["O control: abstract method with a declared type",
    `abstract class W {\n    abstract void applyManualFlush(Session session)\n}\n`],
  // CacheAutoConfigurationSpec.groovy row 154 — TWO typed closure params with
  // an inline body on the same line.
  ["P two typed closure params with an inline body",
    `class W {\n    def m(p, g) {\n        p.each { String key, Object value -> g.put(key, value) }\n    }\n}\n`],
  ["Q control: one typed closure param with an inline body",
    `class W {\n    def m(p, g) {\n        p.each { String key -> g.put(key, key) }\n    }\n}\n`],
  // G/H both failed, so the `?.` was never the trigger. Isolating what is:
  // (1) drop the typed param, (2) keep the typed param but flatten the body.
  ["R untyped closure param, same dotted body",
    `class W {\n    def m(d) {\n        boolean b = d.find() { f -> f.name.endsWith('.groovy') }\n        return b\n    }\n}\n`],
  ["S typed closure param, flattened body",
    `class W {\n    def m(d) {\n        boolean b = d.find() { File f -> f.name }\n        return b\n    }\n}\n`],
  ["T typed closure param, body is a call on the param",
    `class W {\n    def m(d) {\n        boolean b = d.find() { File f -> f.endsWith('.groovy') }\n        return b\n    }\n}\n`],
  ["U typed closure param, body is a chained call",
    `class W {\n    def m(d) {\n        boolean b = d.find() { File f -> f.name.endsWith(x) }\n        return b\n    }\n}\n`],
  ["V control: typed closure param, body is a two-segment chain",
    `class W {\n    def m(d) {\n        boolean b = d.find() { File f -> f.name.size() }\n        return b\n    }\n}\n`],
  ["W control: typed closure param and a dotted body, braced on its own line",
    `class W {\n    def m(d) {\n        boolean b = d.find() { File f ->\n            f.name.endsWith('.groovy')\n        }\n        return b\n    }\n}\n`],
]

async function main() {
  const dir = path.join(os.tmpdir(), "bb-shapes-r6")
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
    if (err) console.log(`         ${err.isMissing ? "MISSING" : "ERROR"} row ${err.startPosition.row + 1} col ${err.startPosition.column + 1} :: ${JSON.stringify(String(err.text).replace(/\n/g, "\\n").slice(0, 90))}`)
  }
  writeFileSync(path.join(dir, "list.txt"), list.join("\n") + "\n")
  console.log(`\nwritten for the real-Groovy oracle: ${path.join(dir, "list.txt")}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
