/**
 * GO ENDPOINT DEFECT SWEEP — the rows behind the census's counters.
 *
 * ## Why this is separate from `go-ontology-census.ts`
 *
 * The census COUNTS endpoint defects per type — empty endpoints, placeholder
 * literals, non-identifier spellings — and keeps a bounded sample. A count with
 * six sample rows is enough to know a defect class exists and not enough to fix
 * it: the fix needs every distinct SITE, because each site is a different
 * construct and one guard placed at the wrong node removes none of them.
 *
 * So this sweep streams the corpus and records every distinct site for the
 * classes that are defects rather than conventions:
 *
 *   D1 empty source        R7: an edge endpoint may not be empty
 *   D2 empty target        R7: same
 *   D3 source == "global"  the analyzer's own documented pseudo-source, used
 *                          when a declared-type reference cannot be attributed
 *                          to a declaration. An edge whose source names nothing
 *                          cannot be navigated back to the declaration that
 *                          wanted the type, so it is unattributable by
 *                          construction — counted here rather than excused
 *   D4 source == "this"    a JavaScript placeholder. Only `extractFallback`
 *                          writes it (pool-worker.ts), so any occurrence is
 *                          regex-derived output in a Go lane
 *   D5 placeholder literal an endpoint spelled `Unknown` / `Null` / `Symbol` /
 *                          `Anonymous` and so on, with the file's own declared
 *                          names as the discriminator — a Go declaration may
 *                          legitimately be called `Null` (`type Null[T any]` in
 *                          database/sql), so a file-scope-blind rule convicts
 *                          real members, which is the error
 *                          `validation/m60/target-spelling-register.json`
 *                          already records twice
 *
 * Conventions are deliberately NOT swept, because they are not defects and a
 * sweep that convicts them trains people to ignore the sweep: `imports` targets
 * are module paths, `overrides` endpoints are `Receiver.Method`, and
 * `references`/`uses` targets are declared-name leaves. Each is counted and
 * attributed in the census.
 *
 * ## NO REGEX
 *
 * Zero regular expressions.
 *
 * USAGE
 *   npx tsx script/m14/go-endpoint-defects.ts --out d.json [--shard=i/n] [--repo=a,b]
 *   npx tsx script/m14/go-endpoint-defects.ts --merge a.json b.json --out d.json
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]
const SAMPLE_CAP = 60

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1]
  const j = process.argv.find((a) => a.startsWith(`${flag}=`))
  return j ? j.slice(flag.length + 1) : dflt
}
const REPOS = (argOf("--repo", "go-stdlib") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const OUT = argOf("--out")
const MAX_BYTES = 512 * 1024
const SKIP = new Set((process.env.BB_GO_SKIP ?? "").split(",").map((s) => s.trim()).filter(Boolean))
const IS_MERGE = process.argv.includes("--merge")

type Site = { kind: string; type: Type; file: string; source: string; target: string; detail: string }
type Shard = {
  schema: "go-endpoint-defects/1"
  repos: string[]
  revisions: Record<string, string>
  corpusAdmitted: number
  drawn: number
  filesParsed: number
  relationships: number
  wallMs: number
  counts: Record<string, number>
  /** every distinct SITE, keyed so a merge is a union rather than a re-count */
  sites: Record<string, Site>
}
const siteKey = (s: Site) => `${s.kind}|${s.type}|${s.file}|${s.source}|${s.target}`
const EMPTY: Shard = {
  schema: "go-endpoint-defects/1", repos: [], revisions: {}, corpusAdmitted: 0, drawn: 0,
  filesParsed: 0, relationships: 0, wallMs: 0, counts: {}, sites: {},
}

if (IS_MERGE) {
  // `--out`'s VALUE also ends in `.json`, so excluding only the flag leaves the
  // output path in the input list and the merge tries to read the file it is
  // about to write. The census merge excludes OUT explicitly for the same
  // reason; this is that exclusion, written down so it is not "simplified" away.
  const parts = process.argv.slice(2).filter((a) => !a.startsWith("--") && a !== OUT && a.endsWith(".json"))
  const acc: Shard = { ...EMPTY }
  for (const p of parts) {
    const j = JSON.parse(readFileSync(p, "utf8")) as Shard
    acc.repos = [...new Set([...acc.repos, ...(j.repos ?? [])])]
    for (const [k, v] of Object.entries(j.revisions ?? {})) acc.revisions[k] = v
    acc.corpusAdmitted = Math.max(acc.corpusAdmitted, j.corpusAdmitted ?? 0)
    acc.drawn += j.drawn ?? 0
    acc.filesParsed += j.filesParsed ?? 0
    acc.relationships += j.relationships ?? 0
    acc.wallMs += j.wallMs ?? 0
    for (const [k, v] of Object.entries(j.counts ?? {})) acc.counts[k] = (acc.counts[k] ?? 0) + v
    for (const [k, v] of Object.entries(j.sites ?? {})) acc.sites[k] = v
  }
  // The merged COUNT of a site class is the number of distinct SITES, because a
  // site is keyed by kind|type|file|source|target and the census's own counter
  // (edges, not sites) is the thing that can exceed it. Both are reported.
  const byKind: Record<string, number> = {}
  for (const s of Object.values(acc.sites)) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1
  const report = { ...acc, distinctSitesByKind: byKind }
  console.log(`merged ${parts.length} shards -> ${OUT ?? "(stdout)"}`)
  console.log(`  files parsed ${acc.filesParsed}, relationships ${acc.relationships.toLocaleString()}`)
  for (const k of Object.keys(byKind).sort()) console.log(`  ${k.padEnd(28)} ${byKind[k]} distinct sites`)
  if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2))
  process.exit(0)
}

