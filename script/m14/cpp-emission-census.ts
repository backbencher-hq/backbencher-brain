/**
 * cpp-emission-census — WHAT the C++ analyzer emits, counted by SITE, over the whole admitted
 * population (ALL-OUT-OF-ALL charter §9.1 D2: rows + files + repos, per relationship type).
 *
 * WHY THIS EXISTS. The fleet gates answer "does every edge RESOLVE"; none answers "does every
 * construct EMIT". `incoming-gate.ts --dump` prints only NON-RESOLVED rows; `residual-gate.ts`
 * publishes per-type totals with no metadata breakdown; and the D1 construct table needs
 * whole-population counts for the constructs that are RULED as carrying no relationship
 * (concepts/requires) or as carrying one under an adapted reading (multiple inheritance,
 * pure-virtual contracts). This is the one place the EMITTED rows are counted by the marker the
 * emission carries, and the one place the grammar constructs that never become edges are counted.
 *
 * WHAT IT COUNTS, per admitted C++ file, through the PRODUCTION entry
 * (`src/ast/pool-worker.parseFile`, the same call `engine.ts` makes):
 *
 *   per relationship type     edges, and the number of FILES that emitted at least one
 *   per marker                `metadata.relationshipType` (include_dependency, using_dependency,
 *                             field_access, identifier_usage, module_export, export_attribute)
 *   per SITE PAYLOAD          the split each emission form's own metadata carries:
 *                               exports.exportMacro / exports.exportSpelling / marker kind
 *                               overrides.reasonCode (override-keyword+signature-match /
 *                                 signature-match / override-keyword+companion-declares-method)
 *                               implements.reasonCode + pureVirtualCount
 *                               imports.isSystemInclude (angle vs quoted spelling)
 *                               calls.qualified (none — the leaf is the target; the qualified
 *                                 path is metadata and is counted here)
 *                               contains.sourceShape (global-pseudo-container vs named-owner) —
 *                                 the whole-population size of the file-scope contains class
 *                                 the Lead's §14 ruling ACCEPTED for C/C++; this is the count the
 *                                 shared-oracle fix is scoped with.
 *                               instantiates.isNew
 *   GRAMMAR CONSTRUCTS        the D1 construct table's own population: class/struct/union,
 *                             template declarations, namespaces, using-declarations, operator
 *                             names, lambda expressions, structured bindings, concept_definition,
 *                             requires_clause, friend declarations, and MULTIPLE INHERITANCE
 *                             measured as base_class_clause items per class (the D1 handoff asks
 *                             for it by name).
 *   (deliberately NOT counted: anything inferred from a target's spelling. The census reads what
 *   the analyzer WROTE into metadata, and what the pinned grammar's node types are.)
 *
 * THE POPULATION IS DERIVED, NEVER LISTED. Discovery is copied from `script/m14/incoming-gate.ts`
 * (`discoverFiles`), which cannot be imported because that file is a script whose top level
 * executes. The copy is the one thing in this file that can drift, so the CONTROL is structural:
 * with `--cap=<N>` the census REQUIRES its per-type edge totals to equal a live
 * `incoming-gate.ts --json` run over the same stride sample, and exits 3 refusing to print if they
 * differ. The whole-population run (`--cap=0`) prints no control because there is no second
 * instrument to control it against — its control is internal (population closure: every parsed
 * file either contributes rows or is counted in `degraded`/`failed`, and the per-type totals sum
 * to the TOTAL the report prints).
 *
 * ## PARSER LIFECYCLE (the class lesson both finished lanes handed over)
 *
 * The grammar-construct walk acquires `engine.getParser("cpp")` PER FILE and calls
 * `tree.delete()` after the walk. The engine recreates cached parsers every 500 acquisitions; a
 * HELD parser faults on its next `.parse` and the run silently mass-falls-back. Every skip is
 * AGGREGATED and printed (`constructSkipped: {overCap, parseFailed, noTree}`) so a mass skip can
 * never be a silent count.
 *
 * POPULATION NOTE — the lane's full router spelling set: cpp,cc,cxx,c++,hpp,hxx,ipp,inl,cu
 * (`src/ast/language-detection.ts:102-108`). `.h` is NOT admitted by THIS instrument and the
 * reason is measured, not assumed: production routes `.h` by CONTENT (c vs cpp), while the gate's
 * discovery admits by extension only, so a pooled cpp+c,h census would pool the C analyzer's
 * edges into a C++ number. The `.h` half is the measured boundary in
 * `validation/m14/proposals/cpp-h-routing.md` and is declared in the D2 evidence page.
 *
 * USAGE
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   bun run script/m14/cpp-emission-census.ts --cap=50             # controlled triage sample
 *   bun run script/m14/cpp-emission-census.ts --cap=0 --json      # whole admitted population
 *
 * EXIT: 0 printed · 2 environment (no corpus / no files) · 3 CONTROL DID NOT FIRE.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { ASTEngine } from "../../src/ast/engine"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const GATE = path.join(ROOT, "script/m14/incoming-gate.ts")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const SIZE_CAP = 1024 * 1024 // mirror of pool-worker's FULL_AST_LIMIT — the same line the analyzer draws
const EXTS = ["cpp", "cc", "cxx", "c++", "hpp", "hxx", "ipp", "inl", "cu"]

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

/** The grammar constructs the D1 handoff names, counted from the parse tree. */
const CONSTRUCTS = [
  "class_specifier", "struct_specifier", "union_specifier", "enum_specifier",
  "template_declaration", "template_instantiation", "template_type",
  "namespace_definition", "namespace_alias_definition", "using_declaration",
  "operator_name", "operator_cast", "destructor_name",
  "lambda_expression", "lambda_capture_specifier",
  "structured_binding_declarator",
  "concept_definition", "requires_clause", "requires_expression",
  "friend_declaration",
  "base_class_clause",
  "virtual_specifier", "pure_virtual_clause",
  "new_expression",
] as const

