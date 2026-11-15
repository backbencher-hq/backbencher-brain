// #919 A/B classifier: every before/after difference is classified, and the
// only admissible removals are the macro-body LOCALS the recovery stops
// leaking (a file-scope symbol declared inside a recovered body span) plus
// re-attributed / re-attributed-with-line edges. Anything else is REAL-LOSS and
// is printed with no explanation.
//   bun script/m14/tmp/c919-abdiff.ts /tmp/c919-before.json /tmp/c919-after.json
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const before = JSON.parse(readFileSync(process.argv[2], "utf8"))
const after = JSON.parse(readFileSync(process.argv[3], "utf8"))
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-cpp.wasm")))
const parser = new P(); parser.setLanguage(lang)
const { macroDeclaredBody, RealCppAnalyzer } = await import(path.join(ROOT, "src", "ast", "real-cpp-analyzer.ts"))
const pred: any = new RealCppAnalyzer()

// recovered body spans per file (line-ranges), from the tree
const spansByFile = new Map<string, Array<[number, number, string]>>()
const parseSpans = (rel: string) => {
  if (spansByFile.has(rel)) return spansByFile.get(rel)!
  const out: Array<[number, number, string]> = []
  try {
    const root = parser.parse(readFileSync(path.join(CORPUS, rel), "utf8")).rootNode
    const st: any[] = [root]
    while (st.length) {
      const n = st.pop()!
      const rec = macroDeclaredBody(n)
      if (rec) out.push([n.startPosition.row + 1, n.endPosition.row + 1, rec.headingText])
      // the second spelling: a `function_definition` the analyzer's CP2 predicate
      // reads as a macro-declared body (ALL-CAPS declarator name, untyped params)
      else if (n.type === "function_definition") {
        const det = pred.getFunctionDetails(n)
        if (det && !det.isDestructor && !String(det.name).startsWith("operator") && pred.isMacroFunctionShape(n, det.name)) {
          out.push([n.startPosition.row + 1, n.endPosition.row + 1, `CP2:${det.name}`])
        }
      }
      for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
    }
  } catch {}
  spansByFile.set(rel, out)
  return out
}

const parseSym = (s: string) => {
  const [kind, name, owner, line] = s.split("|")
  return { kind, name, owner, line: Number(line) }
}
const parseRel = (r: string) => {
  const i = r.lastIndexOf("|")
  const j = r.lastIndexOf("|", i - 1)
  const k = r.indexOf("|")
  return { type: r.slice(0, k), source: r.slice(k + 1, j), target: r.slice(j + 1, i), line: Number(r.slice(i + 1)) }
}

let filesChanged = 0
const addedSyms: Array<{ file: string; s: string }> = []
const removedSyms: Array<{ file: string; s: string; klass: string }> = []
const addedRels: Array<{ file: string; r: string; klass: string; wasSource?: string }> = []
const removedRels: Array<{ file: string; r: string; klass: string; newSource?: string }> = []
const exportChanges: Array<{ file: string; s: string; dir: string }> = []

