// FS028 — classify the F5 residual by SHAPE, so the closure record can state a number
// per class instead of a single unexplained total. A total with no shape breakdown is
// the "undifferentiated residual" the M60 rounds were written to end.
import * as fs from "fs"; import * as path from "path"
const ROOT = path.resolve(import.meta.dirname, "../../..")
const { deriveFsharpEdges } = await import(path.join(ROOT, "script/m14/fsharp-truth-oracle.ts"))
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argOf = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined }
function walk(d: string, exts: string[], out: string[], cap: number): string[] {
  if (out.length >= cap) return out
  let ns: string[]; try { ns = fs.readdirSync(d) } catch { return out }
  for (const n of ns) { if (out.length >= cap) return out
    if (n === ".git" || n === "node_modules" || n === "bin" || n === "obj") continue
    const p = path.join(d, n); let st: fs.Stats
    try { st = fs.statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, exts, out, cap)
    else if (exts.includes(path.extname(n).slice(1))) out.push(p) }
  return out
}
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const LIMIT = parseInt(argOf("--limit") ?? "120")
/** A residual's shape, by what the SOURCE and TARGET look like — no file inspection. */
function shapeOf(dir: "MISSING" | "UNEXPLAINED", label: string, from: string, to: string, declaredOn?: string): string {
  const dotted = (s: string) => s.includes(".") ? "dotted" : "bare"
  if (label === "calls") return `calls / source ${from === to ? "SELF (recursive)" : "other"}`
  if (label === "overrides") return `overrides / source ${from.startsWith("new ") ? "an object expression" : "a named type"}`
  if (label === "implements") return `implements / target ${dotted(to)}`
  if (label === "extends") return `extends / target ${dotted(to)}`
  if (label === "contains") return `contains / target ${dotted(to)}`
  if (label === "references") return `references ${declaredOn ? `declared_type(${declaredOn})` : "an open path"} / target ${dotted(to)}`
  if (label === "instantiates") return `instantiates / target ${dotted(to)}`
  return `${label} (unclassified)`
}
const miss = new Map<string, { n: number; eg: string }>()
const unexp = new Map<string, { n: number; eg: string }>()
const openFiles = new Map<string, number>()
const perLabelMiss = new Map<string, number>()
const perLabelUn = new Map<string, number>()
const perLabelTruth = new Map<string, number>()
let m = 0, u = 0, files = 0
for (const file of walk(path.join(CORPUS_ROOT, argOf("--repo") ?? "fsharp"), ["fs","fsi","fsx"], [], LIMIT)) {
  if (files >= LIMIT) break
  let src: string; try { src = fs.readFileSync(file, "utf8") } catch { continue }
  files++
  const rel = path.relative(CORPUS_ROOT, file)
  let r: any; try { r = await ASTEngine.parseFile(file, src) } catch { continue }
  const parser = new P()
  let truth: any[] = []
  try { parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))
        const tree = parser.parse(src); truth = deriveFsharpEdges(tree.rootNode, r.symbols ?? []) } catch { continue }
  const k = (l: string, a: string, b: string) => `${l}|${a}|${b}`
  const tk = new Map(truth.map((e: any) => [k(e.label, e.from, e.to), e]))
  const rels: any[] = r.relationships ?? []
  const ak = new Set(rels.map((x: any) => k(String(x.type), String(x.source), String(x.target))))

  // A PER-LABEL histogram, added because two probes over the same analyzer disagreed by two
  // orders of magnitude (this one: 26 unexplained over 120 files; the canonical harness: 2159
  // over its 60). Two numbers that cannot both be right usually mean the two are not counting
  // the same THING, and the cheapest way to find out which thing is missing is to count labels
  // rather than to argue about totals.
  {
    const truthByLabel = new Map<string, number>()
    for (const e of truth) truthByLabel.set(String(e.label), (truthByLabel.get(String(e.label)) ?? 0) + 1)
      for (const [key, e] of tk) if (!ak.has(key)) perLabelMiss.set(String(e.label), (perLabelMiss.get(String(e.label)) ?? 0) + 1)
    for (const x of rels) if (!tk.has(k(String(x.type), String(x.source), String(x.target)))) perLabelUn.set(String(x.type), (perLabelUn.get(String(x.type)) ?? 0) + 1)
    for (const [l, n] of truthByLabel) perLabelTruth.set(l, (perLabelTruth.get(l) ?? 0) + n)
  }
  for (const [key, e] of tk) if (!ak.has(key)) { m++; const s = shapeOf("MISSING", e.label, e.from, e.to, e.declaredOn); miss.set(s, { n: (miss.get(s)?.n ?? 0) + 1, eg: miss.get(s)?.eg ?? `${rel}  ${key}` }) }
  // The MARKER has to come from the ANALYZER ROW, not from the key. The key is
  // `label|from|to` and carries no declaredOn, so calling shapeOf without it classified
  // EVERY unexplained `references` row as "an open path" — declared_type rows included.
  // That put 127 rows in a class that had been fixed twice against two files which both
  // agreed afterwards, and the total did not move, because the class was never the class
  // its name said. The residual is keyed on a Set of strings, so the marker has to be
  // carried alongside it.
  const markerOf = new Map<string, string | undefined>()
  for (const x of rels) markerOf.set(k(String(x.type), String(x.source), String(x.target)), (x.metadata ?? {}).declaredOn)
  for (const key of ak) if (!tk.has(key)) { u++; const [l, f2, t2] = key.split("|"); const s = shapeOf("UNEXPLAINED", l, f2, t2, markerOf.get(key)); unexp.set(s, { n: (unexp.get(s)?.n ?? 0) + 1, eg: unexp.get(s)?.eg ?? `${rel}  ${key}` })
    // WHICH FILE, for the open-path class. A total with no file list is the same problem
    // one level down from a total with no shape breakdown: this class was "fixed" twice
    // against two files that both agreed afterwards, and the total did not move, which
    // meant neither of those files was where the rows were.
    if (l === "references" && !/declared_type/.test(s)) { openFiles.set(rel, (openFiles.get(rel) ?? 0) + 1) } }
}
const dump = (title: string, mp: Map<string, { n: number; eg: string }>) => {
  console.log(`\n== ${title} (${[...mp.values()].reduce((a, b) => a + b.n, 0)}) ==`)
  for (const [k, v] of [...mp.entries()].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${String(v.n).padStart(5)}  ${k}\n         eg ${v.eg}`)
}
console.log(`FS028 — F5 residual by shape, ${files} files of ${argOf("--repo") ?? "fsharp"}`)
console.log("\nUNEXPLAINED open-path rows BY FILE:")
for (const [k2, v2] of [...openFiles].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${String(v2).padStart(4)}  ${k2}`)
dump("MISSING (truth derives, the analyzer does not)", miss)
dump("UNEXPLAINED (the analyzer emits, truth does not)", unexp)
console.log(`\ntotals: MISSING ${m}  UNEXPLAINED ${u}`)
if (process.env["FS028_LABELS"]) {
  const show = (t: string, mp: Map<string, number>) => {
    console.log(`\n== ${t} ==`)
    for (const [l, n] of [...mp].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${l}`)
  }
  show("TRUTH derives, by label", perLabelTruth)
  show("MISSING by label", perLabelMiss)
  show("UNEXPLAINED by label", perLabelUn)
}
