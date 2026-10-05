/**
 * TYPESCRIPT ONTOLOGY CENSUS — JOB 1's instrument.
 *
 * Runs the PRODUCTION entry point (`parseFile` from `src/ast/pool-worker.ts`, the
 * same one the indexer uses) over the whole real corpus and reports, for every one
 * of the ontology's ten relationship types:
 *
 *   1. EMITTED — the count and the files it came from. Evidence, not assertion.
 *   4. LABELLED — the distribution of labels per emission site, so a neighbour
 *      label (a `calls` edge that should be `references`) is visible as a number.
 *   5. RESOLVED — both endpoints bound to a symbol the analyzer actually emitted,
 *      counted per type and per end.
 *   6. CONFIDENT — the evidenceClass / confidence histogram, because anything
 *      under 0.7 is a heuristic and must not be reported as a fact (honesty
 *      contract §4).
 *   R7 — unknown symbols, empty names, and placeholder-literal endpoints.
 *
 * READ-ONLY. Writes nothing except the JSON passed with --out.
 *
 * Usage: bun run script/m14/ts-ontology-census.ts [--lang typescript] [--out path.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

const argv = process.argv.slice(2)
const argOf = (flag: string): string | undefined => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const LANG = argOf("--lang") ?? "typescript"
const OUT = argOf("--out")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const LIMIT = Number(argOf("--limit") ?? "0")
const REPO_FILTER = argOf("--repo")
const MAX_BYTES = Number(argOf("--max-bytes") ?? String(512 * 1024))

/** Standing rule R7: a placeholder literal is not a name. Anything that is not a
 *  plausible program identifier is reported, not filtered away. */
const PLACEHOLDER_LITERALS = new Set([
  "", "?", "unknown", "unknown_symbol", "unknownsymbol", "<unknown>", "undefined", "null",
  "todo", "tbd", "n/a", "na", "none", "anonymous", "<anonymous>", "anonymousfunction",
  "placeholder", "xxx", "<lambda>", "lambda", "func", "fn", "symbol", "name", "value",
  "target", "source", "object", "string", "number", "any", "unknown1", "foo", "bar", "baz",
])

type Rel = {
  type?: string
  relationshipType?: string
  source?: string
  target?: string
  from?: string
  to?: string
  fromSymbol?: string
  toSymbol?: string
  confidence?: number
  metadata?: Record<string, any>
  [k: string]: any
}

const endpointsOf = (r: Rel): [string, string] => [
  String(r.source ?? r.from ?? r.fromSymbol ?? ""),
  String(r.target ?? r.to ?? r.toSymbol ?? ""),
]
const typeOf = (r: Rel): string => String(r.type ?? r.relationshipType ?? "").toLowerCase()

// ---------------------------------------------------------------- corpus
type CorpusFile = { repo: string; dir: string; rel: string; abs: string; text: string }
const files: CorpusFile[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  if (REPO_FILTER && !e.includes(REPO_FILTER)) continue
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    files.push({ repo: e, dir, rel, abs, text })
  }
  if (files.length && LIMIT && files.length >= LIMIT) break
}
const admitted = LIMIT ? files.slice(0, LIMIT) : files

// ---------------------------------------------------------------- census
type Stat = {
  count: number
  files: Set<string>
  srcResolves: number
  tgtResolves: number
  bothResolve: number
  conf: Map<string, number>
  evidence: Map<string, number>
  reasons: Map<string, number>
  srcLiteralUnknown: number
  tgtLiteralUnknown: number
  emptyEndpoint: number
  selfLoop: number
  examples: string[]
}
const stat = (): Stat => ({
  count: 0, files: new Set(), srcResolves: 0, tgtResolves: 0, bothResolve: 0,
  conf: new Map(), evidence: new Map(), reasons: new Map(),
  srcLiteralUnknown: 0, tgtLiteralUnknown: 0, emptyEndpoint: 0, selfLoop: 0, examples: [],
})
const rows = new Map<Type, Stat>()
for (const t of ALL_TYPES) rows.set(t, stat())

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

