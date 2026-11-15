import fs from "node:fs"
import path from "node:path"
const ROOT = process.cwd()
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  console.log("own load types=", lang.nodeTypeCount)
  const p = new P()
  p.setLanguage(lang)
  console.log("parse ok:", !!p.parse("class A { }").rootNode)
  const diff: any = await import(path.join(ROOT, "script/m14/differential.ts"))
  console.log("LANGS keys:", Object.keys(diff.LANGS).length, Object.keys(diff.LANG_REPOS).slice(0, 4))
  // does a second grammar still load after the engine inited?
  try {
    const lang2 = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-python.wasm")))
    console.log("post-engine load types=", lang2.nodeTypeCount)
  } catch (e: any) { console.log("post-engine load FAILED:", String(e).slice(0, 90)) }
}
main()
