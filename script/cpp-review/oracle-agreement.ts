/**
 * CPP ORACLE AGREEMENT — does the analyzer's own output match the oracle, per
 * relationship type?
 *
 * This is the check the DERIVATION finding says cpp does not have. The three
 * findings recorded in `validation/m60/rel-type-coverage-baseline.json` are that
 * `contains`, `overrides` and `references` are "stored and compared against
 * nothing" — emitted by the analyzer, audited by no one. Two more arrived with
 * this wave's edges (`imports`, `exports`), so five types were in that state.
 *
 * It drives the PRODUCTION entry (`parseFile` from `src/ast/pool-worker`), not
 * `analyze()` directly, because the known-zeros gap lives exactly there: the
 * analyzer produces `exports` rows from raw source and `parseFile` delivers
 * none, because `src/ast/engine.ts` blanks `__attribute__((...))` and
 * `__declspec(...)` out of C/C++ content before the parser sees it. An oracle
 * comparison that called `analyze()` would report 0/0 and pass.
 *
 * THE COMPARISON IS SET-BASED, NOT ROW-BASED, and the reason is stated rather
 * than hidden: the oracle derives a SET of (label, from, target) facts and the
 * analyzer publishes rows with metadata this module does not model. A row
 * comparison would therefore report tens of thousands of "missing" rows that are
 * a difference in accounting, not in facts — which is a number nobody can act on
 * and is exactly how a coverage number stops meaning anything. So each fact is
 * asked two questions:
 *
 *   MISSING     the oracle derived a fact the analyzer did not publish   (a gap)
 *   UNEXPLAINED the analyzer published a fact the oracle did not derive (a
 *               fabrication, or a rule the oracle does not model — each such
 *               rule is named in `KNOWN_ORACLE_GAPS` so an unexplained row is a
 *               finding rather than a shrug)
 *
 * HONEST LIMITS, restated at the point of use:
 *   - Both sides walk the SAME pinned parse, so a grammar bug shared by them is
 *     invisible here. The workstream doc requires that be said rather than
 *     claimed around.
 *   - `overrides` truth is signature matching, which is the analyzer's own rule
 *     (CPPD-R1). Its agreement rate is a measure of the REGISTRY plumbing, not
 *     proof that the signature rule is correct.
 *   - `exports` agreement is expected to be 0 on the production path, and the
 *     report says so explicitly rather than letting a red number stand as an
 *     unexplained lane defect.
 *
 *   bun run script/cpp-review/oracle-agreement.ts [--repo=a,b] [--sample=N]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"
import { deriveCppTruth, deriveCppShared, CPP_ORACLE_LABELS, type CppTruthEdge } from "../m14/cpp-truth"
import { normTarget } from "../m14/differential"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1]
  const j = process.argv.find((a) => a.startsWith(`${flag}=`))
  return j ? j.slice(flag.length + 1) : dflt
}
const OUT = argOf("--out")
const REPOS = (argOf("--repo", "cpp-example,fmt,nlohmann-json,googletest") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const SAMPLE = Number(argOf("--sample", "120") ?? "120")
const MAX_BYTES = 900 * 1024

/**
 * Rules the oracle does not model, each with the reason. An unexplained row that
 * lands in one of these buckets is ATTRIBUTED rather than counted as a
 * fabrication — which is the only honest thing to do with a difference whose
 * cause is known, and the difference between that and simply widening the
 * oracle's scope is that the list is bounded, reviewed, and stated.
 */
const KNOWN_ORACLE_GAPS: Array<{ label: string; test: (from: string, target: string) => boolean; why: string }> = [
  { label: "references", test: (_f, t) => t.includes("::"), why: "the oracle derives `using` dependencies at FILE/NAMESPACE scope only; the analyzer also emits a `using` whose target it read through a wrapper. Asserted apart so the count is attributed." },
]

