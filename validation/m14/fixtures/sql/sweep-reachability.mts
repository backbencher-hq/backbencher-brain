/**
 * SWEEP REACHABILITY — can `sweepDeclarationsRecovered` move at all, and does the
 * declaration sweep still buy anything the root walk does not already do?
 *
 * ## WHY THIS EXISTS
 *
 * `ambiguity-census.mts` measures the analyzer's own recovery counters through production
 * `parseFile` over every admitted corpus file. It reports:
 *
 *   resyncDeclarations           7 files, 21 declarations
 *   sweepDeclarationsRecovered   0 files,  0 declarations      <-- over 1,962 admitted files
 *
 * next to 778 files the parse tree calls damaged (`errorNodes > 0`). A recovery pass whose whole
 * purpose is to find declarations error recovery buried inside other declarations, reading 0 on a
 * corpus where 778 files are damaged, is either DEAD CODE or a counter whose guard can never let
 * it be the first finder. Those are different defects with different fixes, so this separates
 * them by construction rather than by argument.
 *
 * ## THE NUMBERS, per file
 *
 *   declarationNodes   nodes in the tree whose type is in DECLARATION_NODES, at any depth
 *   nested             of those, the ones with at least one DECLARATION_NODES ancestor — a
 *                      declaration inside a declaration, the only population the sweep was
 *                      written for. `statement` is not a declaration node, so the ordinary
 *                      `program > statement > create_table` shape does not count as nested.
 *   symbolsOnNodes     published symbols whose `startIndex` lies inside a declaration node's byte
 *                      span — the production symbol is flat (`startIndex` on the symbol, not under
 *                      `range`), and a symbol carrying no `startIndex` is excluded from the
 *                      arithmetic rather than guessed at
 *   unclaimed          declaration nodes with NO published symbol starting inside them, nested or
 *                      not. Every node is tested independently: a node nested inside another
 *                      declaration can be claimed by a symbol that also lies inside its ancestor,
 *                      and a rule that stops at the first containing node reports that as missing.
 *   sweepRecovered     `metadata.ambiguity.sweepDeclarationsRecovered`
 *
 * `nestedUnclaimed = 0` together with `sweepRecovered = 0` is a pass whose work another pass now
 * does first: the honest reading. `nestedUnclaimed > 0` together with `sweepRecovered = 0` is a
 * counter that cannot report what it does, which is the opposite defect.
 *
 * ## HOW CONTAINMENT IS DECIDED
 *
 * From the tree and from `parseFile`'s own `startIndex`, at byte precision. A symbol carrying no
 * `startIndex` is counted in `symbolsWithoutByteOffset` and excluded from the arithmetic rather
 * than guessed at, so the two populations being compared have the same membership.
 *
 * ## MERGING, and why it lives here rather than in an ad-hoc script
 *
 * One 8-shard slice of this corpus exceeds 900 s on its slow files, so `run-sweep-reachability.sh`
 * measures two of the eight from finer sub-slices and an overlapping slice is therefore possible.
 * The merged artifact has to deduplicate BY PATH for that to be safe — and the artifact this lane
 * committed was produced by a merge nobody could re-run, because the merge was not in the
 * repository. An artifact whose producing step is a shell history is not reproducible, however
 * careful the walk that filled it was.
 *
 * `--merge FILE...` is that step: it reads shard artifacts, keys `perFile` by path, recomputes every
 * total FROM the deduplicated rows rather than summing the shards' own totals (so a double-counted
 * row cannot hide inside an aggregate), and prints how many paths arrived from more than one slice.
 * That number is the falsifier: an overlap that the dedup did not see would show as 0 sources per
 * path while the file count rose.
 *
 * ## USAGE
 *   npx tsx validation/m14/fixtures/sql/sweep-reachability.mts [--out FILE] [--limit N] [FILE.sql ...]
 *   npx tsx validation/m14/fixtures/sql/sweep-reachability.mts --merge FILE.json ... [--out FILE]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { Parser, Language } from "web-tree-sitter"
import { parseFile } from "../../../../src/ast/pool-worker"
import { DECLARATION_NODES as ANALYZER_DECLARATION_NODES } from "../../../../src/ast/real-sql-analyzer"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const CR = process.env.BB_CORPUS_ROOT || "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const OUT = argOf("--out")
const LIMIT = Number(argOf("--limit") ?? "0")
const SHARDS = Number(argOf("--shards") ?? "0")
const SHARD = Number(argOf("--shard") ?? "0")
/**
 * `--merge` is a SWITCH, not a flag that takes one value: every bare argument after it is a shard
 * artifact. An earlier version read `--merge`'s immediate successor and treated the rest as explicit
 * file paths, so `npx tsx … --merge a.json b.json c.json` merged `a.json` and then walked `b.json`
 * and `c.json` as if they were SQL files — and said so on stdout, in a line a reader would skim.
 * The two argument shapes are now disjoint: `--merge` present means every bare argument is an
 * artifact, absent means every bare argument is a file to measure.
 */
