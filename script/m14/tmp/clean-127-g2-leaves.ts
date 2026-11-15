// script/m14/tmp/clean-127-g2-leaves.ts
//
// The decisive G2 measurement: text loss vs re-typing, run corpus-wide.
//
// G2 flags a file when the pinned and candidate grammars produce different s-expressions
// for a file that is CLEAN under both. That verdict cannot distinguish two very different
// things: (a) the grammar re-typed / re-nested the same source text — no information is
// lost, and any analyzer regression on top of it is a recovery fix, or (b) the grammar
// dropped or split source text — real damage.
//
// A tree-sitter tree's leaves tile the source TOKENS (whitespace between them is not in the
// tree), so the token stream is the ground truth. The honest tests are:
//
//   coverA/coverB   — does each side's leaf concatenation equal the source modulo whitespace
//                     (a false here means the measurement itself is broken, not that a file is)
//   lostText/gained — is the token content preserved at all?
//   retyped         — same text, same span, different node TYPE (pure re-typing)
//   moved           — same text, different span (real re-positioning)
//   clusters        — adjacent lost/added spans grouped into one lexing EVENT, so a single
//                     defect (`mod`+`e` -> `mode`) is one record rather than N
//
// Run: bun script/m14/tmp/clean-127-g2-leaves.ts          # the 14 G2 files
//      G2_FILES=ALL bun script/m14/tmp/clean-127-g2-leaves.ts   # every Clean source on disk
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"

const ROOT = process.cwd()
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const CANDIDATE = process.env.CLEAN_CANDIDATE ?? "/tmp/tree-sitter-clean-127.wasm"
const PINNED = path.join(ROOT, "wasm/tree-sitter-clean.wasm")
const SPEC = process.env.G2_FILES ?? ""

const REPOS = ["Clyde", "clean-stdlib", "Prelude", "cloogle.org", "eastwood"]

async function makeParser(): Promise<any> {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const mk = async (wasm: string) => {
    const language = await L.load(readFileSync(wasm))
    const p = new P()
    p.setLanguage(language)
    return p
  }
  return { pinned: await mk(PINNED), candidate: await mk(CANDIDATE) }
}

interface Leaf { text: string; type: string; start: number; end: number; line: number }
interface Cluster { start: number; end: number; line: number; lost: Leaf[]; added: Leaf[] }

function leaves(root: any, src: string): Leaf[] {
  const out: Leaf[] = []
  const visit = (n: any) => {
    const kids = n.children ?? []
    if (kids.length === 0) {
      out.push({
        text: src.slice(n.startIndex, n.endIndex),
        type: n.type,
        start: n.startIndex,
        end: n.endIndex,
        line: n.startPosition.row + 1,
      })
      return
    }
    for (const k of kids) visit(k)
  }
  visit(root)
  return out
}

/** Keyed by (text,start): a re-type at the same span matches; a move does not. */
function bySpan(ls: Leaf[]): Map<string, Leaf> {
  const m = new Map<string, Leaf>()
  for (const l of ls) m.set(`${l.text}\u0000${l.start}`, l)
  return m
}

function byText(ls: Leaf[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of ls) if (l.text.trim()) m.set(l.text, (m.get(l.text) ?? 0) + 1)
  return m
}

/** Adjacent lost/added spans become one lexing event. */
function clusterize(lost: Leaf[], added: Leaf[]): Cluster[] {
  const evs = [
    ...lost.map((l) => ({ kind: "lost" as const, l })),
    ...added.map((l) => ({ kind: "added" as const, l })),
  ].sort((x, y) => x.l.start - y.l.start || x.l.end - y.l.end)
  const out: Cluster[] = []
  for (const e of evs) {
    const last = out[out.length - 1]
    if (last && e.l.start <= last.end && e.l.line <= last.line + 1) {
      if (e.kind === "lost") last.lost.push(e.l)
      else last.added.push(e.l)
      last.end = Math.max(last.end, e.l.end)
      continue
    }
    out.push({
      start: e.l.start,
      end: e.l.end,
      line: e.l.line,
      lost: e.kind === "lost" ? [e.l] : [],
      added: e.kind === "added" ? [e.l] : [],
    })
  }
  return out
}

