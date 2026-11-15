// FS002 — the fsharp lane's PRODUCTION-ENTRY surface census (LANE-AUDIT-FORMULA
// dimensions 5, 7, 8): every symbol and relationship `ASTEngine.parseFile` publishes
// for real F# files, counted, with the anomalies named and located.
//
// WHAT IT MEASURES
//   D5 zero-unknown-symbols : unknown-kind, empty/placeholder names, members with no
//                             ownerName, and every file that yields NO symbol (each one
//                             checked for legitimacy).
//   D7 relationship ontology: every label emitted, the confidence histogram per label
//                             (the honesty contract §4: how much of this graph is
//                             guesswork must be a queryable number), and every edge whose
//                             endpoints are not names.
//   D8 line emission        : per label, edges with no line and edges with line 0.
//
// Every anomaly is reported with file:line so it is a worklist, not a number.
//
// Run:
//   BB_CORPUS_ROOT=... bun script/m14/tmp/fs002-surface-census.ts --repo fsharp --limit 400
//   ... --all --json /tmp/opencode/fs002.json
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "../../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const argOf = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined }
const LIMIT = parseInt(argOf("--limit") ?? "400")
const EXT = (argOf("--ext") ?? "fs,fsi,fsx").split(",")
const ALL = process.argv.includes("--all")
const REPOS = ALL
  ? fs.readdirSync(CORPUS_ROOT).filter((d) => { try { return fs.statSync(path.join(CORPUS_ROOT, d)).isDirectory() } catch { return false } })
  : [argOf("--repo") ?? "fsharp"]

const PLACEHOLDER = /^(unknown|undefined|null|none|nil|n\/a|\?|_+)$/i

