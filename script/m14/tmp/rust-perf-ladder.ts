/**
 * RUST lane — PERF LADDER, built to isolate the ONE term the lane flagged and
 * never measured.
 *
 * THE FLAGGED TERM. `collectFunctionBindings` walks a body subtree PER
 * `function_item`, starting the walk at the function node itself (so it descends
 * into everything below it). The fifth review recorded this as "the likely
 * scaling term, pre-existing, untouched" — and untouched is the problem: a term
 * named "likely" has never been measured, and the lane's own perf evidence
 * (ms/kB by quartile, Q1 116.6 → Q4 3.64) is a COMPOSITION artifact, which the
 * same review said so.
 *
 * WHY THE LADDER IS SHAPED THIS WAY. In Rust a `function_item` cannot contain
 * another `function_item`, so a file of sibling functions costs O(file) — the
 * per-function walks are over DISJOINT subtrees and the term is harmless. The
 * case that makes them OVERLAP is legal and does occur: an `impl` block (or a
 * `const` with a block body) INSIDE a function body, because the walk from the
 * outer function descends into it. So the ladder has three arms:
 *
 *   A. N sibling functions, tiny bodies   — isolates the COUNT of functions.
 *   B. 1 function, N statements           — isolates the SIZE of one body.
 *   C. N functions, each containing an impl with N methods — the overlap case.
 *
 * A quadratic term shows up as ms/def rising with N in A or C, and flat in B.
 * Every arm is generated deterministically from a seed, so two runs measure the
 * same bytes.
 *
 * CLI: npx tsx script/m14/tmp/rust-perf-ladder.ts [--max-n=800] [--corpus=<dir>]
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/sano/ishaq/backbencher-brain"
const arg = (n: string) => process.argv.find((a: string) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const MAXN = Number(arg("max-n") ?? "800")
const CORPUS = arg("corpus") ?? "/home/sano/ishaq/bb_rust_corpora"

const ladder = (arm: "A" | "B" | "C", n: number): string => {
  const parts: string[] = []
  if (arm === "A") {
    // N sibling functions, each a handful of statements
    for (let i = 0; i < n; i++) parts.push(`pub fn f${i}(a: u32) -> u32 { let b = a + ${i}; b * 2 }`)
  } else if (arm === "B") {
    // ONE function with N statements
    const body: string[] = []
    for (let i = 0; i < n; i++) body.push(`let v${i} = a + ${i};`)
    parts.push(`pub fn one(a: u32) -> u32 { ${body.join(" ")} a }`)
  } else {
    // N functions, EACH containing an impl with N methods — the overlap case
    for (let i = 0; i < n; i++) {
      const methods: string[] = []
      for (let j = 0; j < n; j++) methods.push(`pub fn m${j}(&self, x: u32) -> u32 { x + ${j} }`)
      parts.push(`pub fn f${i}(a: u32) -> u32 { struct S${i}(u32); impl S${i} { ${methods.join(" ")} } a }`)
    }
  }
  return parts.join("\n") + "\n"
}

const SKIP = new Set([".git", "target", "tests", "test", "benches", "examples"])

async function main() {
  const mod: any = await import(path.join(ROOT, "src/ast/real-rust-analyzer.ts"))
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? (wts.default as any)?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-rust.wasm")))
  const parser = new P(); parser.setLanguage(g)

  // A single timing on a loaded box is not a measurement: the first arm-A rung
  // read 466ms and the second (TWICE the input) read 284ms, which is the JIT
  // warming up and not the analyzer. So: warm up on a real corpus file, take the
  // MEDIAN of k runs, and print min/median/max so the spread stays visible
  // instead of being averaged away.
  const walkFiles = (root: string, out: string[] = []): string[] => {
    if (out.length > 40) return out
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue
      const p = path.join(root, e.name)
      if (e.isDirectory()) walkFiles(p, out)
      else if (e.name.endsWith(".rs") && fs.statSync(p).size > 0) out.push(p)
    }
    return out
  }
  const REPS = Number(arg("reps") ?? "3")
  let warm: any = null
  {
    const cands = walkFiles(CORPUS)
    if (cands.length) { const t = fs.readFileSync(cands[0], "utf8"); for (let i = 0; i < 3; i++) warm = await new mod.RealRustAnalyzer().analyze(parser.parse(t).rootNode, t, cands[0]) }
  }
  const run = async (src: string, label: string) => {
    const root = parser.parse(src).rootNode
    const times: number[] = []
    let res: any
    for (let i = 0; i < REPS; i++) {
      const t0 = process.hrtime.bigint()
      res = await new mod.RealRustAnalyzer().analyze(root, src, `${label}.rs`)
      times.push(Number(process.hrtime.bigint() - t0) / 1e6)
    }
    const sorted = times.slice().sort((a, b) => a - b)
    const ms = sorted[Math.floor(sorted.length / 2)]
    const defs = (res.symbols ?? []).filter((s: any) => s.kind === "function" || s.kind === "method").length
    return { ms, min: sorted[0], max: sorted[sorted.length - 1], defs, bytes: src.length, syms: (res.symbols ?? []).length, rels: (res.relationships ?? []).length }
  }

  const ns = [50, 100, 200, 400, MAXN].filter((n, i, a) => a.indexOf(n) === i && n <= MAXN)
  console.log(`\n######## RUST PERF LADDER — the flagged per-function body walk, isolated`)
  for (const arm of ["A", "B", "C"] as const) {
    // arm C is quadratic in the overlap, so it is SLOW BY DESIGN; cap it so the
    // medians can actually be taken
    const armMax = arm === "C" ? Math.min(MAXN, 200) : MAXN
    const title = arm === "A" ? "N sibling functions, tiny bodies (isolates function COUNT)" : arm === "B" ? "1 function, N statements (isolates body SIZE)" : "N functions, each with an impl of N methods (the OVERLAP case)"
    console.log(`\n  ARM ${arm} — ${title}`)
    console.log("      N        bytes     defs   symbols   rels      ms    ms/def   ms/kB     spread (median of " + REPS + ")")
    let prev: { ms: number; defs: number; bytes: number } | null = null
    for (const n of ns.filter((x) => x <= armMax)) {
      const src = ladder(arm, n)
      const r = await run(src, `arm${arm}-${n}`)
      const perDef = r.defs ? r.ms / r.defs : 0
      const perKb = r.ms / (r.bytes / 1024)
      const growth = prev ? `  (x${(r.ms / prev.ms).toFixed(2)} for x${(n / (prev as any).n).toFixed(1)} N)` : ""
      console.log(`  ${String(n).padStart(6)} ${String(r.bytes).padStart(10)} ${String(r.defs).padStart(8)} ${String(r.syms).padStart(9)} ${String(r.rels).padStart(7)} ${r.ms.toFixed(1).padStart(8)} ${perDef.toFixed(4).padStart(9)} ${perKb.toFixed(1).padStart(8)}   [min ${r.min.toFixed(0)} max ${r.max.toFixed(0)}]${growth}`)
      prev = { ms: r.ms, defs: r.defs, bytes: r.bytes, n } as any
    }
  }

  // real corpus: ms/def against file size, the shape the lane's perf note says
  // it already read as composition
  const files: string[] = []
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".rs") && fs.statSync(p).size > 0) files.push(p) } }
  for (const repo of ["cargo", "tokio", "serde", "ripgrep"]) { const d = path.join(CORPUS, repo); if (fs.existsSync(d)) walk(d) }
  const withDefs: { f: string; bytes: number; defs: number }[] = []
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8")
    let root: any
    try { root = parser.parse(text).rootNode } catch { continue }
    if (root.hasError) continue
    let n = 0
    const st: any[] = [root]
    while (st.length) { const x = st.pop(); if (x.type === "function_item" || x.type === "function_signature_item") n++; for (let i = x.namedChildCount - 1; i >= 0; i--) { const c = x.namedChild(i); if (c) st.push(c) } }
    if (n > 0) withDefs.push({ f, bytes: text.length, defs: n })
  }
  withDefs.sort((a, b) => a.defs - b.defs)
  const quart = (k: number) => withDefs[Math.min(withDefs.length - 1, Math.floor((withDefs.length - 1) * k))]
  console.log(`\n  REAL CORPUS — ${withDefs.length} files, bucketed by DEFINITION COUNT (not by size, which is what made the old ms/kB read as composition)`)
  console.log("      bucket        files  median defs  median bytes      ms/def   ms/kB")
  for (let k = 0; k < 4; k++) {
    const lo = Math.floor((withDefs.length - 1) * (k / 4)), hi = Math.floor((withDefs.length - 1) * ((k + 1) / 4))
    const slice = withDefs.slice(lo, hi + 1).slice(0, 40)
    if (!slice.length) continue
    const med = (arr: number[]) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)]
    const samples: number[] = []
    for (const s of slice.slice(0, 12)) { const r = await run(fs.readFileSync(s.f, "utf8"), path.basename(s.f)); samples.push(r.ms) }
    const perDef = med(samples) / med(slice.map((s) => s.defs))
    const perKb = med(samples) / (med(slice.map((s) => s.bytes)) / 1024)
    console.log(`      Q${k + 1}          ${String(slice.length).padStart(6)} ${String(med(slice.map((s) => s.defs))).padStart(13)} ${String(med(slice.map((s) => s.bytes))).padStart(13)} ${perDef.toFixed(3).padStart(9)} ${perKb.toFixed(1).padStart(7)}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
