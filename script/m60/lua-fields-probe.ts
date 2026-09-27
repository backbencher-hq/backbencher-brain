import { readFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"
import { loadWebTreeSitter, resolveWasmAsset } from "../../src/util/wasm"
import { join } from "node:path"
const REPOS = "$HOME/fixtures/repositories"
async function main(): Promise<void> {
  const mod: any = await loadWebTreeSitter()
  await parseFile(join(REPOS, "luvit", "init.lua"), REPOS)
  const lang = await mod.Language.load(resolveWasmAsset("tree-sitter-lua.wasm"))
  const p = new mod.Parser(); p.setLanguage(lang)
  const src = readFileSync("$HOME/fixtures/probe/fields.lua", "utf8")
  const t = p.parse(src)
  console.log("=== FULL tree of the probe (children incl. anonymous) ===")
  const walk = (n: any, d = 0): void => {
    const fields: string[] = []
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (!c) continue
      const fn = typeof n.fieldNameForChild === "function" ? n.fieldNameForChild(i) : null
      if (fn) fields.push(`${fn}=${c.type}`) }
    console.log("  " + "  ".repeat(d) + n.type + (n.isNamed ? "" : " (anon)") + (fields.length ? "  fields:[" + fields.join(", ") + "]" : "") + `  "${n.text.split("\n")[0].slice(0,32)}"`)
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) walk(c, d + 1) }
  }
  walk(t.rootNode)
}
main()
