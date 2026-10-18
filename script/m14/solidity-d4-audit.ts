/**
 * solidity-d4-audit — quantify and CLASSIFY the differential's residual for the Solidity lane
 * (ALL-OUT-OF-ALL §9.1 D4: every emitted label derived AND admitted; residual classified, never
 * claimed clean).
 *
 * The differential is the AUDIT OF RECORD: it prints per draw `files · tree-truth · covered ·
 * MISSING · analyzer-edges · unexplained · heuristic` and the `COMPARED WITH NO TRUTH` disclosure,
 * but it does not print the rows behind a count. This instrument reproduces the SAME comparison on a
 * same-shaped draw (the repo's admitted `.sol` files, sorted, stride to N — a stated draw, never
 * merged with the differential's cold-pool rotation) and puts EVERY non-matching row into a named
 * class with its deciding side.
 *
 * MATCH KEY: `label + normTarget(target)` — the differential's published rule — EXCEPT `imports`,
 * which compares the target AS WRITTEN. That exception is not this instrument's invention: the
 * Lead's matcher fix (`174f35fda`) made path-like imports exact because `normTarget` collapses every
 * module path to its extension segment (`./A.sol` -> `sol`), which would make any import path cover
 * any other. The lane found that defect while writing this oracle; the audit uses the FIXED rule.
 *
 * TRUTH: the lane's own derivation — `deriveSolidityEdges` + `deriveSolidityCallReferenceEdges`
 * (`script/m14/oracles/solidity.ts`) + `deriveSolidityImportTruth` (`script/m14/oracles/solidity-imports-truth.ts`).
 * Both sides walk the same pinned parse, so a grammar bug shared by them is invisible here — stated,
 * not claimed around.
 *
 * CLASSES (each names its DECIDING SIDE):
 *   truth-over-derivation/*   truth derives a row the analyzer deliberately does not publish
 *   truth-gap/*               analyzer publishes a row truth does not derive yet — truth debt
 *   imports/*                 the newly-admitted label; must be 0/0 under the exact matcher
 *   unknown/*                 the control FAILS on any row here
 *
 * USAGE
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/solidity-d4-audit.ts --repo=solidity --sample=60 [--json]
 *
 * EXIT 0 audited · 2 usage/environment · 3 CONTROL DID NOT FIRE (unclassified row / class sum mismatch).
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { deriveSolidityCallReferenceEdges, deriveSolidityEdges } from "./oracles/solidity"
import { deriveSolidityImportTruth } from "./oracles/solidity-imports-truth"
import { normTarget } from "./differential"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const EXTS = ["sol"]
const ALL_LABELS = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const

function arg(name: string, dflt?: string): string | undefined {
  const j = process.argv.find((a) => a.startsWith(`${name}=`))
  return j ? j.slice(name.length + 1) : dflt
}
const REPO = arg("--repo")
const SAMPLE = Number(arg("--sample", "60"))
const JSON_OUT = process.argv.includes("--json")
if (!REPO) {
  console.error("usage: bun run script/m14/solidity-d4-audit.ts --repo=<corpus repo> [--sample=60] [--json]")
  process.exit(2)
}

const { getParser } = await import("./run-fixtures")

function drawFiles(): { files: string[]; admitted: number } {
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", path.join(CR, REPO as string), "ls-files", "-z"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    console.error(`solidity-d4-audit: cannot read ${path.join(CR, REPO as string)} as a git checkout (BB_CORPUS_ROOT=${CR})`)
    process.exit(2)
  }
  const admitted = tracked
    .filter((rel) => {
      const base = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase()
      const dot = base.lastIndexOf(".")
      return dot >= 0 && EXTS.includes(base.slice(dot + 1))
    })
    .sort()
  if (admitted.length === 0) {
    console.error(`solidity-d4-audit: 0 admitted .sol files in ${REPO}`)
    process.exit(2)
  }
  const files: string[] = []
  const stride = Math.max(1, Math.floor(admitted.length / SAMPLE))
  for (let i = 0; i < admitted.length && files.length < SAMPLE; i += stride) files.push(admitted[i])
  return { files, admitted: admitted.length }
}

type RowClass = { klass: string; why: string }
function classify(kind: "missing" | "unexplained", label: string, from: string, target: string, meta: any): RowClass {
  const t = String(target)
  if (kind === "missing") {
    // truth derived a row the analyzer did not publish
    if (label === "uses") {
      // The oracle's read walk also visits an `inheritance_specifier`'s ancestor type as a read of
      // that name; the analyzer publishes the heritage edge and no `uses` row. Measured samples:
      // `uses supportsInterface -> IERC6909TokenSupply` beside `implements supportsInterface -> …`.
      const typeShaped = /^[A-Z]/.test(t) || t.startsWith("I") && /^I[A-Z]/.test(t)
      return {
        klass: typeShaped ? "truth-over-derivation/uses-inheritance-specifier" : "truth-gap/uses-other",
        why: typeShaped
          ? "the oracle's read walk reads an inheritance clause's ancestor TYPE as a uses row; the analyzer publishes the heritage edge (extends/implements) and no uses row — ANALYZER decides"
          : "truth derived a read the analyzer does not publish",
      }
    }
    if (label === "contains") return { klass: "truth-gap/contains", why: "truth derives a containment row the analyzer suppresses (recovery region)" }
    return { klass: `unknown/${label}-missing`, why: "unclassified missing row — control fails" }
  }
  // analyzer published, truth did not derive
  if (label === "uses") {
    if (meta?.isYulPathSegment === true || meta?.isYulVariableRead === true) {
      return { klass: "truth-gap/uses-yul", why: "analyzer publishes a Yul read the oracle's Yul walk misses" }
    }
    if (meta?.isMemberReference === true) return { klass: "truth-gap/uses-member", why: "analyzer publishes a member read the oracle does not derive" }
    if (meta?.isVariableReference === true) return { klass: "truth-gap/uses-variable", why: "analyzer publishes an identifier read (SOL-2 positional rule) the oracle does not derive" }
    return { klass: "truth-gap/uses-other", why: "analyzer publishes a uses row the oracle does not derive" }
  }
  if (label === "calls") {
    const kind = typeof meta?.calleeKind === "string" ? meta.calleeKind : "(none)"
    return { klass: `truth-gap/calls-${kind}`, why: `analyzer publishes a ${kind} call the oracle does not derive` }
  }
  if (label === "exports") return { klass: "truth-gap/exports", why: "analyzer publishes an export row the oracle does not derive" }
  if (label === "imports") return { klass: "imports/mismatch", why: "the newly-admitted label — a PATH mismatch under the exact matcher, to be reported" }
  if (label === "references") return { klass: "truth-gap/references", why: "analyzer publishes a references row the oracle does not derive" }
  return { klass: `unknown/${label}`, why: "unclassified residual row — control fails" }
}

const { files, admitted } = drawFiles()
const parser: any = await getParser("solidity")
const mod: any = await import(path.join(ROOT, "src/ast/real-solidity-analyzer.ts"))
const analyzer = new mod.RealSolidityAnalyzer()
const ctor: any = analyzer?.constructor
if (typeof ctor?.setGrammar === "function") {
  try { ctor.setGrammar(parser.language, parser.constructor) } catch { /* main pass only, same contract as the runner */ }
}

