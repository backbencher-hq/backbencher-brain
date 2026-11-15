// The lane's OWN F5. Every published Zig number in
// `docs/analyzers/zig.md` that came from `differential.ts` came
// from a shared harness that another lane is free to rewrite, and that has
// already happened here twice: HEAD's copy lost its `main()` to a merge and
// exited 0 IN SILENCE, and the working-tree copy is a mid-rewrite whose config
// names corpus repos this machine does not have. A number this lane publishes
// should be reproducible from this lane.
//
// So this reproduces F5's semantics exactly rather than approximating them:
//
//   PUBLISHED RULE  key = label + normTarget(target), where normTarget is the
//                   LAST SEGMENT after stripping `<...>` and `[...]` and taking
//                   the text after the final `::`. This is what the shared
//                   harness compares, so the numbers here are COMPARABLE with it.
//   STRICT RULE     key = label + strictTargetText(target), which keeps the
//                   dotted qualifier. This is the sharper question, and it is
//                   the one that found Z40: the published rule discards the
//                   qualifier, so a truth row naming `X.Y` is satisfied by an
//                   unrelated edge naming `Z.Y`, and a whole class can be absent
//                   while the published count reads clean.
//
// Both directions, both rules, per class, on a deterministic draw whose file list
// is hashed so the run can be reproduced. `--calibrate` perturbs the analyzer's
// output ahead of every comparison and the gate must then fail.
import * as fs from "fs"
import { createHash } from "crypto"
import {
  deriveZigBareUsesWithSource,
  deriveZigContainment,
  deriveZigEdgesWithSource,
  deriveZigExports,
  deriveZigImports,
  deriveZigInstantiation,
  deriveZigReferenceEdges,
} from "../zig-truth"
import { init, parser, analyzer } from "./zigw-harness"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const REPOS = ["zig", "zls", "ghostty"]
const CALIBRATE = process.argv.includes("--calibrate")
if (CALIBRATE) console.log("CALIBRATION: the analyzer's first file is perturbed -- a real gate must FAIL this")

// ── F5's normalization, transcribed from the shared harness ───────────────────
// Not reimplemented from the doc: these two functions ARE the published rule,
// and a paraphrase of a rule is how this lane produced six identical defects.
function lastSegment(t: string): string {
  const lt = t.indexOf("<")
  const base = lt >= 0 ? t.slice(0, lt) : t
  return base.split("::").filter(Boolean).pop() ?? base
}
const normTarget = (t: string): string => lastSegment(t.replace(/<.*$/, "").replace(/\[.*$/, "").trim())
const strictTargetText = (t: string): string => String(t ?? "").replace(/<.*$/, "").replace(/\[.*$/, "").trim()

function collect(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) collect(p, out)
    else if (e.name.endsWith(".zig")) out.push(p)
  }
}

type Row = { label: string; from: string; target: string; line: number }
type Acc = { truth: number; covered: number; missing: number; edges: number; unexplained: number; sMissing: number; sUnexplained: number }

await init()
const limit = Number(process.argv[2] ?? 400)
const all: string[] = []
for (const r of REPOS) collect(`${CORPUS}/${r}`, all)
all.sort()
// A DETERMINISTIC draw: sorted, then rotated by the sample size so successive
// runs walk the corpus instead of re-grading the same alphabetical prefix, which
// is what a fixed prefix does and why a prefix-only gate can stay green for
// months. The rotation is a pure function of the sample size, and the file list
// is hashed, so a published number names the exact files behind it.
const rot = limit % Math.max(1, all.length)
const draw = all.slice(rot, rot + Math.min(limit, all.length))
const hash = createHash("sha256").update(draw.join("\n")).digest("hex").slice(0, 12)

const perClass = new Map<string, Acc>()
const acc = (label: string): Acc => {
  let a = perClass.get(label)
  if (!a) { a = { truth: 0, covered: 0, missing: 0, edges: 0, unexplained: 0, sMissing: 0, sUnexplained: 0 }; perClass.set(label, a) }
  return a
}
const misses: string[] = []
const unexplains: string[] = []
const strictMisses: string[] = []
const strictUnexplains: string[] = []

