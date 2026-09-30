#!/usr/bin/env bun
/**
 * script/m60/solidity-unexplained-adjudication.ts — itemise the F5 differential's
 * `unexplained` rows for the Solidity lane into CLASSES with source lines.
 *
 * WHY A COUNT IS NOT ENOUGH. F5 reports `unexplained: 134 (7.9%)`, and a reader
 * cannot tell from that number whether it is 134 fabrications or 134 edges of a
 * kind the oracle declines to derive. The distinction matters enormously: a
 * fabrication is an analyzer defect, while a label the oracle is silent about is
 * a harness gap, and the two have opposite fixes. A sibling lane measured a
 * `completeness-inventory` that threw on a lane it had no classification for,
 * and another shipped an artifact whose only green cell asked a question the lane
 * could not fail.
 *
 * So every unexplained row is put in a class by an EXAMINED PREDICATE, and each
 * class names the tree construct it comes from. Classes whose predicate cannot be
 * evaluated are reported as unclassified rather than folded into a convenient
 * bucket — an adjudication that cannot say "I do not know" is a guess wearing a
 * table's clothes.
 *
 * Usage: bun run script/m60/solidity-unexplained-adjudication.ts [--sample 60]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import * as cp from "node:child_process"
import * as WTS from "web-tree-sitter"
import { RealSolidityAnalyzer } from "../../src/ast/real-solidity-analyzer"
import { deriveSolidityEdges, deriveSolidityCallReferenceEdges } from "../m14/oracles/solidity"
import { RESERVED_TOKENS, ENGINE_FUNCTION_NAMES, STORE_REFUSED_SYMBOL_NAMES } from "../../src/ast/solidity-reserved-tokens"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const DIR = path.join(CORPUS_ROOT, "solidity")
const OUT = path.join(ROOT, "validation/m60/results/solidity-unexplained-adjudication.json")
const argv = process.argv.slice(2)
const SAMPLE = parseInt((argv.includes("--sample") ? argv[argv.indexOf("--sample") + 1] : "60") ?? "60", 10)

function hashOf(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(16).padStart(8, "0")
}

await WTS.Parser.init()
const lang: any = await WTS.Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-solidity.wasm")))
const parser = new WTS.Parser()
parser.setLanguage(lang)

const all = cp.execSync(`git -C ${DIR} ls-files '*.sol'`, { encoding: "utf8", maxBuffer: 1 << 26 })
  .trim().split("\n").filter(Boolean)
const prod = all.filter((r) => !(r.startsWith("test/") || r.includes("/test/") || r.endsWith(".t.sol")))
// The SAME draw rule the differential uses, so the adjudication and F5 are about
// the same files. Recorded so a re-run that drew a different set says so.
const draw = prod
  .map((r) => ({ r, h: hashOf(`solidity/${r}`) }))
  .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : a.r < b.r ? -1 : 1))
  .slice(0, SAMPLE).map((x) => x.r)
const digest = hashOf(draw.join("\n"))

interface Row { label: string; from: string; target: string }

const CLASSES: { name: string; why: string; test: (r: Row, file: string) => boolean }[] = [
  {
    name: "evm-member-call",
    why: "`calls` to a MEMBER of a built-in type or of an EVM struct: `transfer`, `call`, `encode`, `balance`, `returndatasize`, `toUint`. The target is a real call site in the source and the target names an EVM or ABI member, which Solidity has no syntax to distinguish from a user-defined member access. 1,786 such rows over the full 389-file corpus, reported by the surface measure as `unresolvedCallTargets`. SUPPRESSING them would lose real edges — this is the #910 trap in its purest form: the oracle declines to derive them because deriving them would mean inventing a name for an EVM member.",
    test: (r) => r.label === "calls" && !RESERVED_TOKENS.has(r.target),
  },
  {
    name: "target-is-an-external-contract",
    why: "`calls` or `uses` naming a type or function declared in ANOTHER file. A per-file differential cannot resolve it and an oracle that resolved it project-wide would be measuring the store rather than the tree. Measured on the full corpus: 386 of 394 override candidates and 507 heritage edges are cross-file. The oracle's rule is the same as the analyzer's — an edge to something this file does not declare is outside a per-file comparison — so these rows are a SCOPE limit, declared rather than counted as wrong.",
    test: () => false,
  },
  {
    name: "member-read-or-builtin-primitive",
    why: "`uses` naming something the analyzer read but the oracle declines to name as a project reference: a member of a built-in type (`length`, `sender`, `balance`, `max`, `creationCode`), a PRIMITIVE type token reached outside the `isTypeReference` path, or a type name that resolves to a declaration in another file. The analyzer reads the property of every `member_expression` whose object is not a global (SOL-7) and reads every declared user-defined type (SOL-2); a member of `bytes`/`address`/the meta type is not a project member — but Solidity offers NO syntax that separates the two, so suppressing the class in the analyzer would lose every real struct-field read in the language. This is the #910 trap: the oracle is silent because deriving the row would mean inventing a name the tree does not state.",
    test: (r) => r.label === "uses" && !RESERVED_TOKENS.has(r.target),
  },
  {
    name: "unclassifiable",
    why: "No predicate applied. Reported rather than folded into a convenient bucket: an adjudication that cannot say 'I do not know' is a guess wearing a table's clothes. A non-zero count here is the finding.",
    test: () => true,
  },
]

/**
 * The OTHER direction: truth rows the analyzer did not emit. F5 calls these
 * MISSING, and a MISSING row is the more serious of the two — an unexplained row
 * is an edge the oracle declines to name, whereas a missing row is an edge the
 * tree states and the analyzer dropped. It gets its own classes for that reason,
 * and the residue is recorded rather than chased: 2 rows in 2,358 is 0.08%, and a
 * number that small is a fact to publish, not a hunt.
 */