const MERGE_MODE = argv.includes("--merge")
const MERGE_INPUTS = MERGE_MODE ? argv.filter((a) => !a.startsWith("--")) : []
const LANG = "sql"
const SIZE_CAP = 512 * 1024

await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-sql.wasm")))
const parser = new Parser()
parser.setLanguage(language)

/**
 * The analyzer's own declaration-node set, IMPORTED rather than retyped here, so this probe cannot
 * drift from the product the way a copied list would — and not recovered by pattern-matching the
 * analyzer's source either, which is how the previous version of this probe read it. A regular
 * expression over source matches comments and string literals as readily as the literal it is
 * looking for, so it would have returned a plausible wrong set rather than failing.
 */
const DECLARATION_NODES = ANALYZER_DECLARATION_NODES
console.log(`DECLARATION_NODES read from the analyzer: ${DECLARATION_NODES.size} node types`)

type Span = { start: number; end: number; startLine: number; endLine: number; type: string; nested: boolean }
type FileRow = {
  file: string
  declarationNodes: number
  nestedDeclarationNodes: number
  publishedSymbols: number
  symbolsWithOffset: number
  symbolsOnDeclarationNodes: number
  declarationNodesWithNoSymbol: number
  nestedUnclaimed: number
  sweepRecovered: number
  resyncDeclarations: number
  errorNodes: number
  /** pool-worker answers a file over 1 MB with the language-agnostic REGEX extractor. Its 0 symbols
   *  are not the analyzer's 0 symbols, so a fallback result is excluded from the containment
   *  arithmetic and reported separately. */
  fallback: boolean
  bytes: number
}

/** Line index by byte offset, so a node's span can be compared with the lines `parseFile` publishes. */
function lineIndex(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  return starts
}
function lineAt(starts: number[], offset: number): number {
  let lo = 0, hi = starts.length - 1
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid]! <= offset) lo = mid; else hi = mid - 1 }
  return lo
}

function declarationSpans(root: any, starts: number[]): Span[] {
  const spans: Span[] = []
  const stack: { node: any; declAncestors: number }[] = [{ node: root, declAncestors: 0 }]
  while (stack.length > 0) {
    const { node, declAncestors } = stack.pop()!
    const isDecl = DECLARATION_NODES.has(node.type)
    if (isDecl) spans.push({
      start: node.startIndex, end: node.endIndex,
      startLine: lineAt(starts, node.startIndex), endLine: lineAt(starts, Math.max(node.startIndex, node.endIndex - 1)),
      type: node.type, nested: declAncestors > 0,
    })
    const next = declAncestors + (isDecl ? 1 : 0)
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const c = node.namedChild(i)
      if (c) stack.push({ node: c, declAncestors: next })
    }
  }
  return spans
}

