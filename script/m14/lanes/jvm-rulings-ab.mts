/**
 * JVM RULINGS A/B — the two rulings the java/groovy folds settled, measured on
 * the last two JVM-family lanes (kotlin, scala) at CORPUS scale.
 *
 * WHY. "kotlin and scala share the java ctor-identity and line-anchoring
 * rulings" was asserted in archive/docs-pre-consolidation/analyzers-BRANCH-INVENTORY-2026-10-07.md §14/§15
 * from the shape of their declared failures, never measured. A claim that a lane
 * is COMPLIANT is worth exactly as much as the instrument behind it, and a claim
 * that a count moved needs both numbers from the same instrument — quoting the
 * pre-fold tables (different instruments, different samples, different dates)
 * beside a fresh census would attribute drift to the fold that came from
 * elsewhere. So this harness runs the recorded revision's analyzer and the
 * working tree's analyzer side by side, same engine, same files, same run, and
 * reports the two rulings directly:
 *
 *   1. CONSTRUCTOR IDENTITY — the name distribution of `kind: constructor`
 *      symbols. M37.21 C3: a constructor carries its CLASS name. The literal
 *      `"constructor"` is the retired spelling.
 *   2. DECLARATION-NAME ANCHORING — every symbol's (line, column). M59 (#825):
 *      the anchor is the NAME node. A lane whose pick is the first non-trivia
 *      child agrees on LINES and can still disagree on COLUMNS (that is exactly
 *      scala's `opaque type Size = Int`, 22 in 600 files).
 *
 * The identity multiset and the anchor multiset are reported SEPARATELY, because
 * a rename moves identities while a re-anchor moves ranges, and one number that
 * conflates them cannot say which ruling a delta came from.
 *
 * PRE-FOLD SIDE. `git show HEAD:src/ast/real-<lang>-analyzer.ts` is materialized
 * as `src/ast/real-<lang>-analyzer-headprobe.ts` for the duration of the run and
 * removed afterwards — it has to sit beside the analyzer for its relative
 * imports (`./engine`, `./override-context`) to resolve. Nothing else is
 * written; the corpora are read-only. When a lane's working tree EQUALS its HEAD
 * blob the A/B is the identity control: it must report zero movement, and a
 * non-zero result means something outside this harness changed the file.
 *
 * NO REGEX. Character walks only, per the family rule.
 *
 * USAGE (from the repo root):
 *   bun script/m14/lanes/jvm-rulings-ab.mts                     # both lanes
 *   bun script/m14/lanes/jvm-rulings-ab.mts scala               # one lane
 *   AB_NFILES=0 bun script/m14/lanes/jvm-rulings-ab.mts scala   # whole corpus
 *   AB_CONC=4 bun script/m14/lanes/jvm-rulings-ab.mts
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"

// A PARSER PER WORKER, AND ONE PARSE PER FILE.
//
// `run-fixtures.ts`'s `getParser` returns a CACHED, SHARED Parser instance, and
// concurrent `parse()` calls on one instance are not safe: the first version of
// this harness called it inside the parallel loop and 7 kotlin files came back
// `Error: Incompatible language version 0. Compatibility range 13 through 15.`
// on ONE side of an A/B whose two analyzers were byte-identical — which is how
// the race was caught. The identity control is what makes that visible: a
// harness that had only ever compared two different trees would have reported
// those 7 files as a fold artifact.
//
// So each worker builds its OWN parser from the same wasm the lane uses, and a
// file is parsed ONCE: both analyzers then run on the SAME tree, which removes
// the second parse AND the possibility of the two sides seeing different trees.
import { readFileSync as readWasm } from "node:fs"

const REPO = process.env.BB_M14_ROOT ?? "$HOME/backbencher-brain"
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const CONC = Number(process.env.AB_CONC ?? 8)
const NFILES = Number(process.env.AB_NFILES ?? 1500)

const TEN = ["calls", "extends", "implements", "uses", "imports", "exports", "contains", "references", "overrides", "instantiates"]

/** Lane -> corpus directories, in load order. */
const LANES: Record<string, { repos: string[]; ext: string }> = {
  kotlin: { repos: (process.env.AB_KOTLIN_REPOS ?? "kotlinx-coroutines,kotlin").split(","), ext: "kt" },
  scala: { repos: (process.env.AB_SCALA_REPOS ?? "scala").split(","), ext: "scala" },
}

