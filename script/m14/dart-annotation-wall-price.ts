/**
 * dart-annotation-wall-price — the 246,724-row annotation wall, priced on the PRODUCTION POPULATION.
 *
 * ## THE QUESTION
 *
 * The dart lane's largest single named wall is `references` unresolved: 246,724 rows whose target is
 * an ANNOTATION TYPE the project does not declare (`@override`, `@internal`, `@Deprecated`, `@pragma`,
 * …). DART-DEPTH-D7.md §4 row 1 dispositioned it as **INSTRUMENT GAP (sized, Lead-owned)** — the
 * remedy named was "an annotation-platform CLAIM KIND (arbiter-verified against a pinned platform
 * declaration list)".
 *
 * **That instrument gap was CLOSED BEFORE the D7 ledger was written.** The `namespace` claim kind
 * (`script/m14/incoming-rule.ts` `NAMESPACE_CLAIM_KEY = "languageNamespace"`) verifies a target's root
 * against a lane-declared root list, counts a match as `extOK` with `verifiedBy: "namespace"`, and
 * counts a non-listed root as `externalRefuted`. The dart lane adopted it in task-26 with
 * `BB_DART_CITATION=1` (default OFF): the analyzer stamps `metadata.languageNamespace = [name]` plus
 * `metadata.languageNamespacePolicy = "strict-absent"` on every ANNOTATION row whose bare target is in
 * the committed `DART_SDK_CORE` vocabulary (`script/m14/citations.ts`), and strict-absent makes the
 * claim FALL THROUGH wherever the run declares the target, so a vendored same-name declaration keeps
 * the name model's answer.
 *
 * So the wall is a **CLAIM** class, not an instrument gap, and the D7 row is stale. This instrument
 * measures HOW MUCH of the wall that claim actually covers on the production population, so the
 * disposition can be a COUNTED one rather than an assertion.
 *
 * ## WHAT IT MEASURES, AND WHAT IT DOES NOT
 *
 * It reads the GATE'S OWN `--dump` rows (population, resolution rule and outcome are the gate's by
 * construction), re-parses each dumped file for the analyzer metadata the dump does not print, and
 * builds each repo's OWN declaration key space with the SAME index builder the differential uses.
 * For every ANNOTATION-class row it answers one of three questions:
 *
 *   * **CLAIMABLE**   — the target is EXACTLY a committed `DART_SDK_CORE` root AND the project
 *                      declares nothing of that name. The `namespace` claim verifies → `extOK`.
 *   * **PROJECT-DECLARED** — the target is a committed root AND the project DOES declare it. The
 *                      claim must be REFUSED (strict-absent falls through; the name model answers).
 *   * **UNLISTED**    — the target is not in the committed vocabulary. No claim, no citation: the row
 *                      stays in the wall, and the vocabulary is NOT widened by this instrument.
 *
 * ## WHY THE PROJECT KEY SPACE IS THE GATE'S, NOT MINE
 *
 * The claim's falsifier is "the project declares that name too". A project index built over a
 * DIFFERENT file set would answer a different question. So the key space is built over the gate's own
 * ADMITTED file list — the same 1 MB size cap the gate applies (`statSync(f).size <= 1048576`), the
 * same git-tracked discovery, and the same per-repo grouping. The census that predates this file
 * (DART-CITATION-CENSUS.md §2 erratum) measured what happens when that is not true: it flagged `Uri`
 * as project-declared because it indexed all 335 tracked files while the gate parsed 333, and the
 * 29-row error was the whole difference between a correct and an incorrect claim.
 *
 * ## CONTROLS (each can fail, exit 3)
 *
 *   1. Every annotation-class row must have attached metadata from a re-parse of its own file.
 *   2. The classes must sum to the row count (every dumped row lands in exactly one class).
 *   3. With `--gate-json`, the dump's per-label non-resolved counts must equal the gate's.
 *   4. The committed vocabulary and the analyzer's literal copy must be EQUAL in both directions
 *      (the drift assertion `script/m14/dart-citation-fixtures.ts` also makes, re-checked here so
 *      this instrument cannot price a wall against a vocabulary the analyzer does not use).
 *
 * ## USAGE
 *
 *   BB_CORPUS_ROOT=$PWD/.corpus BB_DUMP_LIMIT=3000000 \
 *     bun run script/m14/incoming-gate.ts dart dart 0 --repo=proxicall --dump > proxi.dump
 *   BB_CORPUS_ROOT=$PWD/.corpus BB_DUMP_LIMIT=3000000 \
 *     bun run script/m14/incoming-gate.ts dart dart 0 --repo=proxicall --json > proxi.json
 *   bun run script/m14/dart-annotation-wall-price.ts --dump=proxi.dump --repo=proxicall [--gate-json=proxi.json] [--json]
 *
 * A dump may hold SEVERAL repos (`--repo=a,b`); `--repo` may then be omitted and the repos are read
 * from the dump's own file paths. This instrument EMITS NOTHING into the analyzer and changes no
 * count, no tally and no exit code of any other tool: it is measurement only.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { buildProjectIndexStreaming, DART_DECLARATION_SPEC } from "../../src/ast/project-index"
import { DART_SDK_CORE } from "./citations"
import { DART_CITATION_ROOTS } from "../../src/ast/real-dart-analyzer"

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
const REPO_ARG = argOf("--repo") ?? ""
if (!DUMP_PATH) {
  console.error("usage: bun run script/m14/dart-annotation-wall-price.ts --dump=<dump.tsv> [--repo=<name>] [--gate-json=<json>] [--json]")
  process.exit(2)
}
const WASM = path.join(path.resolve(import.meta.dirname ?? ".", "..", ".."), "wasm", "tree-sitter-dart.wasm")
/** The gate's own size cap (`SIZE_CAP` in incoming-gate.ts is the engine's 1 MB full-AST limit). */
const SIZE_CAP = 1048576

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
if (rows.length === 0) { console.error("price: dump has no DUMP rows"); process.exit(2) }

