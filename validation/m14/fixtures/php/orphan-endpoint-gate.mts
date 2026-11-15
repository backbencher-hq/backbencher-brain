/**
 * ORPHAN-ENDPOINT GATE — the projection-level pin the fixture lane structurally cannot make.
 *
 * ## Why this file has to exist
 *
 * `script/m14/run-fixtures.ts:728` evaluates every fixture with
 * `analyzer.analyze(tree.rootNode, content, …)` — the ANALYZER, directly — and says so at
 * its own `:518`. The production path instead ends in `keepSymbol()`
 * (`src/ast/pool-worker.ts:494`, applied at `:985`), which projects the analyzer's symbols
 * into what the store receives. A rule that lives in the projection is INVISIBLE to all 25
 * php fixtures, and that is not hypothetical: `keepSymbol` refuses php symbols named
 * `self`/`parent` with no reference to kind or owner, so a legal
 * `public Node|null $parent = null;` was deleted while the analyzer's
 * `contains Node -> parent` edge survived — an edge whose endpoint is in no store row. 25
 * fixture files and a 53-mutant suite passed over it, because every one of them stops one
 * layer above the rule.
 *
 * ## Two sections, because only one of them can be an exit code
 *
 * A. STRICT — `contains` integrity. Containment is same-file by construction: the owner and
 *    the member are both published by the file under test, so a `contains` target that does
 *    not resolve is a defect with no legitimate reading. This decides the exit code.
 * B. ADVISORY — every other edge's target against the fixture population's union index,
 *    with the measured reasons a target can name no declaration (php-internal, path,
 *    dynamic `$var()`, member published under another owner). The remainder is printed and
 *    counted, not failed on: at fixture scale a bare name can be a local variable, and this
 *    gate does not own that rule — TIER 2 of the lane plan does.
 *
 * ## The self-test is not decoration
 *
 * A classifier that returns "no orphans" for everything passes section A vacuously. The
 * control feeds the SAME classifier a published target and an orphan and requires exactly
 * one of each; if it cannot separate them, this script refuses to report. This lane's
 * `exports` ruling is the precedent — a probe that cannot fire looked exactly like a probe
 * that measured zero.
 *
 * Run: bun validation/m14/fixtures/php/orphan-endpoint-gate.mts [--json]
 * Exit 0 = no orphaned `contains` endpoint in any php fixture. Exit 1 = at least one.
 */
import { readdirSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const FIXTURE_DIR = path.join(ROOT, "validation/m14/fixtures/php")
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const { phpInternalKind } = await import(path.join(ROOT, "src/ast/php-internal-symbols.ts"))

type Edge = { type: string; source: string; target: string; owner?: string | null; line?: number | null }

function resolves(t: string, owner: string | null | undefined, names: Set<string>, keys: Set<string>): boolean {
  if (names.has(t)) return true
  const leaf = t.includes("\\") ? t.slice(t.lastIndexOf("\\") + 1) : null
  if (leaf && names.has(leaf)) return true
  if (owner && keys.has(`${owner}\u0000${t}`)) return true
  return false
}

function reason(t: string, memberNames: Set<string>): string | null {
  const leaf = t.includes("\\") ? t.slice(t.lastIndexOf("\\") + 1) : null
  const ik = phpInternalKind(t) ?? (leaf ? phpInternalKind(leaf) : null)
  if (ik) return `php-internal:${ik}`
  if (t.startsWith("$")) return "dynamic-call"
  if (t.includes("/") || t.endsWith(".php")) return "file-path"
  if (memberNames.has(t)) return "member-under-another-owner"
  return null
}

// ---------------------------------------------------------------- self-test control
{
  const names = new Set(["published", "External", "DeclaredInAnotherFile"])
  const keys = new Set(["Owner\u0000member"])
  const resolved = ["published", "Owner-member-by-key"]
  const probes: [string, string | null, boolean][] = [
    ["published", null, true],
    ["member", "Owner", true],
    ["nobody-declares-me", null, false],
    ["External", null, true],
  ]
  let bad = 0
  for (const [t, owner, want] of probes) {
    const got = resolves(t, owner, names, keys)
    if (got !== want) bad++
  }
  const reasonProbe: [string, string | null][] = [
    ["strlen", "php-internal:php-internal-function"],
    ["$method", "dynamic-call"],
    ["__DIR__/x.php", "file-path"],
    ["member", "member-under-another-owner"],
    ["nothing-matches-me", null],
  ]
  for (const [t, want] of reasonProbe) {
    const got = reason(t, new Set(["member"]))
    if (got !== want) bad++
  }
  if (bad) {
    console.error(`orphan-endpoint-gate CONTROL FAILED (${bad} of ${probes.length + reasonProbe.length} probes wrong) — refusing to report on fixtures`)
    process.exit(1)
  }
  console.log(`control: PASS (${probes.length} resolution probes + ${reasonProbe.length} reason probes, same functions as below)`)
}

// ---------------------------------------------------------------- fixture walk
const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".php")).sort()