type Acc = {
  files: number
  symbols: number
  rels: number
  zeroSymbolFiles: number
  types: Map<string, number>
  ctorNames: Map<string, number>
  /** identity multiset: name|kind|owner -> count */
  identity: Map<string, number>
  /** anchor multiset: name|kind|owner -> sorted list of line:col */
  anchors: Map<string, string[]>
  /** relationship multiset: type|label|source -> target|line */
  relRows: Map<string, number>
  /**
   * Up to three FILES per relationship row key. A moved row is only actionable
   * with a file to open: the key deliberately aggregates across the corpus, so
   * `contains|Foo -> field|L7 PRE 1 -> POST 0` says a row moved without saying
   * WHERE — added after exactly that happened on the kotlin lane's first run.
   */
  relRowFiles: Map<string, string[]>
  ownerless: string[]
}

const mkAcc = (): Acc => ({
  files: 0, symbols: 0, rels: 0, zeroSymbolFiles: 0,
  types: new Map(), ctorNames: new Map(), identity: new Map(), anchors: new Map(), relRows: new Map(), relRowFiles: new Map(), ownerless: [],
})

function tally(acc: Acc, res: any, L: string): void {
  acc.files++
  const syms: any[] = res.symbols ?? []
  acc.symbols += syms.length
  if (syms.length === 0) acc.zeroSymbolFiles++

  for (const s of syms) {
    const name = String(s.name ?? "")
    const kind = String(s.kind ?? "")
    const owner = String(s.ownerName ?? "")
    const idKey = `${name}|${kind}|${owner}`
    acc.identity.set(idKey, (acc.identity.get(idKey) ?? 0) + 1)
    const at = `${s.range?.startLine ?? 0}:${s.range?.startColumn ?? 0}`
    const list = acc.anchors.get(idKey)
    if (list) list.push(at)
    else acc.anchors.set(idKey, [at])
    if (kind === "constructor") acc.ctorNames.set(name, (acc.ctorNames.get(name) ?? 0) + 1)
    if (!owner && kind !== "class" && kind !== "interface" && kind !== "module" && kind !== "enum" && kind !== "type") {
      acc.ownerless.push(`${L}: ${name} kind=${kind} line=${s.range?.startLine ?? 0}`)
    }
  }

  const rels: any[] = res.relationships ?? []
  acc.rels += rels.length
  for (const r of rels) {
    const t = String(r.type ?? r.relationshipType ?? "")
    const label = String(r.metadata?.relationshipType ?? "")
    if (TEN.includes(t)) acc.types.set(t, (acc.types.get(t) ?? 0) + 1)
    const key = `${t}|${label}|${r.source} -> ${r.target}|L${r.line_number ?? "-"}`
    acc.relRows.set(key, (acc.relRows.get(key) ?? 0) + 1)
    const files = acc.relRowFiles.get(key)
    if (!files) acc.relRowFiles.set(key, [L])
    else if (files.length < 3 && !files.includes(L)) files.push(L)
  }
}