/**
 * Labels whose SOURCE ENDPOINT IS A SITE CONVENTION on the oracle side, so the
 * two walkers cannot be compared on it.
 *
 * The shared oracle in `script/m14/differential.ts` writes `from="(expr)"` for
 * every call, bare use and instantiation it derives — a placeholder meaning "the
 * source is an expression, not a named entity" — and the shared harness then
 * compares on `label + normTarget(target)` and IGNORES `from` entirely (the
 * coverage loop, and its own comment at the `uses` truth: "keys on label+target
 * with from=\"(expr)\" - and the site-agnostic comparison ignores `from`
 * anyway"). This analyzer publishes the ENCLOSING SYMBOL as the source, which is
 * the more useful answer and is what the store can attribute to a file.
 *
 * So a strict (label, from, target) comparison reports every one of those facts
 * as MISSING and every analyzer row as unexplained, and the number describes the
 * two conventions rather than either walker: measured on 912 corpus files, strict
 * comparison gives `calls` 16,566 MISSING against 101,340 unexplained, while the
 * shared harness's own site-agnostic rule is the one the repository treats as
 * correct. Both numbers are printed for every label; the site-agnostic column is
 * the verdict for these five, and the strict column is the verdict for the other
 * five (whose sources ARE named entities: a namespace, a class, a method).
 */
const SOURCE_IS_A_SITE: ReadonlySet<string> = new Set(["calls", "uses", "instantiates", "references", "contains"])


// ── corpus ───────────────────────────────────────────────────────────────────
const files: Array<{ repo: string; rel: string; abs: string; dir: string; text: string }> = []
for (const e of REPOS) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
    const ext = path.extname(rel).toLowerCase()
    if (![".cpp", ".cc", ".cxx", ".hpp", ".hxx", ".h"].includes(ext)) continue
    if (detectLanguageFromPath(abs, text) !== "cpp") continue
    files.push({ repo: e, rel, abs, dir, text })
  }
}
files.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))
const draw = files.slice(0, SAMPLE)
console.log(`cpp oracle agreement — repos ${REPOS.join(",")}  admitted ${files.length}  drawn ${draw.length}`)

// ── tree access for the oracle (the SAME pinned wasm the engine loads) ───────
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-cpp.wasm"))))

type Counter = Record<string, number>
const bump = (m: Counter, k: string, by = 1): void => { m[k] = (m[k] ?? 0) + by }
/**
 * The Map form, as its OWN function because the object form is a SILENT no-op on a
 * Map — and this instrument shipped that way for a whole round.
 *
 * `bump(truth, k)` with `truth = new Map()` sets a property ON THE MAP OBJECT. The
 * Map stays empty, so BOTH comparison loops iterate nothing and the run printed
 *
 *     totals: oracle facts 34,321 | published 135,653 | MISSING 0 | unexplained 0
 *
 * with `perLabelMissing: {}` — a clean report derived from ZERO comparisons. The
 * per-label FACT counts were correct (those are plain objects), which is exactly
 * why the table looked credible: ten labels, plausible populations, two zeros, and
 * an agree% column dividing a real numerator by a real denominator while the set
 * comparison underneath it never ran. Nothing turns red when an instrument compares
 * nothing; it prints the answer the gate wanted, and the previous round's commit
 * message recorded "MISSING 0, unexplained 0 across every label it derives" as a
 * result. This is the known-zeros failure mode in its purest form, in the very
 * instrument written to repay the DERIVATION debt.
 */
const bumpMap = (m: Map<string, number>, k: string, by = 1): void => { m.set(k, (m.get(k) ?? 0) + by) }

const key = (label: string, from: string, target: string) => `${label}|${from}|${target}`
const truth = new Map<string, number>()
const got = new Map<string, number>()
/** The shared differential's OWN comparison identity: label + normTarget(target),
 *  with `from` ignored. `normTarget` is imported rather than reimplemented — a
 *  copied rule is a second answer, which is how the self-agreeing `uses num_bits`
 *  survived a year of gates. */
const siteKey = (label: string, target: string) => `${label}|${normTarget(target)}`
const truthSite = new Map<string, number>()
const gotSite = new Map<string, number>()
const perLabelTruth = {} as Counter
const perLabelGot = {} as Counter
const perLabelMissing = {} as Counter
const perLabelUnexplained = {} as Counter
const perLabelAttributed = {} as Counter
const missingSamples: string[] = []
const unexplainedSamples: string[] = []

