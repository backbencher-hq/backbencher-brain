import * as fs from "fs"
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
  t("closure->-in-chain", "[1,2].filter { path -> path > 1 }\n")
  t("closure-noparam", "[1,2].filter { it > 1 }\n")
  t("closure->-standalone", "def f = { path -> path > 1 }\n")
  t("local def new", "def m() { def x = new Deeper() }\n")
  t("local def lit", "def m() { def x = 1 }\n")
  // FULL corpus error count for honesty
  const files = fs.readdirSync("/home/ishaq2321/bb_tests/repositories/grails-core", { recursive: true }).filter((f: string) => f.endsWith(".groovy"))
  let err = 0
  for (const f of files) {
    const src = fs.readFileSync("/home/ishaq2321/bb_tests/repositories/grails-core/" + f, "utf8")
    if ((parser.parse(src).rootNode as any).hasError) err++
  }
  process.stdout.write("FULL grails-core: " + err + "/" + files.length + " groovy files have parse errors\n")
}
main().catch((e) => { console.error(e); process.exit(1) })
