/**
 * CLOJURE UNRESOLVED CENSUS — classify EVERY non-resolved edge the fleet gate reports, per label, by
 * CAUSE, over the gate's own `--dump` population (the lane's D3 "named causes with measured counts").
 *
 * The dump says WHAT did not resolve; this says WHY, by re-parsing each file the dump names with the
 * gate's own parse entry and reading the analyzer's own metadata (`isFieldAccess`, `isJavaInterop`,
 * `isLibraryDep`, `isCtorLiteral`, protocol/method-impl forms, ns/alias facts) plus the file's symbol
 * table and the lane's declared clojure.core surface.
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/clojure-unresolved-census.ts <dump.txt> [--json out]
 */
import { builtinModules } from "node:module"
import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { CLOJURE_CORE_BUILTINS } from "../../src/ast/real-clojure-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const dumpPath = process.argv[2]
if (!dumpPath) { console.error("usage: clojure-unresolved-census.ts <dump.txt> [--json out]"); process.exit(2) }
const jsonOut = (() => { const i = process.argv.indexOf("--json"); return i >= 0 ? process.argv[i + 1] : null })()

type Bucket = { count: number; samples: string[] }
const labels = new Map<string, { rows: number; buckets: Map<string, Bucket> }>()
const bucket = (label: string, outcome: string, name: string, sample: string) => {
  const row = labels.get(label) ?? (labels.set(label, { rows: 0, buckets: new Map() }), labels.get(label)!)
  row.rows++
  const key = `${outcome} | ${name}`
  const b = row.buckets.get(key) ?? (row.buckets.set(key, { count: 0, samples: [] }), row.buckets.get(key)!)
  b.count++
  if (b.samples.length < 3) b.samples.push(sample)
}
type DumpRow = { label: string; outcome: string; target: string; file: string; line: number; claimKind: string }
const rows: DumpRow[] = []
for (const line of fs.readFileSync(dumpPath, "utf8").split("\n")) {
  if (!line.startsWith("DUMP\t")) continue
  const f = line.split("\t")
  if (f.length < 6) continue
  // THE BOUND MARKER IS NOT A DATA ROW (2026-10-20, the clojure lane's finding). The gate prints
  // `DUMP\tBOUND\tREACHED\t<limit>` when the dump's bound is reached, and the lane's own instrument
  // prints `DUMP\tBOUND\tCOMPLETE\t<rows>`; BOTH have the label "BOUND" and BOTH have more than six
  // fields ✓, so the length check alone let them through as RELATIONSHIPS ✓. The consequences were
  // concrete: the census reported a population of 14,414 over a 14,413-row dump ✓, classified a label
  // called BOUND with the cause "unjoined-no-file-facts" ✓, and — because the marker's srcFile is "-" —
  // reported a PHANTOM UNFETCHED FILE ✓✓. **EVERY CENSUS OVER A GATE DUMP WAS OFF BY ONE ROW AND "
  // REPORTED A FILE THAT DOES NOT EXIST ✓✓.** The one-line fix is to skip the marker row ✓, and the
  // lane's own reconciler already did ✓, which is why its reconciliation was unaffected while the
  // census over the SAME dump was not ✓✓.
  if (f[1] === "BOUND") continue
  const file = f[4] ?? ""
  const m = file.match(/^(.*):(\d+)$/)
  rows.push({ label: f[1]!, outcome: f[2]!, target: f[3]!, file: m ? m[1]! : file, line: m ? Number(m[2]) : 0, claimKind: f[5]! })
}
const files = [...new Set(rows.map((r) => r.file))]
const CORE = new Set(Object.keys(CLOJURE_CORE_BUILTINS))

// project module-name space (per repo), for the ext?-claim pricing — the same rule the gate's
// moduleNamespace verification uses: file stem + last directory segment are "project module names".
const projectNames = new Map<string, Set<string>>()
for (const f of files) {
  const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
  const parts = rel.split(/[\\/]/)
  const repo = parts[0] ?? ""
  const base = parts[parts.length - 1] ?? ""
  const stem = base.replace(/\.[^.]+$/, "")
  const dir = parts.length >= 2 ? parts[parts.length - 2] ?? "" : ""
  const set = projectNames.get(repo) ?? new Set<string>()
  if (stem) set.add(stem)
  if (dir) set.add(dir)
  projectNames.set(repo, set)
}

