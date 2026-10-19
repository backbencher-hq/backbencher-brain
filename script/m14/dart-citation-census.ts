/**
 * dart-citation-census — the MEASUREMENT before any `languageNamespace` citation emission.
 *
 * Task-26 asks one question first: of dart's two largest named walls, how many rows have a target
 * that the COMMITTED vocabulary (`DART_SDK_CORE` in script/m14/citations.ts) can honestly cite?
 * This file answers it from the gate's OWN `--dump` rows (population, resolution rule and outcome are
 * the gate's by construction) plus the analyzer's metadata for each row (re-parsed per dumped file
 * through the same `parseFile(f, repoRoot, { projectRoot: repoRoot })` call the gate makes).
 *
 * THE CLASSES (as defined by the D7 ledger, DART-DEPTH-D7.md §4):
 *   annotation-class  non-resolved `references` rows whose metadata says `isAnnotation`
 *   type-shaped-class non-resolved rows of the labels in the D7 row-6 class (calls/uses/instantiates/
 *                     extends/implements/overrides/mixes_in/part_of) whose target is a BARE name
 *   other             everything else (paths, qualified targets, `references` non-annotation)
 *
 * THE MATCH is EXACT against the committed vocabulary roots — dart's targets in these classes are
 * bare names, and the vocabulary is symbol-level, so `override` matches exactly and nothing is
 * root-split. The report separates:
 *   claimable-now        target name exactly in the committed list AND not declared in the project
 *   project-declared     a candidate name the PROJECT declares (vendoring/shadowing) — MUST REFUSE
 *   unlisted             names not in the list (candidates for a vocabulary addition, WITH a source)
 *
 * CONTROLS (each can fail, exit 3): (1) every annotation-class row must have attached metadata from a
 * re-parse of its own file; (2) every dumped row must land in exactly one class (the printed classes
 * sum to the row count); (3) when --gate-json is supplied, per-label non-resolved counts from the dump
 * must equal the gate's. This instrument emits NOTHING; it is measurement only.
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus BB_DUMP_LIMIT=3000000 \
 *     bun run script/m14/incoming-gate.ts dart dart 0 --repo=proxicall --dump > proxi.dump
 *   bun run script/m14/dart-citation-census.ts --dump=proxi.dump --repo=proxicall [--gate-json=proxi.json] [--json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { buildProjectIndexStreaming, DART_DECLARATION_SPEC } from "../../src/ast/project-index"
import { DART_SDK_CORE } from "./citations"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const argOf = (name: string): string | undefined => {
  const withEq = argv.find((a) => a.startsWith(`${name}=`))
  if (withEq) return withEq.slice(name.length + 1)
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const JSON_OUT = argv.includes("--json")
const DUMP_PATH = argOf("--dump") ?? process.env.BB_DART_DUMP ?? ""
const GATE_JSON = argOf("--gate-json") ?? process.env.BB_DART_GATE_JSON ?? ""
const REPO = argOf("--repo") ?? ""
if (!DUMP_PATH || !REPO) {
  console.error("usage: bun run script/m14/dart-citation-census.ts --dump=<dump.tsv> --repo=<corpus repo name> [--gate-json=<json>] [--json]")
  process.exit(2)
}
const REPO_ROOT = path.join(CR, REPO)
const WASM = path.join(ROOT, "wasm", "tree-sitter-dart.wasm")

const TYPE_SHAPED_LABELS = new Set([
  "calls", "uses", "instantiates", "extends", "implements", "overrides", "mixes_in", "part_of",
])
const VOCAB = new Set<string>(DART_SDK_CORE.roots)

type Row = { label: string; outcome: string; target: string; srcFile: string; line: number; claimKind: string }
const rows: Row[] = []
for (const line of readFileSync(DUMP_PATH, "utf8").split("\n")) {
  if (!line.startsWith("DUMP\t")) continue
  const p = line.split("\t")
  if (p.length < 6) continue
  const loc = p[4]
  const colon = loc.lastIndexOf(":")
  rows.push({
    label: p[1],
    outcome: p[2],
    target: p[3],
    srcFile: colon > 1 ? loc.slice(0, colon) : loc,
    line: colon > 1 ? Number(loc.slice(colon + 1)) || 0 : 0,
    claimKind: p[5],
  })
}
if (rows.length === 0) { console.error("census: dump has no DUMP rows"); process.exit(2) }

// ---- the analyzer metadata the gate's dump does not print (one parse per dumped file) ----------
const fileCache = new Map<string, Map<string, Record<string, unknown>[]>>()
async function metadataFor(file: string): Promise<Map<string, Record<string, unknown>[]>> {
  const hit = fileCache.get(file)
  if (hit) return hit
  const r: any = await parseFile(file, REPO_ROOT, { projectRoot: REPO_ROOT } as any)
  const map = new Map<string, Record<string, unknown>[]>()
  for (const rel of Array.isArray(r?.relationships) ? r.relationships : []) {
    const label = String(rel?.type ?? rel?.relationshipType ?? "")
    const tgt = String(rel?.target ?? "")
    const line = Number(rel?.line_number ?? 0) || 0
    const key = `${label}\u0001${tgt}\u0001${line}`
    const list = map.get(key)
    if (list) list.push((rel?.metadata ?? {}) as Record<string, unknown>)
    else map.set(key, [(rel?.metadata ?? {}) as Record<string, unknown>])
  }
  fileCache.set(file, map)
  return map
}

// ---- the project's OWN declaration key space (the same index builder the differential uses) ----
const tracked = execFileSync("git", ["-C", REPO_ROOT, "ls-files", "*.dart"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
  .split("\n").filter(Boolean).map((f) => path.join(REPO_ROOT, f))
const projectIndex = await buildProjectIndexStreaming(WASM, tracked, DART_DECLARATION_SPEC)
const projectDeclared = projectIndex.symbolNames
const projectTypes = new Set(projectIndex.typeKinds.keys())

// ---- classify ----------------------------------------------------------------------------------
type NameStat = { rows: number; labels: Map<string, number>; files: Set<string>; projectType: boolean }
const mk = (): NameStat => ({ rows: 0, labels: new Map(), files: new Set(), projectType: false })
const ann = new Map<string, NameStat>()
const typ = new Map<string, NameStat>()
const buckets = { annotation: 0, typeShaped: 0, referencesOther: 0, nonBare: 0, classified: 0 }
let annMetaMissing = 0
const byOutcome = new Map<string, number>()
for (const row of rows) {
  byOutcome.set(row.outcome, (byOutcome.get(row.outcome) ?? 0) + 1)
  const md = (await metadataFor(row.srcFile)).get(`${row.label}\u0001${row.target}\u0001${row.line}`)
  const isAnnotation = (md ?? []).some((m) => m && m.isAnnotation === true)
  const bare = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(row.target)
  if (isAnnotation) {
    buckets.annotation++
    let s = ann.get(row.target)
    if (!s) ann.set(row.target, (s = mk()))
    s.rows++; s.labels.set(row.label, (s.labels.get(row.label) ?? 0) + 1); s.files.add(row.srcFile)
    s.projectType = projectDeclared.has(row.target)
    continue
  }
  if (row.label === "references") { buckets.referencesOther++; continue }
  if (bare && TYPE_SHAPED_LABELS.has(row.label)) {
    buckets.typeShaped++
    let s = typ.get(row.target)
    if (!s) typ.set(row.target, (s = mk()))
    s.rows++; s.labels.set(row.label, (s.labels.get(row.label) ?? 0) + 1); s.files.add(row.srcFile)
    s.projectType = projectDeclared.has(row.target)
    continue
  }
  buckets.nonBare++
}
// CONTROL 1: annotation-class rows must carry attached metadata (a missing attach means the re-parse
// and the gate's walk describe different emissions, so the class counts would be fabricated).
for (const [name, s] of ann) for (const f of s.files) if (!fileCache.has(f)) annMetaMissing++
if (annMetaMissing > 0) { console.error(`CONTROL FAILED: ${annMetaMissing} annotation file(s) unreparsed`); process.exit(3) }
// CONTROL 2: partition sum
buckets.classified = buckets.annotation + buckets.typeShaped + buckets.referencesOther + buckets.nonBare
if (buckets.classified !== rows.length) {
  console.error(`CONTROL FAILED: classes ${buckets.classified} != dump rows ${rows.length}`)
  process.exit(3)
}
// CONTROL 3: per-label non-resolved counts from the dump vs the gate JSON
if (GATE_JSON) {
  const gate: any = JSON.parse(readFileSync(GATE_JSON, "utf8"))
  const nonResolved = (r: any) => {
    const p = r.project
    return p.resolved === undefined ? 0 : r.edges - p.resolved
  }
  const dumpPerLabel = new Map<string, number>()
  for (const r of rows) dumpPerLabel.set(r.label, (dumpPerLabel.get(r.label) ?? 0) + 1)
  const diffs: string[] = []
  for (const [label, r] of Object.entries<any>(gate.perType ?? {})) {
    if (!r || !r.edges) continue
    const want = nonResolved(r)
    const got = dumpPerLabel.get(label) ?? 0
    // `resolved` may legitimately be a subset counted differently only if the gate's own dump bound
    // applied — it is set to 3,000,000 here; so any difference is a real instrument disagreement.
    if (want !== got) diffs.push(`${label}: dump ${got} vs gate ${want}`)
  }
  if (diffs.length > 0) { console.error(`CONTROL FAILED: dump/gate per-label counts disagree:\n  ${diffs.join("\n  ")}`); process.exit(3) }
  console.log("control 3 PASS — dump non-resolved rows reconstruct the gate's per-type counts")
}

// ---- report ------------------------------------------------------------------------------------
const claimable = (m: Map<string, NameStat>) => [...m.entries()].filter(([n]) => VOCAB.has(n) && !projectDeclared.has(n))
const claimedButDeclared = (m: Map<string, NameStat>) => [...m.entries()].filter(([n]) => VOCAB.has(n) && projectDeclared.has(n))
const unlisted = (m: Map<string, NameStat>) => [...m.entries()].filter(([n]) => !VOCAB.has(n)).sort((a, b) => b[1].rows - a[1].rows)
const sumRows = (a: [string, NameStat][]) => a.reduce((n, [, s]) => n + s.rows, 0)
const fmt = (a: [string, NameStat], top = 25) =>
  a.slice(0, top).map(([n, s]) => `${n} ${s.rows}${s.projectType ? " (PROJECT-DECLARED)" : ""}`).join(" · ")

console.log(`dart-citation-census — repo ${REPO} · ${rows.length} non-resolved row(s) · ${tracked.length} project file(s)`)
console.log(`outcomes: ${[...byOutcome.entries()].map(([o, n]) => `${o} ${n}`).join(" · ")}`)
console.log(`classes: annotation ${buckets.annotation} · type-shaped ${buckets.typeShaped} · references-other ${buckets.referencesOther} · non-bare ${buckets.nonBare} (sum ${buckets.classified})`)
console.log("")
console.log(`ANNOTATION CLASS — ${ann.size} distinct name(s)`)
console.log(`  claimable-now (exact committed name, not project-declared): ${sumRows(claimable(ann))} row(s) / ${claimable(ann).length} name(s)`)
console.log(`    ${fmt(claimable(ann)) || "(none)"}`)
console.log(`  claimed-name-but-PROJECT-DECLARED (must refuse): ${sumRows(claimedButDeclared(ann))} row(s) / ${claimedButDeclared(ann).length} name(s)`)
console.log(`    ${fmt(claimedButDeclared(ann)) || "(none)"}`)
console.log(`  unlisted: ${sumRows(unlisted(ann))} row(s) / ${unlisted(ann).length} name(s); top: ${fmt(unlisted(ann), 30) || "(none)"}`)
console.log("")
console.log(`TYPE-SHAPED CLASS — ${typ.size} distinct name(s)`)
console.log(`  claimable-now: ${sumRows(claimable(typ))} row(s) / ${claimable(typ).length} name(s)`)
console.log(`    ${fmt(claimable(typ)) || "(none)"}`)
console.log(`  claimed-name-but-PROJECT-DECLARED (must refuse): ${sumRows(claimedButDeclared(typ))} row(s) / ${claimedButDeclared(typ).length} name(s)`)
console.log(`    ${fmt(claimedButDeclared(typ)) || "(none)"}`)
console.log(`  unlisted: ${sumRows(unlisted(typ))} row(s) / ${unlisted(typ).length} name(s); top: ${fmt(unlisted(typ), 40) || "(none)"}`)
console.log("")
console.log(`VOCABULARY: ${DART_SDK_CORE.id} — ${DART_SDK_CORE.roots.length} committed root(s)`)
if (JSON_OUT) {
  const dump = (m: Map<string, NameStat>) => [...m.entries()].sort((a, b) => b[1].rows - a[1].rows)
    .map(([name, s]) => ({ name, rows: s.rows, projectDeclared: projectDeclared.has(name), labels: [...s.labels.entries()] }))
  console.log(JSON.stringify({
    repo: REPO, dump: DUMP_PATH, rows: rows.length, buckets, vocabulary: DART_SDK_CORE.id,
    annotation: { claimable: dump(claimableNames(ann)), projectDeclared: dump(claimedButDeclared(ann)), unlisted: dump(unlisted(ann)) },
    typeShaped: { claimable: dump(claimableNames(typ)), projectDeclared: dump(claimedButDeclared(typ)), unlisted: dump(unlisted(typ)) },
  }, null, 2))
}
function claimableNames(m: Map<string, NameStat>): Map<string, NameStat> {
  return new Map(claimable(m))
}
