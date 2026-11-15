/**
 * NIM ACCENT-QUOTED ENDPOINT CENSUS — how many edges the production filter deletes.
 *
 * ## The defect this measures
 *
 * `src/ast/pool-worker.ts` exports `filterNoiseRelationships`, which every
 * relationship passes through on the way out of `parseFile`. One of its rules is
 *
 *     if (/[{}`<>\n\r\t]/.test(leaf)) return false
 *
 * and the comment above it explains why: in JavaScript a backtick in a target is
 * template-literal garbage. But in **Nim the backtick is the accent-quoted
 * IDENTIFIER syntax** — `proc \`-!\``, `proc \`==\``, `func \`$\`` are how every
 * operator overload is written, and they are among the most ordinary
 * declarations in the language. So the filter deletes every Nim relationship
 * whose endpoint is an accent-quoted operator, while the SYMBOL is published
 * normally (symbols are not filtered).
 *
 * The result is a declaration the graph holds and can never be reached by an
 * edge: `bb_impact` on `` `-!` `` returns nothing because no edge names it, and
 * the reverse walk cannot distinguish that from a declaration nobody uses.
 *
 * ## Why two numbers
 *
 * The POST number comes from production `parseFile`. The PRE number comes from
 * `analyze()` driven through the shared harness's own `getParser`, because the
 * filter runs strictly between the two and the difference between them IS the
 * measurement. Labelling both is the point: quoting only the POST number would
 * report the filter's opinion as if it were the analyzer's, which is the exact
 * confusion this script exists to prevent.
 *
 * `filterNoiseRelationships` is applied directly to the PRE set as well, so the
 * script attributes the loss to that function rather than inferring it from the
 * difference between two pipelines that could differ for other reasons.
 *
 * ## Method
 *
 * No text matching on the language: accent quoting is read off the tree. A
 * declared name is accent-quoted when its `name` field is an `accent_quoted`
 * node, or when the name field is an `exported_symbol` whose first named child
 * is one.
 *
 * READ-ONLY. Writes nothing except an optional JSON path in argv[2].
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { filterNoiseRelationships } from "../../../../src/ast/pool-worker"
import { getParser } from "../../../../script/m14/run-fixtures"
import { RealNimAnalyzer } from "../../../../src/ast/real-nim-analyzer"

/** Corpus fan-out, and the reason it is a knob rather than a constant.
 *
 * The production path is non-deterministic under concurrency (the doc's
 * Limitations 8 / 11): the WASM parser exhausts its fixed heap on a
 * load-dependent set of files, and a file lost that way publishes symbols with
 * an EMPTY `kind` — a degraded walk whose counts are wrong and whose artifact is
 * otherwise indistinguishable from a clean one. Measured on this corpus at
 * `validation/m14/fixtures/nim/fallback.mts`: 1 worker -> 0 fallback files and 0
 * empty-kind symbols; 6 workers -> 2 and 4.
 *
 * So every number this lane quotes carries its worker count, and this is what
 * makes that count choosable rather than merely reported. Six is the default
 * because that is what every artifact on record was measured at, so an unpinned
 * invocation reproduces the committed figures. Lower it on a saturated box to
 * buy a clean walk; the spread is in the doc either way.
 */
const WORKERS = Math.max(1, Number(process.env.BB_NIM_WORKERS ?? 6) || 6)

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const ANALYZER = path.resolve((import.meta as any).dirname ?? ".", "../../../../src/ast/real-nim-analyzer.ts")
const analyzerHash = (): string => createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")
const HASH_BEFORE = analyzerHash()
const digestLine = (): string => `\n${path.relative(process.cwd(), ANALYZER)} sha256:${HASH_BEFORE.slice(0, 16)}`
const OUT = process.argv[2] && process.argv[2].endsWith(".json") ? process.argv[2] : null

const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "nim") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
/**
 * The sample, and why this instrument does not walk the whole corpus by default.
 *
 * This is the most expensive instrument in the lane: it parses each file THREE
 * times (one raw parse for the tree, then `analyze()` for the pre-filter edge
 * list, then production `parseFile` for the post-filter one) and holds three
 * symbol sets per file. Over 6,063 files on a box already running seven lanes
 * that did not finish inside 50 minutes, and the WASM parser aborted repeatedly
 * on `nimony/lib/std/*` on the way — each abort forcing a parser rebuild. That
 * is a fact about this machine under this load, not a licence to publish a
 * number from an unknown number of files.
 *
 * So the population is a DETERMINISTIC stride sample of the same walk the census
 * makes, the size is printed, and the artifact records it. `BB_NIM_FILES=0`
 * walks everything for a machine that can afford it. The measurement itself does
 * not need full coverage: `filterNoiseRelationships` is a pure function of an
 * edge list, so what is being estimated is a RATE, and a rate over a fixed stride
 * over 6,063 files is a rate with a stated denominator rather than a sample of
 * unknown size.
 */
