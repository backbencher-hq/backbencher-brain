// Groovy grammar provenance — head-to-head re-measurement.
//
// archive/docs-pre-consolidation/analyzers-review-appendix.md decided (2026-08-23) that the patched
// amaanq fork "IS the best available option" over murtaza64's community grammar,
// on 34.0% vs 29.0% clean parse rate over 300 grails-core files, plus the
// construct-level facts that murtaza64 fails the *constructor itself* and has no
// trait support. That measurement is now months old, so this re-runs the
// comparison against the identical 400-file recorded sample used everywhere else
// in the corpus lane, and re-checks the two decisive constructs.
//
// Self-contained on purpose: it parses with web-tree-sitter directly instead of
// the analyzer pipeline, so it measures the GRAMMAR, not the analyzer, and needs
// no repository state to be swapped.
//
// Usage: bun script/m14/tmp/groovy-grammar-headtohead.ts <wasm> [<wasm> ...]
import * as fs from "fs"
import * as path from "path"

const CORPUS = "/home/ishaq2321/bb_tests/repositories/grails-core"
const SAMPLE = "validation/m12/results/groovy-corpus-sample.txt"

// The two constructs that decided the choice last time, plus the ones the
// analyzer doc's comparison table lists per grammar.
const constructs: { cls: string; src: string }[] = [
  { cls: "constructor Foo(String a)", src: "class Foo {\n  String a\n  Foo(String a) {\n    this.a = a\n  }\n}\n" },
  { cls: "trait with method", src: "trait T {\n  void hello() { println 'hi' }\n}\n" },
  // Several trait shapes on purpose: a single minimal trait passed on murtaza64's
  // current main even though the 2026-08 record says traits shred there, so the
  // per-grammar trait verdict must not rest on one construct.
  { cls: "trait with property", src: "trait T {\n  String name\n  void hello() { println name }\n}\n" },
  { cls: "trait with abstract method", src: "trait T {\n  abstract void run()\n}\n" },
  { cls: "class implements trait", src: "trait T {\n  void hello() { }\n}\nclass C implements T {\n  void own() { }\n}\n" },
  { cls: "class extends + constructor", src: "class Base {\n  Base(String a) { }\n}\nclass C extends Base {\n  C(String a) {\n    super(a)\n  }\n}\n" },
  { cls: "untyped params def dyn(arg)", src: "def dyn(arg) {\n  return arg\n}\n" },
  { cls: "safe-nav / spread / elvis", src: "def m(o) {\n  def b = o?.name\n  def c = list*.name\n  def d = o?.name ?: 'x'\n  return [b, c, d]\n}\n" },
  { cls: "Spock string method name", src: "class S {\n  def \"addition works\"() {\n    expect:\n    true\n  }\n}\n" },
  { cls: "one-line label { expect: true }", src: "class S {\n  def m() { expect: true }\n}\n" },
  { cls: "dotted chain call", src: "class C {\n  def m(p) {\n    return p.layout.buildDirectory.dir('x')\n  }\n}\n" },
  { cls: "slashy string + division", src: "class C {\n  def m() {\n    def a = 6\n    def b = a / 2\n    def r = /a.b/\n    return [b, r]\n  }\n}\n" },
  { cls: "as cast + =~ regex", src: "class C {\n  def m(x) {\n    def y = x as String\n    def z = y =~ /ab/\n    return z\n  }\n}\n" },
  { cls: ".& method reference", src: "class C {\n  def m() {\n    list.each(this.&validate)\n  }\n}\n" },
]

async function main() {
  const wasms = process.argv.slice(2)
  if (!wasms.length) {
    console.error("usage: bun groovy-grammar-headtohead.ts <wasm> [<wasm> ...]")
    process.exit(1)
  }
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })

  const sample = fs
    .readFileSync(SAMPLE, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  console.log(`sample: ${sample.length} files from ${SAMPLE}\n`)

  for (const wasm of wasms) {
    const label = `${wasm}  (${(fs.statSync(wasm).size / 1024).toFixed(0)} KB)`
    let parser: any
    try {
      const lang = await L.load(fs.readFileSync(wasm))
      parser = new P()
      parser.setLanguage(lang)
    } catch (e: any) {
      console.log(`${label}\n  LOAD FAILED: ${e?.message ?? e}\n`)
      continue
    }

    let failing = 0
    let errored = 0
    const sigs = new Map<string, number>()
    for (const rel of sample) {
      const abs = path.join(CORPUS, rel)
      let src: string
      try {
        src = fs.readFileSync(abs, "utf8")
      } catch {
        continue
      }
      const tree = parser.parse(src)
      const root = tree.rootNode as any
      if (!root.hasError) continue
      failing++
      // classify: a true ERROR node vs only MISSING tokens
      let hasErrNode = false
      const walk = (n: any) => {
        if (hasErrNode) return
        if (n.type === "ERROR") {
          hasErrNode = true
          return
        }
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c) walk(c)
        }
      }
      walk(root)
      if (hasErrNode) errored++
      // Report the FIRST defective node's own line — not the root's, which is
      // always line 1 and made every signature read `/*`.
      let first: any = null
      const seek = (n: any) => {
        if (first) return
        if (n.type === "ERROR" || n.isMissing) {
          first = n
          return
        }
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c) seek(c)
        }
      }
      seek(root)
      if (first) {
        const raw = (src.split("\n")[first.startPosition.row] ?? "").trim()
        const sig = `${first.isMissing ? "MISSING " + first.type + " @" : "ERROR @"}${first.startPosition.row + 1}: ${raw.slice(0, 55)}`
        sigs.set(sig, (sigs.get(sig) ?? 0) + 1)
      }
    }

    console.log(`${label}`)
    console.log(`  sample files failing : ${failing}/${sample.length}  (${((failing / sample.length) * 100).toFixed(1)}%)`)
    console.log(`  with a true ERROR node: ${errored}`)
    console.log(`  top first-error lines :`)
    for (const [s, n] of [...sigs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
      console.log(`      ${String(n).padStart(3)}x  ${s}`)
    }

    console.log(`  constructs:`)
    for (const c of constructs) {
      const t = parser.parse(c.src)
      console.log(`      ${(t.rootNode as any).hasError ? "FAIL" : "ok  "}  ${c.cls}`)
    }
    console.log()
  }
}

main()
