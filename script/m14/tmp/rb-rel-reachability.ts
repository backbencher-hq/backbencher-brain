/**
 * RUBY LANE — relationship-type reachability census (M60 deep round 6).
 *
 * The question this answers is not "does the analyzer emit type X" — that has
 * been measured four times over. It is the question a consumer actually faces:
 *
 *   of the relationships the analyzer emits, how many of each TYPE can a graph
 *   query actually RETURN?
 *
 * Two filters stand between an emitted edge and a consumer, and both are silent:
 *
 *   1. TYPE. `graph-engine.ts` defaults `relTypes` to
 *      `["calls","instantiates","extends","implements"]` and puts
 *      `relationship_type IN (...)` in the traversal SQL. Every other type is
 *      excluded before the query runs. Measured on this corpus: 22.2% of emitted
 *      relationships. `contains` is the parent->member edge, so a traversal from
 *      a class cannot reach its methods under that default.
 *   2. RESOLUTION. Every graph query requires `source_symbol_id IS NOT NULL AND
 *      target_symbol_id IS NOT NULL`. An edge whose target names no symbol is
 *      stored unresolved and is invisible to every graph path — which for
 *      `references` (a require PATH) and `contains` (a member NAME) is the
 *      normal case, not an edge case.
 *
 * The two compose: a type can be emitted in bulk and still be almost entirely
 * unreachable. This instrument measures the PRODUCT, per type, because that is
 * the number a consumer experiences.
 */
import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..", "..")

/**
 * graph-engine.ts's DEFAULT_REL_TYPES, PARSED OUT OF THE FILE.
 *
 * The first version of this instrument hardcoded the list. That is precisely
 * the drift this round has been about — an instrument that restates a constant
 * keeps reporting the OLD number after the constant changes, which is how a
 * fixed defect stays on the books. The traversal is the thing being measured, so
 * the traversal's own default is the source.
 */
function readDefaultRelTypes(): string[] {
  const src = fs.readFileSync(path.join(ROOT, "src", "intelligence", "graph", "graph-engine.ts"), "utf8")
  const m = src.match(/const DEFAULT_REL_TYPES = \[([\s\S]*?)\]/)
  if (!m) throw new Error("could not find DEFAULT_REL_TYPES in graph-engine.ts")
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
}
const DEFAULT_REL_TYPES = new Set(readDefaultRelTypes())
/** Every distinct value of ASTEngine.RelationshipType. */
const ALL_TYPES = ["calls", "extends", "implements", "uses", "instantiates", "overrides", "contains", "references", "imports", "exports"]

function list(root: string): string[] {
  const out: string[] = []
  const skip = new Set([".git", "node_modules", "vendor", "tmp", "log"])
  const walk = (d: string) => {
    let e: fs.Dirent[]
    try { e = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const x of e) {
      if (x.name.startsWith(".")) continue
      const p = path.join(d, x.name)
      if (x.isDirectory()) { if (!skip.has(x.name)) walk(p) }
      else if (x.name.endsWith(".rb")) out.push(p)
    }
  }
  walk(root)
  return out.sort()
}

