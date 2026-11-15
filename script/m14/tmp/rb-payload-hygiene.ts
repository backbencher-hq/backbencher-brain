/**
 * RUBY LANE — payload hygiene census (M60 deep round 5).
 *
 * The user-facing question this answers is "no unknown symbols". That is two
 * different defects wearing one name, and only one of them is about node types:
 *
 *   A. an UNKNOWN NODE TYPE — a literal the analyzer compares against a node type
 *      the grammar does not have, i.e. a branch that can never match. M14.0.F1
 *      audits this and, since the round-1 fix, audits ALL 60 of the file's
 *      comparisons. `rb-f1-vacuity-probe.ts` re-derives that independently.
 *
 *   B. an UNKNOWN SYMBOL — a symbol or relationship the analyzer PUBLISHES whose
 *      NAME names nothing: a sentinel, a placeholder, an empty string, a path
 *      fragment, a template, or a name that survives normalisation when it should
 *      have been rejected. R7's `SYMBOL_NAME_DENYLIST` exists for this and the
 *      lane's own header calls `"unknown"` "the second spelling" of a role that
 *      was fixed once and regressed. NOTHING in this lane's history has swept the
 *      published payload for these over a real corpus.
 *
 * This instrument sweeps B over the whole corpus and reports every class it
 * finds, with the offending value and one site each. A name that appears here is
 * a name a consumer of the graph would resolve and fail to find.
 */
import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..", "..")

/**
 * Names that must never reach a consumer. Each entry is a CLAIM about what the
 * analyzer believes, and each was read off the file rather than assumed:
 *
 *  empty / whitespace  — a symbol whose name carries no token at all
 *  "unknown"           — R7's denylist sentinel; the file's header records it as
 *                        the SECOND spelling of the file-scope owner, which is
 *                        exactly how a placeholder gets reintroduced
 *  "Global"            — the DECLARED file-scope owner, which is a real graph
 *                        node, so it is legal as a relationship SOURCE and
 *                        illegal as a symbol NAME
 *  template fragments  — a name still carrying `#{` / `#{}` (R8)
 *  non-leaf paths      — a class/module name still carrying `::` (FIX-7)
 *  raw quote/colons    — a name that escaped its stripping, e.g. `:orders` or
 *                        `"orders"` where the contract says `orders`
 *  dotted receivers    — a `calls` target that is a whole expression rather than
 *                        a method name
 */
/**
 * Names that must never reach a consumer. Each entry is a CLAIM about what the
 * analyzer believes, read off the file rather than assumed -- and each names the
 * labels it is legitimate for, because two of the first three classes this
 * instrument reported were the INSTRUMENT's fault, not the analyzer's:
 *
 *   `dotted` fired 1,089 times on `overrides` targets like `Base.run`, which is
 *   the analyzer's DOCUMENTED contract (`target: ${base}.${method}`) -- the test
 *   was written for `calls` targets and applied to every label.
 *   `path-fragment` fired 141 times on `references` targets like
 *   `unicode/display_width`, which is a require path verbatim -- also the
 *   documented contract, and the same shape the c lane's `imports` kind uses.
 *
 * A hygiene check that flags the contract is worse than none, because it trains
 * a reader to dismiss the report. So every class is scoped to the labels where
 * the shape is actually wrong.
 */
interface NameClass { id: string; test: (n: string) => boolean; why: string; labels?: string[]; symbolsOnly?: boolean }

