/**
 * TYPESCRIPT ONTOLOGY CENSUS — the typescript lane's own instrument for the
 * relationship-type workstream (docs/analyzers/ONTOLOGY-WORKSTREAM.md).
 *
 * WHY A LANE-OWNED FILE. `differential.ts` runs a corpus sweep on import, so an
 * instrument cannot ask it a question without starting a 40+ lane sweep; and it
 * is MASTER-owned. This file drives the PRODUCTION entry (`parseFile` from
 * `src/ast/pool-worker`) and computes its own numbers. It writes only `--out`.
 * It reads no shared file and writes no shared file, so it cannot conflict with
 * a lane that owns one of them.
 *
 * WHAT IT ANSWERS, per relationship type (the workstream's Part 1 six questions
 * reduced to what ONE instrument can honestly answer):
 *
 *   1 FIRES     count from production `parseFile`, never from source reading. A
 *               branch that never matches is invisible to derivation.
 *   4 LABELLED  per-type metadata/rationale census, so "is it the right type and
 *               not a neighbour" can be read against what each site claims.
 *   5 RESOLVED  both endpoints bind to a symbol. Measured against (a) the file's
 *               OWN symbol set and (b) the PROJECT symbol set accumulated over
 *               the run, because a cross-file edge that only resolves
 *               project-wide is still resolvable and the difference is the fact
 *               a consumer needs.
 *   6 CONFIDENT the confidence distribution per type, and the count below the 0.7
 *               fabrication threshold (honesty contract §4).
 *   R7          unknown/empty endpoint names and placeholder literals, attributed
 *               to the EMISSION SITE that produced them.
 *
 * Question 3 (an independent oracle agrees) is NOT answered here and this file
 * says so rather than implying it: the oracle is a separate walker over the SAME
 * grammar, so a grammar bug shared by both paths is invisible to both. That is
 * `script/m14/differential.ts` plus `script/m14/oracles/typescript-*.ts`, which
 * are master-owned / lane-oracle.
 *
 * CLI: npx tsx script/m14/typescript-ontology-census.ts [--repo typescript]
 *      [--sample N] [--out <file.json>] [--workers N]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const REPOS = (argOf("--repo", "typescript") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const SAMPLE = parseInt(argOf("--sample", "0") ?? "0")
const WORKERS = parseInt(argOf("--workers", "6") ?? "6")
const OUT = argOf("--out")
const MAX_BYTES = 512 * 1024

// ── corpus ────────────────────────────────────────────────────────────────────
// Tracked files only (`git ls-files`), the same admission rule the ontology gate
// uses: an untracked build artifact in a dirty tree is not evidence about the
// language.
type File = { repo: string; dir: string; rel: string; abs: string; size: number }
const files: File[] = []
for (const e of readdirSync(CR)) {
  if (!REPOS.includes(e)) continue
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let size: number
    try { size = statSync(abs).size } catch { continue }
    if (size > MAX_BYTES) continue
    if (detectLanguageFromPath(abs) !== "typescript") continue
    files.push({ repo: e, dir, rel, abs, size })
  }
}
// Deterministic order: lexicographic by repo/rel, so a re-run with the same
// --sample measures the same files. A census whose sample drifts is not a census.
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
const ALL = files.length
const admitted = SAMPLE > 0 ? files.slice(0, SAMPLE) : files
let rev = ""
try { rev = execFileSync("git", ["-C", path.join(CR, REPOS[0] ?? "typescript"), "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch {}

// ── per-type accumulators ─────────────────────────────────────────────────────
type Row = {
  n: number
  files: Set<string>
  /** source binds to a symbol this FILE declares */
  srcFile: number
  /** target binds to a symbol this FILE declares */
  tgtFile: number
  /** source binds to some symbol in the PROJECT (accumulated so far) */
  srcProj: number
  tgtProj: number
  conf: Map<string, number>
  metaKeys: Map<string, number>
  relTypeMeta: Map<string, number>
  reason: Map<string, number>
  empty: number
  examples: string[]
}
const rows = new Map<Type, Row>()
const row = (t: Type): Row => {
  let r = rows.get(t)
  if (!r) {
    r = { n: 0, files: new Set(), srcFile: 0, tgtFile: 0, srcProj: 0, tgtProj: 0, conf: new Map(), metaKeys: new Map(), relTypeMeta: new Map(), reason: new Map(), empty: 0, examples: [] }
    rows.set(t, r)
  }
  return r
}

// ── R7: placeholder endpoints, BY SITE ────────────────────────────────────────
//
// A name that can be DECLARED is not a placeholder, so the test is: does the
// suspicious name occur as a declaration in this file? If it does, it is an
// identifier. If it does not, it is a fallback the analyzer invented — and each
// such site is attributed to the EMISSION SITE that produced it, because the
// remedy differs per site and a bag of strings cannot say which.
const SUSPECT = /^(root|global|unknown|anonymous|<anonymous>|constructor|self|this|super|none|null|undefined|object|class|module|default|<module>|<unknown>)$/i
let r7Hits = 0
let r7Undeclared = 0
const r7BySite = new Map<string, number>()
const r7Examples = new Map<string, string[]>()
const bumpSite = (t: Type, ep: string, declared: boolean, where: string) => {
  const k = `${t}:${ep || "<empty>"}${declared ? " (declared in file — an identifier)" : " (NOT declared — analyzer fallback)"}`
  r7BySite.set(k, (r7BySite.get(k) ?? 0) + 1)
  const ex = r7Examples.get(k) ?? []
  if (ex.length < 3) ex.push(where)
  r7Examples.set(k, ex)
}

// The project's symbol-name space, for the project-resolution half of q5.
const projectNames = new Set<string>()