async function main() {
  const { RealRubyAnalyzer } = await import(path.join(ROOT, "src", "ast", "real-ruby-analyzer.ts"))
  await Parser.init()
  const lang = await Language.load(path.join(ROOT, "wasm", "tree-sitter-ruby.wasm"))
  const parser = new Parser()
  parser.setLanguage(lang as any)

  const limitAt = process.argv.indexOf("--limit")
  const LIMIT = limitAt >= 0 ? parseInt(process.argv[limitAt + 1]) : Infinity
  const roots = process.argv.slice(2).filter((a, i) => !a.startsWith("--") && !(i > 0 && process.argv[i - 1] === "--limit"))
  let allFiles: string[] = []
  for (const r of roots) allFiles = allFiles.concat(list(path.resolve(r)))

  // Pass 1 — every symbol name the WHOLE CORPUS declares.
  //
  // This used to index only the files this run PARSES, which made every
  // per-type rate a SAMPLE rate: a call into an unsampled file scored as
  // unresolved. Measured, on 1,200 of 8,528 files:
  //
  //     calls       43.9%  (8,838 names)  ->  72.7%  (49,779 names)
  //     implements  25.0%  (sample)        ->  99.5%  (checked against the
  //                                               4,613 `module X` sites)
  //
  // 28.8 points and 74.5 points respectively, produced entirely by the
  // denominator. The corpus is the denominator; only the PARSING is sampled.
  // A reachability number is a claim about the project, not about the sample.
  const declaredNames = new Set<string>()
  const declaredQualified = new Set<string>()
  for (const f of allFiles) {
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    if (content.length > 400_000) continue
    let tree: any
    try { tree = parser.parse(content) } catch { continue }
    let res: any
    try { res = new RealRubyAnalyzer().analyze(tree.rootNode, content, f) } catch { continue }
    for (const s of res.symbols ?? []) {
      declaredNames.add(String(s.name))
      if (s.ownerName) declaredQualified.add(`${s.ownerName}.${s.name}`)
    }
    tree = null
  }

  // Pass 2 — the relationships themselves, over the strided sample.
  let files = allFiles
  if (Number.isFinite(LIMIT) && files.length > LIMIT) {
    const stride = files.length / LIMIT
    files = Array.from({ length: LIMIT }, (_, i) => files[Math.floor(i * stride)])
  }
  const results: any[] = []
  for (const f of files) {
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    let tree: any
    try { tree = parser.parse(content) } catch { continue }
    let res: any
    try { res = new RealRubyAnalyzer().analyze(tree.rootNode, content, f) } catch { continue }
    results.push({ res, file: path.relative(roots[0], f) })
  }

  const byType = new Map<string, { total: number; resolvedTarget: number; resolvedSource: number; visible: number; visibleUnderDefault: number; unreachableUnderDefault: number }>()
  for (const t of ALL_TYPES) byType.set(t, { total: 0, resolvedTarget: 0, resolvedSource: 0, visible: 0, visibleUnderDefault: 0, unreachableUnderDefault: 0 })
  let total = 0, reachableAtAll = 0, reachableUnderDefault = 0

  for (const { res } of results) {
    for (const r of res.relationships ?? []) {
      const ty = String(r.type ?? "")
      const row = byType.get(ty)
      if (!row) continue
      total++; row.total++
      const tgt = String(r.target ?? "")
      const src = String(r.source ?? "")
      const leaf = tgt.includes("::") ? tgt.slice(tgt.lastIndexOf("::") + 2) : tgt
      const tMember = leaf.split(".").pop() ?? leaf
      const tOk = declaredNames.has(tgt) || declaredNames.has(leaf) || declaredNames.has(tMember) || declaredQualified.has(tgt)
      const sLeaf = src.split(".").pop() ?? src
      const sOk = src === "Global" || declaredNames.has(src) || declaredNames.has(sLeaf)
      if (tOk) row.resolvedTarget++
      if (sOk) row.resolvedSource++
      const visible = tOk && sOk
      if (visible) { reachableAtAll++; row.visible++ }
      if (visible && DEFAULT_REL_TYPES.has(ty)) { reachableUnderDefault++; row.visibleUnderDefault++ }
      if (!visible || !DEFAULT_REL_TYPES.has(ty)) row.unreachableUnderDefault++
    }
  }

  // Two different denominators, and conflating them is what made the previous
  // version of this table unreadable. SHARE is a column's weight in the whole
  // payload; RATE is that column measured against its OWN type. The old `pct`
  // used the global total for both, so the column headed "target resolves"
  // printed calls at 32.3% when 32,635 of 74,372 calls resolve — 43.9% — and
  // a reader comparing columns across rows was comparing different fractions.
  const share = (n: number) => total === 0 ? "  -  " : ((n / total) * 100).toFixed(1).padStart(6) + "%"
  const rate = (n: number, d: number) => d === 0 ? "  -  " : ((n / d) * 100).toFixed(1).padStart(6) + "%"
  console.log(`corpus: ${roots.join(", ")}  parsed=${files.length} of ${allFiles.length}  declared symbols (CORPUS-wide)=${declaredNames.size}`)
  console.log(`graph default (read from graph-engine.ts): ${[...DEFAULT_REL_TYPES].sort().join(", ")}`)
  console.log(`relationships emitted=${total}\n`)
  console.log(`SHARE = weight in the whole payload.  RATE = that column against its OWN type.`)
  console.log(`\ntype          emitted   share   target resolves    rate    VISIBLE (both)     rate   visible under default     rate`)
  for (const t of ALL_TYPES) {
    const r = byType.get(t)!
    if (r.total === 0) { console.log(`  ${t.padEnd(12)}      0`); continue }
    // The true intersection, counted rather than inferred. The previous line was
    // `r.resolvedTarget && r.resolvedSource ? r.total : r.resolvedTarget`, which
    // returned `r.total` — the whole emitted count — whenever both endpoints had
    // ANY resolvable edge, so `calls` reported 74,372 visible against 32,635
    // resolvable. The TOTAL line was always right (it counted edges, not types);
    // only the per-type column was invented, which is why the table contradicted
    // its own footer.
    console.log(
      `  ${t.padEnd(12)} ${String(r.total).padStart(7)} ${share(r.total)}` +
      `   ${String(r.resolvedTarget).padStart(7)} ${share(r.resolvedTarget)} ${rate(r.resolvedTarget, r.total)}` +
      `   ${String(r.visible).padStart(8)} ${share(r.visible)} ${rate(r.visible, r.total)}` +
      `   ${String(r.visibleUnderDefault).padStart(8)} ${share(r.visibleUnderDefault)} ${rate(r.visibleUnderDefault, r.total)}`,
    )
  }
  // The per-type visible column must now sum to the footer, or one of them is
  // still lying. Asserted rather than trusted.
  const visSum = [...byType.values()].reduce((a, r) => a + r.visible, 0)
  const defSum = [...byType.values()].reduce((a, r) => a + r.visibleUnderDefault, 0)
  if (visSum !== reachableAtAll || defSum !== reachableUnderDefault) {
    console.log(`\n  INSTRUMENT SELF-CHECK FAILED: per-type visible sums to ${visSum} but the footer says ${reachableAtAll}` +
      `; under-default sums to ${defSum} but the footer says ${reachableUnderDefault}. One of the two is wrong.`)
  } else {
    console.log(`\n  instrument self-check: per-type columns sum to the footer (${visSum} / ${defSum}).`)
  }
  console.log(`\n  TOTAL emitted ${total}   visible at all ${reachableAtAll} (${((reachableAtAll / total) * 100).toFixed(1)}%)` +
    `   visible under the DEFAULT graph filter ${reachableUnderDefault} (${((reachableUnderDefault / total) * 100).toFixed(1)}%)`)
  console.log(`  => ${((1 - reachableUnderDefault / total) * 100).toFixed(1)}% of emitted relationships cannot be returned by a graph query that does not pass \`relationshipTypes\`.`)

  fs.writeFileSync(
    path.join(ROOT, "validation", "m60", "results", "ruby-rel-reachability.json"),
    JSON.stringify({
      generatedAt: new Date().toISOString(), corpus: roots, files: files.length, declaredSymbols: declaredNames.size,
      emitted: total, visibleAtAll: reachableAtAll, visibleUnderDefault: reachableUnderDefault,
      defaultRelTypes: [...DEFAULT_REL_TYPES],
      byType: Object.fromEntries([...byType.entries()].filter(([, v]) => v.total > 0)),
    }, null, 2),
  )
}

main()
