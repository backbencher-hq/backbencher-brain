// LUA-G2: what does the wired tree-sitter-lua.wasm DECLARE about itself?
//
// A wasm language module carries its own identity (name, ABI, semantic version,
// node-kind count) as data the loader reads at runtime. That is a different
// question from "which package published these bytes" — and it is the question
// that can be answered from the artifact alone, with no registry and no network.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { loadWebTreeSitter, resolveWasmAsset } from "../../src/util/wasm"
import { parseFile } from "../../src/ast/pool-worker"
import { join } from "node:path"

const CORPUS = "$HOME/fixtures/repositories"
const CANDIDATES: Array<[string, string]> = [
  ["wired (wasm/tree-sitter-lua.wasm)", resolveWasmAsset("tree-sitter-lua.wasm")],
  ["@tree-sitter-grammars/…@0.4.1", "$HOME/fixtures/grammars/npm-0.4.1.wasm"],
  ["tree-sitter-wasms@0.1.13", "$HOME/fixtures/grammars/tswasms-0.1.13-lua.wasm"],
]

async function main(): Promise<void> {
  const mod: any = await loadWebTreeSitter()
  await parseFile(join(CORPUS, "luvit", "init.lua"), CORPUS)
  const out: any[] = []
  for (const [label, p] of CANDIDATES) {
    const bytes = readFileSync(p)
    const rec: any = {
      label,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }
    try {
      const lang: any = await mod.Language.load(p)
      rec.declared = {
        name: lang.name ?? null,
        abiVersion: lang.abiVersion ?? lang.version ?? null,
        semanticVersion: lang.semanticVersion ?? null,
        nodeKindCount: lang.nodeKindCount ?? lang.node_kind_count ?? null,
        fieldCount: lang.fieldCount ?? lang.field_count ?? null,
        stateCount: lang.stateCount ?? null,
      }
      // The enumerable surface the pin contract asks for, measured through
      // web-tree-sitter rather than read out of the file.
      const parser = new mod.Parser()
      parser.setLanguage(lang)
      const tree = parser.parse("local a = 1\n")
      rec.parseOk = tree.rootNode.type === "chunk" && !tree.rootNode.hasError
    } catch (e: any) {
      rec.declared = { error: String(e?.message ?? e).slice(0, 120) }
    }
    out.push(rec)
  }
  console.log(JSON.stringify(out, null, 2))
  const wired = out[0]
  console.log("\n=== identity comparison ===")
  for (const r of out.slice(1)) {
    const same = JSON.stringify(wired.declared) === JSON.stringify(r.declared)
    console.log(`  wired vs ${r.label}: declared-identity ${same ? "IDENTICAL" : "DIFFERS"}`)
    if (!same) {
      for (const k of new Set([...Object.keys(wired.declared ?? {}), ...Object.keys(r.declared ?? {})])) {
        const a = (wired.declared ?? {})[k]
        const b = (r.declared ?? {})[k]
        if (JSON.stringify(a) !== JSON.stringify(b)) console.log(`      ${k}: wired=${JSON.stringify(a)}  other=${JSON.stringify(b)}`)
      }
    }
  }
}
main()
