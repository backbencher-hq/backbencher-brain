/**
 * java-emission-census — WHAT the Java analyzer emits, counted by SITE, over the admitted population.
 *
 * WHY THIS EXISTS. The fleet gates answer "does every edge RESOLVE"; none of them answers "does every
 * construct EMIT". The owner ruling of 2026-10-18 asks for the second question with counts: a gap
 * closes by implementing the emission AND measuring that the site fires on the corpus, and the
 * Java-only constructs (annotations, throws, bounds, enum constant bodies, record components) each
 * need a population count rather than a probe. `script/m14/residual-gate.ts` publishes per-type edge
 * totals but no metadata breakdown; `incoming-gate.ts --dump` prints only NON-RESOLVED rows. This is
 * the one place the EMITTED rows themselves are counted by the marker each emission carries.
 *
 * WHAT IT COUNTS, per admitted `.java` file, through the PRODUCTION entry
 * (`src/ast/pool-worker.parseFile`, the same call `engine.ts` makes):
 *
 *   per relationship type     edges, and the number of FILES that emitted at least one
 *   per marker                `metadata.relationshipType` (declared_type, throws_type, annotation,
 *                             type_parameter_bound, record_pattern, constructor_invocation, …)
 *   GAP MARKERS               the four #419 gaps and the fixture that pins each:
 *                               G1 uses.isArrayAccess              java/array-access-uses
 *                               G2 calls.constructor_invocation    java/ctor-delegation
 *                               G3 references.record_pattern       java/record-pattern-refs
 *                               G4 calls.inInitializer              java/initializer-calls
 *   RECEIVER PAYLOAD          calls edges carrying metadata.owner, split by metadata.ownerEvidence
 *                             ({field,param,local,return}) — the counts the owner-carrying channel
 *                             is priced with. NEVER a resolution claim: the store's
 *                             member-owner-resolution.ts decides resolution, not this file.
 *   ANNOTATIONS               annotation edges split by `annotatedKind` (class/method/field/param/
 *                             local/enum constant/record component/package/…)
 *
 * THE POPULATION IS DERIVED, NEVER LISTED. Discovery is copied from `script/m14/incoming-gate.ts`
 * (`discoverFiles`), which cannot be imported because that file is a script whose top level executes.
 * The copy is the one thing in this file that can drift, so the CONTROL is structural: with
 * `--cap=<N>` the census REQUIRES its per-type edge totals to equal a live
 * `incoming-gate.ts --json` run over the same stride sample, and exits 3 refusing to print if they
 * differ. A whole-population run (`--cap=0`) prints its population beside the last published
 * whole-population reading (java-completeness.json `_implemented_measured`) so a corpus change is
 * visible as a delta rather than silently averaged away.
 *
 * USAGE
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   bun run script/m14/java-emission-census.ts --cap=50             # controlled triage sample
 *   bun run script/m14/java-emission-census.ts --cap=0 --json       # whole admitted population
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
const EXTS = ["java"]

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

/** The site markers each emitted edge carries. An edge may carry one marker; the census never
 *  infers a marker from a target's spelling — it reads what the analyzer wrote. */
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
const ownerEvidence = new Map<string, Tally>()
/** BOOLEAN site markers: flags written as `metadata.<key> === true`, NOT relationshipType
 *  sub-labels. G1 (`isArrayAccess`) and G4 (`inInitializer`) are booleans, so counting them in
 *  the relationshipType map reads a measured zero for a site that fired — the first version of
 *  this census did exactly that and printed G1 0 / G4 0 beside a fixture that passes. */
const booleanMarkers = new Map<string, Tally>()
const BOOLEAN_MARKER_KEYS = ["isArrayAccess", "inInitializer"] as const
const annotatedKind = new Map<string, Tally>()
const markerOnType = (type: string, marker: string) => `${type}\u0000${marker}`
for (const t of ALL_TYPES) perType.set(t, mk())

const { files, total, repos, absent, overCap } = discover(CAP)
if (files.length === 0) {
  console.error(`java-emission-census: 0 admitted .java files under ${CR}. Set BB_CORPUS_ROOT to the corpus.`)
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
    if (type === "calls" && typeof md.owner === "string" && md.owner.length > 0) {
      const ev = typeof md.ownerEvidence === "string" ? md.ownerEvidence : "(unlabelled)"
      add(ownerEvidence, ev, rel)
    }
    for (const bkey of BOOLEAN_MARKER_KEYS) {
      if (md[bkey] === true) add(booleanMarkers, bkey, rel)
    }
    if (type === "references" && md.isAnnotation === true) {
      const kind = typeof md.annotatedKind === "string" ? md.annotatedKind : "(unlabelled)"
      add(annotatedKind, kind, rel)
    }
  }
}

