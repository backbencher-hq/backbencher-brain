/**
 * script/m14/tmp/pin-surface-vs-nodetypes.ts
 *
 * Before the pin can gate on "the wired wasm is a build of the vendored source",
 * the two sides must be compared in a vocabulary they share. This probe prints,
 * for a language, the wasm's enumerable surface (every id, its name, whether
 * web-tree-sitter calls it named) against the vendored `src/node-types.json` and
 * `src/grammar.json` (supertypes are declared there but are NOT enumerable node
 * types in a built parser — the haskell grammar declares 14).
 *
 * Usage: bun script/m14/tmp/pin-surface-vs-nodetypes.ts haskell
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dir ?? path.dirname(Bun.main), "..", "..", "..")
const LANG = process.argv[2] ?? "haskell"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const g = await Language.load(fs.readFileSync(path.join(ROOT, `wasm/tree-sitter-${LANG}.wasm`)))

  const named: string[] = []
  const anon: string[] = []
  const all: Array<{ id: number; name: string; named: boolean }> = []
  for (let i = 0; i < g.nodeTypeCount; i++) {
    const name = String(g.nodeTypeForId(i) ?? "")
    const isNamed = !!g.nodeTypeIsNamed(i)
    all.push({ id: i, name, named: isNamed })
    if (isNamed) named.push(name)
    else anon.push(name)
  }
  const ntPath = path.join(ROOT, `grammars/tree-sitter-${LANG}/src/node-types.json`)
  const nt = JSON.parse(fs.readFileSync(ntPath, "utf8")) as any[]
  const ntNamed = new Set<string>()
  const ntSuper = new Set<string>()
  for (const e of nt) {
    if (e.named && typeof e.type === "string") ntNamed.add(e.type)
    if (Array.isArray(e.subtypes)) ntSuper.add(e.type)
  }
  const grPath = path.join(ROOT, `grammars/tree-sitter-${LANG}/src/grammar.json`)
  const supertypes: string[] = JSON.parse(fs.readFileSync(grPath, "utf8")).supertypes ?? []

  const wasmNamedSet = new Set(named)
  const wasmAnonSet = new Set(anon)
  console.log(`${LANG}: wasm ids=${g.nodeTypeCount} named=${named.length} (unique ${wasmNamedSet.size}) anon=${anon.length} (unique ${wasmAnonSet.size})`)
  console.log(`node-types.json: named=${ntNamed.size} subtype-headers=${ntSuper.size}; grammar.json supertypes=${supertypes.length}`)
  const inNtNotWasm = [...ntNamed].filter((t) => !wasmNamedSet.has(t) && !wasmAnonSet.has(t))
  console.log(`declared in node-types.json, absent from the wasm surface entirely (${inNtNotWasm.length}): ${inNtNotWasm.join(", ")}`)
  console.log(`  of those, declared supertypes: ${inNtNotWasm.filter((t) => supertypes.includes(t)).length}`)
  const namedNotInNt = named.filter((t) => !ntNamed.has(t))
  console.log(`wasm-named, not declared named in node-types.json (${namedNotInNt.length}): ${namedNotInNt.slice(0, 40).join(", ")}`)
  const anonThatAreRules = anon.filter((t) => /^[a-z_][a-z0-9_]*$/.test(t))
  console.log(`wasm-anonymous with identifier-like names (${anonThatAreRules.length}): ${anonThatAreRules.slice(0, 40).join(", ")}`)
  console.log(`first 20 ids: ${all.slice(0, 20).map((a) => `${a.id}:${a.name}${a.named ? "" : "(anon)"}`).join(" ")}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