export function adjudicate(pinned: any, candidate: any, src: string) {
  const a = leaves(pinned.parse(src).rootNode, src)
  const b = leaves(candidate.parse(src).rootNode, src)

  const nw = (s: string) => s.replace(/\s+/g, "")
  const coverA = nw(a.map((l) => l.text).join("")) === nw(src)
  const coverB = nw(b.map((l) => l.text).join("")) === nw(src)

  const ta = byText(a)
  const tb = byText(b)
  const lostText: [string, number][] = []
  const gainedText: [string, number][] = []
  for (const [t, n] of ta) { const d = n - (tb.get(t) ?? 0); if (d > 0) lostText.push([t, d]) }
  for (const [t, n] of tb) { const d = n - (ta.get(t) ?? 0); if (d > 0) gainedText.push([t, d]) }

  const sa = bySpan(a)
  const sb = bySpan(b)
  const retyped: { text: string; line: number; from: string; to: string }[] = []
  const lostAtSpan: Leaf[] = []
  for (const [k, l] of sa) {
    const r = sb.get(k)
    if (!r) { lostAtSpan.push(l); continue }
    if (r.type !== l.type) retyped.push({ text: l.text, line: l.line, from: l.type, to: r.type })
  }
  const addedAtSpan: Leaf[] = []
  for (const [k, l] of sb) if (!sa.has(k)) addedAtSpan.push(l)

  return {
    a, b, coverA, coverB, lostText, gainedText, retyped, lostAtSpan, addedAtSpan,
    clusters: clusterize(lostAtSpan, addedAtSpan),
  }
}

function walkClean(dir: string, out: string[]): void {
  for (const ent of readdirSync(dir)) {
    const abs = path.join(dir, ent)
    let st: ReturnType<typeof statSync>
    try { st = statSync(abs) } catch { continue }
    if (st.isDirectory()) { if (ent !== ".git") walkClean(abs, out); continue }
    if (/\.(icl|dcl)$/.test(ent)) out.push(abs)
  }
}

/** A stable name for a lexing event, so the census groups by CAUSE not by example. */
function signature(c: Cluster): string {
  const lost = c.lost.map((l) => `${l.type}:${JSON.stringify(l.text)}`).join("+")
  const added = c.added.map((l) => `${l.type}:${JSON.stringify(l.text)}`).join("+")
  const lostTypes = new Set(c.lost.map((l) => l.type))
  const addedTypes = new Set(c.added.map((l) => l.type))
  if (c.lost.length && c.added.length && c.lost.every((l) => l.type === "operator" || l.type === "operator_mul" || l.type === "operator_div" || l.type === "operator_rem")) {
    return `operator-prefix-split -> ${addedTypes.size === 1 ? [...addedTypes][0] : [...addedTypes].join("/")}`
  }
  if (!c.lost.length) return `pure-add: ${added}`
  if (!c.added.length) return `pure-loss: ${lost}`
  return `${[...lostTypes].join("/") || "none"} -> ${[...addedTypes].join("/")}`
}

