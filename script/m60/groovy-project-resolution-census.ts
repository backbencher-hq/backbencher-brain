// script/m60/groovy-project-resolution-census.ts — question 5, with the right
// denominator.
//
//   npx tsx script/m60/groovy-project-resolution-census.ts [--out <path>]
//                                                   [--max N] [--from N]
//
// ## Why the per-file census is not enough
//
// `groovy-ontology-census.ts` answers "does this edge bind to a symbol?" by
// looking the endpoints up in the SAME FILE's symbol list. That is the strict
// reading and it is the wrong denominator for most of this lane's graph:
//
//   extends / implements / instantiates   the target is a type declared in
//                                        ANOTHER file in the large majority of
//                                        cases — that is what a real codebase
//                                        looks like. Per-file, `extends` reads
//                                        16.9% and `implements` 32.5%, which
//                                        says nothing about whether the edge
//                                        binds in the graph a reader queries.
//   imports / references (import rows)    the target is a DOTTED MODULE PATH by
//                                        construction, so it can never be an
//                                        in-file symbol: 0.3% per-file is the
//                                        expected value of a correct rule, not
//                                        a defect.
//   exports                             the SOURCE is the package, by design,
//                                        so only the target is a symbol.
//
// So this instrument builds the PROJECT symbol table first — every symbol every
// admitted file contributes, keyed the way `parallel-indexer` keys them — and
// then resolves every edge of every file against it. Both numbers are reported:
// `perFile` (the strict reading, kept so the two can be compared and the change
// between them is visible) and `projectWide`.
//
// ## The binding rules
//
// Reproduced from `parallel-indexer`'s insert-time binding rather than imported
// from it. A gate that calls the code it audits is a tautology, and an
// instrument that cannot disagree with the indexer is decoration; the point of
// the measurement is to find edges the indexer CANNOT bind, so the rules have to
// be the indexer's, written out, and the source of each rule is named.
//
// ## What it does not claim
//
// It measures binding, not CORRECTNESS. An edge that binds is not thereby true —
// question 4 (right label) and question 3 (oracle agrees) are separate, and this
// file says nothing about either.
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : undefined
const MAX = Number((argv.includes("--max") ? argv[argv.indexOf("--max") + 1] : "0")) || 0
const FROM = Number((argv.includes("--from") ? argv[argv.indexOf("--from") + 1] : "0")) || 0
const REPOS = (process.env.BB_GROOVY_REPOS ?? "groovy").split(",").map((s) => s.trim()).filter(Boolean)
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

/** indexer insert-time binding, in its order: exact name, leaf of a dotted or
 *  `:`-separated path, `endsWith(:name)`, `endsWith(.name)`, qualified `scope.name`. */
function makeResolver(allNames: Set<string>, allQualified: Set<string>) {
  const leafCache = new Map<string, string>()
  const leaf = (name: string): string => {
    const noLine = name.replace(/:\d+$/, "")
    const segs = noLine.split(":").filter((s) => s.length > 0)
    const last = segs[segs.length - 1] ?? ""
    const cached = leafCache.get(last)
    if (cached !== undefined) return cached
    const dots = last.split(".")
    const out = dots[dots.length - 1]
    leafCache.set(last, out)
    return out
  }
  return (name: string): boolean => {
    if (!name) return false
    if (allNames.has(name)) return true
    if (allNames.has(leaf(name))) return true
    if (name.endsWith(`:${leaf(name)}`) || name.endsWith(`.${leaf(name)}`)) return true
    return allQualified.has(name)
  }
}

type Row = {
  total: number
  files: number
  perFileBoth: number
  projBoth: number
  projSrcOnly: number
  projTgtOnly: number
  projNeither: number
  samplesUnbound: string[]
  samplesBound: string[]
}
const newRow = (): Row => ({
  total: 0, files: 0, perFileBoth: 0, projBoth: 0, projSrcOnly: 0, projTgtOnly: 0, projNeither: 0,
  samplesUnbound: [], samplesBound: [],
})