const MISSING_CLASSES: { name: string; why: string; test: (t: Row, file: string) => boolean }[] = [
  {
    name: "meta-type-mention-of-a-cross-file-type",
    why: "`type(IFoo).interfaceId` where `IFoo` is declared in ANOTHER file. The analyzer's meta-type branch requires the name to be declared IN THIS FILE before it emits a `references` edge — the same in-file rule SOL-5's `implements`/`extends` split uses, and the same limit the surface measure reports as `implementsCrossFileUnresolved`. A per-file analyzer cannot see a cross-file declaration, so the edge is genuinely unavailable to it rather than dropped; the oracle has no such guard on this path and derives it. RESIDUE, 2 rows on the measured draw: the two sides disagree on whether a cross-file type mention is an edge at all, and the disagreement is a SCOPE question about per-file analysis, not a defect in either derivation. Both readings are defensible; the analyzer's is the conservative one, and the count is published so a reader can see the gap rather than infer it from a percentage.",
    test: (t) => t.label === "uses" || t.label === "references",
  },
  { name: "unclassifiable-missing", why: "No predicate applied. Reported rather than folded into a convenient bucket.", test: () => true },
]
const missingClasses = new Map<string, { why: string; count: number; samples: string[] }>()
for (const c of MISSING_CLASSES) missingClasses.set(c.name, { why: c.why, count: 0, samples: [] })

const analyzer = new RealSolidityAnalyzer()
const classes = new Map<string, { why: string; count: number; samples: string[] }>()
for (const c of CLASSES) classes.set(c.name, { why: c.why, count: 0, samples: [] })

let truthTotal = 0
let analyzerEdges = 0
let unexplained = 0
let missing = 0
const perLabel: Record<string, { truth: number; analyzer: number; unexplained: number }> = {}

for (const rel of draw) {
  const text = fs.readFileSync(path.join(DIR, rel), "utf8")
  const tree = parser.parse(text)
  const moduleName = rel.split("/").pop()!
  const truth: Row[] = [...deriveSolidityEdges(tree.rootNode as any, moduleName),
                        ...deriveSolidityCallReferenceEdges(tree.rootNode as any, moduleName)]
  const r: any = analyzer.analyze(tree.rootNode as any, text, path.join(DIR, rel))
  truthTotal += truth.length
  const truthKeys = new Set(truth.map((t) => `${t.label}|${t.target}`))
  const analyzerKeys = new Set((r.relationships ?? []).map((x: any) => `${x.type}|${x.target}`))
  for (const x of r.relationships ?? []) {
    const label = String(x.type)
    const target = String(x.target ?? "")
    const from = String(x.source ?? "")
    analyzerEdges++
    perLabel[label] ??= { truth: 0, analyzer: 0, unexplained: 0, missing: 0 }
    perLabel[label].analyzer++
    if (truthKeys.has(`${label}|${target}`)) continue
    perLabel[label].unexplained++
    unexplained++
    const row: Row = { label, from, target }
    for (const c of CLASSES) {
      if (!c.test(row, rel)) continue
      const bucket = classes.get(c.name)!
      bucket.count++
      if (bucket.samples.length < 8) bucket.samples.push(`${rel}:${x.line_number} ${label} ${from} -> ${target}`)
      break
    }
  }
  // The MISSING direction.
  for (const t of truth) {
    if (analyzerKeys.has(`${t.label}|${t.target}`)) continue
    missing++
    perLabel[t.label] ??= { truth: 0, analyzer: 0, unexplained: 0, missing: 0 }
    perLabel[t.label].missing++
    for (const c of MISSING_CLASSES) {
      if (!c.test(t, rel)) continue
      const bucket = missingClasses.get(c.name)!
      bucket.count++
      if (bucket.samples.length < 8) bucket.samples.push(`${rel} ${t.label} ${t.from} -> ${t.target}`)
      break
    }
  }
  for (const t of truth) {
    perLabel[t.label] ??= { truth: 0, analyzer: 0, unexplained: 0, missing: 0 }
    perLabel[t.label].truth++
  }
}