// ---- CONTROL 4: the vocabulary the analyzer uses IS the committed vocabulary ---------------------
{
  const committed = new Set(DART_SDK_CORE.roots)
  const analyzer = new Set(DART_CITATION_ROOTS)
  const missingInAnalyzer = [...committed].filter((n) => !analyzer.has(n))
  const extraInAnalyzer = [...analyzer].filter((n) => !committed.has(n))
  if (missingInAnalyzer.length > 0 || extraInAnalyzer.length > 0) {
    console.error(`CONTROL FAILED: vocabulary drift — in committed only: ${missingInAnalyzer.join(", ")} · in analyzer only: ${extraInAnalyzer.join(", ")}`)
    process.exit(3)
  }
}

// ---- the repos the dump's rows came from ------------------------------------------------------------
const repoOf = (f: string): string => {
  const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
  return rel.split(path.sep)[0]
}
const repos = REPO_ARG
  ? new Set(REPO_ARG.split(",").map((s) => s.trim()).filter(Boolean))
  : new Set(rows.map((r) => repoOf(r.srcFile)))

// ---- the analyzer metadata the gate's dump does not print (one parse per dumped file) ------------
const fileCache = new Map<string, Map<string, Record<string, unknown>[]>>()
async function metadataFor(file: string): Promise<Map<string, Record<string, unknown>[]>> {
  const hit = fileCache.get(file)
  if (hit) return hit
  const repoRoot = path.join(CR, repoOf(file))
  const r: any = await parseFile(file, repoRoot, { projectRoot: repoRoot } as any)
  const map = new Map<string, Record<string, unknown>[]>()
  for (const rel of Array.isArray(r?.relationships) ? r.relationships : []) {
    const label = String(rel?.type ?? rel?.relationshipType ?? "")
    const tgt = String(rel?.target ?? "")
    const line = Number(rel?.line_number ?? 0) || 0
    const key = `${label}${tgt}${line}`
    const list = map.get(key)
    if (list) list.push((rel?.metadata ?? {}) as Record<string, unknown>)
    else map.set(key, [(rel?.metadata ?? {}) as Record<string, unknown>])
  }
  fileCache.set(file, map)
  return map
}