for (const f of draw) {
  const src = fs.readFileSync(f, "utf8")
  const tree = parser().parse(src)
  const res = analyzer().analyze(tree.rootNode, src, f) as any
  const syms = res.symbols ?? []
  const rel_ = f.split("/repositories/")[1] ?? f

  const derived: Row[] = [
    ...deriveZigContainment(tree.rootNode, syms),
    ...deriveZigImports(tree.rootNode),
    ...deriveZigInstantiation(tree.rootNode),
    ...deriveZigExports(tree.rootNode),
    ...deriveZigReferenceEdges(tree.rootNode),
    ...deriveZigEdgesWithSource(tree.rootNode),
    ...deriveZigBareUsesWithSource(tree.rootNode, syms),
  ] as Row[]

  const pub: any[] = res.relationships ?? []
  if (CALIBRATE && f === draw[0] && pub.length > 0) {
    // perturb BEFORE anything is compared: drop one truth row's coverage by
    // renaming a published target, and push a confidence out of contract
    pub[0] = { ...pub[0], target: `${pub[0].target}__CALIBRATION__` }
    pub[1] = { ...pub[1], confidence: 0.01 }
  }

  const pubNorm = new Set<string>()
  const pubStrict = new Set<string>()
  for (const r of pub) {
    acc(String(r.type)).edges++
    pubNorm.add(`${r.type}|${normTarget(String(r.target ?? ""))}`)
    pubStrict.add(`${r.type}|${strictTargetText(String(r.target ?? ""))}`)
  }
  // Count a ROW, not a key. The first version of this table incremented `truth`
  // once per row but `covered` once per UNIQUE key, so a file with three rows
  // sharing one key read as 1 covered of 3 truth and the total capped at 67.29%
  // on a run where nothing was missing. A ratio that cannot reach 100% is not a
  // coverage number, and reporting it as one would have been this lane's seventh
  // instance of a figure that looks like evidence and is not.
  const seen = new Set<string>()
  for (const t of derived) {
    const a = acc(t.label)
    a.truth++
    const nk = `${t.label}|${normTarget(t.target)}`
    const sk = `${t.label}|${strictTargetText(t.target)}`
    if (pubNorm.has(nk)) a.covered++
    else {
      a.missing++
      if (!seen.has(nk) && misses.length < 12) { seen.add(nk); misses.push(`${rel_}:${t.line ?? "?"}  ${t.label} ${t.from} -> ${t.target}`) }
    }
    if (!pubStrict.has(sk)) {
      a.sMissing++
      if (!seen.has(sk) && strictMisses.length < 12) strictMisses.push(`${rel_}:${t.line ?? "?"}  ${t.label} ${t.from} -> ${t.target}`)
    }
  }
  const truthStrict = new Set(derived.map((t) => `${t.label}|${strictTargetText(t.target)}`))
  const seenPub = new Set<string>()
  for (const r of pub) {
    const nk = `${r.type}|${normTarget(String(r.target ?? ""))}`
    if (seenPub.has(nk)) continue
    seenPub.add(nk)
    if (!truthNormFor(derived).has(nk)) {
      acc(String(r.type)).unexplained++
      if (unexplains.length < 12) unexplains.push(`${rel_}:${r.line_number ?? "?"}  ${r.type} ${r.source} -> ${r.target}`)
    }
    const sk = `${r.type}|${strictTargetText(String(r.target ?? ""))}`
    if (!truthStrict.has(sk)) {
      acc(String(r.type)).sUnexplained++
      if (strictUnexplains.length < 12) strictUnexplains.push(`${rel_}:${r.line_number ?? "?"}  ${r.type} ${r.source} -> ${r.target}`)
    }
  }
  tree.delete()
}

function truthNormFor(derived: Row[]): Set<string> {
  return new Set(derived.map((t) => `${t.label}|${normTarget(t.target)}`))
}

const order = ["contains", "uses", "calls", "references", "imports", "exports", "instantiates"]
let tTruth = 0, tCovered = 0, tMissing = 0, tEdges = 0, tUnexp = 0, sMiss = 0, sUnexp = 0
console.log(`lane differential \u2014 files: ${draw.length}  draw: sha256:${hash} (rot ${rot})  calib: ${CALIBRATE ? "ON" : "off"}`)
console.log(`\n${"class".padEnd(14)}${"truth".padStart(8)}${"covered".padStart(9)}${"MISSING".padStart(9)}${"edges".padStart(8)}${"unexpl".padStart(8)}   | strict MISSING / strict unexplained`)
for (const k of order) {
  const a = perClass.get(k)
  if (!a) continue
  tTruth += a.truth; tCovered += a.covered; tMissing += a.missing; tEdges += a.edges; tUnexp += a.unexplained
  sMiss += a.sMissing; sUnexp += a.sUnexplained
  console.log(`${k.padEnd(14)}${String(a.truth).padStart(8)}${String(a.covered).padStart(9)}${String(a.missing).padStart(9)}${String(a.edges).padStart(8)}${String(a.unexplained).padStart(8)}   | ${a.sMissing} / ${a.sUnexplained}`)
}
console.log(`${"TOTAL".padEnd(14)}${String(tTruth).padStart(8)}${String(tCovered).padStart(9)}${String(tMissing).padStart(9)}${String(tEdges).padStart(8)}${String(tUnexp).padStart(8)}   | ${sMiss} / ${sUnexp}`)
const pct = tTruth === 0 ? "n/a" : `${((tCovered / tTruth) * 100).toFixed(2)}%`
console.log(`\npublished rule: ${tCovered}/${tTruth} covered (${pct}), MISSING ${tMissing}, unexplained ${tUnexp} of ${tEdges} analyzer edges`)
console.log(`strict rule:    MISSING ${sMiss}, unexplained ${sUnexp}  \u2014 the axis the published rule cannot see`)
if (misses.length) { console.log("\nMISSING samples:"); for (const m of misses) console.log("  " + m) }
if (unexplains.length) { console.log("\nunexplained samples:"); for (const m of unexplains) console.log("  " + m) }
if (strictMisses.length) { console.log("\nstrict MISSING samples:"); for (const m of strictMisses) console.log("  " + m) }
if (strictUnexplains.length) { console.log("\nstrict unexplained samples:"); for (const m of strictUnexplains) console.log("  " + m) }

process.exit(tMissing + tUnexp === 0 ? 0 : 1)
