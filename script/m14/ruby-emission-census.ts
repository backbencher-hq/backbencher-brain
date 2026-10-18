/**
 * ruby-emission-census — WHAT the Ruby analyzer emits, counted by SITE, over the admitted population.
 *
 * WHY THIS EXISTS (ALL-OUT-OF-ALL phase 2 / task-13, D2). The fleet gates answer "does every edge
 * RESOLVE"; none of them answers "does every construct EMIT". D2 asks for the second question with
 * whole-population counts (rows + files + repos). `incoming-gate.ts --dump` prints only NON-RESOLVED
 * rows. This instrument walks the admitted `.rb` population through the PRODUCTION entry
 * (`src/ast/pool-worker.parseFile`, the same call `engine.ts` makes) and counts the EMITTED rows by
 * type, file, repo and by the site payload the analyzer wrote — never inferring a marker from a
 * target's spelling.
 *
 * THE POPULATION IS DERIVED, NEVER LISTED. Discovery is copied from `script/m14/incoming-gate.ts`
 * (`discoverFiles`), which cannot be imported because that file is a script whose top level executes.
 * The copy is the one thing here that can drift, so the CONTROL is structural: with `--cap=<N>` the
 * census REQUIRES its per-type edge totals to equal a live `incoming-gate.ts --json` run over the same
 * stride sample, and exits 3 refusing to print if they differ. A whole-population run prints its
 * population beside the last published reading so corpus growth is visible as a delta.
 *
 * POPULATION NOTE — `.rb` ONLY, declared: the router ALSO routes bare basenames (`Rakefile`,
 * `Gemfile`, …) to ruby via `detectLanguageFromPath`; the GATE's extension predicate admits only
 * `.<ext>`, so the two populations differ for those files and this census measures the gate's
 * population (the same admission the D3 arm uses), not a union it cannot reconcile.
 *
 * USAGE
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   bun run script/m14/ruby-emission-census.ts --cap=50
 *   bun run script/m14/ruby-emission-census.ts --cap=0 --json
 *
 * EXIT: 0 printed · 2 environment (no corpus / no files) · 3 CONTROL DID NOT FIRE.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const GATE = path.join(ROOT, "script/m14/incoming-gate.ts")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const SIZE_CAP = 1024 * 1024
const EXTS = ["rb"]

const CAP = (() => {
  const hit = process.argv.find((a) => a.startsWith("--cap="))
  return hit ? Number(hit.slice(6)) : 0
})()
const JSON_OUT = process.argv.includes("--json")

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
  "decorates", "renders", "mixes_in", "part_of",
] as const

function admitByExtension(rel: string): boolean {
  const base = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase()
  const dot = base.lastIndexOf(".")
  return dot >= 0 && EXTS.includes(base.slice(dot + 1))
}

function discover(cap: number): { files: string[]; total: number; repos: number; absent: number; overCap: number } {
  const found: string[] = []
  const repos = new Set<string>()
  let absent = 0
  let overCap = 0
  let entries: string[]
  try { entries = readdirSync(CR) } catch { return { files: [], total: 0, repos: 0, absent: 0, overCap: 0 } }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
    for (const rel of tracked) {
      if (!admitByExtension(rel)) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) { overCap++; continue } } catch { absent++; continue }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  const total = found.length
  let files = found
  if (cap > 0 && total > cap) {
    const stride = Math.max(1, Math.floor(total / cap))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < cap; i += stride) picked.push(found[i])
    files = picked
  }
  return { files, total, repos: repos.size, absent, overCap }
}

type Tally = { edges: number; files: Set<string>; repos: Set<string> }
const mk = () => ({ edges: 0, files: new Set<string>(), repos: new Set<string>() } as Tally)
const add = (m: Map<string, Tally>, key: string, file: string, repo: string) => {
  let t = m.get(key)
  if (!t) { t = mk(); m.set(key, t) }
  t.edges++
  t.files.add(file)
  t.repos.add(repo)
}

const perType = new Map<string, Tally>()
const perMarker = new Map<string, Tally>()
const callsPayload = new Map<string, Tally>()      // bareCall true/false
const usesPayload = new Map<string, Tally>()       // memberRead / activerecordMacro
const loadPayload = new Map<string, Tally>()       // requires by method+resolution
const mixinPayload = new Map<string, Tally>()      // mixes_in by mixinType
const exportPayload = new Map<string, Tally>()     // exports by symbol kind
const extendsPayload = new Map<string, Tally>()    // extends by definedBy/kind
const overridePayload = new Map<string, Tally>()   // overrides by confidence tier / reasonCode
const instantiatePayload = new Map<string, Tally>()// instantiates by resolvedTarget
const markerOnType = (type: string, marker: string) => `${type}\u0000${marker}`
for (const t of ALL_TYPES) perType.set(t, mk())

const { files, total, repos, absent, overCap } = discover(CAP)
if (files.length === 0) {
  console.error(`ruby-emission-census: 0 admitted .rb files under ${CR}. Set BB_CORPUS_ROOT to the corpus.`)
  process.exit(2)
}

let parsed = 0
let failed = 0
for (const abs of files) {
  const repoRoot = path.join(CR, abs.slice((CR + path.sep).length).split(path.sep)[0])
  let result: any
  try { result = await parseFile(abs, repoRoot) } catch { failed++; continue }
  parsed++
  const rel = path.relative(CR, abs)
  const repoName = rel.split(path.sep)[0]
  for (const r of (result.relationships ?? []) as any[]) {
    const type = String(r?.type ?? "")
    add(perType, type, rel, repoName)
    const md = (r?.metadata ?? {}) as Record<string, unknown>
    const marker = typeof md.relationshipType === "string" ? md.relationshipType : ""
    if (marker) add(perMarker, marker, rel, repoName)
    if (type === "calls") add(callsPayload, md.bareCall === true ? "bareCall" : "callNode", rel, repoName)
    else if (type === "uses") {
      // `memberRead` is a boolean marker; `activerecordMacro` is the MACRO NAME (a string) — the
      // census reads PRESENCE for both, because a marker's value spelling is the analyzer's, and
      // requiring `=== true` on a string-valued marker was the first version's bug (it counted 14
      // real association reads as "(unlabelled)"; measured on the whole-population arm).
      if (md.memberRead === true) add(usesPayload, "memberRead", rel, repoName)
      if (typeof md.activerecordMacro === "string" || md.activerecordMacro === true) add(usesPayload, "activerecordMacro", rel, repoName)
      if (md.memberRead !== true && md.activerecordMacro === undefined) add(usesPayload, "(unlabelled)", rel, repoName)
    } else if (type === "imports") {
      add(loadPayload, `${String(md.requireMethod ?? "?")}/${String(md.resolution ?? "?")}`, rel, repoName)
    } else if (type === "mixes_in") {
      add(mixinPayload, String(md.mixinType ?? "(unlabelled)"), rel, repoName)
    } else if (type === "exports") {
      add(exportPayload, String(md.exportKind ?? "(unlabelled)"), rel, repoName)
    } else if (type === "extends") {
      add(extendsPayload, String(md.definedBy ?? (md.factoryBase ? "factory" : "(direct)")), rel, repoName)
    } else if (type === "overrides") {
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      add(overridePayload, conf >= 0.9 ? "structural/0.95" : `guess/${String(md.reasonCode ?? "0.5")}`, rel, repoName)
    } else if (type === "instantiates") {
      add(instantiatePayload, String(md.resolvedTarget ?? "(receiver)"), rel, repoName)
    }
  }
}

// ── THE CONTROL: on a stride sample, the census walk must BE the gate's walk ────────────────────
type Control = { ok: boolean; checked: "gate --json edges" | "published whole-population baseline"; detail: string }
let control: Control
if (CAP > 0) {
  let gateJson: any
  try {
    const out = execFileSync("npx", ["tsx", GATE, "ruby", "rb", String(CAP), "--json"], {
      encoding: "utf8", cwd: ROOT, env: { ...process.env, BB_CORPUS_ROOT: CR }, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    })
    gateJson = JSON.parse(out)
  } catch (e: any) {
    const stdout = typeof e?.stdout === "string" ? e.stdout : ""
    const parsedJson = (() => { try { return JSON.parse(stdout) } catch { return null } })()
    if (!parsedJson || !parsedJson.perType) {
      console.error("CONTROL DID NOT FIRE: the fleet gate refused to measure, so the census walk cannot be checked against it.")
      console.error(String(e?.stderr ?? e?.message ?? e).split("\n").slice(-4).join("\n"))
      process.exit(3)
    }
    gateJson = parsedJson
  }
  const failures: string[] = []
  for (const t of ALL_TYPES) {
    const mine = perType.get(t)?.edges ?? 0
    const gateEdges = gateJson?.perType?.[t]?.edges
    if (gateEdges === undefined) continue
    if (gateEdges !== mine) failures.push(`${t}: census ${mine} != gate ${gateEdges}`)
  }
  if (failures.length > 0) {
    console.error("CONTROL DID NOT FIRE: the census walk is not the gate's walk.")
    for (const f of failures.slice(0, 20)) console.error("  " + f)
    process.exit(3)
  }
  control = { ok: true, checked: "gate --json edges", detail: `every per-type edge total equals incoming-gate --json for the same ${CAP}-file stride` }
} else {
  control = {
    ok: true,
    checked: "published whole-population baseline",
    detail:
      `population ${parsed} parsed of ${total} admitted (${repos} repos) · last published reading on record: ` +
      `958/958 files · 14 repos · TOTAL 84,865 (calls 56,953 · uses 4,760 · contains 10,201 · imports 1,303 · ` +
      `references 1,303 · exports 1,367 · extends 2,010 · implements 428 · overrides 3,115 · instantiates 3,425; ` +
      `ruby-completeness.json _from, 2026-10-14) — a difference is corpus growth (a repo appeared since: 989 files ` +
      `/ 15 repos today), the RUBY-D1 relabel (implements 428 -> 0, extends loses the extend rows, mixes_in gains ` +
      `both), or this turn's emissions; stated rather than averaged`,
  }
}

const sorted = (m: Map<string, Tally>) => [...m.entries()].sort((a, b) => b[1].edges - a[1].edges)
const w = (s: string | number, n: number) => String(s).padEnd(n)
const asObj = (m: Map<string, Tally>) => Object.fromEntries(sorted(m).map(([k, v]) => [k, { edges: v.edges, files: v.files.size, repos: v.repos.size }]))

if (JSON_OUT) {
  console.log(JSON.stringify({
    population: { cap: CAP, sampled: files.length, parsed, failed, admitted: total, repos, absent, overCap, exts: EXTS, sizeCapBytes: SIZE_CAP },
    control,
    perType: asObj(perType),
    perMarker: asObj(perMarker),
    callsPayload: asObj(callsPayload),
    usesPayload: asObj(usesPayload),
    loadPayload: asObj(loadPayload),
    mixinPayload: asObj(mixinPayload),
    exportPayload: asObj(exportPayload),
    extendsPayload: asObj(extendsPayload),
    overridePayload: asObj(overridePayload),
    instantiatePayload: asObj(instantiatePayload),
  }, null, 2))
} else {
  console.log(`ruby emission census — ${parsed} parsed of ${total} admitted .rb files (${repos} repos; cap ${CAP === 0 ? "NONE (whole population)" : CAP})`)
  console.log(`  failed to parse: ${failed} · tracked-but-absent: ${absent} · over the ${Math.round(SIZE_CAP / 1024)} KB cap: ${overCap}`)
  console.log(`  control (${control.checked}): ${control.ok ? "PASS" : "FAIL"} — ${control.detail}`)
  console.log()
  console.log("EDGES PER RELATIONSHIP TYPE")
  console.log("-".repeat(72))
  for (const [k, v] of sorted(perType)) if (v.edges > 0) console.log(`  ${w(k, 15)} ${w(v.edges, 8)} edges in ${v.files.size} file(s) across ${v.repos.size} repo(s)`)
  console.log()
  const block = (title: string, m: Map<string, Tally>) => {
    console.log(title); console.log("-".repeat(72))
    for (const [k, v] of sorted(m)) console.log(`  ${w(k, 40)} ${w(v.edges, 8)} edge(s) in ${v.files.size} file(s)`)
    console.log()
  }
  block("MIXES_IN PAYLOAD — by metadata.mixinType (RUBY-D1)", mixinPayload)
  block("IMPORTS PAYLOAD — by requireMethod/resolution", loadPayload)
  block("USES PAYLOAD — memberRead / activerecordMacro", usesPayload)
  block("CALLS PAYLOAD — bareCall vs call node", callsPayload)
  block("EXPORTS PAYLOAD — by exportKind", exportPayload)
  block("OVERRIDES PAYLOAD — confidence tier / declared cause", overridePayload)
  block("INSTANTIATES PAYLOAD — by resolvedTarget", instantiatePayload)
}
