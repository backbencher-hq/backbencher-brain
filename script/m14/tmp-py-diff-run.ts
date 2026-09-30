import * as fs from "node:fs";
import * as path from "node:path";
import * as wts from "web-tree-sitter";

/**
 * PYTHON DIFFERENTIAL PROBE (PY-1).
 *
 * Compares `derivePythonTruth` against the analyzer over a corpus, type by type, and
 * reports the three buckets that matter:
 *
 *   MISSING     — the tree says this edge exists and the analyzer did not emit it.
 *                 Every one is a relationship the graph is missing.
 *   UNEXPLAINED — the analyzer emitted an edge the tree does not support. Every one is
 *                 either a real edge the oracle has not derived yet (a coverage gap in
 *                 THIS file, and it is named) or a fabricated endpoint.
 *   AGREED      — the number a gate wants, but the number that means least on its own.
 *
 * The comparison is by (type, from, to) WITHOUT the line, because the store resolves a
 * non-`contains` target by name alone and the two sides legitimately disagree about
 * which line to carry. For `contains` the line IS the identity (same-named members), so
 * it is compared too — and that is where a same-named method in two classes separates.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const wdir = path.join(ROOT, "node_modules/web-tree-sitter");
await wts.Parser.init({
  locateFile: () => ["tree-sitter.wasm", "web-tree-sitter.wasm"].map((f) => path.join(wdir, f)).find((f) => fs.existsSync(f))!,
})
const parser = new wts.Parser()
parser.setLanguage(await wts.Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-python.wasm"))))
const engine: any = await import(path.join(ROOT, "src/ast/engine"))
const { derivePythonTruth } = await import(path.join(ROOT, "script/m14/oracles/python-truth"))

const TYPES = ["contains", "extends", "overrides", "calls"] as const
const key = (t: string, f: string, to: string, line?: number) =>
  line === undefined ? `${t}\u0000${f}\u0000${to}` : `${t}\u0000${f}\u0000${to}\u0000${line}`

let files = 0, guesses = 0, confirmedGuess = 0, guessBaseImported = 0
const refuted: string[] = []
const missing = new Map<string, string[]>()
const unexplained = new Map<string, string[]>()
const agreed = new Map<string, number>()
// Count EVERYTHING; cap only what is printed. A capped count is a number that reads as
// a count and is not one, which is how a 4,000-edge gap gets reported as 40.
const count = new Map<string, number>()
const push = (m: Map<string, string[]>, t: string, s: string) => {
  count.set(`${m === missing ? "M" : "U"}:${t}`, (count.get(`${m === missing ? "M" : "U"}:${t}`) ?? 0) + 1)
  if (!m.has(t)) m.set(t, [])
  const l = m.get(t)!
  if (l.length < 25) l.push(s)
}

for (const f of process.argv.slice(2)) {
  const content = fs.readFileSync(f, "utf8")
  const res: any = await engine.ASTEngine.parseFile(f, content)
  if (res?.language !== "python") continue
  files++

  const truth = derivePythonTruth(parser.parse(content).rootNode, path.basename(f).replace(/\.py$/, ""))
  const truthKeys = new Set<string>()
  for (const e of truth) truthKeys.add(TYPES.includes(e.type as any) ? key(e.type, e.from, e.to, e.type === "contains" ? e.line : undefined) : "")
  const analyzerKeys = new Set<string>()
  const guessKeys = new Set<string>()   // per FILE: accumulating it multiplied the count by the file count
  for (const r of res.relationships ?? []) {
    const t = String(r.type)
    if (!TYPES.includes(t as any)) continue
    // A declared first-parent guess is not an unexplained edge. The M14 differential
    // buckets it `heuristic` and the gate compares COUNTS, so this harness does the
    // same: reporting a guess as "unexplained" would be a false red of ~1,300 rows and
    // would train a reader to ignore the bucket that means something.
    if ((r.metadata as any)?.reasonCode === "first-parent-guess") { guessKeys.add(key(t, String(r.source), String(r.target))); continue }
    analyzerKeys.add(key(t, String(r.source), String(r.target), t === "contains" ? r.line_number : undefined))
  }

  for (const k of truthKeys) {
    if (!k) continue
    const [t, from, to, line] = k.split("\u0000")
    if (analyzerKeys.has(k)) agreed.set(t, (agreed.get(t) ?? 0) + 1)
    else push(missing, t, `${path.basename(f)} ${from} -> ${to}${line ? ` @L${line}` : ""}`)
  }
  // A guess that truth CONFIRMS is the best bucket there is: the analyzer labelled it a
  // suspicion at 0.5 and it turned out right. Counting it as "unexplained" would punish
  // honesty, and counting it nowhere (which is what this harness did first) understates
  // the lane. It gets its own column, and the guess share is reported against
  // confirmed+refuted so the number means something.
  for (const k of guessKeys) { if (truthKeys.has(k)) confirmedGuess++; else { guesses++; if (refuted.length < 25) refuted.push(`${path.basename(f)} ${k.split("\u0000").slice(1).join(" -> ")}`) } }
  // Does the file IMPORT the base it guesses about? That is the only local corroboration
  // available for an external base, so it decides whether a smarter guess rule exists.
  const importedNames = new Set<string>()
  for (const r of res.relationships ?? []) if (String(r.type) === "imports") {
    const t = String(r.target); const item = t.includes(":") ? t.slice(t.lastIndexOf(":") + 1) : t
    if (item && item !== "*") importedNames.add(item)
  }
  for (const k of guessKeys) { if (truthKeys.has(k)) continue; const base = k.split("\u0000")[2]?.split(".")[0] ?? ""; if (importedNames.has(base)) guessBaseImported++ }
  for (const k of analyzerKeys) {
    if (truthKeys.has(k)) continue
    const [t, from, to] = k.split("\u0000")
    push(unexplained, t, `${path.basename(f)} ${from} -> ${to}`)
  }
}

console.log(`files=${files}\n`)
const p = (s: unknown, n: number) => String(s).padEnd(n)
console.log(p("TYPE", 12) + p("agreed", 10) + p("missing", 10) + p("unexplained", 12) + p("guess", 9) + p("guess-ok", 9))
for (const t of TYPES) console.log(p(t, 12) + p(agreed.get(t) ?? 0, 10) + p(count.get(`M:${t}`) ?? 0, 10) + p(count.get(`U:${t}`) ?? 0, 12) + p(t === "overrides" ? guesses : 0, 9) + p(t === "overrides" ? confirmedGuess : 0, 9))
console.log(`\nrefuted guesses whose base IS imported in the file: ${guessBaseImported} of ${guesses}`)
for (const r of refuted.slice(0, 8)) console.log(`   refuted: ${r}`)
console.log(`\noverrides: verified-agreed=${agreed.get("overrides") ?? 0}  guess-CONFIRMED=${confirmedGuess}  guess-refuted=${guesses}  unexplained=${count.get("U:overrides") ?? 0}`)
console.log(`overrides guess rate: ${guesses + confirmedGuess} of ${(agreed.get("overrides") ?? 0) + guesses + confirmedGuess} = ${(((guesses + confirmedGuess) / Math.max(1, (agreed.get("overrides") ?? 0) + guesses + confirmedGuess)) * 100).toFixed(1)}%, of which ${(((confirmedGuess) / Math.max(1, guesses + confirmedGuess)) * 100).toFixed(1)}% are RIGHT`)
for (const t of TYPES) {
  const m = missing.get(t)
  if (m?.length) {
    console.log(`\nMISSING ${t} (${count.get(`M:${t}`)}) — the tree says these exist and the analyzer did not emit them:`)
    for (const s of m.slice(0, 8)) console.log(`   ${s}`)
  }
  const u = unexplained.get(t)
  if (u?.length) {
    console.log(`\nUNEXPLAINED ${t} (${count.get(`U:${t}`)}) — the analyzer emitted these and the tree does not support them:`)
    for (const s of u.slice(0, 8)) console.log(`   ${s}`)
  }
}