const top = (m: Map<string, number>, n: number): string =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}:${v}`).join("  ")

/** Multiset difference: entries whose COUNT differs, with both counts. */
function diffCounts(a: Map<string, number>, b: Map<string, number>): Array<[string, number, number]> {
  const keys = new Set([...a.keys(), ...b.keys()])
  const out: Array<[string, number, number]> = []
  for (const k of keys) {
    const x = a.get(k) ?? 0
    const y = b.get(k) ?? 0
    if (x !== y) out.push([k, x, y])
  }
  return out.sort((p, q) => Math.abs(q[2] - q[1]) - Math.abs(p[2] - p[1]))
}

function walk(dir: string, ext: string, out: string[]): void {
  let ents
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === "target") continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, ext, out)
    else if (e.name.endsWith(`.${ext}`)) out.push(p)
  }
}

async function runLane(lang: string): Promise<void> {
  const cfg = LANES[lang]
  // LANGS for the analyzer file/class name and the wasm — NOT getParser: see the
  // parser-per-worker note at the top of this file.
  const { LANGS } = await import(`${REPO}/script/m14/run-fixtures.ts`)
  const analyzerRel = `src/ast/${LANGS[lang].analyzerFile}.ts`
  const probeRel = `src/ast/${LANGS[lang].analyzerFile}-headprobe.ts`

  const all: string[] = []
  for (const repo of cfg.repos) walk(join(CORPUS_ROOT, repo), cfg.ext, all)
  all.sort()
  const measured = NFILES > 0 ? all.slice(0, NFILES) : all

  const blob = execFileSync("git", ["show", `HEAD:${analyzerRel}`], { cwd: REPO, maxBuffer: 1 << 26 }).toString()
  const working = readFileSync(join(REPO, analyzerRel), "utf8")
  writeFileSync(join(REPO, probeRel), blob)

  const preMod = await import(`${REPO}/${probeRel}`)
  const postMod = await import(`${REPO}/${analyzerRel}`)
  const Pre: any = preMod[LANGS[lang].className]
  const Post: any = postMod[LANGS[lang].className]

  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const LanguageClass = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => join(REPO, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await LanguageClass.load(readWasm(join(REPO, "wasm", LANGS[lang].wasm)))

  const pre = mkAcc()
  const post = mkAcc()
  let parseFails = 0
  const parseFailExamples: string[] = []
  console.log(`\n=== ${lang.toUpperCase()}  corpora=${cfg.repos.join(",")}  files=${all.length}  measured=${measured.length}${NFILES > 0 ? ` (first ${NFILES} lexicographic)` : " (ALL)"}`)
  console.log(`PRE = HEAD blob (${blob.length} B)   POST = working tree (${working.length} B)   ${blob === working ? "IDENTICAL CONTENT — identity control" : "content DIFFERS — deltas are attributable"}`)

  let cursor = 0
  const t0 = Date.now()
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++
      if (i >= measured.length) return
      const p = measured[i]
      const L = relative(CORPUS_ROOT, p)
      let content: string
      try { content = readFileSync(p, "utf8") } catch { continue }
      const parser = new ParserClass()
      parser.setLanguage(grammar)
      let tree: any
      try {
        tree = await parser.parse(content)
        if (!tree) throw new Error("parse returned no tree")
      } catch (e) {
        parseFails++
        if (parseFailExamples.length < 5) parseFailExamples.push(`${L}: ${String(e).slice(0, 120)}`)
        continue
      }
      // ONE tree, both analyzers — the two sides cannot see different input.
      for (const [acc, Cls] of [[pre, Pre], [post, Post]] as Array<[Acc, any]>) {
        try {
          tally(acc, new Cls().analyze(tree.rootNode, content, p), L)
        } catch (e) {
          console.log(`ANALYZE FAIL ${L}: ${String(e).slice(0, 140)}`)
        }
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()))
  const ms = Date.now() - t0
  try { unlinkSync(join(REPO, probeRel)) } catch { /* already gone */ }

  console.log(`\n--- ${lang} TOTALS in ${ms} ms`)
  console.log(`parse failures: ${parseFails}${parseFails > 0 ? " — these files are EXCLUDED from both sides, so the A/B stays symmetric; they are listed because a corpus file this lane cannot read through this path is a finding of its own" : ""}`)
  for (const e of parseFailExamples) console.log(`   ${e}`)
  if (pre.files !== post.files || pre.symbols !== post.symbols || pre.rels !== post.rels) {
    if (blob === working) console.log(`   !!! IDENTITY CONTROL FAILED: identical analyzer content produced different totals — the instrument, not the analyzer, is at fault. Do not read the deltas below.`)
  }
  console.log(`PRE  files ${pre.files}  symbols ${pre.symbols}  rels ${pre.rels}  zeroSymbolFiles ${pre.zeroSymbolFiles}`)
  console.log(`POST files ${post.files}  symbols ${post.symbols}  rels ${post.rels}  zeroSymbolFiles ${post.zeroSymbolFiles}`)

  console.log(`\n--- ${lang} RULING 1: CONSTRUCTOR IDENTITY (M37.21 C3 — the CLASS name, never the literal)`)
  const preCtor = [...pre.ctorNames.values()].reduce((a, b) => a + b, 0)
  const postCtor = [...post.ctorNames.values()].reduce((a, b) => a + b, 0)
  const preLiteral = pre.ctorNames.get("constructor") ?? 0
  const postLiteral = post.ctorNames.get("constructor") ?? 0
  console.log(`PRE  constructor symbols ${preCtor}  distinct names ${pre.ctorNames.size}  named literally \`constructor\` ${preLiteral}`)
  console.log(`POST constructor symbols ${postCtor}  distinct names ${post.ctorNames.size}  named literally \`constructor\` ${postLiteral}`)
  console.log(`PRE  top names:  ${top(pre.ctorNames, 8)}`)
  console.log(`POST top names:  ${top(post.ctorNames, 8)}`)

  console.log(`\n--- ${lang} RULING 2: DECLARATION-NAME ANCHORING (M59/#825 — the NAME's line and column)`)
  const idDiff = diffCounts(pre.identity, post.identity)
  console.log(`SYMBOL IDENTITY (name|kind|owner) entries that moved: ${idDiff.length}`)
  for (const [k, a, b] of idDiff.slice(0, 12)) console.log(`   ${k.padEnd(46)} PRE ${String(a).padStart(6)} -> POST ${String(b).padStart(6)}`)
  let anchorsMoved = 0
  let lineMoved = 0
  let colOnly = 0
  const anchorExamples: string[] = []
  for (const [k, preAnchors] of pre.anchors) {
    const postAnchors = post.anchors.get(k)
    if (!postAnchors) continue
    const a = [...preAnchors].sort().join(",")
    const b = [...postAnchors].sort().join(",")
    if (a === b) continue
    anchorsMoved++
    const aLines = new Set(preAnchors.map((x) => x.split(":")[0]))
    const bLines = new Set(postAnchors.map((x) => x.split(":")[0]))
    const sameLines = aLines.size === bLines.size && [...aLines].every((x) => bLines.has(x))
    if (sameLines) colOnly++
    else lineMoved++
    if (anchorExamples.length < 10) anchorExamples.push(`${k}: PRE [${a}] -> POST [${b}]  (${sameLines ? "COLUMN only" : "LINE moved"})`)
  }
  console.log(`identities whose ANCHOR moved: ${anchorsMoved}  (line moved: ${lineMoved}, column only: ${colOnly})`)
  for (const e of anchorExamples) console.log(`   ${e}`)

  console.log(`\n--- ${lang} PER-TYPE RELATIONSHIP CHANNEL`)
  let movedTypes = 0
  for (const t of TEN) {
    const a = pre.types.get(t) ?? 0
    const b = post.types.get(t) ?? 0
    if (a !== b) movedTypes++
    console.log(`${t.padEnd(13)} PRE ${String(a).padStart(7)}   POST ${String(b).padStart(7)}   ${a === b ? "same" : `DELTA ${b - a >= 0 ? "+" : ""}${b - a}`}`)
  }
  console.log(`moved: ${movedTypes} of ${TEN.length}`)

  const relDiff = diffCounts(pre.relRows, post.relRows)
  console.log(`\n--- ${lang} RELATIONSHIP ROWS THAT MOVED (type|label|source -> target|line): ${relDiff.length}`)
  for (const [k, a, b] of relDiff.slice(0, 14)) {
    console.log(`   ${k.slice(0, 78).padEnd(78)} PRE ${String(a).padStart(5)} -> POST ${String(b).padStart(5)}`)
    const where = [...new Set([...(post.relRowFiles.get(k) ?? []), ...(pre.relRowFiles.get(k) ?? [])])]
    console.log(`   ${" ".repeat(78)} in: ${where.join(", ") || "(no file recorded)"}`)
  }

  const owned = pre.ownerless.length === post.ownerless.length
  console.log(`\n--- ${lang} OWNER-LESS NON-TYPE SYMBOLS (control: a rename must not change this)`)
  console.log(`PRE ${pre.ownerless.length}   POST ${post.ownerless.length}   ${owned ? "same count" : "COUNT MOVED"}`)
  const preSet = new Set(pre.ownerless)
  const postSet = new Set(post.ownerless)
  for (const x of [...postSet].filter((v) => !preSet.has(v)).slice(0, 8)) console.log(`   POST-only: ${x}`)
  for (const x of [...preSet].filter((v) => !postSet.has(v)).slice(0, 8)) console.log(`   PRE-only:  ${x}`)

  console.log(`\n--- ${lang} VERDICT`)
  console.log(`ruling 1 (ctor identity): ${postCtor === 0 ? "no constructor symbols on this sample" : postLiteral === 0 ? "HOLDS — no constructor carries the literal" : `FAILS — ${postLiteral} still named \`constructor\``}`)
  console.log(`ruling 2 (name anchor):   ${anchorsMoved === 0 ? "no movement (either already compliant, or the fold's pick matches everywhere on this sample)" : `${lineMoved} line move(s), ${colOnly} column-only move(s) — attributable to the fold`}`)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a) => !a.startsWith("-"))
  const lanes = argv.length > 0 ? argv : Object.keys(LANES)
  for (const lang of lanes) {
    if (!LANES[lang]) throw new Error(`unknown lane ${lang} (have ${Object.keys(LANES).join(", ")})`)
    await runLane(lang)
  }
}

try {
  await main()
} catch (e) {
  console.error(String(e))
  process.exitCode = 1
}