type Facts = {
  declared: Set<string>
  namespaces: string[]
  aliases: Map<string, string>
  edges: Map<string, any[]>
}
const factsByFile = new Map<string, Facts>()
let unfetched = 0
for (const f of files) {
  const repo = (f.startsWith(CR) ? f.slice(CR.length + 1) : f).split("/")[0]!
  const repoDir = path.join(CR, repo)
  let r: any
  try { r = await parseFile(f, repoDir) } catch { unfetched++; continue }
  const facts: Facts = { declared: new Set(), namespaces: [], aliases: new Map(), edges: new Map() }
  for (const s of r?.symbols ?? []) { const n = String(s?.name ?? ""); if (n) facts.declared.add(n) }
  for (const rel of r?.relationships ?? []) {
    const md: any = rel.metadata ?? {}
    const t = String(rel.type)
    if (t === "imports") {
      const module = String(md.module ?? "")
      if (module) facts.namespaces.push(module)
      const alias = String(md.alias ?? "")
      if (alias && module) facts.aliases.set(alias, module)
    }
    const key = `${t}|${String(rel.target)}|${rel.line_number ?? md.line ?? 0}`
    const arr = facts.edges.get(key) ?? []
    arr.push(rel)
    facts.edges.set(key, arr)
  }
  factsByFile.set(f, facts)
}

const isClassShaped = (t: string): boolean => /^[A-Z][A-Za-z0-9_$]*(\.[A-Za-z0-9_$]+)*$/.test(t) || /^[a-zA-Z_][\w.-]*\.[A-Z]/.test(t)
const extPricing: Record<string, number> = {}
for (const row of rows) {
  const facts = factsByFile.get(row.file)
  const sample = `${row.target} @ ${row.file.startsWith(CR) ? row.file.slice(CR.length + 1) : row.file}:${row.line}`
  if (!facts) { bucket(row.label, row.outcome, "unjoined-no-file-facts", sample); continue }
  const md: any = (facts.edges.get(`${row.label}|${row.target}|${row.line}`) ?? [])[0]?.metadata ?? {}
  // CLAIM ROWS: outcome columns own these. Price them instead of classifying them as gaps.
  if (row.outcome === "externalVerified" || row.outcome === "externalUnverified" || row.outcome === "bindingVerified") {
    const kind = row.claimKind || "-"
    const module = String(md.module ?? (row.label === "imports" ? String(row.target).replace(/:[^:]*$/, "") : ""))
    if (row.outcome === "externalUnverified") {
      const root = module.includes("/") ? module.slice(0, module.indexOf("/")) : module
      const rel = row.file.startsWith(CR) ? row.file.slice(CR.length + 1) : row.file
      const names = projectNames.get(rel.split("/")[0]!) ?? new Set<string>()
      const cls = !module ? "no-specifier" : names.has(root) ? "module-root-collides-with-project-name" : "module-root-no-collision"
      extPricing[`${kind}|${cls}`] = (extPricing[`${kind}|${cls}`] ?? 0) + 1
    }
    bucket(row.label, row.outcome, `claim kind ${row.claimKind || "-"}`, sample)
    continue
  }
  const t = row.target
  // LANGUAGE/RUNTIME roots only (the claim's closed set). A third-party root (`babashka`,
  // `rewrite-clj`, …) is a PROJECT dependency the per-file lane cannot verify — it is classified as
  // third-party, not as a platform call.
  const PLATFORM = (root: string) => ["clojure", "cljs", "js", "goog", "java", "javax"].includes(root)
  const rootOf = (x: string) => x.split(/[./:]/)[0] ?? x
  // ── per-label cause classification ──────────────────────────────────────────────────────────
  if (row.label === "calls") {
    if (t.startsWith(".")) bucket("calls", row.outcome, "java-interop method target (.method)", sample)
    else if (t.includes("/") && isClassShaped(t.split("/")[0]!)) bucket("calls", row.outcome, "static interop call (Class/member) -> java platform class", sample)
    else if (facts.declared.has(t)) bucket("calls", row.outcome, "name IS declared in this file (ambiguity/shadow model, not absence)", sample)
    else if (CORE.has(t)) bucket("calls", row.outcome, "bare clojure.core name not suppressed (defect candidate) / local shadow", sample)
    else if (PLATFORM(rootOf(t))) bucket("calls", row.outcome, "qualified language-platform call (root in platform set)", sample)
    else if (t.includes("/")) bucket("calls", row.outcome, "qualified THIRD-PARTY call (root not a language namespace)", sample)
    else bucket("calls", row.outcome, "bare callee -> no declaration or import origin in the run", sample)
  } else if (row.label === "uses") {
    if (md.isFieldAccess === true) bucket("uses", row.outcome, "java-interop field read (.field)", sample)
    else if (md.isStaticInteropClass === true || md.isStaticInterop === true) bucket("uses", row.outcome, "java-interop static member/class", sample)
    else bucket("uses", row.outcome, "bare name mention -> no declaration or import origin", sample)
  } else if (row.label === "references") {
    if (md.isLibraryDep === true) {
      const module = t
      bucket("references", row.outcome, "ns library dependency (require/import libspec) -> external or unknown module", sample)
    } else if (isClassShaped(t)) bucket("references", row.outcome, "java class name (interop/import) -> no project declaration", sample)
    else bucket("references", row.outcome, "bare name mention -> no declaration or import origin", sample)
  } else if (row.label === "imports") {
    const module = String(md.module ?? t.replace(/:[^:]*$/, ""))
    bucket("imports", row.outcome, "module:item spelling unresolved (module not in project module space)", sample)
  } else if (row.label === "exports") {
    if (row.outcome.startsWith("amb")) bucket("exports", row.outcome, "exported name declared by more than one namespace/file (multi-ns project)", sample)
    else bucket("exports", row.outcome, "exported name not declared in the run", sample)
  } else if (row.label === "instantiates") {
    if (md.isCtorLiteral === true) bucket("instantiates", row.outcome, "tagged/ctor literal class (read-literal payload)", sample)
    else if (md.isJavaInterop === true) bucket("instantiates", row.outcome, "java-interop constructor (Class.) -> external class", sample)
    else if (isClassShaped(t)) bucket("instantiates", row.outcome, "class-shaped target -> no project declaration", sample)
    else bucket("instantiates", row.outcome, "other ctor target", sample)
  } else if (row.label === "extends") {
    if (isClassShaped(t)) bucket("extends", row.outcome, "java superclass (:gen-class/proxy) -> external class", sample)
    else bucket("extends", row.outcome, "other superclass target", sample)
  } else if (row.label === "implements") {
    if (t.includes("/")) bucket("implements", row.outcome, "qualified protocol/interface target", sample)
    else bucket("implements", row.outcome, "protocol/interface declared outside the run (external lib)", sample)
  } else if (row.label === "overrides") {
    bucket("overrides", row.outcome, "method-impl target name (protocol/interface method, no project declaration)", sample)
  } else {
    bucket(row.label, row.outcome, "unclassified-label", sample)
  }
}

