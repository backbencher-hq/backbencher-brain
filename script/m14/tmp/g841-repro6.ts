// Block tail-escape: try/catch one-liner bodies (the corpus's 59 MISSING ;)
import * as fs from "fs"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const cases: { cls: string; src: string }[] = [
    { cls: "T1. try { promise.get() }", src: `try { promise.get() } catch (e) { log(e) }\n` },
    { cls: "T2. try multi-stmt + final call", src: `try { def a = 1; use(a) } catch (Throwable e) { callable.call(e) }\n` },
    { cls: "T3. closure with throw tail", src: `def l = [1]\nl << { throw new RuntimeException('bad') }\n` },
    { cls: "T4. if block one-liner", src: `if (x) { handle() }\n` },
    { cls: "T5. multiline block (control)", src: `try {\n  a()\n  b()\n} catch (e) {\n  c()\n}\n` },
    { cls: "T6. method one-liner (control)", src: `class C { def f() { a + b } }\n` },
  ]
  for (const c of cases) {
    const tree = parser.parse(c.src)
    const bad = (tree.rootNode as any).hasError
    console.log(`${bad ? "FAIL" : "OK  "} ${c.cls}`)
  }
}
main()
