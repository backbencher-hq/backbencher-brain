#!/usr/bin/env bun
/**
 * THE 525-ROW PROJECT-KEY-SPACE GAP — THE MECHANISM, LOCATED BY MEASUREMENT.
 *
 * WHY THIS INSTRUMENT EXISTS. The lane's cause census sizes and labels a residual it calls
 * `project-key-space-gap`: rows the ARBITER answered `unresolved` while the lane's own key space
 * says the edge's PROJECT declares the target. The cause ruling DISPOSITIONS the residual — it is
 * counted, it is labelled, it is not argued away — but "the two instruments disagree" is a SYMPTOM,
 * not a mechanism. This instrument NAMES it: it reports an observable SIGNATURE for every row in
 * the disagreement set, and the classes it prints are counts that partition the set exactly.
 *
 * ITS SIBLING, AND WHY BOTH EXIST. `csharp-parse-path-parity.ts` measures WHICH of the two parse
 * entry points the two instruments use, and what that difference costs. This instrument measures
 * WHICH ROWS the difference lands on and WHAT CONSTRUCT EACH ROW NAMES. Neither substitutes for the
 * other: the parity instrument says the paths differ, this one says what the difference is made of.
 *
 * STREAMING, DELIBERATELY. The dump is ~134 MB and ~707,000 rows; holding it as one string and every
 * row as an object costs far more than the answer is worth, on a machine that is shared. The dump is
 * read ONE LINE AT A TIME and a row is retained only when it belongs to the disagreement set, which
 * is a few hundred rows. THE KEY SPACE IS STILL HELD WHOLE, because the join needs it whole; it is
 * the smaller input and it is the one the join is about.
 *
 * WHAT IT DOES NOT DO. It does not edit the arbiter, and it does not re-run the arm: the dump and
 * the key space are already on disk, so this work needs NO arm token and NO small slot. It does not
 * declare a mechanism it cannot count.
 */
import { createReadStream, readFileSync } from "node:fs"
import { createInterface } from "node:readline"
import * as path from "node:path"

const argv = process.argv.slice(2)
const keyspaceIdx = argv.indexOf("--keyspace")
const keyspaceArg = keyspaceIdx >= 0 ? argv[keyspaceIdx + 1] : undefined
const dumpArg = argv.find((a, i) => !a.startsWith("--") && i !== keyspaceIdx + 1)
const jsonOut = argv.includes("--json")
if (!dumpArg || !keyspaceArg) {
  console.error("usage: csharp-keyspace-gap.ts <dump> --keyspace <keyspace.jsonl> [--json]")
  process.exit(2)
}
const CORPUS = process.env.BB_CORPUS_ROOT ?? path.resolve(".corpus")
const OUT = process.env.CSHARP_GAP_OUT ?? "validation/m14/measurements/csharp-keyspace-gap.json"

/** The analyzer's own keyword set (src/ast/real-csharp-analyzer.ts:370) — the same set the analyzer
 *  uses at :2240 to refuse to fabricate a call to a keyword. The mechanism is decided by the
 *  ANALYZER'S OWN list, not by this instrument's opinion of what a keyword is. */
const CSHARP_KEYWORDS = new Set([
  "if", "for", "foreach", "while", "do", "switch", "case", "else", "return", "throw", "using",
  "new", "delegate", "in", "is", "as", "sizeof", "fixed", "lock", "checked", "unchecked", "params",
  "ref", "out", "base", "this", "get", "set", "nameof",
])

/** A PROJECT-RELATIVE spelling, so the artifact's rows mean the same thing on any machine. */
const rel = (p: string): string => {
  const r = path.relative(CORPUS, p)
  return r.startsWith("..") ? p : r
}

// ── THE KEY SPACE: name -> the (repo, file, kinds) that declare it ───────────
type Decl = { repo: string; file: string; kinds: Set<string>; count: number }
const decls = new Map<string, Decl[]>()
let keyspaceFiles = 0
let keyspaceEntries = 0
{
  const seen = new Set<string>()
  for (const line of readFileSync(keyspaceArg, "utf8").split("\n")) {
    if (!line.trim()) continue
    let r: Record<string, unknown>
    try { r = JSON.parse(line) as Record<string, unknown> } catch { continue }
    const name = String(r.n ?? "")
    if (!name) continue
    const repo = String(r.r ?? "")
    const abs = path.join(CORPUS, String(r.f ?? ""))
    seen.add(abs)
    keyspaceEntries++
    const kinds = String(r.k ?? "").split("|").filter(Boolean)
    let list = decls.get(name)
    if (!list) { list = []; decls.set(name, list) }
    const hit = list.find((d) => d.file === abs)
    if (hit) { for (const k of kinds) hit.kinds.add(k); hit.count++ }
    else list.push({ repo, file: abs, kinds: new Set(kinds), count: 1 })
  }
  keyspaceFiles = seen.size
}