for (const rel of Object.keys(before)) {
  const b = before[rel] ?? {}
  const a = after[rel] ?? {}
  if (b.error || a.error) continue
  const bS = new Set<string>(b.symbols ?? [])
  const aS = new Set<string>(a.symbols ?? [])
  const nm: string[] = [...aS]
  const bR = new Set<string>(b.rels ?? [])
  const aR = new Set<string>(a.rels ?? [])
  const bE = new Set<string>(b.exports ?? [])
  const aE = new Set<string>(a.exports ?? [])
  const changed = bS.size !== aS.size || bR.size !== aR.size || bE.size !== aE.size ||
    [...bS].some((x) => !aS.has(x)) || [...bR].some((x) => !aR.has(x)) || [...bE].some((x) => !aE.has(x))
  if (changed) filesChanged++
  const spans = () => parseSpans(rel)
  // symbols added
  for (const s of aS) if (!bS.has(s)) {
    const p = parseSym(s)
    const inBody = spans().some(([a1, b1, name]) => p.line >= a1 && p.line <= b1 && name === p.name && !p.owner)
    addedSyms.push({ file: rel, s, })
    void inBody
  }
  // symbols removed — admissible only as a macro-body local
  for (const s of bS) if (!aS.has(s)) {
    const p = parseSym(s)
    const span = spans().find(([a1, b1]) => p.line >= a1 && p.line <= b1)
    // a leaked body local is published either bare (file scope) or owned by the
    // enclosing anonymous namespace — `anonymous` is not a real owner
    const noRealOwner = !p.owner || p.owner === "anonymous"
    const klass = noRealOwner && span ? `macro-body local (in ${JSON.stringify(span[2])})` : "REAL-LOSS"
    removedSyms.push({ file: rel, s, klass })
  }
  // Names the after-run no longer publishes ANYWHERE in this file (the symbol
  // half of the leak): a read resolves only through the file-scope roster, so a
  // read whose target name leaked out of a macro body was a PHANTOM — it was
  // emitted because a test body's local was (wrongly) a file-scope symbol, and
  // it names no file-scope value now. Measured instance: nlohmann's
  // unit-regression1.cpp `uses nocopy -> n` at 113 is the parameter `n` of a
  // class's friend definition, emitted only because the leaked body at 1365
  // published a file-scope `n`. Admissible IFF that name's OWN symbol removal
  // was itself admissible (macro-body local) — a symbol that vanished for any
  // other reason is already REAL-LOSS in the symbol half.
  const leakedNames = new Set<string>()
  for (const s of bS) if (!aS.has(s)) {
    const p = parseSym(s)
    const span = spans().find(([a1, b1]) => p.line >= a1 && p.line <= b1)
    const noRealOwner = !p.owner || p.owner === "anonymous"
    if (noRealOwner && span) leakedNames.add(p.name)
  }
  const afterNames = new Set<string>(nm.map(parseSym).map((p) => p.name))
  // relationships re-attributed (same type+target+line, different source)
  for (const r of bR) {
    if (aR.has(r)) continue
    const p = parseRel(r)
    const cand = [...aR].map(parseRel).find((q) => q.type === p.type && q.target === p.target && q.line === p.line)
    const klass = cand ? `re-attributed: ${JSON.stringify(p.source)} -> ${JSON.stringify(cand.source)}`
      : spans().some(([a1, b1]) => p.line >= a1 && p.line <= b1) ? "inside a recovered body (source moved/removed)"
      : (leakedNames.has(p.target) && !afterNames.has(p.target))
        ? `phantom target: ${JSON.stringify(p.target)} was a leaked body name, no file-scope value bears it now`
      : "REAL-LOSS"
    removedRels.push({ file: rel, r, klass, newSource: cand?.source })
  }
  for (const r of aR) if (!bR.has(r)) {
    const p = parseRel(r)
    const cand = [...bR].map(parseRel).find((q) => q.type === p.type && q.target === p.target && q.line === p.line)
    // A `source::type::target` dedupe key can only name ONE line per file, so
    // when an earlier occurrence of the same edge class acquires a real owner
    // the `global` key falls to the next site. That is a hand-off, not a new
    // edge: it requires the same (type,target) to have existed with source
    // `global` before AND to still exist (with a new source) after.
    const handoff = p.source === "global" && [...bR].map(parseRel).some((q) => q.type === p.type && q.target === p.target && q.source === "global")
    addedRels.push({
      file: rel,
      r,
      klass: cand
        ? `re-attributed: ${JSON.stringify(cand.source)} -> ${JSON.stringify(p.source)}`
        : spans().some(([a1, b1]) => p.line >= a1 && p.line <= b1)
          ? "inside a recovered body"
          : handoff
            ? "global-key hand-off (the earlier global occurrence of this edge class acquired an owner)"
            : "NEW (no before counterpart)",
      wasSource: cand?.source,
    })
  }
  for (const e of aE) if (!bE.has(e)) exportChanges.push({ file: rel, s: e, dir: "+" })
  for (const e of bE) if (!aE.has(e)) exportChanges.push({ file: rel, s: e, dir: "-" })
}

const cls = (arr: Array<{ klass: string }>) => {
  const m = new Map<string, number>()
  for (const x of arr) m.set(x.klass.split(":")[0], (m.get(x.klass.split(":")[0]) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}
console.log(`files changed: ${filesChanged}`)
console.log(`symbols added: ${addedSyms.length}  removed: ${removedSyms.length}`)
console.log(`  removed classes: ${JSON.stringify(cls(removedSyms))}`)
console.log(`  added sample: ${addedSyms.slice(0, 5).map(x => x.s).join(" ; ")}`)
console.log(`relationships: -${removedRels.length} / +${addedRels.length}`)
console.log(`  removed classes: ${JSON.stringify(cls(removedRels))}`)
console.log(`  added classes:   ${JSON.stringify(cls(addedRels))}`)
console.log(`exports: ${exportChanges.length} (${exportChanges.filter(e => e.dir === "-").length} removed / ${exportChanges.filter(e => e.dir === "+").length} added)`)
const byType = (arr: Array<{ r: string }>) => {
  const m = new Map<string, number>()
  for (const x of arr) m.set(x.r.split("|")[0], (m.get(x.r.split("|")[0]) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}
const insideBody = removedRels.filter((x) => x.klass.startsWith("inside a recovered body"))
console.log(`  inside-recovered-body removals by relation type: ${JSON.stringify(byType(insideBody))}`)
const news = addedRels.filter((x) => x.klass === "NEW (no before counterpart)")
console.log(`\nNEW-with-no-before-counterpart (${news.length}):`)
for (const x of news) console.log(`  ${x.file}  ${x.r}`)
const realSymLoss = removedSyms.filter((x) => x.klass === "REAL-LOSS")
const realRelLoss = removedRels.filter((x) => x.klass === "REAL-LOSS")
console.log(`\nREAL-LOSS symbols: ${realSymLoss.length}`)
for (const x of realSymLoss.slice(0, 20)) console.log(`  ${x.file}  ${x.s}`)
console.log(`REAL-LOSS relationships: ${realRelLoss.length}`)
for (const x of realRelLoss.slice(0, 20)) console.log(`  ${x.file}  ${x.r}`)