type File = { repo: string; dir: string; rel: string; abs: string }
const files: File[] = []
const revisions: Record<string, string> = {}
for (const e of REPOS) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { revisions[e] = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > MAX_BYTES) continue } catch { continue }
    if (SKIP.has(`${e}/${rel}`)) continue
    if (detectLanguageFromPath(abs) !== "go") continue
    files.push({ repo: e, dir, rel, abs })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : a.repo + "/" + b.rel > b.repo + "/" + b.rel ? 1 : 0))
let draw = files
const shardArg = process.argv.find((a) => a.startsWith("--shard="))
if (shardArg) {
  const [i, n] = shardArg.slice("--shard=".length).split("/").map(Number)
  draw = files.filter((_, k) => k % n === i)
}
console.log(`go endpoint defects — ${REPOS.join(",")}${shardArg ? ` ${shardArg.slice(8)}` : ""}  admitted ${files.length}  drawn ${draw.length}`)

const out: Shard = {
  schema: "go-endpoint-defects/1", repos: REPOS, revisions, corpusAdmitted: files.length, drawn: draw.length,
  filesParsed: 0, relationships: 0, wallMs: 0, counts: {}, sites: {},
}
const PLACEHOLDER_LITERALS = new Set(["unknown", "undefined", "null", "n/a", "todo", "fixme", "?", "", "<name>", "unnamed", "anonymous", "symbol"])
const wall0 = Date.now()
let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= draw.length) return
    const f = draw[i]
    const label = `${f.repo}/${f.rel}`
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    out.filesParsed++
    const declared = new Set<string>()
    for (const s of r?.symbols ?? []) if (typeof s?.name === "string") declared.add(s.name)
    const rels = r?.relationships ?? []
    out.relationships += rels.length
    for (const x of rels) {
      const t = String(x.type ?? x.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      const src = String(x.source ?? "")
      const tgt = String(x.target ?? "")
      const record = (kind: string, detail: string) => {
        out.counts[kind] = (out.counts[kind] ?? 0) + 1
        const k = siteKey({ kind, type: t, file: label, source: src, target: tgt, detail })
        if (!out.sites[k]) out.sites[k] = { kind, type: t, file: label, source: src, target: tgt, detail }
      }
      if (src.length === 0) record("D1_empty_source", `target=${JSON.stringify(tgt)}`)
      if (tgt.length === 0) record("D2_empty_target", `source=${JSON.stringify(src)}`)
      if (src === "global") record("D3_global_source", `target=${JSON.stringify(tgt)} md=${JSON.stringify(x.metadata ?? {})}`)
      if (src === "this") record("D4_this_source", `target=${JSON.stringify(tgt)} md=${JSON.stringify(x.metadata ?? {})}`)
      // The declared-name discriminator: Go declares `Null`, `Unknown` and
      // `Anonymous`, so a value-only rule convicts real members.
      for (const [endpoint, v] of [["source", src], ["target", tgt]] as const) {
        if (v.length === 0) continue
        if (!PLACEHOLDER_LITERALS.has(v.trim().toLowerCase())) continue
        if (declared.has(v)) continue
        record(`D5_placeholder_${endpoint}`, `value=${JSON.stringify(v)} not declared in this file`)
      }
    }
  }
}
await Promise.all(Array.from({ length: Number(process.env.BB_GO_RESOLVE_WORKERS ?? "3") }, () => worker()))
out.wallMs = Date.now() - wall0
const byKind: Record<string, number> = {}
for (const s of Object.values(out.sites)) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1
const report: Shard & { distinctSitesByKind: Record<string, number> } = { ...out, distinctSitesByKind: byKind }
console.log(`\nparseFile: ${out.filesParsed} files, ${out.relationships.toLocaleString()} relationships, ${out.wallMs} ms`)
console.log(`\n${"class".padEnd(28)}${"edges".padStart(10)}${"distinct sites".padStart(16)}`)
console.log("-".repeat(56))
for (const k of Object.keys(out.counts).sort()) console.log(`${k.padEnd(28)}${String(out.counts[k]).padStart(10)}${String(byKind[k] ?? 0).padStart(16)}`)
for (const k of Object.keys(byKind).sort()) {
  const rows = Object.values(out.sites).filter((s) => s.kind === k).slice(0, 8)
  for (const s of rows) console.log(`  ${s.type.padEnd(12)} ${s.file}  ${JSON.stringify(s.source)} -> ${JSON.stringify(s.target)}  ${s.detail.slice(0, 110)}`)
}
if (OUT) { writeFileSync(OUT, JSON.stringify(report, null, 2)); console.log(`\nwrote ${OUT}`) }
process.exit(0)