const FILE_LIMIT = Math.max(0, Number(process.env.BB_NIM_FILES ?? 1500) || 0)
const stride = FILE_LIMIT > 0 ? Math.max(1, Math.floor(files.length / FILE_LIMIT)) : 1
const sample = FILE_LIMIT > 0 ? files.filter((_, i) => i % stride === 0).slice(0, FILE_LIMIT) : files
console.log(`files ${sample.length} of ${files.length} discovered (deterministic every-${stride}th${FILE_LIMIT > 0 ? `, BB_NIM_FILES=${FILE_LIMIT}` : ", FULL WALK"})`)
console.log(`workers ${WORKERS} (BB_NIM_WORKERS; every count below is a function of this — see Limitations 8/11)`)
console.log(digestLine())

const parser: any = await getParser("nim")
const analyzer = new RealNimAnalyzer()

/** A declared name is accent-quoted when the tree says so, read off the node. */
function isAccentQuotedNameNode(node: any): boolean {
  if (!node) return false
  if (node.type === "accent_quoted") return true
  if (node.type === "exported_symbol" && node.namedChildCount > 0) return node.namedChild(0).type === "accent_quoted"
  if (node.type === "symbol_declaration_list") {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c?.type === "symbol_declaration") {
        const nm = c.childForFieldName?.("name")
        if (nm && isAccentQuotedNameNode(nm)) return true
      }
    }
  }
  return false
}

let idx = 0
const accentQuotedSymbols = new Map<string, number>()
const preEdges = { total: 0, withBacktickEndpoint: 0 }
const postEdges = { total: 0, withBacktickEndpoint: 0 }
const droppedByFilter: { label: string; type: string; src: string; tgt: string }[] = []
const droppedOther: { label: string; type: string; src: string; tgt: string }[] = []
const byType = new Map<string, { pre: number; post: number; preTick: number }>()
// The per-type SPLIT of what the filter deletes, tallied rather than sampled.
// The sample below is capped at 40 rows, so the sample cannot answer "which
// type loses how many" — and a per-type breakdown that does not sum to the
// total is the defect this was added to remove.
const droppedTickByType: Record<string, number> = {}
let droppedTickTotal = 0
let parseFailures = 0

async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= sample.length) return
    const f = sample[i]
    const label = `${f.repo}/${f.rel}`

    // ── PRE: analyze() through the shared harness's parser.
    let pre: any = null
    try {
      const tree = parser.parse(f.text)
      pre = analyzer.analyze(tree.rootNode, f.text, f.abs)
    } catch { /* recorded below as a pre failure */ }

    // ── POST: production parseFile.
    let post: any = null
    try { post = await parseFile(f.abs, f.dir) } catch { parseFailures++; continue }
    if (!post) { parseFailures++; continue }

    // accent-quoted symbols, read off the tree
    try {
      const tree = parser.parse(f.text)
      const stack: any[] = [tree.rootNode]
      while (stack.length) {
        const n = stack.pop()
        if (["proc_declaration", "func_declaration", "method_declaration", "iterator_declaration", "template_declaration", "macro_declaration", "converter_declaration"].includes(n.type)) {
          if (isAccentQuotedNameNode(n.childForFieldName?.("name"))) {
            const nm = n.childForFieldName?.("name")
            const key = `${label}: ${String(nm.text)}`
            accentQuotedSymbols.set(key, (accentQuotedSymbols.get(key) ?? 0) + 1)
          }
        }
        for (let k = 0; k < n.childCount; k++) stack.push(n.child(k))
      }
    } catch { /* tree walk is best-effort; the counts above are what matter */ }

    const bump = (t: string, which: "pre" | "post", tick: boolean): void => {
      const row = byType.get(t) ?? { pre: 0, post: 0, preTick: 0 }
      row[which]++
      if (tick && which === "pre") row.preTick++
      byType.set(t, row)
    }

    for (const e of post.relationships ?? []) {
      const t = String(e.type ?? "")
      const s = String(e.source ?? "")
      const g = String(e.target ?? "")
      const tick = s.includes("`") || g.includes("`")
      postEdges.total++
      if (tick) postEdges.withBacktickEndpoint++
      bump(t, "post", tick)
    }

    if (pre?.relationships) {
      const declared = new Set((post.symbols ?? []).map((s: any) => String(s.name)))
      for (const e of pre.relationships) {
        const t = String(e.type ?? "")
        const s = String(e.source ?? "")
        const g = String(e.target ?? "")
        const tick = s.includes("`") || g.includes("`")
        preEdges.total++
        if (tick) preEdges.withBacktickEndpoint++
        bump(t, "pre", tick)
      }
      // Attribute the loss to filterNoiseRelationships directly, so the
      // difference is that function's doing and not a pipeline difference.
      const kept = new Set(
        filterNoiseRelationships(pre.relationships, "nim", declared).map((e: any) => `${e.source}|${e.target}|${e.type}`),
      )
      for (const e of pre.relationships) {
        const k = `${e.source}|${e.target}|${e.type}`
        if (kept.has(k)) continue
        const row = { label, type: String(e.type ?? ""), src: String(e.source ?? ""), tgt: String(e.target ?? "") }
        const tick = row.src.includes("`") || row.tgt.includes("`")
        if (tick) {
          droppedTickByType[row.type] = (droppedTickByType[row.type] ?? 0) + 1
          droppedTickTotal++
          if (droppedByFilter.length < 40) droppedByFilter.push(row)
        } else if (droppedOther.length < 25) droppedOther.push(row)
      }
    }
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

