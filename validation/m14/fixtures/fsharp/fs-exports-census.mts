// F# `exports` — the CORPUS MEASUREMENT.
//
// Two questions, one pass over the corpus, programmatic tree walk (no regex anywhere):
//
//   A. GRAMMAR: does the wired grammar produce an export DECLARATION node, and what are the
//      counts of the constructs an export surface could be read off (module/namespace scopes,
//      their declarations, `access_modifier`, `.fsi` signature declarations, `[<CompiledName>]`)?
//   B. PAYLOAD: the analyzer already computes an export surface (FS-D8, `res.exports`). How many
//      entries does it produce, in how many files, of which kinds and visibilities, and what
//      would the EDGE (source -> target) be if the surface were emitted as a relationship?
//
// Run: bun .tmp-probe/fsharp-lane/fs-exports-census.mts [maxFiles]
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const REPO = "/home/ishaq2321/mcp/backbencher-brain"
const CORPUS = process.env.FS_CORPUS || "/home/ishaq2321/bb_tests/repositories/fsharp"
const MAXFILES = Number(process.argv[2] || process.env.NFILES || 0) // 0 = all
const CAP = 512 * 1024

const { getParser } = await import(`${REPO}/src/ast/engine.ts`)
const { RealFsharpAnalyzer } = await import(`${REPO}/src/ast/real-fsharp-analyzer.ts`)

function walk(dir, out) {
  let ents
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(fs|fsi|fsx)$/.test(e.name)) {
      try { if (statSync(p).size <= CAP) out.push(p) } catch {}
    }
  }
  return out
}

const all = walk(CORPUS, [])
const files = MAXFILES > 0 ? all.filter((_, i) => i % Math.ceil(all.length / MAXFILES) === 0).slice(0, MAXFILES) : all
console.log(`corpus ${CORPUS}: ${all.length} .fs/.fsi/.fsx <=512KB, measuring ${files.length}`)

// grammar inventory + payload tallies
const nodeCount = new Map()
const accessKeyword = new Map()
const compiledNameSites = { nodes: 0, files: new Set() }
const payloadKind = new Map()
const payloadVis = new Map()
const wouldBeEdge = { entries: 0, withOwner: 0, ownerIsModule: 0, ownerIsNamespace: 0, ownerIsType: 0, noOwner: 0, targetsResolvedToSymbol: 0, targetIsFqn: 0 }
const perFile = []
const samples = []
let parsed = 0, failed = 0, extCount = new Map()

const parser = await getParser("fsharp")
const analyzer = new RealFsharpAnalyzer()

for (const f of files) {
  const content = readFileSync(f, "utf8")
  let root
  try { root = (await parser.parse(content, f)).rootNode } catch { failed++; continue }
  parsed++

  // ── A. the tree walk, every node, node types only (the grammar's own vocabulary)
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    nodeCount.set(n.type, (nodeCount.get(n.type) ?? 0) + 1)
    if (n.type === "access_modifier") {
      const kw = content.slice(n.startIndex, n.endIndex).trim()
      accessKeyword.set(kw, (accessKeyword.get(kw) ?? 0) + 1)
    }
    for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
  }

  // [<CompiledName("X")>] — read off the tree: an `attribute` whose name is CompiledName.
  // (No regex: the attribute's name node is a `long_identifier`/`identifier` child.)
  const stack2 = [root]
  let sawCompiled = false
  while (stack2.length) {
    const n = stack2.pop()
    if (n.type === "attribute") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c.type === "long_identifier" || c.type === "identifier") {
          if (content.slice(c.startIndex, c.endIndex) === "CompiledName") sawCompiled = true
          break
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) stack2.push(n.namedChild(i))
  }
  if (sawCompiled) { compiledNameSites.nodes++; compiledNameSites.files.add(f) }

  // ── B. the analyzer's own export surface
  let res
  try { res = analyzer.analyze(root, content, f) } catch { continue }
  const ex = res.exports ?? []
  extCount.set(f.slice(f.lastIndexOf(".")), (extCount.get(f.slice(f.lastIndexOf("."))) ?? 0) + 1)
  const symByLine = new Map()
  for (const s of res.symbols ?? []) {
    const k = `${s.name}@${s.range?.startLine}`
    if (!symByLine.has(k)) symByLine.set(k, s)
  }
  for (const e of ex) {
    payloadKind.set(e.kind, (payloadKind.get(e.kind) ?? 0) + 1)
    const v = e.visibility ?? "(none)"
    payloadVis.set(v, (payloadVis.get(v) ?? 0) + 1)
    wouldBeEdge.entries++
    const s = symByLine.get(`${e.name}@${e.range?.startLine}`)
    if (!s) continue
    wouldBeEdge.targetsResolvedToSymbol++
    const fqn = s.metadata?.fqn
    if (fqn) wouldBeEdge.targetIsFqn++
    if (!s.ownerName) wouldBeEdge.noOwner++
    else if (s.metadata?.ownerKind === "module") wouldBeEdge.ownerIsModule++
    else wouldBeEdge.ownerIsModule++ // owner kinds are not on the symbol; counted below instead
  }
  perFile.push([f.slice(CORPUS.length + 1), ex.length, (res.symbols ?? []).length])
  if (samples.length < 25 && ex.length > 0) {
    samples.push({
      file: f.slice(CORPUS.length + 1),
      exports: ex.slice(0, 8).map((e) => ({ name: e.name, kind: e.kind, vis: e.visibility })),
    })
  }
}

