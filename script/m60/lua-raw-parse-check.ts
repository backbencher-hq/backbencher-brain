// Is the A/B actually loading TWO different parsers, or is the second one
// silently the first? The falsification run said two builds with different ABI
// and different parseOk produce identical verdicts, which is not credible.
import { readFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"
import { loadWebTreeSitter, resolveWasmAsset } from "../../src/util/wasm"
import { join } from "node:path"
const CORPUS = "$HOME/fixtures/repositories"
async function main(): Promise<void> {
  const mod: any = await loadWebTreeSitter()
  await parseFile(join(CORPUS, "luvit", "init.lua"), CORPUS)
  const src = readFileSync("$HOME/fixtures/repositories/kong/kong/runloop/handler.lua", "utf8")
  for (const [label, p] of [
    ["wired", resolveWasmAsset("tree-sitter-lua.wasm")],
    ["npm-0.4.1", "$HOME/fixtures/grammars/npm-0.4.1.wasm"],
    ["tswasms-0.1.13", "$HOME/fixtures/grammars/tswasms-0.1.13-lua.wasm"],
  ] as const) {
    const lang: any = await mod.Language.load(p)
    const parser = new mod.Parser()
    parser.setLanguage(lang)
    const t = parser.parse(src)
    console.log(`  ${label.padEnd(18)} abi=${lang.abiVersion} fields=${lang.fieldCount} hasError=${t.rootNode.hasError} rootChildren=${t.rootNode.namedChildCount}`)
  }
}
main()
