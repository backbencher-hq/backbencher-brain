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
    process.stdout.write(name + ": hasError=" + (tree.rootNode as any).hasError)
    if ((tree.rootNode as any).hasError) {
      const find = (n: any): void => {
        if (n.type === "ERROR" || n.isMissing) {
          process.stdout.write("  ERROR@" + (n.startPosition.row + 1) + ": " + String(n.text).slice(0, 40).replace(/\n/g, "\\n"))
        }
        for (let i = 0; i < n.namedChildCount; i++) find(n.namedChild(i))
      }
      find(tree.rootNode)
    }
    process.stdout.write("\n")
  }
  t("chain-bases", "class Deeper { int leaf = 1 }\nclass Inner { def deeper = new Deeper() }\n")
  t("inner-ctor", "class Inner { def deeper = new Deeper() }\n")
  t("inner-noparen", "class Inner { def deeper = new Inner }\n")
  t("read-int", "class C {\n  int read() { return 1 }\n}\n")
  t("read-def", "class C {\n  def read() { return 1 }\n}\n")
  t("chain-full", "class Deeper { int leaf = 1 }\nclass Inner { def deeper = new Deeper() }\nclass C {\n  def inner = new Inner()\n  def read() { inner.deeper.leaf }\n}\n")
}
main().catch((e) => { console.error(e); process.exit(1) })