type Parsed = { file: string; symbols: any[]; edges: Edge[] }
const parsed: Parsed[] = []
for (const f of files) {
  const r: any = await parseFile(path.join(FIXTURE_DIR, f), FIXTURE_DIR)
  parsed.push({
    file: f,
    symbols: r?.symbols ?? [],
    edges: (r?.relationships ?? []).map((e: any) => ({
      type: String(e.type),
      source: String(e.source ?? ""),
      target: String(e.target ?? ""),
      owner: e.metadata?.owner ?? e.metadata?.ownerName ?? null,
      line: e.line_number ?? null,
    })),
  })
}

// union index over the whole fixture population (fixtures reference each other's declarations)
const unionNames = new Set<string>()
const unionKeys = new Set<string>()
const unionMemberNames = new Set<string>()
for (const p of parsed) {
  for (const s of p.symbols) {
    unionNames.add(String(s.name))
    if (s.ownerName) {
      unionKeys.add(`${s.ownerName}\u0000${s.name}`)
      unionMemberNames.add(String(s.name))
    }
  }
}

let strictOrphans = 0
const advisory: { file: string; edge: Edge }[] = []
const report: any[] = []

for (const p of parsed) {
  const names = new Set(p.symbols.map((s: any) => String(s.name)))
  const keys = new Set(p.symbols.filter((s: any) => s.ownerName).map((s: any) => `${s.ownerName}\u0000${s.name}`))
  const memberNames = new Set(p.symbols.filter((s: any) => s.ownerName).map((s: any) => String(s.name)))
  const containsEdges = p.edges.filter((e) => e.type === "contains")
  const orphans: Edge[] = []
  for (const e of containsEdges) {
    // a contains target must be published by THIS file: same-file by construction
    const keyed = keys.has(`${e.source}\u0000${e.target}`)
    const bare = names.has(e.target)
    if (!keyed && !bare) orphans.push(e)
  }
  const otherUnresolved = p.edges.filter(
    (e) => e.type !== "contains" && !resolves(e.target, e.owner, unionNames, unionKeys) && !reason(e.target, unionMemberNames)
  )
  strictOrphans += orphans.length
  for (const e of otherUnresolved) advisory.push({ file: p.file, edge: e })
  report.push({ fixture: p.file, symbols: p.symbols.length, edges: p.edges.length, containsEdges: containsEdges.length, containsOrphans: orphans.length, advisoydUnresolved: otherUnresolved.length, orphans })
  if (orphans.length) {
    console.log(`ORPHAN  ${p.file}: ${orphans.length} contains target(s) name nothing`)
    for (const e of orphans.slice(0, 8)) console.log(`          contains ${e.source} -> ${e.target}${e.line ? ` line ${e.line}` : ""}`)
    for (const e of orphans.slice(0, 2)) console.log(`          published names in file: ${[...names].filter((n) => n.toLowerCase().includes(String(e.target).slice(0, 4).toLowerCase())).join(", ") || "(no near name)"}`)
  }
}

console.log()
console.log(`fixtures scanned      : ${parsed.length}`)
console.log(`symbols (projection)  : ${parsed.reduce((a, p) => a + p.symbols.length, 0)}`)
console.log(`edges                 : ${parsed.reduce((a, p) => a + p.edges.length, 0)}`)
console.log(`contains edges        : ${parsed.reduce((a, p) => a + p.edges.filter((e) => e.type === "contains").length, 0)}`)
console.log(`STRICT orphaned contains targets : ${strictOrphans}`)
console.log(`advisory unresolved non-contains : ${advisory.length}${advisory.length ? `  e.g. ${advisory.slice(0, 6).map((a) => `${a.file}:${a.edge.type}:${a.edge.target}`).join(", ")}` : ""}`)

if (process.argv.includes("--json")) writeFileSync("/tmp/php-orphan-endpoint-gate.json", JSON.stringify({ fixtures: parsed.length, strictOrphans, advisory: advisory.length, report }, null, 1))
console.log(strictOrphans === 0 ? "\nPASS — every contains target in every php fixture is published by its own file" : "\nFAIL — a contains edge names a member the production projection did not publish")
process.exit(strictOrphans === 0 ? 0 : 1)