console.log(`\nACCENT-QUOTED (operator) DECLARATIONS on the tree: ${accentQuotedSymbols.size} distinct sites`)
for (const [k, v] of [...accentQuotedSymbols].slice(0, 12)) console.log(`  ${k}`)
console.log(`\nENDPOINTS CONTAINING A BACKTICK`)
console.log(`  pre-filter  (analyze)   : ${preEdges.withBacktickEndpoint} of ${preEdges.total} edges`)
console.log(`  post-filter (parseFile) : ${postEdges.withBacktickEndpoint} of ${postEdges.total} edges`)
console.log(`\nPER TYPE  pre -> post, and pre edges with a backtick endpoint`)
for (const [t, r] of [...byType].sort((a, b) => b[1].pre - a[1].pre)) {
  console.log(`  ${t.padEnd(14)} pre ${String(r.pre).padStart(7)}  post ${String(r.post).padStart(7)}  pre-with-backtick ${r.preTick}`)
}
console.log(`\nEDGES filterNoiseRelationships DELETED that carry a backtick endpoint: ${droppedTickTotal} (sampled ${droppedByFilter.length}${droppedByFilter.length >= 40 ? "+" : ""})`)
console.log(`  per type: ${Object.entries(droppedTickByType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("  ")}`)
console.log(`  the split sums to ${Object.values(droppedTickByType).reduce((a, b) => a + b, 0)} of ${droppedTickTotal} — stated so a reader can check it rather than trust it`)
for (const d of droppedByFilter.slice(0, 14)) console.log(`  ${d.label}  ${d.src} -[${d.type}]-> ${d.tgt}`)
console.log(`\nEDGES it deleted for OTHER reasons: ${droppedOther.length}${droppedOther.length >= 25 ? "+" : ""} sampled`)
for (const d of droppedOther.slice(0, 10)) console.log(`  ${d.label}  ${d.src} -[${d.type}]-> ${d.tgt}`)
console.log(`\nparseFile failures: ${parseFailures}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    analyzerSha256: HASH_BEFORE, analyzerStableDuringRun: analyzerHash() === HASH_BEFORE,
    workers: WORKERS,
    lang: "nim", files: files.length, sampled: sample.length, stride, parseFileFailures: parseFailures,
    accentQuotedDeclarationSites: accentQuotedSymbols.size,
    preFilter: preEdges, postFilter: postEdges,
    perType: Object.fromEntries(byType),
    droppedWithBacktickEndpoint: droppedByFilter,
    droppedWithBacktickTotal: droppedTickTotal,
    droppedWithBacktickByType: droppedTickByType,
    droppedOtherReasons: droppedOther,
  }, null, 2))
  console.log(`analyzer sha256 after the walk : ${HASH_BEFORE.slice(0, 16)}${analyzerHash() === HASH_BEFORE ? "  (unchanged — every number above is tied to this analyzer state)" : "  CHANGED DURING THE RUN — the numbers above are a MIXTURE of two analyzer states and are not reproducible"}`)
  console.log(`\nwrote ${OUT}`)
}