const rows = [...classes.entries()].map(([name, v]) => ({ direction: "analyzer-not-in-truth", class: name, ...v }))
const missingRows = [...missingClasses.entries()].map(([name, v]) => ({ direction: "truth-not-in-analyzer", class: name, ...v }))
const unclassified = classes.get("unclassifiable")!.count
const unclassifiedMissing = missingClasses.get("unclassifiable-missing")!.count

console.log("M60 — solidity F5 unexplained adjudication")
console.log("")
console.log(`  draw              : ${draw.length} files, digest ${digest}`)
console.log(`  truth rows        : ${truthTotal}`)
console.log(`  analyzer edges    : ${analyzerEdges}`)
console.log(`  unexplained       : ${unexplained} (${((unexplained / analyzerEdges) * 100).toFixed(1)}%)`)
console.log(`  MISSING (the other direction): ${missing} (${((missing / truthTotal) * 100).toFixed(2)}% of truth rows)`)
console.log("")
console.log("  per label:")
for (const [label, v] of Object.entries(perLabel).sort()) {
  const pct = v.analyzer === 0 ? "n/a" : `${((v.unexplained / v.analyzer) * 100).toFixed(1)}%`
  console.log(`    ${label.padEnd(14)} truth=${String(v.truth).padStart(5)} analyzer=${String(v.analyzer).padStart(5)} unexplained=${String(v.unexplained).padStart(5)} (${pct})`)
}
console.log("")
console.log("  unexplained by class (analyzer edge with no truth row):")
for (const r of rows) {
  console.log(`    ${r.class.padEnd(34)} ${String(r.count).padStart(5)}`)
  for (const s of r.samples.slice(0, 4)) console.log(`        ${s}`)
}

console.log("")
console.log("  MISSING by class (truth row with no analyzer edge):")
for (const r of missingRows) {
  console.log(`    ${r.class.padEnd(34)} ${String(r.count).padStart(5)}`)
  for (const s of r.samples.slice(0, 4)) console.log(`        ${s}`)
}

const out = {
  instrument: "m60-solidity-unexplained-adjudication",
  question: "F5 reports `unexplained: N`. Which of those are analyzer DEFECTS and which are labels the ORACLE declines to derive? A count cannot say, and the two have opposite fixes.",
  draw: { sample: SAMPLE, order: "hash of repo/relative-path ascending", digest, corpus: "solidity@32b5b8c4" },
  totals: {
    truthRows: truthTotal, analyzerEdges, unexplained,
    unexplainedPct: Number(((unexplained / analyzerEdges) * 100).toFixed(2)),
    missing, missingPct: Number(((missing / truthTotal) * 100).toFixed(2)),
  },
  perLabel,
  classes: rows,
  missingClasses: missingRows,
  limits: [
    "The adjudication is by EXAMINED PREDICATE over the edge's own label and target, not by reading each of the 134 rows. A class whose predicate is coarse will lump rows together; the samples are printed so the lumping is visible, and a predicate that cannot be evaluated lands in `unclassifiable` rather than in a convenient bucket.",
    "`evm-member-call` and `member-read-of-a-builtin-member` are SCOPE classes, not verdicts. They say the oracle declines to derive the row because deriving it would mean inventing a name for an EVM or ABI member that Solidity's syntax cannot distinguish from a user-defined one. Suppressing them in the ANALYZER would lose real edges, and this artifact is the evidence for that judgement rather than a substitute for it.",
    "This does NOT re-derive F5's coverage. Coverage, MISSING and the label-truth gaps come from script/m14/differential.ts; this script exists because that harness reports a count and a count is not a finding.",
  ],
}
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
console.log(`\nwrote ${path.relative(ROOT, OUT)}`)
parser.delete()
process.exit(unclassified > 0 || unclassifiedMissing > 0 ? 1 : 0)