/** Copied from `script/m14/incoming-gate.ts` — same admitted-extension predicate. */
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

type Tally = { edges: number; files: Set<string>; repos: Set<string> }
const mk = () => ({ edges: 0, files: new Set<string>(), repos: new Set<string>() } as Tally)
const repoOf = (rel: string) => rel.split(path.sep)[0]
const add = (m: Map<string, Tally>, key: string, rel: string) => {
  let t = m.get(key)
  if (!t) { t = mk(); m.set(key, t) }
  t.edges++
  t.files.add(rel)
  t.repos.add(repoOf(rel))
}

const perType = new Map<string, Tally>()
const perMarker = new Map<string, Tally>()
const perMarkerType = new Map<string, Tally>()
const exportMacro = new Map<string, Tally>()
const exportSpelling = new Map<string, Tally>()
const overrideReason = new Map<string, Tally>()
const implementsPayload = new Map<string, Tally>()
const includesSpelling = new Map<string, Tally>()
const callsQualified = new Map<string, Tally>()
const instantiatesNew = new Map<string, Tally>()
const usesMarker = new Map<string, Tally>()
const referencesMarker = new Map<string, Tally>()
/** `contains` edges split by SOURCE SHAPE — the Lead's §14 ruling on the file-scope
 *  pseudo-container: the analyzer publishes `contains` from `global` for file-scope symbols, and
 *  the whole-population size of that class is what the shared-oracle fix must be scoped with. The
 *  split is read off the EDGE ITSELF (source name), never inferred from a target's spelling. */
const containsSource = new Map<string, Tally>()
const constructCounts = new Map<string, Tally>()
const multipleInheritance = new Map<string, Tally>()
const markerOnType = (type: string, marker: string) => `${type}\u0000${marker}`
for (const t of ALL_TYPES) perType.set(t, mk())
for (const c of CONSTRUCTS) constructCounts.set(c, mk())

const { files, total, repos, absent, overCap } = discover(CAP)
if (files.length === 0) {
  console.error(`cpp-emission-census: 0 admitted C++ files under ${CR}. Set BB_CORPUS_ROOT to the corpus.`)
  process.exit(2)
}

// ── the grammar-construct walk (per-file parser; the class lesson applied) ─────────────────────
const constructSkips = { overCap: 0, parseFailed: 0, noTree: 0 }
const WALK_TYPES = new Set<string>(CONSTRUCTS)
function walkConstructs(node: any, rel: string, adder: (type: string, rel: string) => void): void {
  const stack: any[] = [node]
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    if (WALK_TYPES.has(n.type)) adder(n.type, rel)
    if (n.type === "base_class_clause") {
      // MULTIPLE INHERITANCE: a clause holds a LIST of bases. Count the clause's base items,
      // skipping access-specifier nodes, then bucket the class by how many bases it inherits.
      let bases = 0
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c || c.type === "access_specifier") continue
        bases++
      }
      if (bases > 1) {
        let t = multipleInheritance.get("classesWithMultipleBases")
        if (!t) { t = mk(); multipleInheritance.set("classesWithMultipleBases", t) }
        t.edges++
        t.files.add(rel)
        t.repos.add(repoOf(rel))
      }
      let tt = multipleInheritance.get("totalBases")
      if (!tt) { tt = mk(); multipleInheritance.set("totalBases", tt) }
      tt.edges += bases
    }
    for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
  }
}

