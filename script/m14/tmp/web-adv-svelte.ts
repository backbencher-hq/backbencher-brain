// Adversarial deep-dive (web closure, #841 style): minimal reconstructions of
// the svelte census residual families. The analyzer always emits the component
// symbol; extraction loss shows as (a) zero symbols — the groovy whole-file
// class, or (b) missing script symbols / relationships a correct parse would
// surface. Run: bun script/m14/tmp/web-adv-svelte.ts
import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { parseFile } from "../../../src/ast/pool-worker"

const CASES: Array<[string, string, { scriptSyms: string[]; rels: Array<[string, string]> }]> = [
  ["attach:arrow-inline", `<script>\n  const fn = () => {}\n</script>\n<div {@attach (node) => {}}></div>\n`, { scriptSyms: ["fn"], rels: [] }],
  ["attach:identifier", `<script>\n  import { myAttachment } from "./x.js"\n</script>\n<div {@attach myAttachment}></div>\n`, { scriptSyms: ["myAttachment"], rels: [["T", "myAttachment"]] }],
  ["attach:call", `<script>\n  import { createAttachment } from "./x.js"\n</script>\n<Child {@attach createAttachment(attachment)} />\n`, { scriptSyms: ["createAttachment"], rels: [] }],
  ["comment-in-tag", `<div\n\t// a line comment\n\tdata-two="2"\n>content</div>\n`, { scriptSyms: [], rels: [] }],
  ["generic-snippet", `<script lang="ts">\n  let val = 1\n</script>\n{#snippet complex_generic<T extends { bracket: "<" } | "<" | Set<"<>">>(val: T)}\n  {val}\n{/snippet}\n`, { scriptSyms: ["val"], rels: [] }],
  ["each-index-number", `{#each Array(10), i}\n  {i}\n{/each}\n`, { scriptSyms: [], rels: [] }],
  ["each-index-object", `{#each { length: 1 }, index}\n  {index}\n{/each}\n`, { scriptSyms: [], rels: [] }],
  ["each-bare", `<script>\n  const arr = [1]\n</script>\n{#each arr}\n  x\n{/each}\n`, { scriptSyms: ["arr"], rels: [] }],
  ["script-self-closing", `<script the-answer="42"/>\n`, { scriptSyms: [], rels: [] }],
  ["declaration-tag-division", `{const regex = /[}]}/}\n`, { scriptSyms: [], rels: [] }],
]

async function main() {
  const rows: any[] = []
  for (const [name, src, expected] of CASES) {
    const p = join(tmpdir(), `web-adv-svelte-${name.replace(/[^a-z0-9-]/gi, "_")}.svelte`)
    writeFileSync(p, src)
    let treeErr = 0
    try {
      const parser = await ASTEngine.getParser("svelte")
      const tree = parser.parse(src)
      if ((tree.rootNode as any).hasError) {
        const stack = [tree.rootNode]
        while (stack.length) {
          const n = stack.pop()!
          if (n.type === "ERROR" || n.isMissing) treeErr++
          for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
        }
      }
    } catch { treeErr = -1 }
    let symbols: any[] = []
    let relationships: any[] = []
    let pipelineErr = 0
    let note = ""
    try {
      const parsed = await parseFile(p, process.cwd())
      symbols = parsed.symbols ?? []
      relationships = parsed.relationships ?? []
      pipelineErr = (parsed.errors ?? []).length
    } catch (e: any) { note = String(e?.message ?? e).slice(0, 80) }
    const names = new Set(symbols.map((s: any) => s.name))
    const missingSyms = expected.scriptSyms.filter((n) => !names.has(n))
    const relPairs = new Set(relationships.map((r: any) => `${r.source}->${r.target}`))
    const missingRels = expected.rels.filter(([s, t]) => !relPairs.has(`${s}->${t}`))
    // component symbol (T = module basename) is always emitted; total-loss = symbols <= 1 with expected syms
    const totalLoss = symbols.length === 0
    rows.push({ case: name, grammarErrNodes: treeErr, pipelineErrors: pipelineErr, symbols: symbols.length, relationships: relationships.length, totalLoss, missingSyms, missingRels })
    console.log(
      `${name.padEnd(24)} grammarErr=${String(treeErr).padStart(3)} pipeErr=${pipelineErr} syms=${symbols.length} rels=${relationships.length}` +
      `${totalLoss ? " TOTAL-LOSS" : ""}${missingSyms.length ? " MISSING:" + missingSyms.join(",") : ""}${missingRels.length ? " MISSING-REL:" + missingRels.map(([s, t]) => `${s}->${t}`).join(",") : ""} ${note}`,
    )
  }
  console.log(JSON.stringify(rows, null, 1))
}
main().catch((e) => { console.error(e); process.exit(1) })