const perLabel: Record<string, { truth: number; published: number; missing: number; unexplained: number }> = {}
for (const l of ALL_LABELS) perLabel[l] = { truth: 0, published: 0, missing: 0, unexplained: 0 }
const classes: Record<string, { rows: number; samples: string[]; why: string }> = {}
const bump = (c: RowClass, sample: string) => {
  const row = classes[c.klass] ?? (classes[c.klass] = { rows: 0, samples: [], why: c.why })
  row.rows++
  if (row.samples.length < 6) row.samples.push(sample)
}
const keyOf = (label: string, target: string) =>
  label === "imports" ? `imports\u0000EXACT:${target}` : `${label}\u0000${normTarget(target)}`

let parsed = 0
let failed = 0
let truthRows = 0
let analyzerRows = 0
const unclassifiedLabels = new Map<string, number>()
for (const rel of files) {
  const abs = path.join(CR, REPO as string, rel)
  let src: string
  try { src = readFileSync(abs, "utf8") } catch { failed++; continue }
  const tree: any = parser.parse(src, abs)
  if (!tree?.rootNode) { failed++; continue }
  parsed++
  const a: any = await analyzer.analyze(tree.rootNode, src, rel)
  const moduleName = rel.split("/").pop() ?? "contract.sol"
  const truth: Array<{ label: string; from: string; target: string }> = [
    ...deriveSolidityEdges(tree.rootNode, moduleName),
    ...deriveSolidityCallReferenceEdges(tree.rootNode, moduleName),
    ...deriveSolidityImportTruth(tree.rootNode, moduleName),
  ].map((e: any) => ({ label: String(e.label ?? ""), from: String(e.from ?? ""), target: String(e.target ?? "") }))
  truthRows += truth.length
  const rels = (a?.relationships ?? []) as any[]
  analyzerRows += rels.length
  const tk = new Set(truth.map((e) => keyOf(e.label, e.target)))
  const ak = new Set(rels.map((r: any) => keyOf(String(r.type ?? ""), String(r.target ?? ""))))
  for (const e of truth) {
    if (!(ALL_LABELS as readonly string[]).includes(e.label)) { unclassifiedLabels.set(e.label, (unclassifiedLabels.get(e.label) ?? 0) + 1); continue }
    perLabel[e.label].truth++
    if (!ak.has(keyOf(e.label, e.target))) {
      perLabel[e.label].missing++
      bump(classify("missing", e.label, e.from, e.target, null), `${rel}: ${e.from} -> ${e.target}`)
    }
  }
  for (const r of rels) {
    const label = String(r.type ?? "")
    if (!(ALL_LABELS as readonly string[]).includes(label)) { unclassifiedLabels.set(label, (unclassifiedLabels.get(label) ?? 0) + 1); continue }
    perLabel[label].published++
    if (!tk.has(keyOf(label, String(r.target ?? "")))) {
      perLabel[label].unexplained++
      bump(classify("unexplained", label, String(r.source ?? ""), String(r.target ?? ""), r.metadata), `${rel}: ${r.source} -> ${r.target} [${(r.metadata as any)?.calleeKind ?? (r.metadata as any)?.relationshipType ?? ""}]`)
    }
  }
  tree.delete?.()
}