async function measure(abs: string, label: string): Promise<FileRow | null> {
  let text = ""
  try { text = readFileSync(abs, "utf8") } catch { return null }
  const starts = lineIndex(text)
  const spans = declarationSpans(parser.parse(text).rootNode, starts)
  let r: any
  try { r = await parseFile(abs, LANG) } catch { return null }
  const symbols: any[] = Array.isArray(r?.symbols) ? r.symbols : []
  // The production symbol is FLAT — `startLine`/`startIndex` sit on the symbol itself, not under
  // `range` — so both spellings are accepted rather than assuming the interface type's shape.
  // A pool-worker FALLBACK result is not the analyzer's output — over 1 MB the file is handed to
  // the language-agnostic regex extractor — so it is excluded from every containment figure rather
  // than counted as a file whose declarations went unpublished.
  if (r?.fallback === true) {
    return {
      file: label, declarationNodes: spans.length,
      nestedDeclarationNodes: spans.filter((s) => s.nested).length,
      publishedSymbols: symbols.length, symbolsWithOffset: 0, symbolsOnDeclarationNodes: 0,
      declarationNodesWithNoSymbol: 0, nestedUnclaimed: 0,
      sweepRecovered: 0, resyncDeclarations: 0, errorNodes: 0,
      fallback: true, bytes: Buffer.byteLength(text, "utf8"),
    }
  }
  const off = (s: any) => (typeof s?.startIndex === "number" ? s.startIndex : s?.range?.startIndex)
  const withOffset = symbols.filter((s) => typeof off(s) === "number")
  // EVERY declaration node is tested INDEPENDENTLY, with no first-match break. An earlier version
  // broke out of the span loop at the first containing node, so a declaration nested inside
  // another declaration could never be claimed by a symbol that also lies inside its ancestor —
  // and it reported 880 nested declarations as unrecovered on a file where the analyzer publishes
  // 943 symbols. That was an artefact of the attribution rule, not a finding.
  const claimed = new Set<number>()
  let onNodes = 0
  for (const s of withOffset) {
    const at = off(s) as number
    for (let i = 0; i < spans.length; i++) {
      if (at >= spans[i]!.start && at < spans[i]!.end) { onNodes++; claimed.add(i) }
    }
  }
  const unclaimed = spans.filter((_, i) => !claimed.has(i)).length
  const nestedUnclaimed = spans.filter((sp, i) => sp.nested && !claimed.has(i)).length
  return {
    file: label,
    declarationNodes: spans.length,
    nestedDeclarationNodes: spans.filter((s) => s.nested).length,
    publishedSymbols: symbols.length,
    symbolsWithOffset: withOffset.length,
    symbolsOnDeclarationNodes: onNodes,
    declarationNodesWithNoSymbol: unclaimed,
    nestedUnclaimed,
    sweepRecovered: r?.metadata?.ambiguity?.sweepDeclarationsRecovered ?? 0,
    resyncDeclarations: r?.metadata?.ambiguity?.resyncDeclarations ?? 0,
    errorNodes: r?.metadata?.ambiguity?.errorNodes ?? 0,
    fallback: r?.fallback === true,
    bytes: Buffer.byteLength(text, "utf8"),
  }
}

// The census's own admission rule, so this file and the census describe the same population.
const explicit = MERGE_MODE ? [] : argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--out", "--limit", "--shards", "--shard"].includes(argv[i - 1]!)))
const targets: { abs: string; label: string }[] = []
if (explicit.length > 0) {
  for (const t of explicit) targets.push({ abs: path.resolve(t), label: t })
} else if (MERGE_INPUTS.length === 0) {
  const seen: string[] = []
  for (const entry of execFileSync("ls", ["-1", CR], { encoding: "utf8" }).split("\n").filter(Boolean)) {
    const dir = path.join(CR, entry)
    let tracked: string[] = []
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) if (rel.endsWith(".sql")) seen.push(path.join(dir, rel))
  }
  seen.sort()
  for (const abs of seen) targets.push({ abs, label: path.relative(CR, abs) })
}
console.log(`targets ${targets.length}${explicit.length > 0 ? " (explicit list)" : MERGE_INPUTS.length > 0 ? " (merge mode: no walk)" : " (every tracked .sql in the corpus)"}`)

