// Probe: why does `class X extends HTMLElement` in a svelte <script> block not
// get an `extends` truth edge from the JS oracle?
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const F =
  "/home/ishaq2321/bb_tests/repositories/svelte/packages/svelte/tests/runtime-legacy/samples/attribute-casing-custom-element/main.svelte"

async function main() {
  const src = fs.readFileSync(F, "utf8")
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const Lang: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

  // 1. svelte grammar -> find script raw_text
  const svelteLang = await Lang.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-svelte.wasm")))
  const svelteParser = new P()
  svelteParser.setLanguage(svelteLang)
  const svelteTree = svelteParser.parse(src)
  let raw: string | null = null
  const walk = (n: any) => {
    if (n.type === "script_element") {
      const r = n.namedChildren.find((c: any) => c.type === "raw_text")
      if (r) raw = r.text
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(svelteTree.rootNode)
  console.log("script raw_text found:", !!raw)

  // 2. javascript grammar
  const jsLang = await Lang.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
  const jsParser = new P()
  jsParser.setLanguage(jsLang)
  const jsSrc = "class MyCustomElement extends HTMLElement {\n  render() {}\n}\n"
  const jsTree = jsParser.parse(jsSrc)
  console.log("\n=== JS tree (minimal) ===")
  console.log(jsTree.rootNode.toString())

  // print class_declaration children types + fields
  const findClass = (n: any): any => {
    if (n.type === "class_declaration") return n
    for (let i = 0; i < n.namedChildCount; i++) {
      const r = findClass(n.namedChild(i))
      if (r) return r
    }
    return null
  }
  const cls = findClass(jsTree.rootNode)
  console.log("\nclass childCount:", cls.childCount)
  for (let i = 0; i < cls.childCount; i++) {
    const c = cls.child(i)
    console.log(`  [${i}] type=${c.type} named=${c.isNamed} text=${JSON.stringify(c.text.slice(0, 40))}`)
  }
  const heritage = cls.namedChildren.find((c: any) => c.type === "class_heritage")
  console.log("class_heritage:", heritage ? heritage.type : "NONE")
  if (heritage) {
    for (let i = 0; i < heritage.childCount; i++) {
      const c = heritage.child(i)
      console.log(`    heritage[${i}] type=${c.type} named=${c.isNamed} text=${JSON.stringify(c.text.slice(0, 40))}`)
    }
  }

  // 3. real svelte corpus script
  if (raw) {
    const t2 = jsParser.parse(raw)
    console.log("\n=== real svelte script tree ===")
    console.log(t2.rootNode.toString())
  }
}

main().catch((e) => {
  console.error("probe failed:", e)
  process.exit(1)
})