function walk(dir: string, exts: string[], out: string[], cap: number): string[] {
  if (out.length >= cap) return out
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return out }
  for (const n of names) {
    if (out.length >= cap) return out
    if (n === ".git" || n === "node_modules" || n === "bin" || n === "obj" || n === "tests" || n === "test") continue
    const p = path.join(dir, n)
    let st: fs.Stats
    try { st = fs.statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, exts, out, cap)
    else if (exts.includes(path.extname(n).slice(1).toLowerCase())) out.push(p)
  }
  return out
}

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const kinds = new Map<string, number>()
  const labels = new Map<string, number>()
  const confByLabel = new Map<string, Map<number, number>>()
  const noLine: any[] = []
  const zeroLine: any[] = []
  const badNames: any[] = []
  const ownerless: any[] = []
  const noSymbolFiles: any[] = []
  const nonNameEdges: any[] = []
  const perRepo: Record<string, any> = {}
  let files = 0, symbols = 0, edges = 0, crashFiles = 0, errFiles = 0
  const crashes: any[] = []
  const wall0 = Date.now()

  for (const repo of REPOS) {
    const repoDir = path.join(CORPUS_ROOT, repo)
    const list = walk(repoDir, EXT, [], LIMIT)
    let rFiles = 0, rSymbols = 0, rEdges = 0, rErr = 0, rBytes = 0
    for (const file of list) {
      if (files >= LIMIT) break
      let src: string
      try { src = fs.readFileSync(file, "utf8") } catch { continue }
      files++; rFiles++; rBytes += Buffer.byteLength(src)
      let res: any
      try { res = await ASTEngine.parseFile(file, src) } catch (e: any) {
        crashFiles++; crashes.push({ repo, file: path.relative(CORPUS_ROOT, file), error: String(e?.message ?? e).slice(0, 120) }); continue
      }
      const rel = path.relative(CORPUS_ROOT, file)
      const errs = [...(res.errors ?? []), ...(res.metadata?.errors ?? [])]
      if (errs.length) { errFiles++; rErr++ }
      const syms: any[] = res.symbols ?? []
      const rels: any[] = res.relationships ?? []
      symbols += syms.length; edges += rels.length; rSymbols += syms.length; rEdges += rels.length
      if (!syms.length) noSymbolFiles.push({ repo, file: rel, bytes: Buffer.byteLength(src), lines: src.split("\n").length })
      const MEMBER_KINDS = new Set(["method", "property", "field", "enum_member", "constructor", "accessor"])
      for (const s of syms) {
        const k = String(s.kind ?? "?")
        kinds.set(k, (kinds.get(k) ?? 0) + 1)
        const n = String(s.name ?? "")
        if (!n.trim() || PLACEHOLDER.test(n.trim())) badNames.push({ file: rel, name: JSON.stringify(n), kind: k, line: s.range?.startLine, why: "placeholder/empty name" })
        else if (MEMBER_KINDS.has(k) && !s.ownerName && !s.owner) ownerless.push({ file: rel, name: n, kind: k, line: s.range?.startLine })
      }
      for (const r of rels) {
        const t = String(r.type ?? r.relationshipType ?? "?")
        labels.set(t, (labels.get(t) ?? 0) + 1)
        const cm = confByLabel.get(t) ?? new Map<number, number>()
        cm.set(Math.round((r.confidence ?? -1) * 100), (cm.get(Math.round((r.confidence ?? -1) * 100)) ?? 0) + 1)
        confByLabel.set(t, cm)
        const ln = r.line_number ?? r.metadata?.line ?? r.line
        if (ln === undefined || ln === null) noLine.push({ file: rel, label: t, source: r.source, target: r.target, why: r.metadata?.noLineReason })
        else if (ln === 0) zeroLine.push({ file: rel, label: t, source: r.source, target: r.target })
        const sN = String(r.source ?? ""), tN = String(r.target ?? "")
        if (!sN.trim() || !tN.trim()) nonNameEdges.push({ file: rel, label: t, source: sN, target: tN })
      }
    }
    perRepo[repo] = { files: rFiles, symbols: rSymbols, relationships: rEdges, errorFiles: rErr, bytes: rBytes, ms: Date.now() - wall0 }
  }
  const wallMs = Date.now() - wall0

  const out = {
    at: new Date().toISOString(), repos: REPOS, limit: LIMIT, ext: EXT,
    files, symbols, edges, crashFiles, errFiles, wallMs,
    kinds: [...kinds.entries()].sort((a, b) => b[1] - a[1]),
    labels: [...labels.entries()].sort((a, b) => b[1] - a[1]),
    confidenceByLabel: [...confByLabel.entries()].map(([k, v]) => [k, [...v.entries()].sort((a, b) => a[0] - b[0])]),
    noLineCount: noLine.length, noLine: noLine.slice(0, 40),
    zeroLineCount: zeroLine.length, zeroLine: zeroLine.slice(0, 40),
    badNames: badNames.slice(0, 60), badNamesCount: badNames.length,
    ownerless: ownerless.slice(0, 60), ownerlessCount: ownerless.length,
    noSymbolFiles: noSymbolFiles.slice(0, 60), noSymbolFilesCount: noSymbolFiles.length,
    nonNameEdges: nonNameEdges.slice(0, 40), nonNameEdgesCount: nonNameEdges.length,
    crashes, perRepo,
  }
  const jp = argOf("--json")
  if (jp) { fs.mkdirSync(path.dirname(jp), { recursive: true }); fs.writeFileSync(jp, JSON.stringify(out, null, 1)) }

  console.log(`files ${files}  symbols ${symbols}  relationships ${edges}  errorFiles ${errFiles}  crashFiles ${crashFiles}  ${(wallMs / 1000).toFixed(1)}s`)
  console.log(`\n== symbol kinds ==\n  ${[...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ")}`)
  console.log(`\n== relationship labels + confidence ==`)
  for (const [k, v] of [...labels.entries()].sort((a, b) => b[1] - a[1])) {
    const cm = [...(confByLabel.get(k) ?? new Map()).entries()].sort((a, b) => a[0] - b[0])
    console.log(`  ${k.padEnd(14)} ${String(v).padStart(7)}  conf: ${cm.map(([c, n]) => `${c}%:${n}`).join(" ")}`)
  }
  console.log(`\n== D8 lines ==  no line: ${noLine.length}   line 0: ${zeroLine.length}`)
  for (const x of noLine.slice(0, 12)) console.log(`   NOLINE ${x.label} ${x.source}->${x.target} ${x.file}${x.why ? ` (${x.why})` : ""}`)
  for (const x of zeroLine.slice(0, 12)) console.log(`   ZERO   ${x.label} ${x.source}->${x.target} ${x.file}`)
  console.log(`\n== D5 ==  bad names: ${badNames.length}   ownerless members: ${ownerless.length}   symbol-free files: ${noSymbolFiles.length}   non-name edge endpoints: ${nonNameEdges.length}`)
  for (const x of badNames.slice(0, 25)) console.log(`   BADNAME [${x.kind}] ${x.name}  ${x.file}:${x.line}  ${x.why}`)
  for (const x of ownerless.slice(0, 15)) console.log(`   OWNERLESS [${x.kind}] ${x.name}  ${x.file}:${x.line}`)
  for (const x of noSymbolFiles.slice(0, 15)) console.log(`   NOSYMS ${x.file} (${x.lines} lines, ${x.bytes} B)`)
  for (const x of nonNameEdges.slice(0, 10)) console.log(`   ENDPOINT ${x.label} "${x.source}"->"${x.target}" ${x.file}`)
  if (crashes.length) { console.log(`\n== crashes ==`); for (const c of crashes.slice(0, 10)) console.log(`   ${c.file}: ${c.error}`) }
}
void main()