async function main(): Promise<void> {
  const files: Array<{ repo: string; abs: string }> = []
  for (const repo of REPOS) {
    const dir = join(ROOT, repo)
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!rel.endsWith(".groovy") && !rel.endsWith(".gradle")) continue
      const abs = join(dir, rel)
      try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
      files.push({ repo, abs })
    }
  }
  files.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))
  const selected = MAX > 0 ? files.slice(FROM, FROM + MAX) : (FROM > 0 ? files.slice(FROM) : files)

  // ---- pass 1: symbols + edges, held in memory. 2,825 files is a few tens of
  // MB of relationship objects, which is the price of a project-wide answer.
  type Parsed = { abs: string; symbols: Array<{ name: string; scope?: string }>; rels: any[] }
  const parsed: Parsed[] = []
  let idx = 0
  const WORKERS = Number(process.env.BB_GROOVY_PROJ_WORKERS ?? "3")
  async function worker(): Promise<void> {
    for (;;) {
      const k = idx++
      if (k >= selected.length) return
      const f = selected[k]
      let r: any
      try { r = await parseFile(f.abs) } catch { continue }
      parsed.push({
        abs: f.abs,
        symbols: (r.symbols ?? []).map((s: any) => ({ name: String(s?.name ?? ""), scope: s?.scope })),
        rels: r.relationships ?? [],
      })
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, () => worker()))
  parsed.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))

  // `--cache <path>` writes the parse pass and `--from-cache <path>` reads it
  // back, so the resolution pass can run WITHOUT re-parsing. That is not a
  // convenience: the engine's per-file watchdog (`[BB-HANG] parser stuck 120s`,
  // src/ast/engine.ts) calls process.exit(1), so on a shared box one queued file
  // ends the whole run and a project-wide answer — which by definition needs every
  // file in one process — becomes unmeasurable. Splitting parse from resolve
  // makes the expensive half retryable and the cheap half safe.
  const CACHE = argv.includes("--cache") ? argv[argv.indexOf("--cache") + 1] : undefined
  const FROM_CACHE = argv.includes("--from-cache") ? argv[argv.indexOf("--from-cache") + 1] : undefined
  if (CACHE) { writeFileSync(CACHE, JSON.stringify(parsed)); process.stderr.write(`wrote cache ${CACHE} (${parsed.length} files)\n`) }
  if (FROM_CACHE) { parsed.length = 0; parsed.push(...JSON.parse(readFileSync(FROM_CACHE, "utf8"))) }

  const allNames = new Set<string>()
  const allQualified = new Set<string>()
  for (const p of parsed) {
    for (const s of p.symbols) {
      if (!s.name) continue
      allNames.add(s.name)
      if (s.scope) allQualified.add(`${s.scope}.${s.name}`)
    }
  }
  const projectResolves = makeResolver(allNames, allQualified)
  const fileResolvers = new Map<string, (n: string) => boolean>()
  for (const p of parsed) {
    const names = new Set<string>()
    const qualified = new Set<string>()
    for (const s of p.symbols) {
      if (!s.name) continue
      names.add(s.name)
      if (s.scope) qualified.add(`${s.scope}.${s.name}`)
    }
    fileResolvers.set(p.abs, makeResolver(names, qualified))
  }

  // ---- pass 2: resolve
  const rows: Record<string, Row> = {}
  for (const t of ALL_TYPES) rows[t] = newRow()
  const seenFiles: Record<string, Set<string>> = {}
  for (const t of ALL_TYPES) seenFiles[t] = new Set()

  for (const p of parsed) {
    const local = fileResolvers.get(p.abs)!
    const rel = p.abs.replace(`${ROOT}/`, "")
    for (const x of p.rels) {
      const t = String(x.type ?? x.relationshipType ?? "")
      if (!rows[t]) continue
      const row = rows[t]
      const src = String(x.source ?? "")
      const tgt = String(x.target ?? "")
      row.total++
      seenFiles[t].add(rel)
      if (local(src) && local(tgt)) row.perFileBoth++
      const sOk = projectResolves(src)
      const tOk = projectResolves(tgt)
      const site = `${rel}:${x.line_number ?? "?"} ${src} -> ${tgt}`
      if (sOk && tOk) {
        row.projBoth++
        if (row.samplesBound.length < 4) row.samplesBound.push(site)
      } else if (sOk) {
        row.projSrcOnly++
        if (row.samplesUnbound.length < 6) row.samplesUnbound.push(`src-only ${site}`)
      } else if (tOk) {
        row.projTgtOnly++
        if (row.samplesUnbound.length < 6) row.samplesUnbound.push(`tgt-only ${site}`)
      } else {
        row.projNeither++
        if (row.samplesUnbound.length < 6) row.samplesUnbound.push(`neither ${site}`)
      }
    }
  }
  for (const t of ALL_TYPES) rows[t].files = seenFiles[t].size

  const artifact = {
    instrument: "groovy-project-resolution-census",
    lane: "analyzer/GROOVY",
    entryPoint: "src/ast/pool-worker.ts parseFile",
    question: "do both endpoints bind, against the WHOLE PROJECT's symbol table?",
    corpora: REPOS.map((r) => `${ROOT}/${r}`),
    slice: { from: FROM, max: MAX, universe: files.length },
    filesParsed: parsed.length,
    distinctSymbolNames: allNames.size,
    bindingRules: "parallel-indexer insert-time order: exact name; leaf of a dotted or ':'-separated path; endsWith(:leaf); endsWith(.leaf); scope.name.",
    caveat: "measures BINDING, not correctness. A bound edge is not thereby true.",
    byType: Object.fromEntries(ALL_TYPES.map((t) => {
      const r = rows[t]
      return [t, {
        total: r.total,
        files: r.files,
        perFileBothEndsPct: +((r.perFileBoth / Math.max(1, r.total)) * 100).toFixed(1),
        projectWideBothEnds: r.projBoth,
        projectWideBothEndsPct: +((r.projBoth / Math.max(1, r.total)) * 100).toFixed(1),
        projectWideSourceOnly: r.projSrcOnly,
        projectWideTargetOnly: r.projTgtOnly,
        projectWideNeitherEnd: r.projNeither,
        samplesBound: r.samplesBound,
        samplesUnbound: r.samplesUnbound,
      }]
    })),
  }
  const out = JSON.stringify(artifact, null, 2)
  if (OUT) { writeFileSync(OUT, out + "\n"); process.stderr.write(`wrote ${OUT}\n`) }
  console.log(out)
}
main().catch((e) => { console.error(e); process.exit(1) })