// ── report ─────────────────────────────────────────────────────────────────────────────────────
const report: any = { dump: dumpPath, population: { rows: rows.length, files: files.length, unjoinedFiles: unfetched }, labels: {}, extPricing }
let total = 0
console.log(`CLOJURE UNRESOLVED CENSUS — ${path.basename(dumpPath)}`)
console.log(`population: ${rows.length} dumped non-resolved rows over ${files.length} source file(s); re-parsed with the gate's own entry; unfetched: ${unfetched}`)
for (const [label, l] of [...labels.entries()].sort((a, b) => b[1].rows - a[1].rows)) {
  total += l.rows
  console.log(`\n== ${label}: ${l.rows} rows ==`)
  const ordered = [...l.buckets.entries()].sort((a, b) => b[1].count - a[1].count)
  for (const [name, b] of ordered) {
    console.log(`  ${String(b.count).padStart(6)}  ${name}`)
    for (const s of b.samples) console.log(`            e.g. ${s}`)
  }
  report.labels[label] = { rows: l.rows, buckets: Object.fromEntries(ordered.map(([n, b]) => [n, b])) }
}
console.log(`\nTOTAL ${total} rows classified across ${labels.size} label(s)`)
for (const [k, n] of Object.entries(extPricing).sort((a, b) => b[1] - a[1])) console.log(`EXT? PRICING  ${String(n).padStart(6)}  ${k}`)
report.total = total
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2))
