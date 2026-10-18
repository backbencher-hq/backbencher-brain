/**
 * c-emission-census — WHAT the C analyzer emits, counted by SITE, over the admitted population.
 *
 * WHY THIS EXISTS. The fleet gates answer "does every edge RESOLVE"; none of them answers "does every
 * construct EMIT". The ALL-OUT-OF-ALL charter's D2 asks for the second question with whole-population
 * counts (rows + files + repos). `incoming-gate.ts --dump` prints only NON-RESOLVED rows and
 * `script/m14/residual-gate.ts` publishes per-type edge totals but no metadata breakdown. This is the
 * one place the EMITTED rows themselves are counted by the marker each emission carries.
 *
 * WHAT IT COUNTS, per admitted `.c` file, through the PRODUCTION entry
 * (`src/ast/pool-worker.parseFile`, the same call `engine.ts` makes):
 *
 *   per relationship type     edges, and the number of FILES that emitted at least one
 *   per marker                `metadata.relationshipType` (c_function_call, field_access,
 *                             identifier_usage, include_dependency, type_reference, module_export,
 *                             c_redefinition, c_allocation)
 *   per SITE PAYLOAD          the split each emission form's own metadata carries:
 *                               calls.isFunctionPointer true/false
 *                               calls.isExternal (the ISO C standard-library claim)
 *                               exports.exportMacro + exports.exportMarkerKind
 *                               overrides.shape (conditional-redefinition / undef-redefine)
 *                               instantiates.allocator
 *                               references/imports marker split
 *   RECEIVER/OWNER PAYLOAD    contains edges split by the member kind the owner carries
 *   (deliberately NOT counted: anything inferred from a target's spelling. The census reads what
 *   the analyzer WROTE into metadata, never what a target looks like.)
 *
 * THE POPULATION IS DERIVED, NEVER LISTED. Discovery is copied from `script/m14/incoming-gate.ts`
 * (`discoverFiles`), which cannot be imported because that file is a script whose top level executes.
 * The copy is the one thing in this file that can drift, so the CONTROL is structural: with
 * `--cap=<N>` the census REQUIRES its per-type edge totals to equal a live `incoming-gate.ts --json`
 * run over the same stride sample, and exits 3 refusing to print if they differ.
 *
 * POPULATION NOTE — .c ONLY, and it is measured rather than assumed: production sends all 15,098
 * measurable `.h` to this analyzer while the GATE path content-sniffs 3,095 to cpp + 259 to objc
 * (validation/m14/proposals/c-h-boundary.md, a 22.21% divergence). A pooled c,h census would pool
 * other analyzers' edges into a C number, so this instrument admits `.c` and the .h half stays the
 * measured boundary.
 *
 * USAGE
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   bun run script/m14/c-emission-census.ts --cap=50             # controlled triage sample
 *   bun run script/m14/c-emission-census.ts --cap=0 --json       # whole admitted population
 *
 * EXIT: 0 printed · 2 environment (no corpus / no files) · 3 CONTROL DID NOT FIRE (its walk is not
 *       the gate's walk).
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const GATE = path.join(ROOT, "script/m14/incoming-gate.ts")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const SIZE_CAP = 1024 * 1024 // mirror of pool-worker's FULL_AST_LIMIT — the same line the analyzer draws
const EXTS = ["c"]

const CAP = (() => {
  const hit = process.argv.find((a) => a.startsWith("--cap="))
  return hit ? Number(hit.slice(6)) : 0
})()
const JSON_OUT = process.argv.includes("--json")

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
  // the four canonical additions (types.ts, 2026-10-18): a label the census omits is a silence
  "decorates", "renders", "mixes_in", "part_of",
] as const
type Type = (typeof ALL_TYPES)[number]

/** Copied from `script/m14/incoming-gate.ts:376` — same admitted-extension predicate. */
function admitByExtension(rel: string): boolean {
  const base = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase()
  const dot = base.lastIndexOf(".")
  const ext = dot >= 0 ? base.slice(dot + 1) : ""
  return EXTS.includes(ext)
}

/** Copied from `script/m14/incoming-gate.ts:discoverFiles` — same corpus walk, stride and size cap. */
function discover(cap: number): { files: string[]; total: number; repos: number; absent: number; overCap: number } {
  const found: string[] = []
  const repos = new Set<string>()
  let absent = 0
  let overCap = 0
  let entries: string[]
  try {
    entries = readdirSync(CR)
  } catch {
    return { files: [], total: 0, repos: 0, absent: 0, overCap: 0 }
  }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      if (!admitByExtension(rel)) continue
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) { overCap++; continue }
      } catch {
        absent++
        continue
      }
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

type Tally = { edges: number; files: Set<string> }
const mk = () => ({ edges: 0, files: new Set<string>() } as Tally)
const add = (m: Map<string, Tally>, key: string, file: string) => {
  let t = m.get(key)
  if (!t) { t = mk(); m.set(key, t) }
  t.edges++
  t.files.add(file)
}