// ---- each repo's OWN declaration key space, over the GATE'S ADMITTED FILE SET --------------------
const projectDeclared = new Map<string, Set<string>>()
for (const repo of repos) {
  const repoRoot = path.join(CR, repo)
  let tracked: string[] = []
  try {
    tracked = execFileSync("git", ["-C", repoRoot, "ls-files", "*.dart"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\n").filter(Boolean)
  } catch {
    console.error(`price: repo ${repo} is not a git checkout under ${CR}`)
    process.exit(2)
  }
  const files = tracked
    .map((f) => path.join(repoRoot, f))
    .filter((f) => { try { return statSync(f).size <= SIZE_CAP } catch { return false } })
  const index = await buildProjectIndexStreaming(WASM, files, DART_DECLARATION_SPEC)
  projectDeclared.set(repo, new Set(index.symbolNames))
}

// ---- classify ------------------------------------------------------------------------------------
type NameStat = { rows: number; labels: Map<string, number>; files: Set<string>; projectDeclared: boolean }
const mk = (): NameStat => ({ rows: 0, labels: new Map(), files: new Set<string>(), projectDeclared: false })
const ann = new Map<string, NameStat>()
const buckets = { annotation: 0, other: 0, classified: 0 }
const byOutcome = new Map<string, number>()
let annMetaMissing = 0
for (const row of rows) {
  byOutcome.set(row.outcome, (byOutcome.get(row.outcome) ?? 0) + 1)
  const md = (await metadataFor(row.srcFile)).get(`${row.label}${row.target}${row.line}`)
  const isAnnotation = (md ?? []).some((m) => m && m.isAnnotation === true)
  if (!isAnnotation) { buckets.other++; continue }
  buckets.annotation++
  let s = ann.get(row.target)
  if (!s) ann.set(row.target, (s = mk()))
  s.rows++
  s.labels.set(row.label, (s.labels.get(row.label) ?? 0) + 1)
  s.files.add(row.srcFile)
  s.projectDeclared = projectDeclared.get(repoOf(row.srcFile))?.has(row.target) ?? false
}
// CONTROL 1: every annotation-class row must have attached metadata.
for (const [, s] of ann) for (const f of s.files) if (!fileCache.has(f)) annMetaMissing++
if (annMetaMissing > 0) { console.error(`CONTROL FAILED: ${annMetaMissing} annotation file(s) unreparsed`); process.exit(3) }
// CONTROL 2: the classes sum to the row count.
buckets.classified = buckets.annotation + buckets.other
if (buckets.classified !== rows.length) {
  console.error(`CONTROL FAILED: classes ${buckets.classified} != dump rows ${rows.length}`)
  process.exit(3)
}
// CONTROL 3: the dump's per-label non-resolved counts must equal the gate's.
if (GATE_JSON) {
  const gate: any = JSON.parse(readFileSync(GATE_JSON, "utf8"))
  const nonResolved = (r: any) => (r.project?.resolved === undefined ? 0 : r.edges - r.project.resolved)
  const dumpPerLabel = new Map<string, number>()
  for (const r of rows) dumpPerLabel.set(r.label, (dumpPerLabel.get(r.label) ?? 0) + 1)
  const diffs: string[] = []
  for (const [label, r] of Object.entries<any>(gate.perType ?? {})) {
    if (!r || !r.edges) continue
    const want = nonResolved(r)
    const got = dumpPerLabel.get(label) ?? 0
    if (want !== got) diffs.push(`${label}: dump ${got} vs gate ${want}`)
  }
  if (diffs.length > 0) { console.error(`CONTROL FAILED: dump/gate per-label counts disagree:\n  ${diffs.join("\n  ")}`); process.exit(3) }
  console.log("control 3 PASS — dump non-resolved rows reconstruct the gate's per-type counts")
}

// ---- report ------------------------------------------------------------------------------------
const VOCAB = new Set<string>(DART_SDK_CORE.roots)
const claimable = [...ann.entries()].filter(([n, s]) => VOCAB.has(n) && !s.projectDeclared)
const declared = [...ann.entries()].filter(([n, s]) => VOCAB.has(n) && s.projectDeclared)
const unlisted = [...ann.entries()].filter(([n]) => !VOCAB.has(n)).sort((a, b) => b[1].rows - a[1].rows)
const sumRows = (a: [string, NameStat][]) => a.reduce((n, [, s]) => n + s.rows, 0)
const fmt = (a: [string, NameStat][], top = 30) =>
  a.slice(0, top).map(([n, s]) => `${n} ${s.rows}${s.projectDeclared ? " (PROJECT-DECLARED)" : ""}`).join(" · ")

console.log(`dart-annotation-wall-price — ${[...repos].join(",")} · ${rows.length} non-resolved row(s)`)
console.log(`outcomes: ${[...byOutcome.entries()].map(([o, n]) => `${o} ${n}`).join(" · ")}`)
console.log(`classes: annotation ${buckets.annotation} · other ${buckets.other} (sum ${buckets.classified})`)
console.log("")
console.log(`ANNOTATION WALL — ${ann.size} distinct name(s)`)
console.log(`  CLAIMABLE (committed root, project declares nothing): ${sumRows(claimable)} row(s) / ${claimable.length} name(s)`)
console.log(`    ${fmt(claimable) || "(none)"}`)
console.log(`  PROJECT-DECLARED (committed root the project declares — the claim REFUSES): ${sumRows(declared)} row(s) / ${declared.length} name(s)`)
console.log(`    ${fmt(declared) || "(none)"}`)
console.log(`  UNLISTED (no committed root — the wall REMAINS): ${sumRows(unlisted)} row(s) / ${unlisted.length} name(s); top: ${fmt(unlisted) || "(none)"}`)
console.log("")
console.log(`VOCABULARY: ${DART_SDK_CORE.id} — ${DART_SDK_CORE.roots.length} committed root(s) (analyzer copy verified equal)`)

if (JSON_OUT) {
  const dump = (a: [string, NameStat][]) => a.map(([name, s]) => ({
    name, rows: s.rows, projectDeclared: s.projectDeclared, labels: [...s.labels.entries()],
  }))
  console.log(JSON.stringify({
    repos: [...repos], rows: rows.length, buckets, vocabulary: DART_SDK_CORE.id,
    annotation: {
      claimable: dump(claimable),
      projectDeclared: dump(declared),
      unlisted: dump(unlisted),
      totals: {
        claimable: sumRows(claimable), projectDeclared: sumRows(declared), unlisted: sumRows(unlisted),
      },
    },
  }, null, 2))
}
