/**
 * BASH AMBIGUITY — one edge, how many declarations?
 *
 * ## The question
 *
 * The incoming-edge instruction is explicit that this is the lane's problem and
 * not the traversal code's:
 *
 *   "A TARGET THAT RESOLVES TO MORE THAN ONE PUBLISHED SYMBOL. The reverse walk
 *    picks one by a rule nobody chose... An ambiguous target is ONE edge
 *    attributed to ONE declaration. Counting it as N is how a name collision
 *    becomes a wrong refactor."
 *
 * `census-bash-ontology.ts` already counts it — 19.0% of resolved `uses` targets
 * and 100% of `overrides` targets name more than one published symbol — but a
 * COUNT is not an answer. This probe asks the two questions that decide whether
 * the lane can do anything:
 *
 *   REDUCIBLE?      do the candidate declarations have DISTINCT lines, so a
 *                   consumer could pick one? (`census` printed "lines 0,0,0,0" for
 *                   every ambiguous target, which is an artifact of ITS OWN field
 *                   name — it reads `line_number ?? range.start.line` and
 *                   `parseFile` publishes `startLine`/`endLine`. So the first
 *                   thing to establish is whether the lines are actually there.)
 *   RESOLVED-BY-A-RULE?  is there a deterministic rule that picks exactly ONE —
 *                   for `uses`, "the nearest preceding assignment at or before the
 *                   use site, within the enclosing scope", which is what a shell
 *                   does at run time. If the rule picks exactly one, the
 *                   ambiguity is CLOSEABLE and the rule is the deliverable. If it
 *                   does not, the lane says so with a count.
 *
 * ## INSTRUMENT
 *
 * Production `parseFile` from `src/ast/pool-worker.ts` on the 400-file hash-order
 * census sample, so the denominators match every other number in the lane's doc.
 * A target is AMBIGUOUS when more than one published symbol in the SAME FILE has
 * that name — which is the condition `bb_impact`'s name-match actually faces.
 *
 * NO REGEX. Candidates come from `result.symbols[].name` and `.startLine`, which
 * are data; scope comes from `.ownerName`, also data.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/probe-bash-ambiguity.mts [--sample 400]
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const num = (n: string, d: number): number => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? Number(argv[i + 1]) : d
}
const SAMPLE = num("sample", 400)

interface F {
  repo: string
  rel: string
  abs: string
  dir: string
  text: string
  hash: string
}
const files: F[] = []
let scanned = 0
const repoNames = new Set<string>()
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
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
    const abs = path.join(dir, rel)
    let text: string
    try {
      // The 512 KB cap and the CONTENT-FORM detectLanguageFromPath call are both
      // census behaviour, copied deliberately: without them this probe's
      // denominator is a different population (the content form is what admits an
      // extensionless file by its shebang) and its numbers would not be
      // comparable with any other number in this lane's doc.
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    scanned++
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    repoNames.add(e)
    files.push({ repo: e, rel, abs, dir, text, hash: createHash("sha256").update(`${e}/${rel}`).digest("hex") })
  }
}
files.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
const sample = files.slice(0, SAMPLE)

console.log(`bash ambiguity probe — production parseFile, ${sample.length} files`)
console.log(`admitted ${files.length} / scanned ${scanned} / repos ${repoNames.size}\n`)

type Row = {
  total: number
  resolved: number
  ambiguous: number
  distinctLines: number
  sameLineIrreducible: number
  rulePicksOne: number
  rulePicksMany: number
  rulePicksNone: number
}
const rows = new Map<string, Row>()
const examples: string[] = []
let failures = 0

const get = (t: string): Row => {
  let r = rows.get(t)
  if (!r) {
    r = { total: 0, resolved: 0, ambiguous: 0, distinctLines: 0, sameLineIrreducible: 0, rulePicksOne: 0, rulePicksMany: 0, rulePicksNone: 0 }
    rows.set(t, r)
  }
  return r
}

for (const f of sample) {
  let p: any
  try {
    p = await parseFile(f.abs, f.dir)
  } catch {
    failures++
    continue
  }
  if (!p || p.success === false || !Array.isArray(p.symbols)) continue

  // name -> candidates. A candidate is (startLine, ownerName, kind).
  const byName = new Map<string, { line: number; owner: string; kind: string }[]>()
  for (const s of p.symbols) {
    const n = String(s?.name ?? "")
    if (!n) continue
    const list = byName.get(n) ?? []
    list.push({ line: Number(s.startLine ?? 0), owner: String(s.ownerName ?? ""), kind: String(s.kind ?? "") })
    byName.set(n, list)
  }

  for (const r of p.relationships ?? []) {
    const t = String(r.type ?? r.relationshipType ?? "")
    if (!t) continue
    const row = get(t)
    row.total++
    const tgt = String(r.target ?? r.to ?? "")
    const cands = byName.get(tgt)
    if (!cands || cands.length === 0) continue
    row.resolved++
    if (cands.length === 1) continue
    row.ambiguous++

    const lines = new Set(cands.map((c) => c.line))
    if (lines.size === cands.length) row.distinctLines++
    else {
      row.sameLineIrreducible++
      if (examples.length < 14) {
        examples.push(
          `SAME-LINE   ${f.repo}/${f.rel}: ${r.source ?? "?"} -[${t}]-> ${tgt} @${r.line_number ?? "?"}  ` +
            `${cands.length} declarations all reported at lines ${[...lines].join(",")}`,
        )
      }
    }

    // The rule: for a USE at line L, the declaration in effect is the nearest one
    // at or before L, in the same scope as the use's source. Scoped candidates
    // first (bash variables are function-scoped), then file-scoped.
    const useLine = Number(r.line_number ?? 0)
    const srcName = String(r.source ?? r.from ?? "")
    const srcOwner = String((p.symbols ?? []).find((s: any) => String(s?.name ?? "") === srcName)?.ownerName ?? "")
    const inScope = cands.filter((c) => c.owner === srcOwner)
    const pool = inScope.length > 0 ? inScope : cands
    const atOrBefore = pool.filter((c) => c.line > 0 && c.line <= useLine)
    if (atOrBefore.length === 0) {
      const after = pool.filter((c) => c.line > 0 && c.line > useLine)
      if (after.length === 1) row.rulePicksOne++
      else if (after.length > 1) row.rulePicksMany++
      else row.rulePicksNone++
    } else {
      const nearest = Math.max(...atOrBefore.map((c) => c.line))
      const winners = atOrBefore.filter((c) => c.line === nearest)
      if (winners.length === 1) row.rulePicksOne++
      else if (winners.length > 1) row.rulePicksMany++
      else row.rulePicksNone++
    }
  }
}

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`)
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)

console.log(
  `${w("type", 13)}${w("edges", 9)}${w("tgt present", 12)}${w("ambiguous", 12)}${w("distinct lines", 15)}${w("same-line (irreducible)", 24)}${w("rule picks one", 16)}${w("many", 8)}${w("none", 8)}`,
)
console.log("-".repeat(116))
for (const [t, r] of rows) {
  console.log(
    `${w(t, 13)}${w(r.total.toLocaleString(), 9)}${w(`${r.resolved} ${pct(r.resolved, r.total)}`, 12)}` +
      `${w(`${r.ambiguous} ${pct(r.ambiguous, r.resolved)}`, 12)}${w(`${r.distinctLines} ${pct(r.distinctLines, r.ambiguous)}`, 15)}` +
      `${w(`${r.sameLineIrreducible} ${pct(r.sameLineIrreducible, r.ambiguous)}`, 24)}` +
      `${w(`${r.rulePicksOne} ${pct(r.rulePicksOne, r.ambiguous)}`, 16)}${w(r.rulePicksMany, 8)}${w(r.rulePicksNone, 8)}`,
  )
}
console.log(`\nparse failures: ${failures}`)
if (examples.length) {
  console.log("\nirreducible examples (candidates share a line, so no line-based rule can separate them):")
  for (const e of examples) console.log(`  ${e}`)
}