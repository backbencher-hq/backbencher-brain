// Adjudicate the Dart `contains` disagreement.
//
// The oracle went in and immediately split the lane in two: dart-http reads 99.7%
// with MISSING=1, while proxicall reads 100% covered but 1,579 analyzer `contains`
// rows with no truth counterpart (64.7% of the label). A 100%-covered / 64.7%-unexplained
// row is a specific shape — the analyzer publishing containment my rule does not
// derive — so this asks what those rows actually are instead of guessing.
//
// Three questions, in order:
//   1. which container shapes produce analyzer rows the oracle misses
//   2. is there a family here, or is it a long tail
//   3. for one worked example, is the ANALYZER right and the oracle short — or the
//      reverse? That decides which side moves, and it is the only question that
//      matters.

import fs from "node:fs"
import path from "node:path"
import { deriveDartContainsTruth } from "../oracles/dart-contains"
import { LANGS, LANG_REPOS, normTarget } from "../differential"

const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "<corpus-root>/bb_tests/repositories"

function walk(dir: string, exts: string[], cap: number): string[] {
  const out: string[] = []
  const stack = [dir]
  while (stack.length && out.length <= cap) {
    const cur = stack.pop()!
    let es: fs.Dirent[]
    try { es = fs.readdirSync(cur, { withFileTypes: true }) } catch { continue }
    for (const e of es) {
      if ([".git", "node_modules", "dist", "build", "target", ".dart_tool"].includes(e.name)) continue
      const p = path.join(cur, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (exts.some((x) => e.name.endsWith(x))) out.push(p)
    }
  }
  // STRIDE, not head. Taking the first N in sorted order put this probe entirely
  // inside proxicall's `_dev/` one-off scripts — files with no class declarations —
  // so it derived 43 truth rows over 60 files while the differential's rotating
  // cold pool derived 402 over 15. The instrument was sampling the wrong part of
  // the corpus and reporting it as agreement.
  out.sort()
  if (out.length <= cap) return out
  const stride = Math.max(1, Math.floor(out.length / cap))
  const picked: string[] = []
  for (let i = 0; i < out.length && picked.length < cap; i += stride) picked.push(out[i])
  return picked
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const corpusName = argv[0] ?? "proxicall"
  const per = Number(argv[1] ?? 12)
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const cfg: any = (LANGS as any).dart
  const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
  const parser = new P()
  parser.setLanguage(gl)
  const mod = await import(path.join(ROOT, "src/ast", `${cfg.analyzerFile}.ts`))
  const analyzer = new (mod as any)[cfg.className]()

  const exts = String(cfg.ext).split(",").map((e) => `.${e.trim()}`)
  const files = walk(path.join(CORPUS, corpusName), exts, per)
  const dir = path.join(CORPUS, corpusName)

  const analyzerOnly: { from: string; to: string; file: string }[] = []
  const truthOnly: { from: string; to: string; file: string }[] = []
  const both = new Set<string>()
  const truthKeys = new Set<string>()
  let harnessCollapsed = 0

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    let root: any
    try { root = parser.parse(src).rootNode } catch { continue }
    let res: any
    try { res = analyzer.analyze(root, src, f) } catch { continue }
    const rel = path.relative(dir, f)
    const truth = deriveDartContainsTruth(root)
    for (const t of truth) truthKeys.add(`${t.from}|${t.target}`)
    // harness semantics: analyzer side deduped to one row per (label,target)
    // Two views, because they differ and the difference IS a finding.
    //
    // `relsByOwnerTarget` is the relationship's real identity (owner -> member).
    //
    // `relsHarnessKeyed` reproduces differential.ts, which dedupes the analyzer
    // side to one row per (label, target) — target ONLY, no owner. Two classes that
    // each declare a `build` therefore collapse to a single row and the second is
    // unmatchable. That is a pre-existing property of the comparison, not of the
    // oracle, and it is invisible unless you count it.
    const all = (res.relationships ?? []).filter((r: any) => String(r.type) === "contains")
    const relsHarnessKeyed = all.filter((r: any, i: number, arr: any[]) => {
      const k = String(r.target)
      return i === arr.findIndex((x: any) => String(x.target) === k)
    })
    const rels = all.filter((r: any, i: number, arr: any[]) => {
      const k = `${String(r.source)}|${String(r.target)}`
      return i === arr.findIndex((x: any) => `${String(x.source)}|${String(x.target)}` === k)
    })
    for (let i = 0; i < all.length; i++) if (relsHarnessKeyed.length < all.length) { harnessCollapsed++ ; break }
    for (const r of rels) {
      const k = `${r.source}|${r.target}`
      if (truthKeys.has(k)) { both.add(k); continue }
      analyzerOnly.push({ from: String(r.source), to: String(r.target), file: rel })
    }
    for (const t of truth) {
      const k = `${t.from}|${t.target}`
      if (!rels.some((r: any) => String(r.source) === t.from && String(r.target) === t.target)) {
        truthOnly.push({ from: t.from, to: t.target, file: rel })
      }
    }
  }

  console.log(`# dart contains adjudication — ${files.length} files from ${corpusName}\n`)
  console.log(`- truth rows: ${truthKeys.size}`)
  console.log(`- agreed: ${both.size}`)
  console.log(`- **analyzer-only (no truth): ${analyzerOnly.length}**`)
  console.log(`- truth-only (no analyzer): ${truthOnly.length}`)
  console.log(`- files where the harness's target-only dedup collapsed rows: ${harnessCollapsed}`)

  // what do the owner names look like? a top-level owner would explain everything
  //
  // Character classes, without a regex. These four predicates were `/^[a-z]/`,
  // `/^constructor$/`, `/\$\d+$/` and `/^[a-z_][A-Za-z0-9_]*$/` — the shape a name
  // has is a property of the STRING, not of the grammar, and a lane that publishes
  // an edge from a regex has replaced a parse fact with a text guess. Here they
  // classify printed diagnostics, so the cost was low; the rule is the same one the
  // analyzer is held to, and it is cheaper to hold a scratch script to it than to
  // re-derive which files were exempt.
  const isLowerStart = (s: string): boolean => s.length > 0 && s[0] >= "a" && s[0] <= "z"
  const isUpperStart = (s: string): boolean => s.length > 0 && s[0] >= "A" && s[0] <= "Z"
  const isIdent = (s: string): boolean => {
    if (s.length === 0) return false
    const head = s[0]
    if (!((head >= "a" && head <= "z") || head === "_")) return false
    for (let i = 1; i < s.length; i++) {
      const c = s[i]
      const alnum = (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9")
      if (!alnum && c !== "_") return false
    }
    return true
  }
  /** The trailing `$N` overload suffix, or "" when the name does not carry one.
   *  The digit run comes FIRST and the `$` is checked behind it — the name ends in a
   *  digit, not in the sigil. Reading it the other way round (`endsWith("$")`)
   *  returned "" for every real suffix, so every truth-only row would have been
   *  classified "other:" and the overload family would have read as absent. Found by
   *  running the replacement beside the regex over 18 names and diffing, which is the
   *  only reason this is known rather than assumed. */
  const overloadSuffix = (s: string): string => {
    let i = s.length
    while (i > 0 && s[i - 1] >= "0" && s[i - 1] <= "9") i--
    if (i === s.length || i === 0) return ""
    return s[i - 1] === "$" ? s.slice(i - 1) : ""
  }
  /** The name with any trailing `$N` removed — the un-suffixed spelling to look for
   *  in the source line, since no declaration is written `foo$1`. */
  const stripOverload = (s: string): string => {
    const suf = overloadSuffix(s)
    return suf.length > 0 ? s.slice(0, s.length - suf.length) : s
  }

  const owners = new Map<string, number>()
  for (const r of analyzerOnly) owners.set(r.from, (owners.get(r.from) ?? 0) + 1)
  const shape = (o: string): string => {
    if (o === "" || o === "-") return "empty/dash owner"
    if (isLowerStart(o)) return "lowercase owner (a LOCAL or top-level construct)"
    if (o.includes(".")) return "dotted owner"
    return "Capitalised owner (a declared type)"
  }
  const byShape = new Map<string, number>()
  for (const o of owners.keys()) byShape.set(shape(o), (byShape.get(shape(o)) ?? 0) + 1)
  console.log(`\n## analyzer-only rows by OWNER shape`)
  for (const [k, v] of [...byShape].sort((a, b) => b[1] - a[1])) console.log(`- ${v} distinct owners: ${k}`)

  console.log(`\n## top analyzer-only owners`)
  for (const [k, v] of [...owners].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(v).padStart(4)}  ${k}`)

  console.log(`\n## worked examples`)
  // the biggest owner first — a family, not a lone row
  const topOwner = [...owners].sort((a, b) => b[1] - a[1])[0]?.[0]
  const shown = analyzerOnly.filter((r) => r.from === topOwner).slice(0, 10)
  console.log(`  (owner \`${topOwner}\`, ${owners.get(topOwner)} rows)`)
  for (const r of shown) {
    const abs = path.join(dir, r.file)
    let ctx = ""
    try {
      const lines = fs.readFileSync(abs, "utf8").split("\n")
      const i = lines.findIndex((l) => l.includes(r.to))
      if (i >= 0) ctx = `  |${lines[i].trim().slice(0, 88)}`
    } catch {}
    console.log(`  ${r.from} -> ${r.to}${ctx}`)
  }
  if (truthOnly.length) {
    console.log(`\n## truth-only — the oracle claiming containment the analyzer does not publish`)
    const shapes = new Map<string, number>()
    for (const r of truthOnly) {
      const k = r.to === "constructor" ? "constructor"
        : overloadSuffix(r.to) ? "overload-suffixed ($N)"
        : isUpperStart(r.to) ? "Capitalised member (a TYPE?)"
        : isIdent(r.to) ? "lowercase member (a method/field)"
        : "other: " + r.to
      shapes.set(k, (shapes.get(k) ?? 0) + 1)
    }
    for (const [k, v] of [...shapes].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${String(v).padStart(5)}  ${k}`)
    console.log(`  --- examples ---`)
    for (const r of truthOnly.slice(0, 10)) {
      const abs = path.join(dir, r.file)
      let ctx = ""
      try {
        const lines = fs.readFileSync(abs, "utf8").split("\n")
        const i = lines.findIndex((l) => l.includes(stripOverload(r.to)))
        if (i >= 0) ctx = `  |${lines[i].trim().slice(0, 80)}`
      } catch {}
      console.log(`  ${r.from} -> ${r.to}${ctx}`)
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })