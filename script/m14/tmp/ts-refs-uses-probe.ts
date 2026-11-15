// typescript references/uses adjudication probe.
//
// The two oracles wired in this round (oracles/typescript-references.ts,
// oracles/typescript-uses.ts) had NEVER been registered, so typescript's
// `references` and `uses` were never measured: the allowlist dropped both labels
// and the lane reported its other labels clean. With them wired the draw surfaces
// 384 MISSING and 49 UNEXPLAINED rows, and neither side is presumed right — the
// oracles have never faced a corpus either.
//
// This probe reproduces the HARNESS's own comparison so the numbers mean the same
// thing the lane's number means:
//   - truth is compared to the analyzer by (label, normTarget(target)) ONLY, per
//     FILE; `from` is not part of the match, so a "missing" row means "no analyzer
//     edge with this label+target anywhere in this file", not "this specific edge".
//   - normTarget = lastSegment(target minus <...> minus [...).
//   - the analyzer side is deduped to one row per (label, target).
//   - UNEXPLAINED matches loosely: an analyzer row is explained if some truth row's
//     target equals normTarget(analyzer target) or CONTAINS it.
//
// The default mode is a CENSUS, not a verdict: it groups every disagreeing row by a
// shape signature so a shared root cause is visible as one row with a count, and
// prints the source lines that decide a class. Adjudication is then per class.

import fs from "node:fs"
import path from "node:path"
import { LANGS, LANG_REPOS, normTarget } from "../differential"
import { deriveTypeScriptContainsTruth } from "../oracles/typescript-contains"
import { deriveTypeScriptReferencesTruth } from "../oracles/typescript-references"
import { deriveTypeScriptUsesTruth } from "../oracles/typescript-uses"

const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS_ROOT = "/home/ishaq2321/bb_tests/repositories"

function lastSegment(name: string): string {
  const parts = name.split(/::|\./).filter(Boolean)
  return parts[parts.length - 1] ?? name
}
const norm = (t: string) => lastSegment(String(t).replace(/<.*$/, "").replace(/\[.*$/, "").trim())

const LABELS = ["references", "uses", "contains"]

function walk(dir: string, exts: string[], cap: number): string[] {
  const out: string[] = []
  const stack = [dir]
  while (stack.length && out.length <= cap) {
    const cur = stack.pop()!
    let es: fs.Dirent[]
    try { es = fs.readdirSync(cur, { withFileTypes: true }) } catch { continue }
    for (const e of es) {
      if ([".git", "node_modules", "dist", "build", "coverage", ".turbo"].includes(e.name)) continue
      const p = path.join(cur, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (exts.some((x) => e.name.endsWith(x))) out.push(p)
    }
  }
  return out.sort().slice(0, cap)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const num = (k: string, d: number) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d }
  const files_ = num("--files", 20)
  const draw = num("--draw", 15)
  const show = argv.includes("--rows")
  const target = argv.includes("--target") ? argv[argv.indexOf("--target") + 1] : null

  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", (LANGS as any).typescript.wasm)))
  const parser = new P()
  parser.setLanguage(gl)

  const mod = await import(path.join(ROOT, "src/ast", `real-typescript-analyzer.ts`))
  const analyzer = new mod.RealTypeScriptAnalyzer()

  const corpus = LANG_REPOS.typescript
  const all = walk(path.join(CORPUS_ROOT, corpus), [".ts", ".tsx"], Number.MAX_SAFE_INTEGER)
  const start = (draw * files_) % Math.max(1, all.length)
  const list: string[] = []
  for (let i = 0; i < files_ && list.length < files_; i++) list.push(all[(start + i) % all.length])

  const missing: { label: string; from: string; target: string; file: string }[] = []
  // per file, the (label|normTarget) pairs the analyzer DID publish — used to test
  // whether a MISSING row is simply published under the other label
  const publishedOther = new Map<string, Set<string>>()
  const swap = new Map<string, { label: string; from: string; target: string; file: string }[]>()
  const other: Record<string, { label: string; from: string; target: string; file: string }[]> = { references: [], uses: [] }
  // per file: the names the file IMPORTS and EXPORTS, so a MISSING row can be
  // tested for "the analyzer routed this to `imports`/`exports` instead"
  const fileSets = new Map<string, { imported: Set<string>; exported: Set<string> }>()
  const unexpl: { label: string; target: string; file: string }[] = []
  const perLabel: Record<string, { truth: number; covered: number; missing: number; unexpl: number }> = {}

  for (const f of list) {
    const src = fs.readFileSync(f, "utf8")
    let root: any
    try { root = parser.parse(src).rootNode } catch { continue }
    let res: any
    try { res = analyzer.analyze(root, src, f) } catch { continue }
    const rel = path.relative(path.join(CORPUS_ROOT, corpus), f)

    const truth: any[] = [
      ...deriveTypeScriptContainsTruth(root),
      ...deriveTypeScriptReferencesTruth(root),
      ...deriveTypeScriptUsesTruth(root),
    ].filter((e) => LABELS.includes(String(e.label)))

    // dedupe analyzer side to one row per (label, target), harness-style
    const rels = (res.relationships ?? [])
      .filter((r: any) => LABELS.includes(String(r.type ?? r.relationshipType)))
      .filter((r: any, i: number, arr: any[]) => {
        const k = String(r.type) + "|" + r.target
        return i === arr.findIndex((x: any) => String(x.type) + "|" + x.target === k)
      })

    publishedOther.set(rel, new Set(rels.map((r: any) => `${String(r.type)}|${norm(r.target)}`)))
    {
      const imported = new Set<string>()
      const exported = new Set<string>()
      // The grammar spells an imported name as `identifier` (or `type_identifier`)
      // inside `import_specifier` under `named_imports`; the module path is a
      // `string`/`string_fragment` pair and must be excluded. Verified against the
      // tree, because testing `norm(import_clause.text)` returned 0% imported while
      // the adjudicated sample was an import on every row — a broken extractor
      // reads exactly like a clean result.
      const collect = (n: any, inString: boolean): void => {
        const str = inString || n.type === "string" || n.type === "string_fragment"
        if (!str && (n.type === "identifier" || n.type === "type_identifier" || n.type === "shorthand_property_identifier")) {
          const nm = norm(n.text)
          if (nm) imported.add(nm)
        }
        for (const c of n.namedChildren ?? []) collect(c, str)
      }
      const exportNames = (n: any, inString: boolean): void => {
        const str = inString || n.type === "string" || n.type === "string_fragment"
        if (!str && (n.type === "identifier" || n.type === "type_identifier")) {
          const nm = norm(n.text)
          if (nm) exported.add(nm)
        }
        for (const c of n.namedChildren ?? []) exportNames(c, str)
      }
      for (const st of root.namedChildren ?? []) {
        if (st.type === "import_statement") collect(st, false)
        else if (st.type === "export_statement") exportNames(st, false)
      }
      fileSets.set(rel, { imported, exported })
    }
    for (const l of LABELS) perLabel[l] ??= { truth: 0, covered: 0, missing: 0, unexpl: 0 }
    for (const te of truth) {
      perLabel[te.label].truth++
      const hit = rels.some((r: any) => String(r.type) === te.label && norm(r.target) === norm(te.target))
      if (hit) perLabel[te.label].covered++
      else { perLabel[te.label].missing++; missing.push({ label: te.label, from: te.from, target: te.target, file: rel }) }
    }
    for (const r of rels) {
      const l = String(r.type)
      const hit = truth.some((te) => te.label === l && (norm(te.target) === norm(r.target) || te.target.includes(norm(r.target))))
      if (hit) continue
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      if (conf < 0.7) continue
      perLabel[l].unexpl++
      unexpl.push({ label: l, target: String(r.target), file: rel })
    }
  }

  console.log(`# typescript references/uses/contains — ${list.length} files, draw ${draw}, corpus ${corpus}\n`)
  console.log("| label | truth | covered | MISSING | UNEXPLAINED |")
  console.log("|---|---:|---:|---:|---:|")
  for (const l of LABELS) {
    const p = perLabel[l]
    console.log(`| ${l} | ${p.truth} | ${p.covered} | ${p.missing} | ${p.unexpl} |`)
  }

  // ── shape census: group disagreements by a signature that predicts the cause ──
  const sig = (row: { label: string; from: string; target: string; file: string }): string => {
    const t = row.target
    const parts = String(t).split(".")
    return `${row.label}: leaf=${parts[parts.length - 1].replace(/<.*$/, "").trim()} dotted=${parts.length > 1} angle=${t.includes("<")}`
  }
  const groups = new Map<string, { label: string; from: string; target: string; file: string }[]>()
  for (const m of missing) { const k = sig(m); (groups.get(k) ?? groups.set(k, []).get(k)!).push(m) }
  console.log(`\n## MISSING grouped by shape — ${missing.length} rows in ${groups.size} classes`)
  const ranked = [...groups].sort((a, b) => b[1].length - a[1].length).slice(0, 22)
  for (const [k, rows] of ranked) {
    console.log(`- **${rows.length}**  ${k}   e.g. ${rows[0].from} -> ${rows[0].target}   (${rows[0].file})`)
  }

  const ug = new Map<string, number>()
  for (const u of unexpl) {
    const leaf = String(u.target).split(".").pop()!
    const k = `${u.label}: dotted=${String(u.target).includes(".")} leaf=${leaf}`
    ug.set(k, (ug.get(k) ?? 0) + 1)
  }
  console.log(`\n## UNEXPLAINED grouped by shape — ${unexpl.length} rows in ${ug.size} classes`)
  for (const [k, n] of [...ug].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(`- **${n}**  ${k}`)

  // ── CROSS-LABEL RECONCILIATION ──────────────────────────────────────────
  // A mention can be PUBLISHED by the analyzer under one label while the oracle
  // derives it under the other. Matching is (label, target), so each side then
  // counts the other as a disagreement while the FILE actually agrees. The
  // analyzer publishes a type-position mention as `uses` (conf 0.9,
  // real-typescript-analyzer.ts:4776) and a value-position mention as
  // `references` (conf 0.8, :4752); the references oracle derives type mentions
  // as `references`. So this is the first thing to rule out, and it is a
  // contract question, not 352 defects.
  console.log("\n## does the other label already carry the row?")
  for (const l of LABELS) {
    const other = l === "uses" ? "references" : l === "references" ? "uses" : null
    if (!other) continue
    let same = 0
    const rest: typeof missing = []
    for (const m of missing.filter((x) => x.label === l)) {
      const hit = publishedOther.get(m.file)?.has(`${other}|${norm(m.target)}`)
      if (hit) same++
      else rest.push(m)
    }
    console.log(`- ${l} MISSING whose target IS published as ${other} in the same file: **${same}** of ${missing.filter((x) => x.label === l).length}`)
    swap.set(l, rest)
  }
  for (const l of ["references", "uses"] as const) {
    const rest = swap.get(l) ?? []
    const g = new Map<string, number>()
    for (const m of rest) {
      const isLocal = /^[a-z][A-Za-z0-9_]*$/.test(String(m.target))
      g.set(isLocal ? "lowercase identifier (looks like a local/param)" : "Capitalised or compound (looks like a type/decl)", (g.get(isLocal ? "lowercase identifier (looks like a local/param)" : "Capitalised or compound (looks like a type/decl)") ?? 0) + 1)
    }
    console.log(`- ${l}: after removing the ${l === "uses" ? "references" : "uses"} swap, ${rest.length} remain — ${[...g].map(([k, v]) => `${v} ${k}`).join("; ")}`)
  }

  // ── ROOT-CAUSE CENSUS: is the row simply routed to another label? ────────
  // The adjudicated sample above showed `references ComponentOptionsBase ->
  // SlotsType` MISSING because `SlotsType` is an IMPORT: the analyzer routes an
  // import mention to the `imports` label (which typescript's allowlist also
  // drops), while the references oracle re-derives it as `references`. If that is
  // the bulk, the 351 rows are ONE routing disagreement, not 351 defects.
  console.log("\n## root cause: is the MISSING target IMPORTED / EXPORTED in that file?")
  for (const l of ["references", "uses"] as const) {
    const rest = swap.get(l) ?? []
    let imported = 0
    let exported = 0
    const neither: typeof rest = []
    for (const m of rest) {
      const sets = fileSets.get(m.file)
      if (!sets) { neither.push(m); continue }
      if (sets.imported.has(norm(m.target))) imported++
      else if (sets.exported.has(norm(m.target))) exported++
      else neither.push(m)
    }
    const n = rest.length || 1
    console.log(`- ${l}: ${rest.length} rows after the label swap — **${imported} (${((imported/n)*100).toFixed(0)}%) imported**, ${exported} exported, ${neither.length} neither`)
    other[l] = neither
  }
  console.log("\n## the rows that are NEITHER imported nor exported — the real residue")
  for (const l of ["references", "uses"] as const) {
    const rows = other[l] ?? []
    const local = rows.filter((m) => /^[a-z_$][A-Za-z0-9_$]*$/.test(String(m.target)))
    const typey = rows.filter((m) => !/^[a-z_$][A-Za-z0-9_$]*$/.test(String(m.target)))
    console.log(`- ${l}: ${rows.length} residue — ${local.length} lowercase (local/param read), ${typey.length} type-shaped`)
    const g = new Map<string, number>()
    for (const m of local) g.set(String(m.from), (g.get(String(m.from)) ?? 0) + 1)
    console.log(`    top sources: ${[...g].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>`${k}(${v})`).join(", ")}`)
  }

  if (target) {
    console.log(`\n## source context for target \`${target}\``)
    for (const row of [...missing, ...unexpl].filter((r) => String(r.target).includes(target)).slice(0, 12)) {
      const abs = path.join(CORPUS_ROOT, corpus, (row as any).file)
      if (!fs.existsSync(abs)) continue
      const lines = fs.readFileSync(abs, "utf8").split("\n")
      const idx = lines.findIndex((l) => l.includes(String(target)))
      console.log(`\n--- ${(row as any).label}  ${(row as any).from ?? ""} -> ${row.target}   ${(row as any).file}:${idx + 1}`)
      for (let i = Math.max(0, idx - 2); i < Math.min(lines.length, idx + 3); i++) {
        console.log(`  ${String(i + 1).padStart(5)} | ${lines[i].slice(0, 150)}`)
      }
    }
  }
  if (show) {
    console.log("\n## every MISSING row")
    for (const m of missing) console.log(`  ${m.label}  ${m.from} -> ${m.target}   ${m.file}`)
    console.log("\n## every UNEXPLAINED row")
    for (const u of unexpl) console.log(`  ${u.label}  -> ${u.target}   ${u.file}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })