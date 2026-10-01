import * as fs from "node:fs";
import * as path from "node:path";
import * as wts from "web-tree-sitter";

/**
 * PYTHON DIFFERENTIAL PROBE (PY-1).
 *
 * Compares `derivePythonTruth` against the analyzer over a corpus, TYPE BY TYPE, and
 * separates the buckets that mean different things. The separation is the point; an
 * aggregate over a lane with 10,353 agreeing `calls` and 1,163 fabricated `overrides`
 * is a green number that means nothing.
 *
 *   agreed      — both sides derive the edge.
 *   missing     — the TREE says this edge exists and the analyzer did not emit it. Every
 *                 one is a relationship the graph is missing.
 *   unexplained — the analyzer emitted an edge the tree does not support. Either a real
 *                 fabricated endpoint, or a policy this file has not implemented — and
 *                 which of those it is, is stated in the review rather than guessed at
 *                 from a count.
 *   guess       — the analyzer labelled the edge `reasonCode: first-parent-guess`, i.e.
 *                 it declared its own uncertainty. A guess the tree CONFIRMS is the
 *                 best bucket there is and is counted as `guess-ok`; a guess the tree
 *                 REFUTES is counted as `guess-bad`. Collapsing them (the first version
 *                 of this file did, and counted a confirmed guess as neither) is how a
 *                 98%-wrong mechanism reads as an honest one.
 *
 * Comparison is by (type, from, to) WITHOUT the line, because the store resolves a
 * non-`contains` target by name alone and the two sides legitimately disagree about
 * which line to carry. For `contains` the line IS the identity — same-named members are
 * the whole reason that type carries one into resolution — so it is compared too, and
 * that is where a getter and its setter finally separate.
 *
 * Usage: bun run script/m14/oracles/python-truth-diff.ts <file.py|dir> ...
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..")
const wdir = path.join(ROOT, "node_modules/web-tree-sitter")
await wts.Parser.init({
  locateFile: () => ["tree-sitter.wasm", "web-tree-sitter.wasm"].map((f) => path.join(wdir, f)).find((f) => fs.existsSync(f))!,
})
const parser = new wts.Parser()
parser.setLanguage(await wts.Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-python.wasm"))))
const engine: any = await import(path.join(ROOT, "src/ast/engine"))
const { derivePythonTruth } = await import(path.join(ROOT, "script/m14/oracles/python-truth"))

const TYPES = ["contains", "extends", "overrides", "calls", "instantiates", "uses", "references", "imports", "exports"] as const
const SHOW = 8

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error("usage: bun run script/m14/oracles/python-truth-diff.ts <file.py|dir> [...]")
  process.exit(2)
}
const files: string[] = []
for (const a of args) {
  const st = fs.statSync(a)
  if (st.isDirectory()) {
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith(".py")) files.push(p)
      }
    }
    walk(a)
  } else files.push(a)
}

const key = (t: string, f: string, to: string, line?: number) =>
  line === undefined ? `${t}\u0000${f}\u0000${to}` : `${t}\u0000${f}\u0000${to}\u0000${line}`

/**
 * `--dump <path>` writes EVERY disagreement as JSONL, uncapped.
 *
 * The console output shows 8 examples per type because a human reads the first few. That
 * is the right default and the wrong tool for triage: 6,048 disagreements cannot be
 * classified from 40 of them, and PY-20 already showed what happens when a count and a
 * sample are confused. Triage needs the whole population — a cluster that is 90% one
 * shape is invisible in a sample of 8 and obvious in a dump.
 *
 * Each line carries the file, type, endpoints, the line, and the SIDE (`missing` = the
 * tree says it exists and the analyzer did not emit it, `unexplained` = the analyzer
 * emitted it and the tree does not support it), so the two populations stay separable
 * even after they are in one file.
 */
/** The engine's own limit, mirrored so both sides of the comparison see identical bytes. */
const PARSE_LIMIT = 1024 * 1024
const truncatedFiles: string[] = []
let nTruncated = 0

const DUMP = process.env.BB_ORACLE_DUMP
const dumpRows: any[] = []

let n = 0
let guessOk = 0
let guessBad = 0
const agreed = new Map<string, number>()
const missing = new Map<string, string[]>()
const unexplained = new Map<string, string[]>()
const guessBadEx = new Map<string, string[]>()
const count = (m: Map<string, number>, t: string, d: number): void => m.set(t, (m.get(t) ?? 0) + d)

/**
 * COUNT AND SAMPLE ARE SEPARATE, and conflating them is how this harness first
 * misreported itself.
 *
 * `sample` used to do double duty: it capped the stored examples at `SHOW` **and** the
 * summary table printed `missing.get(t)?.length` as the disagreement count. So every
 * disagreement total was silently clamped to 8, and the full-corpus run printed a bare
 * `8` in five of five columns where the honest answer was "8 or more, possibly thousands".
 * A capped number in an uncapped-looking column is the worst of both: the per-type lists
 * said "(8+)", which is honest, and the table said `8`, which is not.
 *
 * The counts are therefore tracked exactly and only the EXAMPLES are capped. A run whose
 * real disagreement count equals `SHOW` is now visible as a coincidence instead of being
 * indistinguishable from a clamp.
 */
const missingN = new Map<string, number>()
const truthCount = new Map<string, number>()
const analyzerCount = new Map<string, number>()
const bump = (m: Map<string, number>, k: string): void => m.set(k, (m.get(k) ?? 0) + 1)
const multiN = new Map<string, number>()
const multiEx = new Map<string, string[]>()
let currentFile = "?"
const unexplainedN = new Map<string, number>()
const guessBadN = new Map<string, number>()
const sample = (m: Map<string, string[]>, t: string, s: string): void => {
  const l = m.get(t) ?? []
  if (l.length < SHOW) { l.push(s); m.set(t, l) }
}

for (const f of files) {
  currentFile = f
  // PER FILE. The multiplicity pass runs inside this loop, so the count maps must not
  // accumulate across the corpus: their keys are (type, from, to) with no file, so a
  // leftover entry from an earlier file would be compared against this file's edges and
  // report a difference that is not one. That bug made `references` look like 972,753
  // multiplicity disagreements when the real figure is per-file and per-site.
  truthCount.clear()
  analyzerCount.clear()
  const raw = fs.readFileSync(f, "utf8")

  // MIRROR THE ENGINE'S PREPROCESSING, or the two sides are not reading the same bytes.
  //
  // `ASTEngine.parseFile` truncates content at 1 MiB before parsing (PY-19), but this
  // harness fed the FULL file to both: the analyzer saw the first 1,048,576 UTF-16 units
  // and the oracle saw all 1,414,143. For every file under the limit that is invisible; for
  // `cython/tests/run/extsubscript.py` it produced **619 "missing" edges that the analyzer
  // could not have emitted**, because they live in a tail it never read — 25.5% of the whole
  // lane's missing-edge population, reported as if it were analyzer error.
  //
  // A differential that compares different inputs is not a weaker differential, it is a
  // wrong one, and the failure is invisible in aggregate because the number looks like a
  // defect rate. So the truncation is reproduced EXACTLY — same limit, same unit — and a
  // truncated file is COUNTED and named, because "we did not read this file" is a coverage
  // fact the differential has to surface rather than absorb into its own error rate.
  let content = raw
  let truncatedBytes = 0
  if (raw.length > PARSE_LIMIT) {
    truncatedBytes = raw.length - PARSE_LIMIT
    content = raw.substring(0, PARSE_LIMIT)
  }
  if (truncatedBytes > 0) { truncatedFiles.push(`${path.basename(f)} (${truncatedBytes} bytes unread)`); nTruncated++ }

  const res: any = await engine.ASTEngine.parseFile(f, content)
  if (res?.language !== "python") continue
  n++

  // The MODULE SCOPE is the filename stem NORMALISED to a legal identifier — the analyzer's
  // PY-13 rule, mirrored here because a differential that spells the module differently
  // compares two different graphs. `run-with-pty.py` is scoped `run_with_pty` by the lane,
  // so an oracle that passes the raw stem disagreed on every module-level call in the file
  // and reported it as the analyzer having missed the relationship: 146 edges across 63
  // hyphenated scripts. Deriving it independently rather than importing the analyzer's
  // helper is deliberate — two derivations that agree are evidence, one shared function is
  // not — and agreeing on the NORMALISATION is part of deriving it.
  const stem = path.basename(f).replace(/\.py$/, "")
  const moduleScope = stem.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1")
  const truth = derivePythonTruth(parser.parse(content).rootNode, moduleScope)
  const truthKeys = new Set<string>()
  for (const e of truth) {
    if (!TYPES.includes(e.type as any)) continue
    truthKeys.add(key(e.type, e.from, e.to, e.type === "contains" ? e.line : undefined))
  }

  const analyzerKeys = new Set<string>()
  const guessKeys = new Set<string>()
  for (const r of res.relationships ?? []) {
    const t = String(r.type)
    if (!TYPES.includes(t as any)) continue
    const k = key(t, String(r.source), String(r.target), t === "contains" ? r.line_number : undefined)
    if ((r.metadata as any)?.reasonCode === "first-parent-guess") guessKeys.add(k)
    else { analyzerKeys.add(k); bump(analyzerCount, k) }
  }
  for (const e of truth) {
    if (!TYPES.includes(e.type as any)) continue
    bump(truthCount, key(e.type, e.from, e.to, e.type === "contains" ? e.line : undefined))
  }

  for (const k of truthKeys) {
    const [t, from, to, line] = k.split("\u0000")
    const label = `${path.basename(f)} ${from} -> ${to}${line ? ` @L${line}` : ""}`
    if (analyzerKeys.has(k) || guessKeys.has(k)) count(agreed, t, 1)
    else { count(missingN, t, 1); sample(missing, t, label)
      if (DUMP) dumpRows.push({ side: "missing", type: t, file: path.basename(f), from, to, line: line ? Number(line) : null }) }
  }
  for (const k of guessKeys) {
    if (truthKeys.has(k)) guessOk++
    else { guessBad++; count(guessBadN, String(k).split("\u0000")[0], 1); sample(guessBadEx, String(k).split("\u0000")[0], `${path.basename(f)} ${k.split("\u0000").slice(1).join(" -> ")}`) }
  }
  // MULTIPLICITY: a key BOTH sides carry, in different numbers.
  //
  // The comparison above is set-based, so a key present twice on one side and once on the other
  // compares EQUAL. That is not a harmless simplification: a duplicated edge is the defect
  // class PY-6 belongs to — a dedup key coarser than the store's, which lost a `contains` edge
  // for a getter/setter pair — and a set comparison cannot see that whole class. It is not
  // hypothetical here either: a file with two same-named classes each overriding the same base
  // method makes the analyzer emit `overrides C.m -> Base.m` twice, at two different lines, and
  // the set collapsed both to one and reported agreement.
  //
  // So each side also accumulates a COUNT per key, and a key whose counts differ is reported
  // even when both sides have the key. A lane that emits the same edge twice for two genuinely
  // different sites is correct; one that emits it twice for one site is not, and only a count
  // distinguishes those.
  for (const [k, tc] of truthCount) {
    const ac = analyzerCount.get(k) ?? 0
    if (ac === tc) continue
    // A key present on ONE side only is already reported as missing/unexplained. Counting it
    // here as well double-reports every one of them, and the first run of this pass did
    // exactly that: 60,254 "multiplicity" disagreements, of which the loudest were the
    // self-referential `extends` the analyzer declines — 13 edges already sitting in the
    // missing column. A second axis that re-reports the first is worse than no second axis,
    // because it makes the real population unreadable.
    if (ac === 0 || tc === 0) continue
    const parts = k.split("\u0000")
    const t = parts[0]
    const from = parts[1]
    const to = parts[2]
    const line = parts[3]
    count(multiN, t, 1)
    sample(multiEx, t, `${path.basename(currentFile)} ${from} -> ${to}${line ? " @L" + line : ""}  truth=${tc} analyzer=${ac}`)
  }

  for (const k of analyzerKeys) {
    if (truthKeys.has(k)) continue
    const [t, from, to] = k.split("\u0000")
    { count(unexplainedN, t, 1); sample(unexplained, t, `${path.basename(f)} ${from} -> ${to}`)
      if (DUMP) dumpRows.push({ side: "unexplained", type: t, file: path.basename(f), from, to, line: null }) }
  }
}