let idx = 0
let parsed = 0
let threw = 0

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= admitted.length) return
    const f = admitted[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { threw++; continue }
    parsed++
    const label = `${f.repo}/${f.rel}`
    const syms: any[] = r.symbols ?? []
    const names = new Set<string>()
    for (const s of syms) {
      if (typeof s?.name !== "string" || !s.name) continue
      names.add(s.name)
      names.add(`${s.ownerName ?? ""}.${s.name}`)
      projectNames.add(s.name)
    }
    for (const rel of r.relationships ?? []) {
      const t = String(rel.type ?? rel.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      const R = row(t)
      R.n++
      if (R.files.size < 4000) R.files.add(label)
      const src = String(rel.source ?? rel.from ?? "")
      const tgt = String(rel.target ?? rel.to ?? "")
      if (src && names.has(src)) R.srcFile++
      if (tgt && names.has(tgt)) R.tgtFile++
      if (src && projectNames.has(src.split(".").pop() ?? src)) R.srcProj++
      if (tgt && projectNames.has(tgt.split(".").pop() ?? tgt)) R.tgtProj++
      const c = rel.confidence
      bump(R.conf, typeof c === "number" ? c.toFixed(2) : String(c ?? "undefined"))
      const md = rel.metadata ?? {}
      for (const k of Object.keys(md)) bump(R.metaKeys, k)
      if (typeof md.relationshipType === "string") bump(R.relTypeMeta, md.relationshipType)
      if (typeof md.reasonCode === "string") bump(R.reason, md.reasonCode)
      if (!src || !tgt) R.empty++
      for (const [ep, side] of [[src, "source"], [tgt, "target"]] as Array<[string, string]>) {
        if (!ep) { r7Hits++; r7Undeclared++; bumpSite(t, "<empty>", false, `${label}: ${side} is empty`); continue }
        if (!SUSPECT.test(ep)) continue
        r7Hits++
        const declared = names.has(ep)
        if (!declared) r7Undeclared++
        bumpSite(t, ep, declared, `${label}:${rel.line_number ?? "?"} ${side}=${ep} meta=${JSON.stringify(rel.metadata).slice(0, 90)}`)
      }
      if (R.examples.length < 6) R.examples.push(`${src} -[${t} conf=${c}]-> ${tgt}`)
    }
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

// ── report ────────────────────────────────────────────────────────────────────
const out: any = {
  lane: "typescript",
  instrument: "script/m14/typescript-ontology-census.ts",
  corpus_root: CR,
  repos: REPOS,
  pinned_rev: rev,
  tracked_typescript_files: ALL,
  files_measured: admitted.length,
  files_parsed: parsed,
  files_threw: threw,
  max_bytes_per_file: MAX_BYTES,
  project_symbol_names: projectNames.size,
  r7_suspect_endpoints: r7Hits,
  r7_endpoints_not_declared_in_their_file: r7Undeclared,
  r7_by_site: Object.fromEntries([...r7BySite.entries()].sort((a, b) => b[1] - a[1])),
  r7_examples: Object.fromEntries(r7Examples),
  types: {} as any,
}
const order = [...ALL_TYPES]
for (const t of order) {
  const R = rows.get(t)
  if (!R) {
    out.types[t] = { verdict: "NOT-EMITTED", edges: 0 }
    continue
  }
  out.types[t] = {
    verdict: "EMITTED",
    edges: R.n,
    files: R.files.size,
    example_files: [...R.files].slice(0, 5),
    resolve: {
      source_in_file: R.srcFile,
      target_in_file: R.tgtFile,
      source_in_project: R.srcProj,
      target_in_project: R.tgtProj,
      pct_source_in_file: +((R.srcFile / R.n) * 100).toFixed(1),
      pct_target_in_file: +((R.tgtFile / R.n) * 100).toFixed(1),
    },
    confidence: Object.fromEntries([...R.conf.entries()].sort((a, b) => b[1] - a[1])),
    below_0_7: [...R.conf.entries()].filter(([k]) => parseFloat(k) < 0.7).reduce((a, [, v]) => a + v, 0),
    metadata_keys: Object.fromEntries([...R.metaKeys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)),
    relationship_type_metadata: Object.fromEntries(R.relTypeMeta),
    reason_codes: Object.fromEntries([...R.reason.entries()].sort((a, b) => b[1] - a[1])),
    empty_endpoints: R.empty,
    examples: R.examples,
  }
}
const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`typescript ontology census — ${parsed}/${admitted.length} files parsed (${threw} threw), ${ALL} tracked .ts in corpus`)
console.log(`${pad("type", 14)}${pad("edges", 12)}${pad("files", 9)}${pad("src%file", 10)}${pad("tgt%file", 10)}${pad("<0.7", 9)}confidence`)
console.log("-".repeat(110))
for (const t of order) {
  const d = out.types[t]
  if (d.verdict !== "EMITTED") { console.log(`${pad(t, 14)}${"0 (NOT EMITTED)"}`); continue }
  console.log(`${pad(t, 14)}${pad(d.edges.toLocaleString(), 12)}${pad(String(d.files), 9)}${pad(String(d.resolve.pct_source_in_file), 10)}${pad(String(d.resolve.pct_target_in_file), 10)}${pad(String(d.below_0_7), 9)}${Object.keys(d.confidence).join(",")}`)
}
console.log("-".repeat(110))
console.log(`\nR7 suspect endpoints: ${r7Hits} total, ${r7Undeclared} of them NOT declared in their own file`)
for (const [k, v] of [...r7BySite.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(6)}  ${k}`)
  for (const ex of (r7Examples.get(k) ?? []).slice(0, 1)) console.log(`           e.g. ${ex.slice(0, 150)}`)
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify(out, null, 1))
  console.log(`\nwrote ${OUT}`)
}