const NAME_CLASSES: NameClass[] = [
  { id: "empty", test: (n) => n.trim().length === 0, why: "a symbol whose name carries no token" },
  // `sentinel-unknown` is RETIRED, deliberately and with a count to back it.
  //
  // The class existed because `unknown` was two things at once: the R7 denylist
  // sentinel, and the file-scope owner's second spelling. BOTH roles are gone,
  // removed by this lane's own fixes rather than by anything upstream:
  //
  //   - the file-scope owner was UNIFIED on `Global` (one owner name, so
  //     `unknown` no longer named one), and
  //   - `SYMBOL_NAME_DENYLIST` denied `unknown` in EVERY language, deleting
  //     `ActiveSupport::Logger#unknown`; that entry was moved to the
  //     fallback-gated set where the file's own rationale puts it.
  //
  // So `unknown` is now an ordinary identifier, and the class could only produce
  // false positives. It did, and the tally fix above is what made them visible:
  // 13 occurrences in 6 files, every one hand-checked and every one REAL.
  //
  //   colorize_logging.rb:46   def unknown(progname = nil, &block)   the method
  //   colorize_logging.rb:47   logger.unknown(progname, &block)       Logger severity 5
  //   proxy_logger.rb:234      def unknown(...) + logger.unknown(...) the same
  //   collector_test.rb:81     collector.unknown                     a real method
  //   active_record_schema_test.rb:102  t.unknown :color             ActiveRecord DSL
  //   broadcast_logger_test.rb:118      logger.unknown "from unknown" Logger severity 5
  //
  // Deleting the class is the honest result rather than a suppression: the
  // property it was checking is now held by construction — there is no `unknown`
  // sentinel left to find — so a class that fires only on correct output is
  // noise that trains its reader to ignore the probe.
  { id: "sentinel-global-as-name", test: (n) => n === "Global", why: "the declared file-scope owner is a graph node, never a symbol name", symbolsOnly: true },
  { id: "template-fragment", test: (n) => n.includes("#{"), why: "an interpolation template is not a name" },
  { id: "non-leaf-path", test: (n) => n.includes("::"), why: "a class/module name should be a leaf; `::` means the split failed", symbolsOnly: true },
  { id: "raw-colon-prefix", test: (n) => /^:/.test(n), why: "a symbol literal whose colon was not stripped" },
  { id: "raw-quote", test: (n) => /^["']|["']$/.test(n), why: "a quoted string whose quotes were not stripped" },
  { id: "whitespace-inside", test: (n) => /\s/.test(n), why: "a name carrying whitespace is a phrase, not a name" },
  // Scoped: `overrides` targets are `Base.method` by contract, and `references`
  // targets are require paths by contract, so a dot or a slash is only wrong
  // where a METHOD NAME is expected.
  { id: "dotted", test: (n) => n.includes("."), why: "a call target that is an expression, not a method name", labels: ["calls", "instantiates"] },
  { id: "path-fragment", test: (n) => n.includes("/"), why: "a path where a method name belongs", labels: ["calls", "instantiates"] },
  { id: "paren-in-name", test: (n) => n.includes("(") || n.includes(")"), why: "a name carrying call syntax" },
]

function listRubyFiles(root: string): string[] {
  const out: string[] = []
  const skip = new Set([".git", "node_modules", "vendor", "tmp", "log"])
  const walk = (d: string) => {
    let ents: fs.Dirent[]
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (e.name.startsWith(".")) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (!skip.has(e.name)) walk(p) }
      else if (e.isFile() && e.name.endsWith(".rb")) out.push(p)
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
  let files: string[] = []
  for (const r of roots) files = files.concat(listRubyFiles(path.resolve(r)))
  if (Number.isFinite(LIMIT) && files.length > LIMIT) {
    const stride = files.length / LIMIT
    files = Array.from({ length: LIMIT }, (_, i) => files[Math.floor(i * stride)])
  }

  const hits = new Map<string, { count: number; samples: any[]; files: Set<string> }>()
  let symbols = 0, rels = 0, parseErrors = 0
  for (const f of files) {
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    let tree: any
    try { tree = parser.parse(content) } catch { parseErrors++; continue }
    let res: any
    try { res = new RealRubyAnalyzer().analyze(tree.rootNode, content, f) } catch { parseErrors++; continue }
    const rel = path.relative(roots[0], f)
    for (const s of res.symbols ?? []) {
      symbols++
      const n = String(s.name ?? "")
      for (const c of NAME_CLASSES) {
        if (c.symbolsOnly === false || c.labels) continue
        if (!c.test(n)) continue
        const h = hits.get(c.id) ?? { count: 0, samples: [], files: new Set<string>() }
        h.count++; h.files.add(rel)
        if (h.samples.length < 6) h.samples.push({ file: rel, line: s.range?.startLine, kind: s.kind, name: n, owner: s.ownerName })
        hits.set(c.id, h)
      }
    }
    for (const r of res.relationships ?? []) {
      rels++
      // A relationship's TARGET is a name a consumer resolves; its SOURCE may
      // legitimately be the declared file-scope owner, so the source is only
      // checked for the classes that are never legitimate anywhere.
      const t = String(r.target ?? "")
      for (const c of NAME_CLASSES) {
        if (c.symbolsOnly) continue
        if (c.labels && !c.labels.includes(String(r.type ?? ""))) continue
        if (!c.test(t)) continue
        const key = `rel:${c.id}`
        const h = hits.get(key) ?? { count: 0, samples: [], files: new Set<string>() }
        h.count++; h.files.add(rel)
        if (h.samples.length < 6) h.samples.push({ file: rel, line: r.line_number, type: r.type, source: r.source, target: t })
        hits.set(key, h)
      }
    }
  }

  console.log(`corpus: ${roots.join(", ")}   files=${files.length}   symbols=${symbols}   relationships=${rels}   errors=${parseErrors}`)
  // A class can be hit by SYMBOLS and by relationship TARGETS, and the two live
  // under different map keys. `hits.get(c.id) ?? hits.get("rel:"+c.id)` reported
  // only the symbol one whenever both existed, so the header said 13 while the
  // per-class line and the EVIDENCE JSON said 3 - the same 10 occurrences counted
  // once and then dropped from the committed artifact. Declared here, ABOVE the
  // zero check, because the clean path needs the same aggregate for its evidence.
  const found = NAME_CLASSES.map((c) => {
    const sym = hits.get(c.id)
    const rel = hits.get(`rel:${c.id}`)
    return { c, sym, rel, count: (sym?.count ?? 0) + (rel?.count ?? 0),
      files: new Set([...(sym?.files ?? []), ...(rel?.files ?? [])]).size,
      samples: [...(sym?.samples ?? []), ...(rel?.samples ?? [])] }
  }).filter((x) => x.count > 0)
  const totalAll = found.reduce((a, x) => a + x.count, 0)
  const total = [...hits.values()].reduce((a, h) => a + h.count, 0)
  if (total === 0) {
    console.log("no unknown/placeholder names in the published payload")
  } else {
    // A class can be hit by SYMBOLS and by relationship TARGETS, and the two live
    // under different map keys. `hits.get(c.id) ?? hits.get("rel:"+c.id)` reported
    // only the symbol one whenever both existed, so the header said 13 and the
    // per-class line and the EVIDENCE JSON said 3 — the same 10 occurrences, twice
    // counted as one class and then dropped from the committed artifact. The class
    // was `sentinel-unknown`: 3 real `def unknown` methods and 10 `calls -> unknown`
    // edges, of which the JSON showed none.
    //
    // The header also printed `hits.size` — a count of map ENTRIES, not of classes
    // found — so "2 of 11 possible" described two keys belonging to one class.
    console.log(`\nCLASSES FOUND (${found.length} of ${NAME_CLASSES.length} possible, ${totalAll} occurrences):\n`)
    for (const x of found) {
      const symN = x.sym?.count ?? 0, relN = x.rel?.count ?? 0
      console.log(`${x.c.id}  ${x.count} occurrences in ${x.files} files  (${symN} as a symbol name, ${relN} as a relationship target)`)
      console.log(`   why: ${x.c.why}`)
      for (const s of x.samples) console.log(`   ${s.file}${s.line ? ":" + s.line : ""}  ${JSON.stringify(s)}`)
    }
    if (total !== totalAll) console.log(`\n  NOTE: raw map sum ${total} vs per-class sum ${totalAll} — these were meant to be equal.`)
  }
  fs.writeFileSync(
    path.join(ROOT, "validation", "m60", "results", "ruby-payload-hygiene.json"),
    JSON.stringify({
      generatedAt: new Date().toISOString(), corpus: roots, files: files.length, symbols, relationships: rels, errors: parseErrors,
      classes: NAME_CLASSES.map((c) => {
        const sym = hits.get(c.id), rel = hits.get(`rel:${c.id}`)
        return { id: c.id, why: c.why,
          count: (sym?.count ?? 0) + (rel?.count ?? 0),
          asSymbol: sym?.count ?? 0, asRelationshipTarget: rel?.count ?? 0,
          files: new Set([...(sym?.files ?? []), ...(rel?.files ?? [])]).size,
          samples: [...(sym?.samples ?? []), ...(rel?.samples ?? [])] }
      }),
      summary: { classesFound: found.length, occurrences: totalAll, rawMapSum: total },
    }, null, 2),
  )
}

main()