const pad = (s: unknown, k: number): string => String(s).padEnd(k)
console.log(`files=${n}  types compared: ${TYPES.join(", ")}\n`)
console.log(pad("TYPE", 13) + pad("agreed", 9) + pad("missing", 9) + pad("unexplained", 13))
for (const t of TYPES) {
  console.log(pad(t, 13) + pad(agreed.get(t) ?? 0, 9) + pad(missingN.get(t) ?? 0, 9) + pad(unexplainedN.get(t) ?? 0, 13))
}
if (guessOk + guessBad > 0) {
  console.log(`\ndeclared guesses (analyzer labelled them uncertain): ${guessOk + guessBad}  confirmed by tree=${guessOk}  refuted=${guessBad}`)
}
for (const t of TYPES) {
  const m = missing.get(t)
  if (m?.length) { console.log(`\nMISSING ${t} (${missingN.get(t) ?? m.length} total, showing ${m.length}): the tree says these exist and the analyzer did not emit them:`); for (const s of m) console.log(`   ${s}`) }
  const u = unexplained.get(t)
  if (u?.length) { console.log(`\nUNEXPLAINED ${t} (${unexplainedN.get(t) ?? u.length} total, showing ${u.length}): the analyzer emitted these and the tree does not support them:`); for (const s of u) console.log(`   ${s}`) }
}
for (const [t, l] of guessBadEx) { console.log(`\nREFUTED GUESSES ${t} (${guessBadN.get(t) ?? l.length} total, showing ${l.length}):`); for (const s of l) console.log(`   ${s}`) }

const multiTotal = [...multiN.values()].reduce((a, b) => a + b, 0)
if (multiTotal > 0) {
  console.log(`\nMULTIPLICITY DISAGREEMENT (${multiTotal}): both sides carry the edge, in different numbers:`)
  for (const [t, l] of multiEx) console.log(`\n  ${t} (${multiN.get(t)} total, showing ${l.length}):`)
  for (const [t, l] of multiEx) for (const x of l) console.log(`   ${x}`)
} else {
  console.log("\nMULTIPLICITY: every edge agrees in COUNT as well as in membership")
}

if (nTruncated > 0) {
  console.log(`\nTRUNCATED INPUT (engine limit 1 MiB) — these files were compared only over the bytes the analyzer actually read:`)
  for (const f of truncatedFiles) console.log(`   ${f}`)
  console.log(`   ${nTruncated} file(s) truncated. Coverage of their unread tails is a PY-19 concern, NOT analyzer error.`)
}

if (DUMP) {
  fs.writeFileSync(DUMP, dumpRows.map((r) => JSON.stringify(r)).join("\n") + "\n")
  console.log(`\ndumped ${dumpRows.length} disagreement(s) to ${DUMP}`)
}