/** THE PROJECT SCOPE: the file's own repository — the gate's own rule (incoming-gate.ts:75,
 *  "TABLE 1 per project - the file's own repository. Production's scope, and the verdict's."). */
const repoOf = (p: string): string => {
  const r = path.relative(CORPUS, p)
  const i = r.indexOf(path.sep)
  return i > 0 ? r.slice(0, i) : r
}

type Shape = { generic: boolean; nullable: boolean; array: boolean; qualified: boolean; global: boolean; dotted: boolean }
const shapeOf = (t: string): Shape => ({
  generic: /[<>]/.test(t), nullable: t.endsWith("?"), array: t.endsWith("[]"),
  global: t.startsWith("global::"), qualified: t.includes("::"), dotted: t.includes("."),
})
const shapeName = (s: Shape): string =>
  [s.generic && "generic", s.nullable && "nullable", s.array && "array", s.global && "global::", s.qualified && "qualified", s.dotted && "dotted"]
    .filter(Boolean).join("+") || "plain"

/** The normalisations a resolver WOULD have to apply. A normaliser that does not CHANGE the string
 *  proves nothing, so it is not allowed to fire. */
const NORMALISERS: { id: string; fn: (t: string) => string[] }[] = [
  { id: "strip-global", fn: (t) => [t.replace(/^global::/, "")] },
  { id: "strip-generic", fn: (t) => [t.replace(/<[^<>]*>/g, "")] },
  { id: "strip-nullable", fn: (t) => [t.replace(/\?$/, "")] },
  { id: "strip-array", fn: (t) => [t.replace(/\[\]$/, "")] },
  { id: "strip-namespace", fn: (t) => { const i = t.lastIndexOf("."); return i > 0 ? [t.slice(i + 1), t.slice(0, i)] : [] } },
  { id: "strip-qualified", fn: (t) => { const i = t.lastIndexOf("::"); return i >= 0 ? [t.slice(i + 2)] : [] } },
]

type Gap = {
  label: string; target: string; file: string; line: number
  edgeRepo: string; mechanisms: string[]; evidence: string
  kinds: string; inProjectFiles: number; elsewhereFiles: number
}
const gaps: Gap[] = []
let dumpRows = 0
let unresolvedRows = 0

// ── ONE STREAMING PASS OVER THE DUMP ────────────────────────────────────────
// A row is retained ONLY when it is in the disagreement set, so memory is proportional to the
// ANSWER, not to the dump.
{
  const rl = createInterface({ input: createReadStream(dumpArg, { encoding: "utf8" }), crlfDelay: Infinity })
  for await (const raw of rl) {
    if (!raw.startsWith("DUMP\t")) continue
    const p = raw.split("\t")
    if (p.length < 6) continue
    dumpRows++
    if (p[2] !== "unresolved") continue
    unresolvedRows++
    const target = p[3]
    const list = decls.get(target)
    if (!list || list.length === 0) continue
    const loc = p[4]
    const colon = loc.lastIndexOf(":")
    const file = colon > 0 ? loc.slice(0, colon) : loc
    const line = colon > 0 ? Number(loc.slice(colon + 1)) || 0 : 0
    const edgeRepo = repoOf(file)
    const inProject = list.filter((d) => d.repo === edgeRepo)
    if (inProject.length === 0) continue
    const kinds = new Set<string>()
    for (const d of inProject) for (const k of d.kinds) kinds.add(k)
    const kindList = [...kinds].sort().join("+") || "(none)"
    const mechanisms: string[] = []
    const why: string[] = []
    // (0) THE TARGET IS A C# KEYWORD — an edge to a construct that is not a declaration at all.
    if (CSHARP_KEYWORDS.has(target)) {
      mechanisms.push("target-is-a-csharp-keyword")
      why.push(`the target "${target}" is a C# keyword in the analyzer's own keyword set (src/ast/real-csharp-analyzer.ts:370); no declaration can answer it`)
    }
    // (1) THE NAME FORM: a normaliser that CHANGES the target into a name the project declares.
    if (mechanisms.length === 0) {
      for (const n of NORMALISERS) {
        let hit = ""
        for (const c of n.fn(target)) {
          if (c === target) continue
          if (decls.has(c) && decls.get(c)!.some((d) => d.repo === edgeRepo)) { hit = c; break }
        }
        if (hit) { mechanisms.push(`name-form:${n.id}`); why.push(`the target's ${n.id} yields "${hit}", which the project declares`); break }
      }
    }
    // (2) THE KIND: declared, but only by kinds that are not declarations.
    if (mechanisms.length === 0) {
      const NON_DECL = new Set(["variable", "parameter", "local", "field", "property", "event", "constant", "label"])
      if (kinds.size > 0 && [...kinds].every((k) => NON_DECL.has(k))) {
        mechanisms.push("kind-not-a-declaration"); why.push(`declared only as ${kindList}`)
      }
    }
    // (3) THE SCOPE: a declaring file outside the edge's repository root.
    if (mechanisms.length === 0) {
      const offRoot = inProject.filter((d) => !d.file.startsWith(path.join(CORPUS, edgeRepo) + path.sep))
      if (offRoot.length > 0) { mechanisms.push("declaring-file-off-the-project-root"); why.push(`${offRoot.length} of ${inProject.length} declaring files are not under the edge's repository root`) }
    }
    if (mechanisms.length === 0) { mechanisms.push("unexplained"); why.push("no mechanism this instrument can count") }
    gaps.push({
      label: p[1], target, file: rel(file), line, edgeRepo, mechanisms,
      evidence: why.join("; "), kinds: kindList,
      inProjectFiles: inProject.length, elsewhereFiles: list.length - inProject.length,
    })
  }
}

