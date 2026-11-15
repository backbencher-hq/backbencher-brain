// CLJ-DEEP · GATE M60 — LINE-NUMBER COMPLETENESS, across EVERY relationship class.
//
// WHAT THIS IS. M60's contract is that a relationship carries the LINE it happened
// on: the name-bearing node's 1-based line, never 0, absent only when it cannot be
// derived. A relationship without a line is an edge a reader cannot follow to its
// source, which makes it an assertion rather than a citation — and an assertion
// is exactly what a graph is supposed to replace.
//
// WHY A SEPARATE GATE. Every other clojure gate answers "is this relationship
// THERE". None of them asks "can a reader GO THERE". A class-by-class coverage
// claim is satisfied by an edge with `line_number: 0`, so the completeness numbers
// and the usefulness of the graph are independent, and only one of them was
// being measured. This one measures the other, per class, so a class cannot look
// complete by publishing edges nobody can locate.
//
// WHAT IT DECIDES. An UNLINED edge is a real defect and fails the gate. A missing
// line is only acceptable where the store's own contract says it is, and that is
// decided per class from the analyzer's emission sites rather than from a
// tolerance: an edge whose source is a whole NAMESPACE (a top-level
// `references`, say) has no single line that means anything, and the analyzer
// does not claim one.
//
//   --repos=clojure,clj-kondo,core.async   scope
//   --out=<path>                           JSON artifact
//   --strict-top                           also enforce the top-level classes
//
// AST only. No regex. Read-only.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"
import { ASTEngine } from "../../../src/ast/engine.ts"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
// BOTH FORMS, AND LOUD ON NEITHER BEING MISSING.
//
// `--repos=metabase` used to be silently ignored: this matched `--repos` as a
// standalone token, found nothing, and fell back to the default corpus - so
// `--repos=metabase` and no flag at all produced IDENTICAL output. A scope flag that
// quietly measures something else is worse than one that is missing, because the
// output looks like an answer to the question that was asked. It is the same shape as
// the corpus-truncation false green and the `label:` key collision: a default taken
// silently on a flag the caller believed they had set.
const argOf = (f: string): string | undefined => {
  const eq = process.argv.find((a) => a.startsWith(`${f}=`))
  if (eq !== undefined) return eq.slice(f.length + 1)
  const i = process.argv.indexOf(f)
  if (i >= 0) return process.argv[i + 1]
  return undefined
}
// AN UNKNOWN FLAG IS A TYPO, NOT A DEFAULT — in BOTH spellings. My first version of
// this check only looked at `--flag=value`, so `--repo metabase` (the space form, and
// the likelier typo of `--repos`) sailed straight through and measured the default
// corpus, which is the exact failure the check exists to prevent. An allowlist is the
// only version of this that is complete: checking for "an unrecognised =" token finds
// typos in one spelling and misses the other.
const KNOWN_FLAGS = new Set(["--repos", "--out"])
const unknownFlags = process.argv.filter((a, i) => {
  if (!a.startsWith("--")) return false
  if (a.includes("=")) return !KNOWN_FLAGS.has(a.slice(0, a.indexOf("=")))
  // space form: the NEXT argv is this flag's value, so the flag itself is unknown
  // unless it is claimed - and `indexOf` would have claimed `--repo`'s value wrongly.
  return !KNOWN_FLAGS.has(a)
})
if (unknownFlags.length > 0) {
  console.error(`UNKNOWN FLAG: ${unknownFlags.join(" ")} — refusing to run with a default corpus.`)
  console.error(`  Known flags: ${[...KNOWN_FLAGS].join(", ")}. Each accepts \`--flag value\` and \`--flag=value\`.`)
  console.error("  A typo'd scope flag silently measures the default corpus and prints a")
  console.error("  number that looks like an answer to the question that was asked.")
  process.exit(2)
}

