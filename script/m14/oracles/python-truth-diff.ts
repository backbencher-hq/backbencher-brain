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

const TYPES = ["contains", "extends", "overrides", "calls", "instantiates"] as const
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

let n = 0
let guessOk = 0
let guessBad = 0
const agreed = new Map<string, number>()
const missing = new Map<string, string[]>()
const unexplained = new Map<string, string[]>()
const guessBadEx = new Map<string, string[]>()
const count = (m: Map<string, number>, t: string, d: number): void => m.set(t, (m.get(t) ?? 0) + d)
const sample = (m: Map<string, string[]>, t: string, s: string): void => {
  const l = m.get(t) ?? []
  if (l.length < SHOW) { l.push(s); m.set(t, l) }
}

for (const f of files) {
  const content = fs.readFileSync(f, "utf8")
  const res: any = await engine.ASTEngine.parseFile(f, content)
  if (res?.language !== "python") continue
  n++

  const truth = derivePythonTruth(parser.parse(content).rootNode, path.basename(f).replace(/\.py$/, ""))
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
    else analyzerKeys.add(k)
  }

  for (const k of truthKeys) {
    const [t, from, to, line] = k.split("\u0000")
    const label = `${path.basename(f)} ${from} -> ${to}${line ? ` @L${line}` : ""}`
    if (analyzerKeys.has(k) || guessKeys.has(k)) count(agreed, t, 1)
    else sample(missing, t, label)
  }
  for (const k of guessKeys) {
    if (truthKeys.has(k)) guessOk++
    else { guessBad++; sample(guessBadEx, String(k).split("\u0000")[0], `${path.basename(f)} ${k.split("\u0000").slice(1).join(" -> ")}`) }
  }
  for (const k of analyzerKeys) {
    if (truthKeys.has(k)) continue
    const [t, from, to] = k.split("\u0000")
    sample(unexplained, t, `${path.basename(f)} ${from} -> ${to}`)
  }
}

const pad = (s: unknown, k: number): string => String(s).padEnd(k)
console.log(`files=${n}  types compared: ${TYPES.join(", ")}\n`)
console.log(pad("TYPE", 13) + pad("agreed", 9) + pad("missing", 9) + pad("unexplained", 13))
for (const t of TYPES) {
  console.log(pad(t, 13) + pad(agreed.get(t) ?? 0, 9) + pad(missing.get(t)?.length ?? 0, 9) + pad(unexplained.get(t)?.length ?? 0, 13))
}
if (guessOk + guessBad > 0) {
  console.log(`\ndeclared guesses (analyzer labelled them uncertain): ${guessOk + guessBad}  confirmed by tree=${guessOk}  refuted=${guessBad}`)
}
for (const t of TYPES) {
  const m = missing.get(t)
  if (m?.length) { console.log(`\nMISSING ${t} (${m.length}+): the tree says these exist and the analyzer did not emit them:`); for (const s of m) console.log(`   ${s}`) }
  const u = unexplained.get(t)
  if (u?.length) { console.log(`\nUNEXPLAINED ${t} (${u.length}+): the analyzer emitted these and the tree does not support them:`); for (const s of u) console.log(`   ${s}`) }
}
for (const [t, l] of guessBadEx) { console.log(`\nREFUTED GUESSES ${t} (${l.length}+):`); for (const s of l) console.log(`   ${s}`) }