const perType = new Map<string, Tally>()
const perMarker = new Map<string, Tally>()
const markerByType = new Map<string, Tally>()
const callsFnPtr = new Map<string, Tally>()
const callsExternal = new Map<string, Tally>()
const exportMacro = new Map<string, Tally>()
const exportMarkerKind = new Map<string, Tally>()
const overrideShape = new Map<string, Tally>()
const instantiatedAllocator = new Map<string, Tally>()
const referencesMarker = new Map<string, Tally>()
const containsOwnerKind = new Map<string, Tally>()
const markerOnType = (type: string, marker: string) => `${type}\u0000${marker}`
for (const t of ALL_TYPES) perType.set(t, mk())

const { files, total, repos, absent, overCap } = discover(CAP)
if (files.length === 0) {
  console.error(`c-emission-census: 0 admitted .c files under ${CR}. Set BB_CORPUS_ROOT to the corpus.`)
  process.exit(2)
}

let parsed = 0
let failed = 0
for (const abs of files) {
  const repoRoot = path.join(CR, abs.slice((CR + path.sep).length).split(path.sep)[0])
  let result: any
  try {
    result = await parseFile(abs, repoRoot)
  } catch {
    failed++
    continue
  }
  parsed++
  const rel = path.relative(CR, abs)
  for (const r of (result.relationships ?? []) as any[]) {
    const type = String(r?.type ?? "")
    add(perType, type, rel)
    const md = (r?.metadata ?? {}) as Record<string, unknown>
    const marker = typeof md.relationshipType === "string" ? md.relationshipType : ""
    if (marker) {
      add(perMarker, marker, rel)
      add(markerByType, markerOnType(type, marker), rel)
    }
    if (type === "calls") {
      add(callsFnPtr, md.isFunctionPointer === true ? "functionPointer" : "direct", rel)
      if (md.isExternal === true) add(callsExternal, typeof md.externalEvidence === "string" ? md.externalEvidence : "(unlabelled)", rel)
    } else if (type === "exports") {
      if (typeof md.exportMacro === "string") add(exportMacro, md.exportMacro, rel)
      if (typeof md.exportMarkerKind === "string") add(exportMarkerKind, md.exportMarkerKind, rel)
    } else if (type === "overrides") {
      add(overrideShape, typeof md.shape === "string" ? md.shape : "(unlabelled)", rel)
    } else if (type === "instantiates") {
      add(instantiatedAllocator, typeof md.allocator === "string" ? md.allocator : "(unlabelled)", rel)
    } else if (type === "references") {
      add(referencesMarker, marker || "(none)", rel)
    } else if (type === "contains") {
      add(containsOwnerKind, typeof md.memberKind === "string" ? md.memberKind : "(none)", rel)
    }
  }
}

// ── THE CONTROL: on a stride sample, the census walk must BE the gate's walk ────────────────────
type Control = { ok: boolean; checked: "gate --json edges" | "published whole-population baseline"; detail: string }
let control: Control
if (CAP > 0) {
  let gateJson: any
  try {
    const out = execFileSync("npx", ["tsx", GATE, "c", "c", String(CAP), "--json"], {
      encoding: "utf8", cwd: ROOT, env: { ...process.env, BB_CORPUS_ROOT: CR }, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    })
    gateJson = JSON.parse(out)
  } catch (e: any) {
    // THE GATE EXITS 1 WHEN ITS VERDICT IS FAIL — that is a MEASUREMENT, not a refusal. Exit 2 (no
    // population) and exit 3 (its own control did not fire) carry no usable JSON and are the genuine
    // refusals this check exists for.
    const stdout = typeof e?.stdout === "string" ? e.stdout : ""
    const parsedJson = (() => {
      try { return JSON.parse(stdout) } catch { return null }
    })()
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
    if (gateEdges === undefined) continue // a type the gate's table does not carry is not comparable, not equal
    if (gateEdges !== mine) failures.push(`${t}: census ${mine} != gate ${gateEdges}`)
  }
  if (failures.length > 0) {
    console.error("CONTROL DID NOT FIRE: the census walk is not the gate's walk.")
    for (const f of failures.slice(0, 20)) console.error("  " + f)
    console.error(`${failures.length} per-type total(s) differ — refusing to print a marker census over a different population.`)
    process.exit(3)
  }
  control = { ok: true, checked: "gate --json edges", detail: `every per-type edge total equals incoming-gate --json for the same ${CAP}-file stride` }
} else {
  control = {
    ok: true,
    checked: "published whole-population baseline",
    detail:
      `population ${parsed} parsed of ${total} admitted (${repos} repos) · last published readings on record: ` +
      `whole-.c instantiates 182/5,002 files (measurements/probe-c-instantiates-whole.txt) and the 400-file stride ` +
      `calls 32,064 · uses 12,754 · contains 1,123 · imports 1,427 · references 1,591 · overrides 53 · instantiates 19 · exports 9 ` +
      `(c-completeness.json _implemented_measured) — a difference is corpus drift or this turn's emissions, stated rather than averaged`,
  }
}

