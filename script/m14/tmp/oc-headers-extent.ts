// script/m14/tmp/oc-headers-extent.ts — the objc lane's header blind spot.
//
// `LANGS.objc.ext` is `"m"`, so the F5 differential and every depth draw measure
// only implementation files. But the PRODUCT does not route by lane: it routes by
// CONTENT. `detectLanguageFromPath` sniffs a `.h` for `@interface`/`@protocol`/
// `@implementation` and hands it to the objective-c analyzer. So production feeds
// the objc analyzer every Objective-C header in the corpus, and the lane's own
// differential has never measured one of them.
//
// This routes each corpus file the way production does, then grades the analyzer
// on the routed-objc headers and, as a CONTROL, on the .m files. The control is
// what makes the result interpretable: if .m files show no divergence from the
// oracle and .h files diverge, the sampling universe is the variable, not the
// analyzer's naming.
//
// Run: bun script/m14/tmp/oc-headers-extent.ts
import * as fs from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const REPOS = ["sdwebimage", "afnetworking"]

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

type Verdict = { symbols: number; edges: number; missing: number; unexplained: number; error?: string }

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const load = async (f: string) => L.load(fs.readFileSync(path.join(ROOT, "wasm", f)))
  const objcLang = await load("tree-sitter-objc.wasm")
  const cppLang = await load("tree-sitter-cpp.wasm")

  const ocmod: any = await import(path.join(ROOT, "src/ast/real-objective-c-analyzer"))
  const cppmod: any = await import(path.join(ROOT, "src/ast/real-cpp-analyzer"))
  const diff: any = await import("../differential")

  const parseWith = (lang: any, src: string) => {
    const p = new P()
    p.setLanguage(lang)
    return p.parse(src).rootNode
  }

  const grade = async (
    mod: any, cls: string, lang: any, src: string, file: string, withOracle: boolean,
  ): Promise<Verdict> => {
    try {
      const root = parseWith(lang, src)
      const r: any = await new mod[cls]().analyze(root, src, file)
      const edges: Array<{ type: string; source: string; target: string }> = r.relationships ?? []
      let missing = 0, unexplained = 0
      if (withOracle) {
        const truth: Array<{ label: string; from: string; target: string }> = diff.deriveObjcEdges(parseWith(objcLang, src)) ?? []
        const key = (t: string, s: string, g: string) => `${t}:${String(s).trim()}->${String(g).trim()}`
        const have = new Set(edges.map((e) => key(e.type, e.source, e.target)))
        const want = new Set(truth.map((t) => key(t.label, t.from, t.target)))
        for (const w of want) if (!have.has(w)) missing++
        for (const h of have) if (!want.has(h)) unexplained++
      }
      return { symbols: (r.symbols ?? []).length, edges: edges.length, missing, unexplained }
    } catch (e: any) {
      return { symbols: 0, edges: 0, missing: 0, unexplained: 0, error: (e?.message ?? String(e)).slice(0, 60) }
    }
  }

  const sum = (v: Verdict[]) => v.reduce((a, b) => ({
    symbols: a.symbols + b.symbols, edges: a.edges + b.edges,
    missing: a.missing + b.missing, unexplained: a.unexplained + b.unexplained,
    errors: a.errors + (b.error ? 1 : 0),
  }), { symbols: 0, edges: 0, missing: 0, unexplained: 0, errors: 0 })

  const routing = new Map<string, number>()
  const hObjc: string[] = [], mAll: string[] = [], hCpp: string[] = [], hOther: string[] = []

  for (const repo of REPOS) {
    for (const abs of walk(path.join(CORPUS, repo))) {
      const ext = path.extname(abs).toLowerCase()
      if (ext !== ".h" && ext !== ".m") continue
      if (ext === ".m") { mAll.push(abs); routing.set("m", (routing.get("m") ?? 0) + 1); continue }
      const content = fs.readFileSync(abs, "utf8")
      const routed = detectLanguageFromPath(abs, content) ?? "(null)"
      routing.set(routed, (routing.get(routed) ?? 0) + 1)
      if (routed === "objective-c") hObjc.push(abs)
      else if (routed === "cpp") hCpp.push(abs)
      else hOther.push(abs)
    }
  }

  console.log("=== how the PRODUCT routes this corpus's files ===")
  for (const [lang, n] of [...routing.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${lang.padEnd(14)} ${n}`)
  console.log(`\n  .m files: ${mAll.length}   .h routed to objective-c: ${hObjc.length}   .h routed to cpp: ${hCpp.length}   other: ${hOther.length}`)

  console.log("\n=== objc analyzer, graded by the ORACLE, control vs treatment ===")
  const control: Verdict[] = []
  for (const f of mAll) control.push(await grade(ocmod, "RealObjectiveCAnalyzer", objcLang, fs.readFileSync(f, "utf8"), f, true))
  const treat: Verdict[] = []
  for (const f of hObjc) treat.push(await grade(ocmod, "RealObjectiveCAnalyzer", objcLang, fs.readFileSync(f, "utf8"), f, true))
  const c = sum(control), t = sum(treat)
  const line = (label: string, v: any, n: number) =>
    `  ${label.padEnd(28)} files=${String(n).padStart(3)} symbols=${String(v.symbols).padStart(6)} edges=${String(v.edges).padStart(6)} missing=${String(v.missing).padStart(5)} unexplained=${String(v.unexplained).padStart(5)} errors=${v.errors}`
  console.log(line("CONTROL  .m (measured)", c, mAll.length))
  console.log(line("TREATMENT .h (never run)", t, hObjc.length))

  console.log("\n=== what the C++ lanes are graded on instead ===")
  const asCpp: Verdict[] = []
  for (const f of hObjc) asCpp.push(await grade(cppmod, "RealCppAnalyzer", cppLang, fs.readFileSync(f, "utf8"), f, false))
  const cppv = sum(asCpp)
  console.log(line("objc headers as C++", cppv, hObjc.length))

  // TRIAGE: a header's declared surface (counted from the source TEXT, so it is
  // independent of the analyzer) vs what the analyzer published. A header that
  // declares a class and twelve methods but yields one symbol is a question the
  // lane's sampling universe has never asked.
  console.log("\n=== headers where the DECLARED surface and the extracted symbols disagree ===")
  type Gap = { f: string; decls: number; syms: number; edges: number; err: boolean }
  const gaps: Gap[] = []
  for (const f of hObjc) {
    const src = fs.readFileSync(f, "utf8")
    const interfaces = (src.match(/@(?:interface|protocol)\s+[A-Za-z_]/g) ?? []).length
    const methods = (src.match(/^\s*[+-]\s*\(/gm) ?? []).length
    const props = (src.match(/@property\b/g) ?? []).length
    const decls = interfaces + methods + props
    const root = parseWith(objcLang, src)
    const r: any = await new ocmod.RealObjectiveCAnalyzer().analyze(root, src, f)
    gaps.push({ f, decls, syms: (r.symbols ?? []).length, edges: (r.relationships ?? []).length, err: !!root.hasError })
  }
  gaps.sort((a, b) => (b.decls - b.syms) - (a.decls - a.syms))
  console.log(`  ${'file'.padEnd(60)} ${'declared'.padStart(8)} ${'symbols'.padStart(8)} ${'edges'.padStart(6)} err`)
  for (const g of gaps.slice(0, 10)) {
    console.log(`  ${path.relative(CORPUS, g.f).padEnd(60)} ${String(g.decls).padStart(8)} ${String(g.syms).padStart(8)} ${String(g.edges).padStart(6)} ${g.err ? "YES" : ""}`)
  }
  const bad = gaps.filter((g) => g.decls > 0 && g.syms <= 1)
  const errs = gaps.filter((g) => g.err)
  const clean = gaps.filter((g) => !g.err)
  console.log(`\n  headers the analyzer parses with ERROR nodes: ${errs.length} of ${gaps.length}`)
  console.log(`  headers declaring a surface (class/method/property) that yield <=1 symbol: ${bad.length}`)
  for (const g of bad.sort((a, b) => b.decls - a.decls)) {
    console.log(`      ${path.relative(CORPUS, g.f).padEnd(62)} declared=${String(g.decls).padStart(3)} symbols=${g.syms} edges=${g.edges}${g.err ? " ERROR" : ""}`)
  }
  const avg = (xs: Gap[], k: "decls" | "syms") => xs.length ? (xs.reduce((a, b) => a + b[k], 0) / xs.length).toFixed(1) : "-"
  const rate = (xs: Gap[]) => xs.length ? `${((xs.reduce((a, b) => a + b.syms, 0) / Math.max(1, xs.reduce((a, b) => a + b.decls, 0))) * 100).toFixed(0)}%` : "-"
  console.log(`\n  ${'cohort'.padEnd(34)} files  avg declared  avg symbols  symbols/declared`)
  console.log(`  ${'ERROR nodes in the tree'.padEnd(34)} ${String(errs.length).padStart(5)}  ${avg(errs, "decls").padStart(12)}  ${avg(errs, "syms").padStart(11)}  ${rate(errs).padStart(16)}`)
  console.log(`  ${'clean parse'.padEnd(34)} ${String(clean.length).padStart(5)}  ${avg(clean, "decls").padStart(12)}  ${avg(clean, "syms").padStart(11)}  ${rate(clean).padStart(16)}`)
  console.log(`  ${'(all routed .h)'.padEnd(34)} ${String(gaps.length).padStart(5)}  ${avg(gaps, "decls").padStart(12)}  ${avg(gaps, "syms").padStart(11)}  ${rate(gaps).padStart(16)}`)

  console.log("\n=== worst headers by symbols the C++ routing would never see ===")
  const per: Array<{ f: string; oc: Verdict; cpp: Verdict }> = []
  for (let i = 0; i < hObjc.length; i++) per.push({ f: hObjc[i], oc: treat[i], cpp: asCpp[i] })
  per.sort((a, b) => (b.oc.symbols - b.cpp.symbols) - (a.oc.symbols - a.cpp.symbols))
  for (const p of per.slice(0, 6)) {
    console.log(`  ${path.relative(CORPUS, p.f)}`)
    console.log(`      objc: ${p.oc.symbols} symbols / ${p.oc.edges} edges   |   as C++: ${p.cpp.symbols} symbols / ${p.cpp.edges} edges${p.cpp.error ? "  (" + p.cpp.error + ")" : ""}`)
  }
}

main()
