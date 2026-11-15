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
    if ((tree.rootNode as any).hasError) {
      const find = (n: any, d: number): void => {
        if (n.type === "ERROR" || n.isMissing) {
          process.stdout.write("  ERROR at line " + (n.startPosition.row + 1) + ": " + String(n.text).slice(0, 40) + "\n")
        }
        for (let i = 0; i < n.namedChildCount; i++) find(n.namedChild(i), d + 1)
      }
      find(tree.rootNode, 0)
    }
  }
  t("dup-foo", "class D {\n  def foo() { 1 }\n  def foo() { 2 }\n}\n")
  t("chain", "class Inner { def deeper = new Deeper() }\nclass C {\n  def inner = new Inner()\n  int read() { return inner.deeper.leaf }\n}\n")
  t("class-no-body", "class App\n")
  t("class-empty-body", "class App {}\n")
}
main().catch((e) => { console.error(e); process.exit(1) })