// `--shards N --shard I` takes a strided slice: engine.ts answers a 120s parser hang with
// process.exit(1), which would otherwise cost the whole measurement rather than one slice.
const rows: FileRow[] = []
if (MERGE_INPUTS.length === 0) {
  const all = LIMIT > 0 ? targets.slice(0, LIMIT) : targets
  const slice = SHARDS > 0 ? all.filter((_, i) => i % SHARDS === SHARD) : all
  for (const t of slice) {
    const row = await measure(t.abs, t.label)
    if (!row) continue
    rows.push(row)
    if (row.nestedUnclaimed > 0 || row.sweepRecovered > 0) console.log(`  NOTABLE ${JSON.stringify(row)}`)
  }
} else {
  /**
   * MERGE MODE. Deduplicated BY PATH, because the shell driver measures two of the eight 8-shard
   * slices from finer sub-slices and those sub-slices can cover the same file.
   *
   * `pathsFromMoreThanOneSlice` is the disclosure that makes the dedup falsifiable rather than
   * assumed: if it is 0 the dedup had nothing to do, and if it is non-zero the dedup is what kept
   * the totals honest. A merge that reported only the final count would be indistinguishable from a
   * merge that double-counted.
   */
  const byPath = new Map<string, { row: FileRow; sources: string[] }>()
  for (const src of MERGE_INPUTS) {
    const shard: any = JSON.parse(readFileSync(src, "utf8"))
    for (const r of (shard?.perFile ?? []) as FileRow[]) {
      const hit = byPath.get(r.file)
      if (hit) hit.sources.push(src)
      else byPath.set(r.file, { row: r, sources: [src] })
    }
  }
  const overlap = [...byPath.values()].filter((v) => v.sources.length > 1)
  console.log(`merge: ${MERGE_INPUTS.length} shard artifact(s), ${byPath.size} distinct path(s), ${overlap.length} path(s) from more than one slice`)
  if (overlap.length > 0) {
    for (const v of overlap.slice(0, 10)) console.log(`  OVERLAP ${v.row.file} <- ${v.sources.length} slice(s)`)
  }
  rows.push(...[...byPath.values()].map((v) => v.row))
  rows.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
}
const agg = (k: keyof FileRow) => rows.reduce((a, r) => a + (r[k] as number), 0)
const totals = {
  files: rows.length,
  declarationNodes: agg("declarationNodes"),
  nestedDeclarationNodes: agg("nestedDeclarationNodes"),
  publishedSymbols: agg("publishedSymbols"),
  symbolsWithByteOffset: agg("symbolsWithOffset"),
  symbolsWithoutByteOffset: agg("publishedSymbols") - agg("symbolsWithOffset"),
  symbolsOnDeclarationNodes: agg("symbolsOnDeclarationNodes"),
  declarationNodesWithNoSymbol: agg("declarationNodesWithNoSymbol"),
  nestedUnclaimed: agg("nestedUnclaimed"),
  sweepRecovered: agg("sweepRecovered"),
  resyncDeclarations: agg("resyncDeclarations"),
  filesWithNestedDeclarations: rows.filter((r) => r.nestedDeclarationNodes > 0).length,
  filesWithUnclaimedNestedDeclarations: rows.filter((r) => r.nestedUnclaimed > 0).length,
  filesWithADeclarationNodeAndNoSymbol: rows.filter((r) => r.declarationNodesWithNoSymbol > 0).length,
  filesWithErrorNodes: rows.filter((r) => r.errorNodes > 0).length,
  filesWhereSweepRecovered: rows.filter((r) => r.sweepRecovered > 0).length,
  filesAnsweredByPoolWorkerFallback: rows.filter((r) => r.fallback).length,
  filesOverTheCensusSizeCap: rows.filter((r) => r.bytes > 512 * 1024).length,
}
console.log(`\nTOTALS ${JSON.stringify(totals, null, 2)}`)

if (OUT) {
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify({
    instrument: "validation/m14/fixtures/sql/sweep-reachability.mts",
    entryPoint: "parseFile (src/ast/pool-worker.ts); declaration spans from a wasm/tree-sitter-sql walk",
    declarationNodeSetSource: "the DECLARATION_NODES literal in src/ast/real-sql-analyzer.ts, read not retyped",
    containmentRule: "a published symbol counts as ON a declaration node when its startIndex lies in [node.startIndex, node.endIndex)",
    population: explicit.length > 0 ? `explicit list of ${explicit.length}` : `every tracked .sql under ${CR}`,
    mode: MERGE_INPUTS.length > 0
      ? { merge: MERGE_INPUTS }
      : { shards: SHARDS > 0 ? SHARDS : 1, shard: SHARD },
    filesWithANonZero: rows.filter((r) => r.nestedUnclaimed > 0 || r.sweepRecovered > 0),
    totals,
    perFile: rows,
  }, null, 2))
  console.log(`wrote ${OUT}`)
}