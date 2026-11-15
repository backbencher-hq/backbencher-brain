// cpp-uses-ab.ts — one file, both trees: which `uses` targets does the analyzer
// emit, and which names does it publish as symbols? Run in the repo (current
// analyzer) and in /tmp/cpp-head (HEAD's analyzer) and diff the output.
//
//   bun script/m14/tmp/cpp-uses-ab.ts <abs path to .h/.cc/.cpp>
//
// Why: the fmt full extent lost 7 covered reads when the declarator-chain guard
// landed (MISSING 0 -> 7 at the SAME sample hash). The guard refuses to mint a
// FUNCTION's name as a value symbol — so first establish, per name, whether the
// read path (isResolvableRead: fileScopeValues / namespaceValues / classMembers)
// or the symbol path is what changed.
import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"

import { fileURLToPath } from "node:url"
const __filename = fileURLToPath(import.meta.url)

const HERE = (import.meta as any).dir ?? path.dirname(path.dirname((import.meta as any).filename ?? __filename))
const ROOT = path.resolve(HERE, "..", "..", "..")
const target = path.resolve(process.argv[2])
const content = fs.readFileSync(target, "utf8")

const { LANGS } = await import(`${ROOT}/script/m14/differential.ts`)
const cfg = LANGS.cpp

await (Parser as any).init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
const parser = new Parser()
parser.setLanguage(grammar)
const root = parser.parse(content).rootNode

const mod: any = await import(`${ROOT}/src/ast/${cfg.analyzerFile}`)
const analyzer = new mod[cfg.className]()
const result = await analyzer.analyze(root, content, path.basename(target))

type R = { type?: string; relationshipType?: string; source?: string; target?: string; line_number?: number }
const rels = (result.relationships ?? []) as R[]
const lab = (r: R) => String(r.type ?? r.relationshipType ?? "")
const uses = new Map<string, number>()
for (const r of rels) if (lab(r) === "uses") uses.set(String(r.target), (uses.get(String(r.target)) ?? 0) + 1)
if (process.argv.includes("--edges")) {
  for (const r of rels.filter((x) => lab(x) === "uses")) console.log(`EDGE ${String(r.target)}\tfrom=${r.source}\tline=${r.line_number}`)
}
const counts = new Map<string, number>()
for (const r of rels) counts.set(lab(r), (counts.get(lab(r)) ?? 0) + 1)

console.log(`# file=${path.basename(target)} rels=${rels.length}`)
console.log(`# labels ${[...counts].sort().map(([k, v]) => `${k}=${v}`).join(" ")}`)
console.log(`# uses targets (${uses.size}):`)
for (const [t, n] of [...uses].sort()) console.log(`${t}\t${n}`)
console.log(`# symbols (${(result.symbols ?? []).length}):`)
const names = ((result.symbols ?? []) as any[]).map((s) => `${s.kind}:${s.name}${s.ownerName ? `@${s.ownerName}` : ""}${s.ownerKind ? `(${s.ownerKind})` : ""}`).sort()
for (const n of names) console.log(n)