let parsed = 0
let failed = 0
let totalSymbols = 0
let totalRels = 0
const parseErrorFiles: string[] = []
const filesWithRels = new Set<string>()
const seenFileKeys: string[] = []
let idx = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= admitted.length) return
    const f = admitted[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { failed++; continue }
    parsed++
    const label = `${f.repo}/${f.rel}`
    const symbols: any[] = r?.symbols ?? []
    totalSymbols += symbols.length
    // A symbol id in this family is `qualified::name` or similar; bind by BOTH the
    // emitted id and the bare name so "resolves" means "binds to a symbol this
    // analyzer emitted in this file", not "the string looks like an id".
    const ids = new Set<string>()
    const names = new Set<string>()
    for (const s of symbols) {
      if (s?.id) ids.add(String(s.id))
      if (s?.name) names.add(String(s.name))
    }
    const rels: Rel[] = r?.relationships ?? []
    totalRels += rels.length
    if (rels.length) filesWithRels.add(label)
    for (const rel of rels) {
      const t = typeOf(rel) as Type
      const s = rows.get(t)
      if (!s) continue
      const [src, tgt] = endpointsOf(rel)
      s.count++
      if (s.files.size < 400) s.files.add(label)
      if (!src || !tgt) s.emptyEndpoint++
      const sr = src !== "" && (ids.has(src) || names.has(src))
      const tr = tgt !== "" && (ids.has(tgt) || names.has(tgt))
      if (sr) s.srcResolves++
      if (tr) s.tgtResolves++
      if (sr && tr) s.bothResolve++
      if (src === tgt && src !== "") s.selfLoop++
      bump(s.conf, String(rel.confidence ?? "absent"))
      bump(s.evidence, String((rel.metadata as any)?.evidenceClass ?? rel.evidenceClass ?? "absent"))
      const reason = (rel.metadata as any)?.reason ?? (rel.metadata as any)?.confidenceReason ?? rel.reason
      if (reason) bump(s.reasons, String(reason))
      const norm = (x: string) => x.toLowerCase().trim()
      if (PLACEHOLDER_LITERALS.has(norm(src)) || /^(unknown|<|\?\?)/i.test(src)) s.srcLiteralUnknown++
      if (PLACEHOLDER_LITERALS.has(norm(tgt)) || /^(unknown|<|\?\?)/i.test(tgt)) s.tgtLiteralUnknown++
      if (s.examples.length < 5) s.examples.push(`${src} -> ${tgt}`)
      seenFileKeys.push(`${label}\t${t}\t${src}\t${tgt}`)
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

// ---------------------------------------------------------------- report
const out: any = {
  at: new Date().toISOString(),
  lang: LANG,
  corpusRoot: CR,
  filesAdmitted: admitted.length,
  filesParsed: parsed,
  filesFailed: failed,
  filesWithRelationships: filesWithRels.size,
  totalSymbols,
  totalRelationships: totalRels,
  parseErrorFiles,
  types: {},
}
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`typescript ontology census — ${LANG}`)
console.log(`corpus ${CR}: ${admitted.length} admitted files, ${parsed} parsed, ${failed} failed`)
console.log(`symbols ${totalSymbols.toLocaleString()}  relationships ${totalRels.toLocaleString()}  files with edges ${filesWithRels.size}\n`)
console.log(`${w("type", 14)}${w("count", 12)}${w("files", 8)}${w("src%", 8)}${w("tgt%", 8)}${w("both%", 8)}${w("self", 7)}${w("R7src", 8)}${w("R7tgt", 8)}confidence histogram`)
console.log("-".repeat(150))
for (const t of ALL_TYPES) {
  const s = rows.get(t)!
  const pct = (n: number) => (s.count ? ((100 * n) / s.count).toFixed(1) : "-")
  const hist = [...s.conf.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")
  out.types[t] = {
    count: s.count,
    files: s.files.size,
    fileListSample: [...s.files].slice(0, 12),
    srcResolves: s.srcResolves,
    targetResolves: s.tgtResolves,
    bothResolve: s.bothResolve,
    emptyEndpoints: s.emptyEndpoint,
    selfLoops: s.selfLoop,
    placeholderSourceEndpoints: s.srcLiteralUnknown,
    placeholderTargetEndpoints: s.tgtLiteralUnknown,
    confidenceHistogram: Object.fromEntries(s.conf),
    evidenceClassHistogram: Object.fromEntries(s.evidence),
    confidenceReasonHistogram: Object.fromEntries([...s.reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)),
    examples: s.examples,
  }
  console.log(`${w(t, 14)}${w(s.count.toLocaleString(), 12)}${w(String(s.files.size), 8)}${w(pct(s.srcResolves), 8)}${w(pct(s.tgtResolves), 8)}${w(pct(s.bothResolve), 8)}${w(String(s.selfLoop), 7)}${w(String(s.srcLiteralUnknown), 8)}${w(String(s.tgtLiteralUnknown), 8)}${hist}`)
}
const missing = ALL_TYPES.filter((t) => rows.get(t)!.count === 0)
console.log(`\nNOT EMITTED: ${missing.length ? missing.join(", ") : "(none)"}`)
out.notEmitted = missing
console.log(`R7 placeholder/unknown endpoints: src ${ALL_TYPES.reduce((a, t) => a + rows.get(t)!.srcLiteralUnknown, 0)}, tgt ${ALL_TYPES.reduce((a, t) => a + rows.get(t)!.tgtLiteralUnknown, 0)}`)
console.log(`empty endpoints: ${ALL_TYPES.reduce((a, t) => a + rows.get(t)!.emptyEndpoint, 0)}`)
if (OUT) {
  const { writeFileSync } = await import("node:fs")
  writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`\nwrote ${OUT}`)
}