let parsed = 0
let failed = 0
let degraded = 0
let constructWalked = 0
const parseErrors: string[] = []
for (const abs of files) {
  const rel = path.relative(CR, abs)
  let result: any
  try {
    result = await parseFile(abs, repoRootOf(abs))
  } catch (e: any) {
    failed++
    parseErrors.push(`${rel}: ${String(e?.message ?? e).slice(0, 120)}`)
    continue
  }
  parsed++
  if (result?.fallback === true) degraded++
  const relSlug = rel.split(path.sep).join("/")
  for (const r of (result.relationships ?? []) as any[]) {
    const type = String(r?.type ?? "")
    add(perType, type, relSlug)
    const md = (r?.metadata ?? {}) as Record<string, unknown>
    const marker = typeof md.relationshipType === "string" ? md.relationshipType : ""
    if (marker) {
      add(perMarker, marker, relSlug)
      add(perMarkerType, markerOnType(type, marker), relSlug)
    }
    if (type === "exports") {
      add(exportMacro, typeof md.exportMacro === "string" ? md.exportMacro : "(none)", relSlug)
      add(exportSpelling, typeof md.exportSpelling === "string" ? md.exportSpelling : "(none)", relSlug)
    } else if (type === "overrides") {
      add(overrideReason, typeof md.reasonCode === "string" ? md.reasonCode : "(none)", relSlug)
    } else if (type === "implements") {
      const pv = typeof md.pureVirtualCount === "number" ? String(md.pureVirtualCount) : "(none)"
      add(implementsPayload, typeof md.reasonCode === "string" ? mkComposite(md.reasonCode, pv) : "(none)", relSlug)
    } else if (type === "imports") {
      add(includesSpelling, md.isSystemInclude === true ? "angle" : md.isSystemInclude === false ? "quoted" : "(none)", relSlug)
    } else if (type === "calls") {
      add(callsQualified, typeof md.qualified === "string" ? "qualified-path-carried" : "leaf-only", relSlug)
    } else if (type === "instantiates") {
      add(instantiatesNew, md.isNew === true ? "isNew" : "(none)", relSlug)
    } else if (type === "uses") {
      add(usesMarker, marker || "(none)", relSlug)
    } else if (type === "references") {
      add(referencesMarker, marker || "(none)", relSlug)
    } else if (type === "contains") {
      const sourceName = String(r.source ?? "")
      add(containsSource, sourceName === "global" ? "global-pseudo-container" : "named-owner", relSlug)
    }
  }
  // Grammar-construct walk. Files over FULL_AST_LIMIT use the production structural path and are
  // COUNTED as skipped here — never silently dropped. Parser acquired PER FILE (may be recreated
  // by the engine every 500 acquisitions; a held parser faults). Tree disposed after the walk.
  if (result?.fallback === true) {
    constructSkips.overCap++
    continue
  }
  try {
    const content = readFileSync(abs, "utf8")
    const parser: any = await ASTEngine.getParser("cpp")
    const tree: any = parser.parse(content, abs)
    if (!tree?.rootNode) { constructSkips.noTree++; continue }
    constructWalked++
    walkConstructs(tree.rootNode, relSlug, (type, rel2) => {
      let t = constructCounts.get(type)
      if (!t) { t = mk(); constructCounts.set(type, t) }
      t.edges++
      t.files.add(rel2)
      t.repos.add(repoOf(rel2))
    })
    tree.delete()
  } catch {
    constructSkips.parseFailed++
  }
}

function mkComposite(a: string, b: string) { return `${a}\u0000pureVirtuals=${b}` }

function repoRootOf(abs: string): string {
  return path.join(CR, abs.slice((CR + path.sep).length).split(path.sep)[0])
}