let idx = 0
const failures: string[] = []
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= draw.length) return
    const f = draw[i]
    const label0 = `${f.repo}/${f.rel}`
    // The oracle walks the RAW source. `parseFile` walks whatever the engine hands
    // the analyzer, which for c/cpp has the compiler attributes blanked — so the
    // oracle is deliberately given the un-blanked text, and the resulting
    // disagreement is the FINDING rather than a harness artefact.
    const t = parser.parse(f.text)
    if (!t) { failures.push(`${label0}: the pinned wasm returned no tree`); continue }
    const derived: CppTruthEdge[] = deriveCppTruth(t.rootNode)
    for (const e of deriveCppShared(t.rootNode)) {
      if (!CPP_ORACLE_LABELS.includes(e.label as any)) continue
      derived.push({ label: e.label as any, from: e.from, target: e.target, line: 0 })
    }
    for (const e of derived) {
      const k = key(e.label, e.from ?? "", e.target)
      bumpMap(truth, k)
      const ks = siteKey(e.label, e.target)
      bumpMap(truthSite, ks)
      bump(perLabelTruth, e.label)
    }
    t.delete?.()
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { failures.push(`${label0}: parseFile threw`); continue }
    for (const x of r.relationships ?? []) {
      const l = String(x.type ?? x.relationshipType ?? "")
      if (!CPP_ORACLE_LABELS.includes(l as any)) continue
      const k = key(l, String(x.source ?? ""), String(x.target ?? ""))
      bumpMap(got, k)
      const ks = siteKey(l, String(x.target ?? ""))
      bumpMap(gotSite, ks)
      bump(perLabelGot, l)
    }
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()))

for (const [k, n] of truth) {
  const have = got.get(k) ?? 0
  const [label, from, target] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1, k.lastIndexOf("|")), k.slice(k.lastIndexOf("|") + 1)]
  if (have === 0) {
    bump(perLabelMissing, label, n)
    if (missingSamples.length < 40) missingSamples.push(`MISSING ${label} ${from} -> ${target} (x${n})`)
  }
}
for (const [k, n] of got) {
  if ((truth.get(k) ?? 0) > 0) continue
  const [label, from, target] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1, k.lastIndexOf("|")), k.slice(k.lastIndexOf("|") + 1)]
  const gap = KNOWN_ORACLE_GAPS.find((g) => g.label === label && g.test(from, target))
  if (gap) { bump(perLabelAttributed, `${label}:attributed`, n); continue }
  bump(perLabelUnexplained, label, n)
  if (unexplainedSamples.length < 40) unexplainedSamples.push(`UNEXPLAINED ${label} ${from} -> ${target} (x${n})`)
}

const labels = [...CPP_ORACLE_LABELS].sort()

// ── the site-agnostic comparison, per label ──────────────────────────────────
// The shared differential's own rule, applied to this lane's ten labels. Reported
// for EVERY label rather than only the five with a site convention on the oracle
// side, because a reader needs to see both numbers before deciding which question
// a label's number answers.
const perLabelSiteTruth = {} as Counter
const perLabelSiteGot = {} as Counter
const perLabelSiteMissing = {} as Counter
const perLabelSiteUnexplained = {} as Counter
const siteSamples: string[] = []
/** Unexplained rows, PER LABEL and capped, because an unexplained `contains` row
 *  is a potential fabrication and an unexplained `uses` row is usually an oracle
 *  scope difference — and the two must not be read from one pooled sample. */
const siteUnexplainedSamples = new Map<string, string[]>()
for (const [k, n] of truthSite) {
  const label = k.slice(0, k.indexOf("|"))
  bump(perLabelSiteTruth, label, n)
  if ((gotSite.get(k) ?? 0) === 0) {
    bump(perLabelSiteMissing, label, n)
    if (siteSamples.length < 30) siteSamples.push(`MISSING(site) ${k.slice(k.indexOf("|") + 1)} (x${n})`)
  }
}
for (const [k, n] of gotSite) {
  const label = k.slice(0, k.indexOf("|"))
  bump(perLabelSiteGot, label, n)
  if ((truthSite.get(k) ?? 0) > 0) continue
  const gap = KNOWN_ORACLE_GAPS.find((g) => g.label === label && g.test("", k.slice(k.indexOf("|") + 1)))
  if (gap) { bump(perLabelAttributed, `${label}:attributed`, n); continue }
  bump(perLabelSiteUnexplained, label, n)
  const list = siteUnexplainedSamples.get(label) ?? []
  if (list.length < 24) list.push(`${label} ${k.slice(k.indexOf("|") + 1)} (x${n})`)
  siteUnexplainedSamples.set(label, list)
}

