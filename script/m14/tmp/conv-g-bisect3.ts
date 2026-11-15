import * as fs from "fs"

import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const t = (name: string, src: string) => {
    const tree = parser.parse(src)
    process.stdout.write(name + ": hasError=" + (tree.rootNode as any).hasError + "\n")
  }
  t("script-level new", "def x = new Deeper()\n")
  t("local var new", "class C {\n  def m() { def x = new Deeper() }\n}\n")
  t("field typed new", "class C {\n  Deeper d = new Deeper()\n}\n")
  t("field def new + method", "class C {\n  def d = new Deeper()\n  def m() { 1 }\n}\n")
  // corpus sample: parse a real groovy file
  const glob = require("fs").readdirSync("/home/ishaq2321/bb_tests/repositories/grails-core", { recursive: true }).filter((f: string) => f.endsWith(".groovy"))
  let errCount = 0, total = 0
  for (let i = 0; i < Math.min(60, glob.length); i++) {
    const f = glob[i]
    const src = fs.readFileSync("/home/ishaq2321/bb_tests/repositories/grails-core/" + f, "utf8")
    total++
    if ((parser.parse(src).rootNode as any).hasError) errCount++
  }
  process.stdout.write("corpus grails-core: " + errCount + "/" + total + " files with parse errors\n")
}
main().catch((e) => { console.error(e); process.exit(1) })
