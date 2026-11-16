// Post-rewrite corpus re-measurement. Same eight pinned corpora, same limits as the
// pre-rewrite census (script/m14/tmp/yaml-f8-census.ts and yaml-census.ts), so the two
// runs are comparable. Reports the defects that were claimed fixed, as counts.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CORPUS_ROOT = "<corpus-root>/bb_tests/repositories"
const REPOS = ["grails-core", "docker", "ansible", "kubernetes", "terraform", "openapi-spec", "helm", "gh-cli"]
const PER_REPO = Number(process.env.YAML_F8_PER_REPO ?? 250)

function walk(dir: string, out: string[], depth = 0): void {
  if (depth > 14) return
  let entries: fs.Dirent[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out, depth + 1)
    else if (/\.(ya?ml)$/i.test(e.name)) out.push(p)
  }
}

const EVIDENCE = new Set(["structural", "usage_contextual", "import_based", "reference_qualified", "inferred"])

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-yaml.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const mod: any = await import(path.join(ROOT, "src/ast/real-yaml-analyzer.ts"))

  const corpus: any[] = []
  let files = 0, symbols = 0, relationships = 0, imports = 0
  let filesWithDupIds = 0, totalDupIds = 0, emptyPathIds = 0
  let relWithLine = 0, relWithEvidenceClass = 0, subOneWithReason = 0, subOne = 0
  let symbolsWithDocstring = 0, symbolsWithComplexity = 0, symbolsWithApiContract = 0, symbolsWithQualifiedCalls = 0
  let sensitiveSymbols = 0
  let unknownSentinels = 0
  const relTypes = new Map<string, number>()
  const frameworks = new Map<string, number>()
  const evidenceClasses = new Map<string, number>()
  const qnameLengths: number[] = []
  const crashes: string[] = []
  const t0 = Date.now()

  for (const r of REPOS) {
    const list: string[] = []
    walk(path.join(CORPUS_ROOT, r), list)
    list.sort()
    let n = 0
    let cFiles = 0, cSyms = 0, cRels = 0, cImports = 0
    for (const f of list) {
      if (n >= PER_REPO) break
      let content: string
      try { content = fs.readFileSync(f, "utf8") } catch { continue }
      if (content.length > 4_000_000) continue
      n++
      const t = parser.parse(content)
      if (!t?.rootNode) { crashes.push(`${f}: no root`); continue }
      let res: any
      try {
        res = await new mod.RealYamlAnalyzer().analyze(t.rootNode, content, f)
      } catch (e: any) {
        crashes.push(`${f}: ${e?.message}`)
        continue
      }
      files++
      cFiles++
      const S = res.symbols ?? []
      const R = res.relationships ?? []
      symbols += S.length; cSyms += S.length
      relationships += R.length; cRels += R.length
      imports += (res.imports ?? []).length; cImports += (res.imports ?? []).length

      const ids = S.map((s: any) => String(s.id))
      const dups = ids.length - new Set(ids).size
      if (dups > 0) { filesWithDupIds++; totalDupIds += dups }
      if (ids.some((i: string) => i.startsWith("[") || i.includes("#damaged@") === false && i.startsWith("["))) emptyPathIds++

      for (const s of S) {
        qnameLengths.push(String(s.qualifiedName ?? s.id).length)
        if (typeof s.docstring === "string" && s.docstring.length > 0) symbolsWithDocstring++
        if (typeof s.complexity === "number" && s.complexity > 0) symbolsWithComplexity++
        if (typeof s.apiContractPath === "string") symbolsWithApiContract++
        if (Array.isArray(s.qualified_calls) && s.qualified_calls.length > 0) symbolsWithQualifiedCalls++
        if (s.metadata?.isSensitive === true) sensitiveSymbols++
        for (const v of Object.values(s.metadata ?? {})) {
          if (String(v) === "unknown") unknownSentinels++
          if (Array.isArray(v)) for (const x of v) if (String(x) === "unknown") unknownSentinels++
        }
      }
      for (const e of R) {
        relTypes.set(String(e.type), (relTypes.get(String(e.type)) ?? 0) + 1)
        if (typeof e.line_number === "number" && e.line_number >= 1) relWithLine++
        const ec = e.metadata?.evidenceClass
        if (EVIDENCE.has(ec)) { relWithEvidenceClass++; evidenceClasses.set(ec, (evidenceClasses.get(ec) ?? 0) + 1) }
        if (typeof e.confidence === "number" && e.confidence < 1) {
          subOne++
          if (typeof e.metadata?.confidenceReason === "string" && e.metadata.confidenceReason.length > 0) subOneWithReason++
        }
      }
      for (const fw of res.metadata?.detectedFrameworks ?? []) frameworks.set(fw, (frameworks.get(fw) ?? 0) + 1)
    }
    corpus.push({ repo: r, files: cFiles, symbols: cSyms, relationships: cRels, imports: cImports })
  }
  const wallMs = Date.now() - t0

  const sorted = [...qnameLengths].sort((a, b) => a - b)
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0

  console.log(JSON.stringify({
    at: new Date().toISOString(),
    perRepoLimit: PER_REPO,
    corpus,
    totals: { files, symbols, relationships, imports, wallMs, filesPerSecond: +(files / (wallMs / 1000)).toFixed(2), symbolsPerSecond: +(symbols / (wallMs / 1000)).toFixed(0), relationshipsPerSecond: +(relationships / (wallMs / 1000)).toFixed(0), crashes: crashes.length },
    defectsClaimedFixed: {
      "duplicateIds_files": filesWithDupIds,
      "duplicateIds_total": totalDupIds,
      "emptyParentPathIds": emptyPathIds,
      "relationshipsWithLine": `${relWithLine}/${relationships}`,
      "relationshipsWithEvidenceClass": `${relWithEvidenceClass}/${relationships}`,
      "subOneConfidenceEdges": subOne,
      "subOneWithReasonCode": subOneWithReason,
      "unknownSentinels": unknownSentinels,
    },
    newPayloads: {
      symbolsWithDocstring, symbolsWithComplexity, symbolsWithApiContract, symbolsWithQualifiedCalls, sensitiveSymbols, imports,
    },
    relationshipTypes: Object.fromEntries([...relTypes.entries()].sort((a, b) => b[1] - a[1])),
    evidenceClasses: Object.fromEntries([...evidenceClasses.entries()].sort((a, b) => b[1] - a[1])),
    frameworksDetected: Object.fromEntries([...frameworks.entries()].sort((a, b) => b[1] - a[1])),
    qualifiedNameLength: { p50: pct(50), p90: pct(90), p99: pct(99), p999: pct(99.9), max: sorted[sorted.length - 1] ?? 0 },
    crashSamples: crashes.slice(0, 10),
  }, null, 1))
}
main()