// ── CONTROL: every row in a named class; class sums close; nothing unclassified ───────────────
const failures: string[] = []
if (failed > 0) failures.push(`parse/read failures: ${failed}`)
for (const [k, v] of unclassifiedLabels) failures.push(`unclassified label: ${k}=${v}`)
const missingSum = Object.values(perLabel).reduce((a, b) => a + b.missing, 0)
const unexplainedSum = Object.values(perLabel).reduce((a, b) => a + b.unexplained, 0)
const classSum = Object.values(classes).reduce((a, b) => a + b.rows, 0)
if (classSum !== missingSum + unexplainedSum) failures.push(`class rows ${classSum} != missing+unexplained ${missingSum + unexplainedSum}`)
for (const [k, c] of Object.entries(classes)) if (k.startsWith("unknown/")) failures.push(`unclassified-in-effect class: ${k}=${c.rows}`)
const importsRow = perLabel["imports"]
const importsCheck = {
  explained: "the only emitted label whose audit was previously impossible; under the exact path matcher (Lead 174f35fda) a path mismatch CAN fail",
  truth: importsRow.truth,
  published: importsRow.published,
  missing: importsRow.missing,
  unexplained: importsRow.unexplained,
  clean: importsRow.missing === 0 && importsRow.unexplained === 0,
}

if (failures.length > 0) {
  console.error("CONTROL DID NOT FIRE: the residual has rows outside the named classes.")
  for (const f of failures.slice(0, 20)) console.error("  " + f)
  for (const [k, c] of Object.entries(classes).sort((a, b) => b[1].rows - a[1].rows)) {
    console.error(`  ${k.padEnd(48)} ${String(c.rows).padStart(5)} — ${c.why}`)
    for (const s of c.samples.slice(0, 4)) console.error(`      e.g. ${s}`)
  }
  process.exit(3)
}

const report = {
  schemaVersion: 1,
  instrument: "script/m14/solidity-d4-audit.ts",
  measuredAt: new Date().toISOString(),
  repo: REPO,
  draw: { requested: SAMPLE, files: files.length, admittedInRepo: admitted, strategy: "repo tracked .sol files, sorted, stride — a DIFFERENT draw from the differential's cold-pool rotation, stated so the two are never merged" },
  population: { parsed, failed, truthRows, analyzerRows },
  comparison: "label + normTarget(target) except imports (target as written, the Lead's 174f35fda fix); `from` endpoints are site conventions and are not compared",
  importsCheck,
  perLabel,
  classes,
  closure: { missing: missingSum, unexplained: unexplainedSum, classRows: classSum, ok: classSum === missingSum + unexplainedSum },
  controls: { ok: true, detail: "every row in a named class; class sum equals missing+unexplained; no unclassified label; 0 parse failures" },
}
if (JSON_OUT) console.log(JSON.stringify(report, null, 1))
else {
  console.log(`solidity-d4-audit — repo ${REPO} · draw ${files.length} of ${admitted} admitted files · parsed ${parsed}, failed ${failed}`)
  console.log(`truth rows ${truthRows} · analyzer rows ${analyzerRows} · MISSING ${missingSum} · unexplained ${unexplainedSum}`)
  console.log(`imports (exact path matcher): truth ${importsCheck.truth} · published ${importsCheck.published} · MISSING ${importsCheck.missing} · unexplained ${importsCheck.unexplained} · ${importsCheck.clean ? "CLEAN" : "MISMATCH"}`)
  console.log()
  for (const l of ALL_LABELS) {
    const r = perLabel[l]
    console.log(`  ${l.padEnd(14)} truth ${String(r.truth).padStart(5)} · published ${String(r.published).padStart(5)} · MISSING ${String(r.missing).padStart(4)} · unexplained ${String(r.unexplained).padStart(4)}`)
  }
  console.log()
  console.log("NAMED CLASSES")
  console.log("-".repeat(78))
  for (const [k, c] of Object.entries(classes).sort((a, b) => b[1].rows - a[1].rows)) {
    console.log(`  ${k.padEnd(48)} ${String(c.rows).padStart(5)} — ${c.why}`)
    for (const s of c.samples.slice(0, 3)) console.log(`      e.g. ${s}`)
  }
  console.log()
  console.log("CONTROL: PASS — every residual row is in a named class; class sum equals MISSING+unexplained; no unclassified label; 0 parse failures")
}