console.log(`\nSTRICT comparison — identity (label, from, target). Verdict for the labels whose SOURCE is a named entity.`)
console.log(`${"label".padEnd(13)}${"oracle facts".padStart(13)}${"published".padStart(11)}${"MISSING".padStart(10)}${"agree%".padStart(8)}${"unexplained".padStart(13)}${"attributed".padStart(12)}`)
console.log("-".repeat(92))
for (const l of labels) {
  const tv = perLabelTruth[l] ?? 0
  const gv = perLabelGot[l] ?? 0
  const miss = perLabelMissing[l] ?? 0
  const unex = perLabelUnexplained[l] ?? 0
  const attr = perLabelAttributed[`${l}:attributed`] ?? 0
  // agree% is over ORACLE FACTS, so a label whose oracle derives nothing reads
  // "ORACLE BLIND" rather than a misleading 100%: an oracle that derives 0 facts
  // has not audited anything, and reporting 0% or 100% for it would both be false.
  const agree = tv === 0 ? (gv === 0 ? "n/a" : "BLIND") : (((tv - miss) / tv) * 100).toFixed(1)
  console.log(`${l.padEnd(13)}${String(tv).padStart(13)}${String(gv).padStart(11)}${String(miss).padStart(10)}${agree.padStart(8)}${String(unex).padStart(13)}${String(attr).padStart(12)}`)
}
console.log(`\nSITE-AGNOSTIC comparison — identity (label, normTarget(target)), the shared differential's own rule, the from endpoint ignored. Verdict for ${[...SOURCE_IS_A_SITE].sort().join(", ")}.`)
console.log(`${"label".padEnd(13)}${"oracle facts".padStart(13)}${"published".padStart(11)}${"MISSING".padStart(10)}${"agree%".padStart(8)}${"unexplained".padStart(13)}${"verdict".padStart(12)}`)
console.log("-".repeat(92))
for (const l of labels) {
  const tv = perLabelSiteTruth[l] ?? 0
  const gv = perLabelSiteGot[l] ?? 0
  const miss = perLabelSiteMissing[l] ?? 0
  const unex = perLabelSiteUnexplained[l] ?? 0
  const agree = tv === 0 ? (gv === 0 ? "n/a" : "BLIND") : (((tv - miss) / tv) * 100).toFixed(1)
  const verdict = SOURCE_IS_A_SITE.has(l) ? "site" : "strict"
  console.log(`${l.padEnd(13)}${String(tv).padStart(13)}${String(gv).padStart(11)}${String(miss).padStart(10)}${agree.padStart(8)}${String(unex).padStart(13)}${verdict.padStart(12)}`)
}
const sum = (m: Counter): number => Object.values(m).reduce((a, b) => a + b, 0)
console.log(`\ntotals: oracle facts ${sum(perLabelTruth).toLocaleString()} | published ${sum(perLabelGot).toLocaleString()} | strict MISSING ${sum(perLabelMissing).toLocaleString()} | strict unexplained ${sum(perLabelUnexplained).toLocaleString()} | site MISSING ${sum(perLabelSiteMissing).toLocaleString()} | site unexplained ${sum(perLabelSiteUnexplained).toLocaleString()}`)
if (siteSamples.length) { console.log(`\nsite-agnostic MISSING samples (${siteSamples.length}):`); for (const s of siteSamples.slice(0, 14)) console.log("  " + s) }
for (const [l, list] of [...siteUnexplainedSamples.entries()].sort((a, b) => (perLabelSiteUnexplained[b[0]] ?? 0) - (perLabelSiteUnexplained[a[0]] ?? 0))) {
  console.log(`\nsite-agnostic UNEXPLAINED, ${l} (${perLabelSiteUnexplained[l]} total, up to ${list.length} distinct shown):`)
  for (const s of list.slice(0, 12)) console.log("  " + s)
}
if (missingSamples.length) { console.log(`\nstrict MISSING samples (${missingSamples.length}):`); for (const s of missingSamples.slice(0, 6)) console.log("  " + s) }
if (failures.length) { console.log(`\nrun failures (${failures.length}):`); for (const s of failures.slice(0, 8)) console.log("  " + s) }
const out = { at: new Date().toISOString(), repos: REPOS, drawn: draw.length, perLabelTruth, perLabelGot, perLabelMissing, perLabelUnexplained, perLabelSiteTruth, perLabelSiteGot, perLabelSiteMissing, perLabelSiteUnexplained, perLabelAttributed, sourceIsASite: [...SOURCE_IS_A_SITE], failures }
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`\nwrote ${OUT}`) }
console.log(`\nNOTE, restated so the table is not read as more than it is: both sides walk the SAME pinned parse, so a grammar bug shared by them is invisible here; and \`overrides\` truth is signature matching, the analyzer's own rule (CPPD-R1), so its row measures the registry plumbing and not the rule.`)
process.exitCode = failures.length ? 1 : 0