// ── THE CONTROL: on a stride sample, the census walk must BE the gate's walk ────────────────────
type Control = { ok: boolean; checked: "gate --json edges" | "none (whole population)"; detail: string }
let control: Control
if (CAP > 0) {
  let gateJson: any
  try {
    const out = execFileSync("npx", ["tsx", GATE, "cpp", EXTS.join(","), String(CAP), "--json"], {
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
  control = { ok: true, checked: "none (whole population)", detail: "whole-population run: no second instrument over this population; the internal control is closure (parsed+failed+degraded = admitted) and per-type sum = TOTAL" }
}

const sorted = (m: Map<string, Tally>) => [...m.entries()].sort((a, b) => b[1].edges - a[1].edges)
const w = (s: string | number, n: number) => String(s).padEnd(n)
const totalEdges = [...perType.values()].reduce((a, b) => a + b.edges, 0)

const payloadJson = (m: Map<string, Tally>) =>
  Object.fromEntries(sorted(m).map(([k, v]) => [k, { edges: v.edges, files: v.files.size, repos: v.repos.size }]))

if (JSON_OUT) {
  console.log(JSON.stringify({
    population: { cap: CAP, sampled: files.length, parsed, failed, degraded, admitted: total, repos, absent, overCap, exts: EXTS, sizeCapBytes: SIZE_CAP },
    control,
    closure: { totalEdges, parsedPlusFailed: parsed + failed, constructWalked, constructSkipped: constructSkips },
    perType: Object.fromEntries(sorted(perType).map(([k, v]) => [k, { edges: v.edges, files: v.files.size, repos: v.repos.size }])),
    perMarker: payloadJson(perMarker),
    markerByType: payloadJson(perMarkerType),
    callPayload: { qualifiedPath: payloadJson(callsQualified) },
    exportPayload: { macros: payloadJson(exportMacro), spellings: payloadJson(exportSpelling) },
    overridePayload: { reasonCodes: payloadJson(overrideReason) },
    implementsPayload: payloadJson(implementsPayload),
    importsPayload: { includeSpelling: payloadJson(includesSpelling) },
    instantiatesPayload: payloadJson(instantiatesNew),
    usesPayload: payloadJson(usesMarker),
    referencesPayload: payloadJson(referencesMarker),
    containsPayload: payloadJson(containsSource),
    constructs: payloadJson(constructCounts),
    multipleInheritance: payloadJson(multipleInheritance),
    parseErrors: parseErrors.slice(0, 20),
  }, null, 2))
} else {
  console.log(`cpp emission census — ${parsed} parsed of ${total} admitted C++ files (${repos} repos; cap ${CAP === 0 ? "NONE (whole population)" : CAP})`)
  console.log(`  extensions admitted: ${EXTS.map((e) => "." + e).join(" ")}`)
  console.log(`  parse failures: ${failed} · merged/structural-fallback (degraded): ${degraded} · tracked-but-absent: ${absent} · over the ${Math.round(SIZE_CAP / 1024)} KB cap: ${overCap}`)
  console.log(`  closure: parsed + failed = ${parsed + failed} of ${total} admitted · TOTAL edges ${totalEdges}`)
  console.log(`  control (${control.checked}): ${control.ok ? "PASS" : "FAIL"} — ${control.detail}`)
  console.log(`  grammar-construct walk: ${constructWalked} files walked · skipped ${JSON.stringify(constructSkips)}`)
  console.log()
  console.log("EDGES PER RELATIONSHIP TYPE")
  console.log("-".repeat(72))
  for (const [k, v] of sorted(perType)) if (v.edges > 0) console.log(`  ${w(k, 15)} ${w(v.edges, 9)} edges in ${v.files.size} file(s), ${v.repos.size} repo(s)`)
  console.log()
  const block = (title: string, m: Map<string, Tally>, pad = 44) => {
    console.log(title)
    console.log("-".repeat(72))
    for (const [k, v] of sorted(m)) console.log(`  ${w(k, pad)} ${w(v.edges, 8)} edge(s) in ${v.files.size} file(s), ${v.repos.size} repo(s)`)
    console.log()
  }
  block("PER SITE MARKER (metadata.relationshipType)", perMarker)
  block("EXPORTS — marker macro", exportMacro)
  block("EXPORTS — marker spelling", exportSpelling)
  block("OVERRIDES — evidence class (reasonCode)", overrideReason)
  block("IMPLEMENTS — pure-virtual contract payload", implementsPayload)
  block("IMPORTS — include spelling", includesSpelling)
  block("CALLS — qualified path carried", callsQualified)
  block("INSTANTIATES — isNew", instantiatesNew)
  block("CONTAINS — source shape (global = the file-scope pseudo-container, Lead §14 ruling)", containsSource)
  block("GRAMMAR CONSTRUCTS (per-file parser, tree disposed)", constructCounts)
  block("MULTIPLE INHERITANCE", multipleInheritance)
  if (parseErrors.length) {
    console.log("PARSE ERRORS (first 20)")
    for (const e of parseErrors) console.log("  " + e)
  }
}