async function main() {
  const p = await makeParser()
  let files: string[]
  if (SPEC === "ALL") {
    files = []
    for (const r of REPOS) {
      const base = path.join(CORPUS, r)
      try { statSync(base) } catch { continue }
      const found: string[] = []
      walkClean(base, found)
      for (const f of found) files.push(`${r}/${path.relative(base, f)}`)
    }
  } else {
    files = SPEC.split(",").filter(Boolean)
  }

  console.log(`G2 leaf adjudication — pinned v1.2.4 vs candidate ${path.basename(CANDIDATE)}`)
  console.log(`${files.length} file(s). leaf-concat==source (mod whitespace) is the sanity gate;`)
  console.log(`a false there means the measurement is broken, not the file.\n`)

  const census = new Map<string, { n: number; files: Set<string>; examples: string[] }>()
  const retypeCensus = new Map<string, { n: number; files: Set<string> }>()
  let brokenGauge = 0
  let textChangeFiles = 0
  let retypeFiles = 0
  let identical = 0
  const detailed = files.length <= 20

  for (const entry of files) {
    const m = entry.match(/^([^/]+)\/(.+)$/)
    if (!m) continue
    const [, repo, rel] = m
    const abs = path.join(CORPUS, repo, rel)
    let src: string
    try { src = readFileSync(abs, "utf8") } catch { console.log(`  ${entry}: unreadable`); continue }
    const r = adjudicate(p.pinned, p.candidate, src)
    if (!r.coverA || !r.coverB) { brokenGauge++; console.log(`  !! GAUGE BROKEN on ${entry} (coverA=${r.coverA} coverB=${r.coverB})`) }
    const spanLoss = r.lostAtSpan.filter((l) => l.text.trim()).length
    const spanAdd = r.addedAtSpan.filter((l) => l.text.trim()).length
    const isTextChange = spanLoss || spanAdd
    if (isTextChange) textChangeFiles++
    else if (r.retyped.length) retypeFiles++
    else identical++

    if (detailed) {
      const verdict = isTextChange ? "TEXT CHANGE" : r.retyped.length ? "RE-TYPE ONLY" : "IDENTICAL"
      console.log(`### ${entry}  ->  ${verdict}`)
      console.log(`  cover: pinned=${r.coverA} candidate=${r.coverB} | text lost ${r.lostText.length} gained ${r.gainedText.length}` +
        ` | spans lost ${spanLoss} added ${spanAdd} | re-typed ${r.retyped.length}`)
      for (const c of r.clusters) {
        const ls = c.lost.map((l) => `${l.type}:"${l.text}"`).join(" ")
        const as = c.added.map((l) => `${l.type}:"${l.text}"`).join(" ")
        console.log(`    line ${c.line}: ${ls}  =>  ${as || "(nothing)"}`)
      }
      console.log()
    }

    for (const c of r.clusters) {
      if (!c.lost.length && !c.added.length) continue
      const sig = signature(c)
      const e = census.get(sig) ?? { n: 0, files: new Set<string>(), examples: [] }
      e.n++
      e.files.add(entry)
      if (e.examples.length < 4) {
        const ls = c.lost.map((l) => l.text).join("|")
        const as = c.added.map((l) => l.text).join("|")
        e.examples.push(`${entry}:${c.line}  ${ls} => ${as}`)
      }
      census.set(sig, e)
    }
    for (const rt of r.retyped) {
      const key = `${rt.from} -> ${rt.to}`
      const e = retypeCensus.get(key) ?? { n: 0, files: new Set<string>() }
      e.n++
      e.files.add(entry)
      retypeCensus.set(key, e)
    }
  }

  console.log(`SUMMARY over ${files.length} files: identical ${identical}, re-type-only ${retypeFiles},` +
    ` text-change ${textChangeFiles}${brokenGauge ? `, GAUGE BROKEN ${brokenGauge}` : ""}`)
  console.log(`\nlexing/span-change census (by cause):`)
  for (const [k, v] of [...census].sort((x, y) => y[1].n - x[1].n)) {
    console.log(`  ${String(v.n).padStart(4)} events in ${String(v.files.size).padStart(3)} files  ${k}`)
    for (const ex of v.examples.slice(0, 2)) console.log(`         e.g. ${ex}`)
  }
  console.log(`\nre-typing census (leaf text and span identical, node type changed):`)
  for (const [k, v] of [...retypeCensus].sort((x, y) => y[1].n - x[1].n)) {
    console.log(`  ${String(v.n).padStart(4)}  ${k.padEnd(40)} (${v.files.size} file${v.files.size > 1 ? "s" : ""})`)
  }
}

if (import.meta.main) main().catch((e) => { console.error(e); process.exit(1) })