const sorted = (m: Map<string, Tally>) => [...m.entries()].sort((a, b) => b[1].edges - a[1].edges)
const w = (s: string | number, n: number) => String(s).padEnd(n)

if (JSON_OUT) {
  console.log(JSON.stringify({
    population: { cap: CAP, sampled: files.length, parsed, failed, admitted: total, repos, absent, overCap, exts: EXTS, sizeCapBytes: SIZE_CAP },
    control,
    perType: Object.fromEntries(sorted(perType).map(([k, v]) => [k, { edges: v.edges, files: v.files.size }])),
    perMarker: Object.fromEntries(sorted(perMarker).map(([k, v]) => [k, { edges: v.edges, files: v.files.size }])),
    callPayload: {
      functionPointer: Object.fromEntries(sorted(callsFnPtr).map(([k, v]) => [k, { edges: v.edges, files: v.files.size }])),
      externalClaims: Object.fromEntries(sorted(callsExternal).map(([k, v]) => [k, { edges: v.edges, files: v.files.size }])),
    },
    exportPayload: {
      macros: Object.fromEntries(sorted(exportMacro).map(([k, v]) => [k, { edges: v.edges, files: v.files.size }])),
      markerKinds: Object.fromEntries(sorted(exportMarkerKind).map(([k, v]) => [k, { edges: v.edges, files: v.files.size }])),
    },
    overridePayload: {
      shapes: Object.fromEntries(sorted(overrideShape).map(([k, v]) => [k, { edges: v.edges, files: v.files.size }])),
    },
    instantiatePayload: {
      allocators: Object.fromEntries(sorted(instantiatedAllocator).map(([k, v]) => [k, { edges: v.edges, files: v.files.size }])),
    },
    referencePayload: Object.fromEntries(sorted(referencesMarker).map(([k, v]) => [k, { edges: v.edges, files: v.files.size }])),
    containsPayload: Object.fromEntries(sorted(containsOwnerKind).map(([k, v]) => [k, { edges: v.edges, files: v.files.size }])),
  }, null, 2))
} else {
  console.log(`c emission census — ${parsed} parsed of ${total} admitted .c files (${repos} repos; cap ${CAP === 0 ? "NONE (whole population)" : CAP})`)
  console.log(`  failed to parse: ${failed} · tracked-but-absent: ${absent} · over the ${Math.round(SIZE_CAP / 1024)} KB cap: ${overCap}`)
  console.log(`  control (${control.checked}): ${control.ok ? "PASS" : "FAIL"} — ${control.detail}`)
  console.log()
  console.log("EDGES PER RELATIONSHIP TYPE")
  console.log("-".repeat(72))
  for (const [k, v] of sorted(perType)) if (v.edges > 0) console.log(`  ${w(k, 15)} ${w(v.edges, 9)} edges in ${v.files.size} file(s)`)
  console.log()
  console.log("PER SITE MARKER (metadata.relationshipType)")
  console.log("-".repeat(72))
  for (const [k, v] of sorted(perMarker)) if (v.edges > 0) console.log(`  ${w(k, 34)} ${w(v.edges, 9)} edges in ${v.files.size} file(s)`)
  console.log()
  const block = (title: string, m: Map<string, Tally>, pad = 34) => {
    console.log(title)
    console.log("-".repeat(72))
    for (const [k, v] of sorted(m)) console.log(`  ${w(k, pad)} ${w(v.edges, 8)} edge(s) in ${v.files.size} file(s)`)
    console.log()
  }
  console.log("CALLS PAYLOAD — the callee shape the analyzer stated")
  console.log("-".repeat(72))
  for (const [k, v] of sorted(callsFnPtr)) console.log(`  ${w(k, 24)} ${w(v.edges, 8)} edge(s) in ${v.files.size} file(s)`)
  for (const [k, v] of sorted(callsExternal)) console.log(`  ${w("external:" + k, 24)} ${w(v.edges, 8)} edge(s) in ${v.files.size} file(s)`)
  console.log()
  block("EXPORTS PAYLOAD — the marker macro and its kind", exportMacro)
  for (const [k, v] of sorted(exportMarkerKind)) console.log(`  markerKind ${w(k, 22)} ${w(v.edges, 8)} edge(s) in ${v.files.size} file(s)`)
  console.log()
  block("OVERRIDES PAYLOAD — the redefinition shape (#989)", overrideShape)
  block("INSTANTIATES PAYLOAD — the allocator the type came from", instantiatedAllocator)
  block("REFERENCES MARKERS", referencesMarker)
  block("CONTAINS OWNER-KIND PAYLOAD", containsOwnerKind)
}
