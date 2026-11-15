// #841 reproduction probe — verifies each named failure class LIVE against the
// committed wasm before any grammar edit. A class that fails to reproduce is a
// refutation and must be recorded, not fixed speculatively.
// Run: bun script/m14/tmp/g841-repro.ts
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const WASM = path.join(ROOT, "wasm/tree-sitter-groovy.wasm")

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync(WASM))
  const parser = new P(); parser.setLanguage(lang)

  const cases: { cls: string; src: string; expect: "parse" | "fail" }[] = [
    {
      cls: "1. slashy string /…/",
      src: `def r = /a.b+c/\ndef s = "ok"\n`,
      expect: "parse",
    },
    {
      cls: "1b. slashy with escaped slash /a\\/b/",
      src: `def r = /a\\/b/\n`,
      expect: "parse",
    },
    {
      cls: "2. spread-map argument f(*:map)",
      src: `def f(a) { a }\ndef m = [x: 1]\nf(*: m)\n`,
      expect: "parse",
    },
    {
      cls: "3. GString nested quoting \"…${x.y('z')}…\"",
      src: `class C { def x(o) { o } def go() { def z = 'w'; return "v=\${x('$z')}" } }\n`,
      expect: "parse",
    },
    {
      cls: "3b. GString interpolation with method call on property",
      src: `def name = "world"\ndef g = "hello, \${name.toUpperCase()}!"\n`,
      expect: "parse",
    },
    {
      cls: "4. javadoc/HTML-heavy comment block",
      src: `/**\n * Does <b>things</b> and {@code foo(bar)}.\n * @param x the x\n */\ndef go() { 1 }\n`,
      expect: "parse",
    },
    {
      cls: "4b. HTML comment with tags and entities",
      src: `/* <p>Option &amp; choice</p>\n * <ul><li>a</li><li>b</li></ul> */\ndef k = 2\n`,
      expect: "parse",
    },
    // controls that MUST keep parsing after any fix
    { cls: "ctrl. division must stay division", src: `def a = 6\ndef b = 3\ndef c = a / b\n`, expect: "parse" },
    { cls: "ctrl. plain regex ~\"…\"", src: `def p = ~"[a-z]+" \n`, expect: "parse" },
    { cls: "ctrl. spread *args", src: `def f(a, b) { a + b }\ndef xs = [1, 2]\nf(* xs)\n`, expect: "parse" },
    { cls: "ctrl. plain gstring", src: `def n = "w"\ndef g = "hi \${n}"\n`, expect: "parse" },
  ]

  let bad = 0
  for (const c of cases) {
    const tree = parser.parse(c.src)
    const hasError = (tree.rootNode as any).hasError
    const ok = c.expect === "parse" ? !hasError : hasError
    if (!ok) bad++
    // show where the error is, if any
    let where = ""
    if (hasError && c.expect === "parse") {
      const lines = c.src.split("\n")
      for (let i = 0; i < lines.length; i++) {
        const node = tree.rootNode.descendantForIndex(
          c.src.indexOf(lines[i]),
          c.src.indexOf(lines[i]) + lines[i].length
        )
        if (node?.hasError) { where = ` (first bad line ${i + 1}: ${JSON.stringify(lines[i].slice(0, 60))})`; break }
      }
    }
    console.log(`${ok ? "OK  " : "FAIL"} ${c.cls}${where}`)
  }
  console.log(bad === 0 ? "\nALL CLASSES REPRODUCE AS DOCUMENTED (or already parse)" : `\n${bad} discrepancy(ies) vs the documented state`)
  process.exit(bad === 0 ? 0 : 1)
}
main()