// ── THE SIGNATURE CENSUS ─────────────────────────────────────────────────────
const byMechanism = new Map<string, number>()
const byLabel = new Map<string, number>()
const bySignature = new Map<string, { count: number; example: Gap }>()
for (const g of gaps) {
  const m = g.mechanisms[0] as string
  byMechanism.set(m, (byMechanism.get(m) ?? 0) + 1)
  byLabel.set(g.label, (byLabel.get(g.label) ?? 0) + 1)
  const sig = `${m}|${g.kinds}|${shapeName(shapeOf(g.target))}|files=${g.inProjectFiles}|elsewhere=${g.elsewhereFiles}`
  const hit = bySignature.get(sig)
  if (hit) hit.count++
  else bySignature.set(sig, { count: 1, example: g })
}
const total = gaps.length
const mechSum = [...byMechanism.values()].reduce((a, b) => a + b, 0)

console.log(`CSHARP - THE PROJECT-KEY-SPACE GAP, THE MECHANISM`)
console.log(`  dump rows STREAMED: ${dumpRows} · unresolved rows: ${unresolvedRows} · key space: ${keyspaceEntries} entries over ${keyspaceFiles} files`)
console.log(`  THE DISAGREEMENT SET: ${total} rows (the arbiter said unresolved; the key space says the edge's PROJECT declares the exact name)`)
console.log(`  the classes partition the set exactly: ${mechSum === total} (${mechSum} = ${total})`)
console.log(`  by label: ${JSON.stringify(Object.fromEntries([...byLabel].sort()))}`)
console.log(`  BY MECHANISM:`)
for (const [m, c] of [...byMechanism].sort((a, b) => b[1] - a[1])) console.log(`    ${m.padEnd(40)} ${c}`)
console.log(`  BY SIGNATURE:`)
for (const [sig, v] of [...bySignature].sort((a, b) => b[1].count - a[1].count).slice(0, 8)) {
  console.log(`    ${String(v.count).padStart(4)}  ${sig}`)
  console.log(`          e.g. ${v.example.label} "${v.example.target}"  <- ${v.example.file}:${v.example.line}`)
}
if (jsonOut) {
  const out = {
    lane: "csharp",
    instrument: "script/m14/csharp-keyspace-gap.ts",
    question: "the mechanism behind the 525-row project-key-space gap: the arbiter answered unresolved while the lane's key space says the edge's PROJECT declares the target",
    method: "ONE STREAMING PASS over the arm's dump; a row is retained only when it is in the disagreement set, so memory is proportional to the answer and not to the dump",
    population: { dumpRows, unresolvedRows, keyspaceEntries, keyspaceFiles },
    disagreementRows: total,
    classesPartitionExactly: mechSum === total,
    byMechanism: Object.fromEntries(byMechanism),
    byLabel: Object.fromEntries(byLabel),
    bySignature: [...bySignature].sort((a, b) => b[1].count - a[1].count).map(([signature, v]) => ({
      signature, count: v.count,
      example: { label: v.example.label, target: v.example.target, file: v.example.file, line: v.example.line, evidence: v.example.evidence },
    })),
    examples: gaps.slice(0, 40),
    siblingInstrument: {
      path: "script/m14/csharp-parse-path-parity.ts",
      why: "this instrument says WHAT the disagreement is made of; the parity instrument says WHICH parse entry points produced it, and what the difference costs over a declared sample",
    },
  }
  await Bun.write(OUT, JSON.stringify(out, null, 2) + "\n")
  console.log(`  written: ${OUT}`)
}