function listFiles(repo: string): string[] {
  const dir = path.join(CORPUS_ROOT, repo)
  if (!existsSync(dir)) return []
  let tracked: string[] = []
  try { tracked = execSync(`git -C ${JSON.stringify(dir)} ls-files`, { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean) } catch { tracked = [] }
  if (tracked.length === 0) {
    const walk = (d: string, acc: string[] = []): string[] => {
      for (const e of readdirSync(d)) {
        if (e === ".git" || e === "target" || e === "node_modules") continue
        const p = path.join(d, e); const st = statSync(p)
        if (st.isDirectory()) walk(p, acc); else if (/\.(clj|cljc|cljs)$/i.test(e)) acc.push(p)
      }
      return acc
    }
    return walk(dir).sort()
  }
  return tracked.filter(f => /\.(clj|cljc|cljs)$/i.test(f)).map(f => path.join(dir, f)).sort()
}

type Row = { total: number; lined: number; unlined: number; linesAtZero: number; samples: string[] }

async function main() {
  const repos = (argOf("--repos") ?? "clojure,clj-kondo,core.async").split(",")
  const outPath = argOf("--out") ?? "/tmp/opencode/clj-m60-lines.json"
  const engine: any = await import(path.join(ROOT, "src/ast/engine.ts"))
  const parser = await engine.ASTEngine.getParser("clojure")
  const mod: any = await import(path.join(ROOT, "src/ast/real-clojure-analyzer.ts"))
  const analyzer = new mod.RealClojureAnalyzer()

  const rows: Record<string, Row> = {}
  const row = (l: string): Row => (rows[l] ??= { total: 0, lined: 0, unlined: 0, linesAtZero: 0, samples: [] })
  let files = 0, threw = 0, symbols = 0, unlinedSymbols = 0
  const symSamples: string[] = []
  // NO CLASS IS EXEMPT. I opened this gate expecting a namespace-level class —
  // a top-level `references` names a whole dependency, and no line is more true
  // than any other. The measurement says otherwise: all 6,183 `references` edges
  // carry a line, because the analyzer emits one at the LIBSPEC SPEC's position,
  // which is a real, checkable place. A gate that exempts a class on a theory
  // about it is a gate that stops looking, so the exemption is deleted and
  // `references` is enforced like the rest. The set stays, empty, because a
  // future class that genuinely cannot carry a line should be added here WITH the
  // measurement that justifies it — not with the reasoning that it sounds right.
  const TOP_LEVEL_CLASSES = new Set<string>()

  for (const repo of repos) {
    for (const file of listFiles(repo)) {
      let content: string
      try { content = readFileSync(file, "utf8") } catch { continue }
      if (content.length > 1_500_000) continue
      let root: any
      try { root = parser.parse(content).rootNode } catch { continue }
      files++
      let res: any
      try { res = analyzer.analyze(root, content, file) } catch { threw++; continue }
      const rel = path.relative(CORPUS_ROOT, file)
      for (const s of (res.symbols ?? []) as any[]) {
        symbols++
        const ln = s.range?.startLine
        if (typeof ln !== "number" || ln <= 0) {
          unlinedSymbols++
          if (symSamples.length < 10) symSamples.push(`${rel} symbol ${s.name} kind=${s.kind} range=${JSON.stringify(s.range)}`)
        }
      }
      for (const r of (res.relationships ?? []) as any[]) {
        const label = String(r.type)
        const rr = row(label)
        rr.total++
        const ln = r.line_number
        if (typeof ln === "number" && ln > 0) rr.lined++
        else if (ln === 0) rr.linesAtZero++
        else {
          rr.unlined++
          if (rr.samples.length < 8) rr.samples.push(`${rel} ${label} ${r.source} -> ${r.target} line_number=${JSON.stringify(ln)}`)
        }
      }
    }
  }

  const enforcedBad: string[] = []
  const summary: Record<string, any> = {}
  for (const [label, rr] of Object.entries(rows).sort((a, b) => b[1].total - a[1].total)) {
    const pct = rr.total ? +(100 * rr.lined / rr.total).toFixed(3) : 100
    const isTop = TOP_LEVEL_CLASSES.has(label)
    // An unlined edge in a namespace-level class is a documented convention, not
    // a defect. Everywhere else it is one, and it fails.
    const actionable = isTop ? rr.linesAtZero : rr.unlined + rr.linesAtZero
    summary[label] = {
      total: rr.total, lined: rr.lined, unlined: rr.unlined, linesAtZero: rr.linesAtZero,
      linedPct: pct, class: isTop ? "namespace-level" : "site-level",
      samples: rr.samples,
    }
    if (actionable > 0) enforcedBad.push(label)
  }
  writeFileSync(outPath, JSON.stringify({ repos, files, threw, symbols, unlinedSymbols, symSamples, labels: summary }, null, 1))

  console.log(`files=${files} threw=${threw} symbols=${symbols} (unlined ${unlinedSymbols})`)
  console.log("")
  console.log("label".padEnd(14) + "total".padStart(9) + "lined".padStart(9) + "lined%".padStart(9) + "  unlined  at-0   kind")
  for (const [label, s] of Object.entries(summary)) {
    console.log(label.padEnd(14) + String(s.total).padStart(9) + String(s.lined).padStart(9) + String(s.linedPct).padStart(8) + "%" +
      String(s.unlined).padStart(9) + String(s.linesAtZero).padStart(7) + "   " + s.class)
  }
  if (symSamples.length) { console.log(""); console.log("  unlined SYMBOLS:"); for (const s of symSamples) console.log(`    ${s}`) }
  for (const [label, s] of Object.entries(summary)) {
    if (s.samples.length) { console.log(""); console.log(`  unlined edges in ${label}:`); for (const s2 of s.samples) console.log(`    ${s2}`) }
  }
  const pass = enforcedBad.length === 0 && unlinedSymbols === 0
  console.log(`\n  clojure-m60  ${pass ? "PASS" : "FAIL"}${enforcedBad.length ? `  (unlined edges in: ${enforcedBad.join(", ")})` : ""}`)
  process.exitCode = pass ? 0 : 1
  console.log(`\nwritten ${outPath}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
