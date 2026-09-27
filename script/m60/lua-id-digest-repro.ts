// Is a node-id-order digest a REPRODUCIBLE property of a build? Parse the same
// file twice with the SAME build and compare. If two parses of one build differ,
// then a difference between two builds proves nothing and the digest must be
// dropped rather than reported.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"
import { loadWebTreeSitter, resolveWasmAsset } from "../../src/util/wasm"
import { join } from "node:path"
const CORPUS = "$HOME/fixtures/repositories"
async function main(): Promise<void> {
  const mod: any = await loadWebTreeSitter()
  await parseFile(join(CORPUS, "luvit", "init.lua"), CORPUS)
  const lang: any = await mod.Language.load(resolveWasmAsset("tree-sitter-lua.wasm"))
  const src = readFileSync("$HOME/fixtures/repositories/kong/kong/runloop/handler.lua", "utf8")
  const digests: string[] = []
  const idSeqs: number[][] = []
  for (let run = 0; run < 3; run++) {
    const p = new mod.Parser(); p.setLanguage(lang)
    const t = p.parse(src)
    const ids: number[] = []
    const st = [t.rootNode]
    while (st.length) { const n = st.pop(); ids.push(n.id); for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) } }
    digests.push(createHash("sha256").update(ids.join(",")).digest("hex").slice(0, 16))
    idSeqs.push(ids)
    t.delete()
  }
  console.log("  three parses of the SAME build, same file:")
  digests.forEach((d, i) => console.log(`    run ${i}: ${d}  first5ids=[${idSeqs[i].slice(0, 5)}]  last5ids=[${idSeqs[i].slice(-5)}]`))
  const allSame = digests.every((d) => d === digests[0])
  console.log(`\n  reproducible across parses of one build? ${allSame ? "YES" : "NO — the digest is a PARSE artifact, not a build property"}`)
}
main()
