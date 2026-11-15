// FS000 — the fsharp lane's grammar surface: the real node types, the real fields,
// and the diff against every node-type literal the analyzer references.
//
// WHY: the lane has no differential, no fixture lane, no spec, and no mutants, so
// every claim about it starts from "which grammar shapes actually exist". This is
// the reference read straight off the wired wasm, through the same API F1 uses.
//
// Run: bun script/m14/tmp/fs000-node-types.ts [--write <dir>]
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "../../..")
const OUT = (() => {
  const i = process.argv.indexOf("--write")
  return i >= 0 ? process.argv[i + 1] : "/tmp/opencode"
})()

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })

  const out: Record<string, any> = {}
  for (const [label, file] of [
    ["fsharp", "tree-sitter-fsharp.wasm"],
    ["fsharp_signature", "tree-sitter-fsharp_signature.wasm"],
  ] as const) {
    const wasmPath = path.join(ROOT, "wasm", file)
    if (!fs.existsSync(wasmPath)) { console.log(`${label}: ABSENT (${file})`); continue }
    const g = await Language.load(fs.readFileSync(wasmPath))
    const named: string[] = []
    const anon: string[] = []
    for (let i = 0; i < g.nodeTypeCount; i++) {
      const n = g.nodeTypeForId(i)
      if (n == null) continue
      ;(g.nodeTypeIsNamed(i) ? named : anon).push(n)
    }
    const fields: string[] = []
    for (let i = 1; i <= g.fieldCount; i++) {
      const f = g.fieldNameForId(i)
      if (f != null) fields.push(f)
    }
    named.sort(); anon.sort(); fields.sort()
    out[label] = { named, anon, fields, nodeTypeCount: g.nodeTypeCount, fieldCount: g.fieldCount, version: g.version, abi: g.abiVersion }
    console.log(`${label}: named ${named.length}, anon ${anon.length}, fields ${fields.length}, abi ${g.abiVersion}, grammarVersion ${g.version}`)
  }

  fs.mkdirSync(OUT, { recursive: true })
  for (const [label, data] of Object.entries(out)) {
    fs.writeFileSync(path.join(OUT, `fs-${label}-nodetypes.json`), JSON.stringify(data, null, 1))
  }
  console.log(`wrote to ${OUT}`)
}
void main()
