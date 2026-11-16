/**
 * C lane: does the PINNED M12 ground truth still describe the analyzer?
 *
 * Found 2026-09-28 (M14/M60 C wave) while checking whether this wave's changes
 * broke the M12 differential. They did not cause the problem, but they made it
 * visible, and the problem is larger than the code defects:
 *
 *   `validation/m12/results/c-differential.json` asserts `passed: true` with
 *   92 expected / 92 observed / 0 false positives / 0 false negatives -- and its
 *   `truePositiveIds` list contains
 *       rel:Module.c:instantiates:buffer_create:malloc
 *       rel:Module.c:references:global:stdlib.h
 *   The analyzer emits NEITHER on that fixture. `Module.c` produces
 *   `imports` 2, `calls` 6, `uses` 8 -- no `instantiates` at all (the allocator
 *   branches count malloc/calloc/realloc and set `metadata.usesMalloc`; a comment
 *   in the code records that the edge was REMOVED as "pure noise"), and an include
 *   has been the first-class `imports` kind since M60/#910.
 *
 * So the ground truth predates two analyzer decisions, and rows the analyzer
 * cannot produce are listed as true positives. An artifact that scores a row it
 * cannot observe is green on something that cannot fail, which is the failure the
 * evidence rules name as "a green artifact whose frame predates the fix is a lie
 * by omission" -- except here the frame is not merely stale, it is unreachable.
 *
 * The artifact also cannot be regenerated in this checkout: the F5 harness reads
 * `CORPUS_ROOT = <corpus-root>/bb_tests/repositories` (overridable with
 * BB_CORPUS_ROOT), that path does not exist here, and the run aborts on the first
 * pinned repo. No script in the tree writes `c-differential.json` by that name, so
 * the artifact's producer is not present either.
 *
 * BUT the M12 differential is a FIXTURE differential, not a corpus one -- so the
 * drift is measurable without any corpus at all, which is what this probe does.
 * It compares every one of the 92 pinned facts against the LIVE analyzer and
 * reports, per row: still produced / no longer produced (a false negative the
 * artifact does not report) / produced with a different type (the ontology moved).
 *
 * The output is the input a re-baseline needs: it says exactly which rows an owner
 * must DECIDE about, rather than regenerating a file and calling the diff a
 * review.
 *
 *   bun run script/m14/tmp/c-audit/m12-truth-drift.ts [--out path]
 */
import * as fs from "fs"
import * as path from "path"

import { createRequire } from "node:module"
const require = createRequire(import.meta.url)

const ROOT = path.resolve((import.meta as any).dirname, "..", "..", "..", "..")
const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const OUT = arg("out", path.join(ROOT, "validation/m12/results/c-truth-drift.json"))
const TRUTH = path.join(ROOT, "validation/m12/ground-truth/c.json")
const FIX = path.join(ROOT, "validation/m12/fixtures/c")

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm"))))
const { RealCAnalyzer } = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))

const truth = JSON.parse(fs.readFileSync(TRUTH, "utf8"))

// One parse per fixture, once.
const observed = new Map<string, any>()
for (const f of fs.readdirSync(FIX).sort()) {
  const src = fs.readFileSync(path.join(FIX, f), "utf8")
  observed.set(f, new RealCAnalyzer().analyze(parser.parse(src).rootNode, src, f) as any)
}

const symbolKey = (file: string, line: number, name: string, kind: string) =>
  `sym:${file}:${line}:${kind}:${name}`
const relKey = (file: string, type: string, source: string, target: string) => `rel:${file}:${type}:${source}:${target}`

/** What the analyzer publishes, in the SAME key shape the ground truth uses. */
const gotSymbols = new Set<string>()
const gotRels = new Set<string>()
for (const [file, res] of observed) {
  for (const s of res.symbols ?? []) gotSymbols.add(symbolKey(file, s.range?.startLine, s.name, s.kind))
  for (const r of res.relationships ?? []) gotRels.add(relKey(file, String(r.type), r.source, r.target))
}

interface Row {
  id: string
  kind: "symbol" | "relationship"
  file: string
  expected: string
  verdict: "still-produced" | "not-produced" | "produced-under-another-type"
  actual: string | null
  pinnedEvidence: string
}

const rows: Row[] = []
for (const f of truth.facts as any[]) {
  if (f.kind === "symbol") {
    const want = symbolKey(f.file, f.line, f.attributes.name, f.attributes.symbolKind)
    rows.push({
      id: f.id,
      kind: "symbol",
      file: f.file,
      expected: want,
      verdict: gotSymbols.has(want) ? "still-produced" : "not-produced",
      actual: [...gotSymbols].find((k) => k.includes(`:${f.attributes.symbolKind}:${f.attributes.name}`)) ?? null,
      pinnedEvidence: String(f.evidence?.reference ?? ""),
    })
  } else if (f.kind === "relationship") {
    const want = relKey(f.file, f.attributes.type, f.sourceId, f.targetId)
    const samePair = [...gotRels].filter((k) => k.startsWith(`rel:${f.file}:`) && k.endsWith(`:${f.sourceId}:${f.targetId}`))
    const verdict = gotRels.has(want)
      ? "still-produced"
      : samePair.length > 0
        ? "produced-under-another-type"
        : "not-produced"
    rows.push({
      id: f.id,
      kind: "relationship",
      file: f.file,
      expected: want,
      verdict,
      actual: samePair[0] ?? null,
      pinnedEvidence: String(f.evidence?.reference ?? ""),
    })
  }
}