// ── THE CONTROL: on a stride sample, the census walk must BE the gate's walk ────────────────────
type Control = { ok: boolean; checked: "gate --json edges" | "published whole-population baseline"; detail: string }
let control: Control
if (CAP > 0) {
  let gateJson: any
  try {
    const out = execFileSync("npx", ["tsx", GATE, "java", "java", String(CAP), "--json"], {
      encoding: "utf8", cwd: ROOT, env: { ...process.env, BB_CORPUS_ROOT: CR }, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    })
    gateJson = JSON.parse(out)
  } catch (e: any) {
    // THE GATE EXITS 1 WHEN ITS VERDICT IS FAIL — that is a MEASUREMENT, not a refusal, and a census
    // control that treated it as one could only ever fire on a passing lane. The JSON on stdout is
    // the measurement; exit 2 (no population) and exit 3 (its own control did not fire) carry NO
    // usable JSON and are the genuine refusals this check exists for.
    const stdout = typeof e?.stdout === "string" ? e.stdout : ""
    const parsed = (() => {
      try { return JSON.parse(stdout) } catch { return null }
    })()
    if (!parsed || !parsed.perType) {
      console.error("CONTROL DID NOT FIRE: the fleet gate refused to measure, so the census walk cannot be checked against it.")
      console.error(String(e?.stderr ?? e?.message ?? e).split("\n").slice(-4).join("\n"))
      process.exit(3)
    }
    gateJson = parsed
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
  // Whole-population runs cannot re-run the gate cheaply (it also resolves every edge); they print
  // the population beside the last published reading so a corpus change is a visible delta.
  control = {
    ok: true,
    checked: "published whole-population baseline",
    detail:
      `population ${parsed} parsed of ${total} admitted (${repos} repos) · last published whole-population reading: ` +
      `11,152 files / 19 repos / 1,377,933 edges — compare per-type totals below; a difference is corpus drift or this turn's emissions, stated rather than averaged`,
  }
}

const sorted = (m: Map<string, Tally>) => [...m.entries()].sort((a, b) => b[1].edges - a[1].edges)
const w = (s: string | number, n: number) => String(s).padEnd(n)

if (JSON_OUT) {
  console.log(JSON.stringify({
    population: { cap: CAP, sampled: files.length, parsed, failed, admitted: total, repos, absent, overCap },
    control,
    perType: Object.fromEntries(sorted(perType).map(([k, v]) => [k, { edges: v.edges, files: v.files.size }])),
    perMarker: Object.fromEntries(sorted(perMarker).map(([k, v]) => [k, { edges: v.edges, files: v.files.size }])),
    gapMarkers: {
      G1: { site: "uses.isArrayAccess", edges: booleanMarkers.get("isArrayAccess")?.edges ?? 0, files: booleanMarkers.get("isArrayAccess")?.files.size ?? 0 },
      G2: { site: "calls.relationshipType=constructor_invocation", edges: markerByType.get(markerOnType("calls", "constructor_invocation"))?.edges ?? 0, files: markerByType.get(markerOnType("calls", "constructor_invocation"))?.files.size ?? 0 },
      G3: { site: "references.relationshipType=record_pattern", edges: markerByType.get(markerOnType("references", "record_pattern"))?.edges ?? 0, files: markerByType.get(markerOnType("references", "record_pattern"))?.files.size ?? 0 },
      G4: { site: "calls.inInitializer", edges: booleanMarkers.get("inInitializer")?.edges ?? 0, files: booleanMarkers.get("inInitializer")?.files.size ?? 0 },
    },
    receiverPayload: Object.fromEntries(sorted(ownerEvidence).map(([k, v]) => [k, { edges: v.edges, files: v.files.size }])),
    annotationKinds: Object.fromEntries(sorted(annotatedKind).map(([k, v]) => [k, { edges: v.edges, files: v.files.size }])),
  }, null, 2))
} else {
  console.log(`java emission census — ${parsed} parsed of ${total} admitted .java files (${repos} repos; cap ${CAP === 0 ? "NONE (whole population)" : CAP})`)
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
  console.log("  (relationshipType sub-labels; boolean site markers are counted in the GAP MARKERS block)")
  console.log()
  console.log("GAP MARKERS (#419 closure — a marker with 0 edges is a STILL-OPEN gap, not a ruled one)")
  console.log("-".repeat(72))
  const g = (label: string, site: string, edges: number, files2: number, fixture: string) =>
    console.log(`  ${w(label, 3)} ${w(site, 46)} ${w(edges, 8)} edges in ${files2} file(s)   fixture: ${fixture}`)
  g("G1", "uses.isArrayAccess", booleanMarkers.get("isArrayAccess")?.edges ?? 0, booleanMarkers.get("isArrayAccess")?.files.size ?? 0, "java/array-access-uses")
  g("G2", "calls.constructor_invocation", markerByType.get(markerOnType("calls", "constructor_invocation"))?.edges ?? 0, markerByType.get(markerOnType("calls", "constructor_invocation"))?.files.size ?? 0, "java/ctor-delegation")
  g("G3", "references.record_pattern", markerByType.get(markerOnType("references", "record_pattern"))?.edges ?? 0, markerByType.get(markerOnType("references", "record_pattern"))?.files.size ?? 0, "java/record-pattern-refs")
  g("G4", "calls.inInitializer", booleanMarkers.get("inInitializer")?.edges ?? 0, booleanMarkers.get("inInitializer")?.files.size ?? 0, "java/initializer-calls")
  console.log()
  console.log("RECEIVER PAYLOAD — calls edges carrying metadata.owner, by metadata.ownerEvidence")
  console.log("  (counts of what the ANALYZER stated; resolution through the owner channel is")
  console.log("   src/ast/member-owner-resolution.ts's decision and is NOT claimed here)")
  console.log("-".repeat(72))
  for (const ev of ["field", "param", "local", "return", "(unlabelled)"]) {
    const hit = ownerEvidence.get(ev)
    if (hit) console.log(`  ${w(ev, 12)} ${w(hit.edges, 8)} edge(s) in ${hit.files.size} file(s)`)
  }
  console.log()
  console.log("ANNOTATION EDGES BY ANNOTATED DECLARATION KIND")
  console.log("-".repeat(72))
  for (const [k, v] of sorted(annotatedKind)) console.log(`  ${w(k, 36)} ${w(v.edges, 8)} edge(s) in ${v.files.size} file(s)`)
}
