/**
 * SWIFT DANGLING-ENDPOINT PROBE — how many relationship endpoints name a symbol
 * the PRODUCTION entry point deleted?
 *
 * WHY THIS EXISTS. The lane's R7 question ("do both endpoints resolve to real
 * symbols?") came back with a number that did not fit any explanation the
 * analyzer could offer: `contains` resolved at both ends for 27,291 of 27,330
 * edges, and the 39 that did not were all endpoints spelled `unknown` or `self`.
 * Reading the analyzer showed it CREATES those symbols — calling
 * `RealSwiftAnalyzer.analyze` directly on
 * swift-nio/Sources/NIOCore/SocketAddresses.swift returns 99 symbols including
 * `unknown:enum_member@SocketAddressError`, while the production `parseFile`
 * returns 98 without it.
 *
 * The difference is `keepSymbol` in `src/ast/pool-worker.ts` (MASTER-owned, not
 * this lane's to change). Its UNIVERSAL denylist holds
 *
 *     this, super, self, Self, me, My, destructor, root, program,
 *     source_file, module_declaration, package_manifest, GlobalScope,
 *     SCSS_FILE_SCOPE, unknown
 *
 * under the comment "language keywords / conventions and synthetic tree-sitter
 * artifact names — never legitimate declarations in any language". For Swift
 * that last clause is measurably false: `case unknown` and `case \`self\`` are
 * ordinary Swift enum cases, and `unknown` is not a Swift keyword (Swift's
 * reserved words include `nil`, not `unknown`). The filter drops the symbol; the
 * analyzer's `contains` edge naming it was already built and survives, so the
 * stored graph carries an edge whose target is not in the symbol index.
 *
 * That is the failure the workstream calls out by name — a fabricated endpoint
 * poisons bb_graph and bb_impact — except here the edge is true about the SOURCE
 * and false about the INDEX. Either way a consumer cannot join it.
 *
 * This probe imports the PRODUCTION `keepSymbol` and applies it to the symbols
 * the analyzer produced, so the count is the filter's real behaviour rather than
 * a restatement of its source. It then measures, per dropped name:
 *
 *   1. how many symbols the filter deleted, in how many files
 *   2. how many relationship edges NAME a deleted symbol (the dangling count)
 *   3. which types those edges are, and whether the other endpoint survives
 *
 * WRITES validation/m14/tmp/swift-dangling-endpoints.json. Nothing else.
 *
 * Usage: bun script/m14/swift-dangling-endpoint-probe.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile, keepSymbol } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = "validation/m14/tmp/swift-dangling-endpoints.json"
const REPOS = [
  { repo: "swift-nio", cap: Number.POSITIVE_INFINITY },
  { repo: "alamofire", cap: Number.POSITIVE_INFINITY },
  { repo: "swift-corpus", cap: 600 },
]

function admittedFiles(repo: string, cap: number): string[] {
  const dir = path.join(CR, repo)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { return [] }
  const out: string[] = []
  for (const rel of tracked) {
    if (!rel.endsWith(".swift")) continue
    try { const st = statSync(path.join(dir, rel)); if (st.isFile() && st.size > 0) out.push(rel) } catch { continue }
  }
  return out.slice(0, cap)
}

interface FileRef { repo: string; rel: string; abs: string; dir: string }
const files: FileRef[] = []
const pins: Record<string, string> = {}
for (const { repo, cap } of REPOS) {
  const rels = admittedFiles(repo, cap)
  if (rels.length === 0) { console.error(`! corpus missing or empty: ${repo}`); process.exit(2) }
  try { pins[repo] = execFileSync("git", ["-C", path.join(CR, repo), "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { pins[repo] = "unknown" }
  for (const rel of rels) files.push({ repo, rel, abs: path.join(CR, repo, rel), dir: path.join(CR, repo) })
}
console.log(`swift dangling-endpoint probe — ${files.length} files`)

// The analyzer's own view of the file, so the dropped set is the analyzer's
// symbols MINUS what production keeps — not a guess from a denylist copy.
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-swift.wasm"))))
const { RealSwiftAnalyzer } = await import("../../src/ast/real-swift-analyzer")

// Keyed by `name|side|type`, because the two reasons an edge can name a deleted
// symbol are different and must not be added together:
//
//   * a REAL declaration whose name the denylist deleted (`unknown`, `self`,
//     `destructor`, and a type or property literally named `root`) — the edge is
//     true about the source and unjoinable in the index;
//   * the FILE-SCOPE PLACEHOLDER. This analyzer spells a file-level edge
//     `root -> <name>` for `references`, `imports` and `exports`, and `root` is
//     on the same denylist. `root` as the SOURCE of one of those three is the
//     declared convention, not a deleted symbol; `root` as the TARGET of a
//     `contains` edge is a property named `root`.
const droppedByName = new Map<string, { symbols: number; files: Set<string>; edges: number; edgeTypes: Record<string, number>; examples: string[] }>()
let totalSymbolsFromAnalyzer = 0, totalSymbolsDropped = 0, totalEdgesNamingDropped = 0, filesWithDropped = 0
// The file-scope placeholder reading of an edge, separated from the dangling one.
const FILE_LEVEL_TYPES = new Set(["references", "imports", "exports"])
const placeholderEdges = { count: 0, byType: {} as Record<string, number> }
const danglingEdges: Array<{ name: string; side: string; type: string; file: string; line: number | null; source: string; target: string }> = []

let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const label = `${f.repo}/${f.rel}`
    let content: string
    try { content = readFileSync(f.abs, "utf8") } catch { continue }
    let analyzed: any
    try {
      const tree = parser.parse(content)
      if (!tree) continue
      analyzed = new RealSwiftAnalyzer().analyze(tree.rootNode as any, content, f.abs)
      tree.delete?.()
    } catch { continue }

    const droppedNames = new Set<string>()
    for (const s of analyzed.symbols ?? []) {
      totalSymbolsFromAnalyzer++
      if (keepSymbol(s, "swift")) continue
      totalSymbolsDropped++
      droppedNames.add(String(s.name ?? ""))
      const e = droppedByName.get(String(s.name ?? "")) ?? { symbols: 0, files: new Set<string>(), edges: 0, edgeTypes: {}, examples: [] }
      e.symbols++
      e.files.add(label)
      droppedByName.set(String(s.name ?? ""), e)
    }
    if (droppedNames.size > 0) filesWithDropped++
    for (const rel of analyzed.relationships ?? []) {
      const src = String(rel.source ?? "")
      const tgt = String(rel.target ?? "")
      const ty = String(rel.type ?? rel.relationshipType ?? "")
      const line = typeof rel.line_number === "number" ? rel.line_number : null
      for (const side of ["source", "target"] as const) {
        const v = side === "source" ? src : tgt
        if (!droppedNames.has(v)) continue
        // `root` as the SOURCE of a file-level kind is the placeholder this
        // analyzer declares, not a symbol the filter took away.
        const isPlaceholder = v === "root" && side === "source" && FILE_LEVEL_TYPES.has(ty)
        if (isPlaceholder) {
          placeholderEdges.count++
          placeholderEdges.byType[ty] = (placeholderEdges.byType[ty] ?? 0) + 1
          continue
        }
        totalEdgesNamingDropped++
        danglingEdges.push({ name: v, side, type: ty, file: label, line, source: src, target: tgt })
        const e = droppedByName.get(v)!
        e.edges++
        e.edgeTypes[ty] = (e.edgeTypes[ty] ?? 0) + 1
        if (e.examples.length < 6) e.examples.push(`${label}:${rel.line_number ?? "-"} ${ty} '${src}' -> '${tgt}' (${side}='${v}')`)
      }
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

const out = {
  at: new Date().toISOString(),
  instrument: "script/m14/swift-dangling-endpoint-probe.ts",
  corpus: { root: CR, repos: Object.entries(pins).map(([repo, pin]) => ({ repo, pin })), files: files.length },
  question: "how many relationship endpoints name a symbol the production entry point deleted?",
  where: "src/ast/pool-worker.ts `keepSymbol` — the UNIVERSAL denylist, which is MASTER-owned. This lane measured it and did not change it.",
  totals: {
    symbolsTheAnalyzerProduced: totalSymbolsFromAnalyzer,
    symbolsProductionKeeps: totalSymbolsFromAnalyzer - totalSymbolsDropped,
    symbolsDeletedByKeepSymbol: totalSymbolsDropped,
    filesWithADeletedSymbol: filesWithDropped,
    relationshipEdgesNamingADeletedDeclaration: totalEdgesNamingDropped,
    fileScopePlaceholderEdgesNotCountedAsDangling: placeholderEdges,
  },
  danglingByNameAndSide: (() => {
    const m = new Map<string, number>()
    for (const d of danglingEdges) {
      const k = `${d.name} as ${d.side} of a ${d.type} edge`
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]))
  })(),
  danglingEdges,
  byName: Object.fromEntries([...droppedByName.entries()].sort((a, b) => b[1].edges - a[1].edges || b[1].symbols - a[1].symbols).map(([k, v]) => [k, {
    symbolsDeleted: v.symbols, files: v.files.size, danglingEdgesNamingIt: v.edges, edgeTypes: v.edgeTypes, examples: v.examples,
  }])),
}
writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(`wrote ${OUT}\n`)
console.log(`symbols the analyzer produced:      ${totalSymbolsFromAnalyzer.toLocaleString()}`)
console.log(`deleted by production keepSymbol:   ${totalSymbolsDropped} in ${filesWithDropped} files`)
console.log(`file-scope placeholder edges (excluded, by design): ${placeholderEdges.count} ${JSON.stringify(placeholderEdges.byType)}`)
console.log(`DANGLING edges naming a deleted declaration: ${totalEdgesNamingDropped}`)
for (const [k, v] of Object.entries(out.danglingByNameAndSide)) console.log(`  ${k}: ${v}`)
for (const [k, v] of Object.entries(out.byName)) {
  console.log(`  '${k}': ${v.symbolsDeleted} symbol(s) deleted in ${v.files} file(s); ${v.danglingEdgesNamingIt} dangling edge(s) ${JSON.stringify(v.edgeTypes)}`)
  for (const e of v.examples.slice(0, 3)) console.log(`      ${e}`)
}