/**
 * Emitted rows the ground truth does not mention -- the other half of a review,
 * and the half a recall-only metric never shows. Each is CLASSIFIED, because an
 * unclassified list in an artifact is a to-do rather than a finding.
 */
const expectedKeys = new Set(rows.map((r) => r.expected))
const unmentioned: string[] = []
/** Macro names, to classify a value-less `#define` symbol the way the truth's own note does. */
const macroNames = new Set<string>()
for (const [, res] of observed) {
  for (const s of res.symbols ?? []) if ((s.metadata as any)?.isMacro) macroNames.add(s.name)
}

/**
 * Why an emitted row is absent from the truth. Measured against the pinned note,
 * which lists "include guards (#define NAME with no value body)" as NOISE -- and
 * the analyzer now mints a Constant for one, deliberately, because a value-less
 * define is still a DECLARATION and dropping it cost two real edges in the F5
 * truth (#901). So this class is a truth staleness, and saying which side moved is
 * the whole point.
 */
function classifyUnmentioned(key: string): string {
  if (key.includes(":imports:")) return "include edge under the first-class `imports` kind (M60/#910) -- the truth's own row is the same fact under the old `references` kind"
  const m = /^sym:[^:]+:\d+:[^:]+:(.+)$/.exec(key)
  if (m) {
    if (macroNames.has(m[1])) return "a value-less `#define` (include guard), which the truth lists as NOISE and the analyzer mints deliberately (#901: dropping it lost two real edges)"
    return "a symbol the truth does not mention"
  }
  if (key.includes(":references:")) return "a type reference the truth does not mention (a typedef declaration site, or a parameter type) -- emitted and correct"
  return "unclassified"
}
for (const [file, res] of observed) {
  for (const s of res.symbols ?? []) {
    const k = symbolKey(file, s.range?.startLine, s.name, s.kind)
    if (!expectedKeys.has(k)) unmentioned.push(k)
  }
  for (const r of res.relationships ?? []) {
    const k = relKey(file, String(r.type), r.source, r.target)
    if (!expectedKeys.has(k)) unmentioned.push(k)
  }
}
const unmentionedClassified = unmentioned.map((k) => ({ row: k, classification: classifyUnmentioned(k) }))
const unmentionedByClass: Record<string, number> = {}
for (const u of unmentionedClassified) unmentionedByClass[u.classification] = (unmentionedByClass[u.classification] ?? 0) + 1

const byVerdict: Record<string, number> = {}
for (const r of rows) byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1

const out = {
  schemaVersion: 1,
  instrument: "script/m14/tmp/c-audit/m12-truth-drift.ts",
  generatedAt: new Date().toISOString(),
  commit: execSyncSafe(),
  purpose:
    "Per-row comparison of the PINNED M12 ground truth against the LIVE analyzer, on the four M12 fixtures. The M12 differential is a fixture differential, so this needs no corpus -- which is what makes it runnable at all in a checkout where the F5 harness's corpus root (<corpus-root>/bb_tests/repositories) does not exist.",
  why: "validation/m12/results/c-differential.json asserts passed:true at 92/92 and lists rel:Module.c:instantiates:buffer_create:malloc and rel:Module.c:references:global:stdlib.h among its TRUE POSITIVES. The analyzer emits neither: Module.c produces imports 2 / calls 6 / uses 8, with no `instantiates` (the allocator edge was deliberately removed as noise) and includes in the first-class `imports` kind since M60/#910. A row the analyzer cannot produce cannot be a true positive, so the artifact is green on something that cannot fail.",
  totals: {
    pinnedFacts: rows.length,
    byVerdict,
    unmentionedEmittedRows: unmentioned.length,
    unmentionedByClass,
  },
  rows,
  unmentionedEmittedRows: unmentionedClassified,
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n")
console.log(`wrote ${OUT}`)
console.log(`pinned facts: ${rows.length}  verdicts: ${JSON.stringify(byVerdict)}  emitted-but-unmentioned: ${unmentioned.length}`)
for (const r of rows) {
  if (r.verdict === "still-produced") continue
  console.log(`  ${r.verdict.padEnd(27)} ${r.id}`)
  if (r.actual) console.log(`      analyzer publishes: ${r.actual}`)
  console.log(`      pinned evidence:  ${r.pinnedEvidence.slice(0, 110)}`)
}
if (unmentioned.length) {
  console.log("\nemitted rows the ground truth does not mention, by class:")
  for (const [cls, n] of Object.entries(unmentionedByClass)) console.log(`  ${String(n).padStart(3)}x  ${cls}`)
  console.log("  and individually:")
  for (const u of unmentionedClassified) console.log(`    ${u.row}\n         -> ${u.classification}`)
}

function execSyncSafe(): string {
  try {
    return require("node:child_process").execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim()
  } catch {
    return "unknown"
  }
}