// ── the export-surface constructs, from the node census
const exportDeclWords = ["export_list", "export_declaration", "module_export", "export_stmt", "export_spec", "exported_item"]
const exportDeclPresent = exportDeclWords.map((w) => [w, nodeCount.get(w) ?? 0])
const allExportNodes = [...nodeCount.keys()].filter((t) => t.includes("export")).map((t) => [t, nodeCount.get(t)])

const kindRows = [...payloadKind.entries()].sort((a, b) => b[1] - a[1])
const totalExports = [...payloadKind.values()].reduce((a, b) => a + b, 0)
const filesWithExports = perFile.filter((r) => r[1] > 0).length

const report = {
  corpus: CORPUS,
  population: { filesOnDisk: all.length, filesMeasured: files.length, parsed, failed },
  byExtension: Object.fromEntries(extCount),
  grammar: {
    distinctNodeTypes: nodeCount.size,
    exportDeclarationCandidates: Object.fromEntries(exportDeclPresent),
    nodeTypesContainingExport: Object.fromEntries(allExportNodes),
    accessModifier: Object.fromEntries(accessKeyword),
    compiledNameAttributeSites: compiledNameSites.nodes,
    compiledNameAttributeFiles: compiledNameSites.files.size,
  },
  payload: {
    entries: totalExports,
    filesWithPayload: filesWithExports,
    filesWithPayloadPct: +((100 * filesWithExports) / Math.max(1, parsed)).toFixed(1),
    byKind: Object.fromEntries(kindRows),
    byVisibility: Object.fromEntries([...payloadVis.entries()].sort((a, b) => b[1] - a[1])),
    entriesMappedToTheirSymbol: wouldBeEdge.targetsResolvedToSymbol,
  },
  samples,
}
writeFileSync(`${REPO}/.tmp-probe/fsharp-lane/fs-exports-census.json`, JSON.stringify(report, null, 2))

console.log(`parsed ${parsed}/${files.length} (failed ${failed}); distinct node types ${nodeCount.size}`)
console.log(`export-declaration candidate nodes: ${JSON.stringify(Object.fromEntries(exportDeclPresent))}`)
console.log(`node types whose NAME contains "export": ${allExportNodes.length ? JSON.stringify(Object.fromEntries(allExportNodes)) : "(none)"}`)
console.log(`access_modifier: ${JSON.stringify(Object.fromEntries(accessKeyword))}`)
console.log(`[<CompiledName>] attribute sites: ${compiledNameSites.nodes} in ${compiledNameSites.files.size} files`)
console.log(`export PAYLOAD: ${totalExports} entries in ${filesWithExports}/${parsed} files (${report.payload.filesWithPayloadPct}%)`)
console.log(`  by kind: ${JSON.stringify(Object.fromEntries(kindRows))}`)
console.log(`  by visibility: ${JSON.stringify(Object.fromEntries(payloadVis))}`)
