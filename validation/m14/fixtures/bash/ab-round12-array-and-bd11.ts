/**
 * BASH ROUND-12 A/B — did publishing the array-element binding and moving BD11's
 * flag to a post-walk pass change any edge, and did it change anything ELSE?
 *
 * ## Why this file exists
 *
 * Two claims are load-bearing after this round and neither is visible in a count:
 *
 *   1. `name[index]=value` publishes a declaration that was previously dropped,
 *      so the symbol table and the `contains` edges must grow — by the amount the
 *      tree census PREDICTED, not by an amount fitted after the change.
 *   2. Moving `isAssignedInFile` to a post-walk pass changes METADATA ONLY. It
 *      must not add, remove or retype an edge, and it must not withdraw a key:
 *      the pass can only set a key that was absent, so a key appearing is
 *      information gained and a key disappearing would be a claim withdrawn.
 *
 * `script/m14/differential.ts` cannot answer either: its cold-pool rotation draws
 * a different 60 files every run, so two consecutive runs are not comparable.
 *
 * ## The instrument
 *
 * A per-item A/B on one PINNED, hash-ordered sample of the whole corpus. Both
 * analyzers see the SAME bytes: one PRIVATE `web-tree-sitter` handle parses each
 * file twice and each tree is handed to one analyzer and deleted. The engine's
 * shared parser is not borrowed — round 9 measured that borrowing it covers ~499
 * files while calling itself whole-corpus, and this file must not repeat that.
 *
 * Old version = `HEAD:src/ast/real-bash-analyzer.ts`, materialised as a SIBLING
 * module and imported directly, so the old side is the real previous analyzer and
 * not a re-implementation. `git stash` is never used (limitation 17).
 *
 * Symbols are compared by `(name, kind, scope, startLine)` and relationships by
 * `(source, type, target, line)` — the same key `addRel` deduplicates on, so an
 * edge that only moved its metadata is not counted as two edges.
 *
 * ## What it asserts
 *
 *   ADDED / REMOVED relationships, per type, with examples
 *   ADDED / REMOVED symbols, with examples
 *   metadata keys gained and LOST per relationship (LOST is fatal by construction)
 *   the predicted symbol delta, read from the tree census, compared to the measured
 *
 * ## NO REGEX
 *
 * Every comparison is `===` on published fields. Nothing is matched as text.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/ab-round12-array-and-bd11.ts
 *      [--sample 400] [--expect-symbols 3] [--expect-contains 3]
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const num = (n: string, d: number): number => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? Number(argv[i + 1]) : d
}
const SAMPLE = num("sample", 400)
const EXPECT_SYMBOLS = num("expect-symbols", 3)
const EXPECT_CONTAINS = num("expect-contains", 3)
const BASE = process.env.BB_AB_BASE ?? "HEAD"
const EXAMPLES = 12

const ROOT = process.cwd()
const CURRENT = path.join(ROOT, "src/ast/real-bash-analyzer.ts")
const OLD_COPY = path.join(ROOT, "src/ast/__ab_old_bash_analyzer.mts")

// The marker that identifies the pre-round-12 shape. If the working tree already
// contains the new code, `HEAD` is still the pre-change version as long as the fix
// is uncommitted; if it is committed, the A/B says NO-OP instead of comparing the
// file to itself.
const NEW_MARKER = "attribution, BD11's flag"
let oldSrc: string
try {
  oldSrc = execFileSync("git", ["show", `${BASE}:src/ast/real-bash-analyzer.ts`], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
} catch {
  console.log(`NO-OP: no ${BASE}:src/ast/real-bash-analyzer.ts in this checkout.`)
  process.exit(0)
}
if (oldSrc.includes(NEW_MARKER)) {
  console.log(
    `NO-OP: ${BASE} already contains the round-12 change, so it is not the pre-change version.\n` +
      `      Pass BB_AB_BASE=<the commit BEFORE the fix>.`,
  )
  process.exit(0)
}
if (!readFileSync(CURRENT, "utf8").includes(NEW_MARKER)) {
  console.log("NO-OP: the working tree does not contain the round-12 change either; nothing to compare.")
  process.exit(0)
}
writeFileSync(OLD_COPY, oldSrc)

// ------------------------------------------------------------------ file set
interface F {
  repo: string
  rel: string
  abs: string
  text: string
  hash: string
}
const files: F[] = []
let scanned = 0
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    scanned++
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    files.push({ repo: e, rel, abs, text, hash: createHash("sha256").update(`${e}/${rel}`).digest("hex") })
  }
}
files.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
const sample = files.slice(0, SAMPLE)

// ------------------------------------------------------- private tree handle
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-bash.wasm"))))

const { RealBashAnalyzer: NewAnalyzer } = await import("../../../../src/ast/real-bash-analyzer")
const { RealBashAnalyzer: OldAnalyzer } = await import("../../../../src/ast/__ab_old_bash_analyzer.mts")
const newA: any = new NewAnalyzer()
const oldA: any = new OldAnalyzer()

const relKey = (r: any): string => `${r.source}|${r.type}|${r.target}|${r.line_number}`
const symKey = (s: any): string => `${s.name}|${s.kind}|${s.scope ?? ""}|${s.startLine ?? 0}`

let compared = 0
let degraded = 0
let relOld = 0
let relNew = 0
let symOld = 0
let symNew = 0
/** Counted as SET DIFFERENCES on `(name, kind, scope, startLine)`, not as a
 *  subtraction of totals. The first version of this file printed
 *  `delta +10 (added 5, removed -5)` — a subtraction wearing two labels, where
 *  `removed` was the negative of the net change. The two numbers are now counted
 *  where they are defined, and a symbol that moved scope shows up in BOTH lists
 *  rather than cancelling. */
let symAdded = 0
let symRemoved = 0
const relAddedByType = new Map<string, number>()
const relRemovedByType = new Map<string, number>()
const relMovedByType = new Map<string, number>()
const metaGained = new Map<string, number>()
const metaLost = new Map<string, number>()
let metaChangedEdges = 0
const relAddedEx: string[] = []
const relRemovedEx: string[] = []
const relMovedEx: string[] = []
const symAddedEx: string[] = []
const symRemovedEx: string[] = []
const metaLostEx: string[] = []
/** The specific claim: reads that gained `isAssignedInFile`, and whether any read
 *  that HAD the key lost it. Split so "more edges carry the flag" and "the flag
 *  is still file-level" are two numbers rather than one. */
let flagGained = 0
let flagLost = 0

for (const f of sample) {
  const label = `${f.repo}/${f.rel}`
  let oldR: any
  let newR: any
  try {
    const tOld = parser.parse(f.text)
    oldR = oldA.analyze(tOld.rootNode, f.text, f.abs)
    tOld.delete?.()
    const tNew = parser.parse(f.text)
    newR = newA.analyze(tNew.rootNode, f.text, f.abs)
    tNew.delete?.()
  } catch {
    continue
  }
  if (!oldR || !newR) continue
  if (newR.fallback || oldR.fallback) degraded++
  compared++

  const oRels: any[] = oldR.relationships ?? []
  const nRels: any[] = newR.relationships ?? []
  relOld += oRels.length
  relNew += nRels.length
  const oMap = new Map(oRels.map((r: any) => [relKey(r), r]))
  const nMap = new Map(nRels.map((r: any) => [relKey(r), r]))

  for (const [k, r] of nMap) {
    const o = oMap.get(k)
    if (o) {
      const oKeys = Object.keys(o.metadata ?? {})
      const nKeys = Object.keys(r.metadata ?? {})
      const grew = nKeys.filter((x) => !oKeys.includes(x))
      const lost = oKeys.filter((x) => !nKeys.includes(x))
      if (grew.length > 0 || lost.length > 0) metaChangedEdges++
      for (const g of grew) metaGained.set(g, (metaGained.get(g) ?? 0) + 1)
      for (const l of lost) {
        metaLost.set(l, (metaLost.get(l) ?? 0) + 1)
        if (metaLostEx.length < EXAMPLES) metaLostEx.push(`${label}: ${k} lost ${l}`)
      }
      const oFlag = o.metadata?.isAssignedInFile === true
      const nFlag = r.metadata?.isAssignedInFile === true
      if (!oFlag && nFlag) flagGained++
      if (oFlag && !nFlag) flagLost++
    } else {
      const t = String(r.type)
      relAddedByType.set(t, (relAddedByType.get(t) ?? 0) + 1)
      if (relAddedEx.length < EXAMPLES) relAddedEx.push(`${label}: ${k}`)
    }
  }
  for (const [k, r] of oMap) {
    if (nMap.has(k)) continue
    // A MOVED edge and a DROPPED edge share a signature in a key that includes the
    // line, and they are opposite findings. `addRel` keys on
    // `${source} ${type} ${target} ${line}`, so an edge whose declaration now sits
    // on an earlier line leaves the key set while the CLAIM survives at a new line.
    // Counting that as a removal would report "2 edges the fix dropped" for the two
    // files where an array is bound by element before its `arr=(…)` form — which is
    // the fix working, stated as damage.
    //
    // So the test is whether the new side published an edge with the same
    // (source, type, target) at ANY line. If it did, the claim moved; if it did not,
    // the claim is gone and the row is fatal.
    const [src, type, tgt] = k.split("|")
    const moved = [...nMap.keys()].some((nk) => {
      const [ns, nt, ntg] = nk.split("|")
      return ns === src && nt === type && ntg === tgt
    })
    if (moved) {
      relMovedByType.set(String(r.type), (relMovedByType.get(String(r.type)) ?? 0) + 1)
      if (relMovedEx.length < EXAMPLES) relMovedEx.push(`${label}: ${k}`)
      continue
    }
    const t = String(r.type)
    relRemovedByType.set(t, (relRemovedByType.get(t) ?? 0) + 1)
    if (relRemovedEx.length < EXAMPLES) relRemovedEx.push(`${label}: ${k}`)
  }

  const oSyms: any[] = oldR.symbols ?? []
  const nSyms: any[] = newR.symbols ?? []
  symOld += oSyms.length
  symNew += nSyms.length
  const oSym = new Set(oSyms.map(symKey))
  const nSym = new Set(nSyms.map(symKey))
  for (const k of nSym) {
    if (oSym.has(k)) continue
    symAdded++
    if (symAddedEx.length < EXAMPLES) symAddedEx.push(`${label}: ${k}`)
  }
  for (const k of oSym) {
    if (nSym.has(k)) continue
    symRemoved++
    if (symRemovedEx.length < EXAMPLES) symRemovedEx.push(`${label}: ${k}`)
  }
}

parser.delete()
try {
  unlinkSync(OLD_COPY)
} catch {
  /* already gone */
}

const addedTotal = [...relAddedByType.values()].reduce((a, b) => a + b, 0)
const removedTotal = [...relRemovedByType.values()].reduce((a, b) => a + b, 0)
const movedTotal = [...relMovedByType.values()].reduce((a, b) => a + b, 0)
const lostTotal = [...metaLost.values()].reduce((a, b) => a + b, 0)

console.log(`bash round-12 A/B — ${compared} files (hash order), ${SAMPLE} requested`)
console.log(`  admitted ${files.length} / scanned ${scanned} / degraded ${degraded}`)
console.log(`  old symbols ${symOld}  new symbols ${symNew}   net ${symNew - symOld >= 0 ? "+" : ""}${symNew - symOld}`)
console.log(`  symbols ADDED   : ${symAdded}`)
console.log(`  symbols REMOVED : ${symRemoved}   (a removed symbol is a declaration the old analyzer published and this one does not)`)
console.log(`  old rels    ${relOld}  new rels    ${relNew}   delta ${relNew - relOld >= 0 ? "+" : ""}${relNew - relOld}`)
console.log(`\n  relationships ADDED   : ${addedTotal} ${JSON.stringify(Object.fromEntries(relAddedByType))}`)
console.log(`  relationships MOVED   : ${movedTotal} ${JSON.stringify(Object.fromEntries(relMovedByType))}   (same source/type/target, a different line — the declaration now sits earlier)`)
console.log(`  relationships REMOVED : ${removedTotal} ${JSON.stringify(Object.fromEntries(relRemovedByType))}   (the claim is GONE — must be 0)`)
console.log(`  metadata keys GAINED  : ${JSON.stringify(Object.fromEntries(metaGained))}`)
console.log(`  metadata keys LOST    : ${lostTotal} ${JSON.stringify(Object.fromEntries(metaLost))}   (a lost key is a claim withdrawn — must be 0)`)
console.log(`  edges with metadata changed: ${metaChangedEdges}`)
console.log(`  isAssignedInFile gained on an edge: ${flagGained}`)
console.log(`  isAssignedInFile LOST on an edge  : ${flagLost}   (must be 0 — the post-walk pass can only add)`)
console.log(`\n  symbols added:`)
for (const e of symAddedEx) console.log(`    ${e}`)
if (symRemovedEx.length) {
  console.log(`  symbols REMOVED:`)
  for (const e of symRemovedEx) console.log(`    ${e}`)
}
if (relAddedEx.length) {
  console.log(`  rels added:`)
  for (const e of relAddedEx) console.log(`    ${e}`)
}
if (relMovedEx.length) {
  console.log(`  rels whose line moved:`)
  for (const e of relMovedEx) console.log(`    ${e}`)
}
if (relRemovedEx.length) {
  console.log(`  rels removed:`)
  for (const e of relRemovedEx) console.log(`    ${e}`)
}
if (metaLostEx.length) {
  console.log(`  metadata keys lost:`)
  for (const e of metaLostEx) console.log(`    ${e}`)
}

// ------------------------------------------------------------------- verdict
const problems: string[] = []
if (removedTotal > 0) problems.push(`${removedTotal} relationships REMOVED — an edge the old analyzer published is gone`)
if (lostTotal > 0) problems.push(`${lostTotal} metadata keys LOST — a published claim was withdrawn`)
if (flagLost > 0) problems.push(`${flagLost} edges lost isAssignedInFile — the pass can only add it`)
if (symRemoved > 0) problems.push(`${symRemoved} symbols REMOVED — a declaration the old analyzer published is gone`)
if (relAddedByType.has("uses")) problems.push(`uses edges ADDED (${relAddedByType.get("uses")}) — the metadata pass must not emit edges`)
if (relAddedByType.has("calls")) problems.push(`calls edges ADDED (${relAddedByType.get("calls")}) — nothing in this change touches calls`)
if (relAddedByType.has("imports")) problems.push(`imports edges ADDED (${relAddedByType.get("imports")})`)
if (relAddedByType.has("references")) problems.push(`references edges ADDED (${relAddedByType.get("references")})`)
if (relAddedByType.has("exports")) problems.push(`exports edges ADDED (${relAddedByType.get("exports")})`)
if (relAddedByType.has("overrides")) problems.push(`overrides edges ADDED (${relAddedByType.get("overrides")})`)
const addedContains = relAddedByType.get("contains") ?? 0
if (addedContains !== EXPECT_CONTAINS) {
  problems.push(`contains ADDED ${addedContains}, the tree census PREDICTED ${EXPECT_CONTAINS}`)
}
if (symAdded !== EXPECT_SYMBOLS) {
  problems.push(`symbols ADDED ${symAdded}, the tree census PREDICTED ${EXPECT_SYMBOLS}`)
}
console.log(`\nPREDICTED from the tree census: +${EXPECT_SYMBOLS} symbols, +${EXPECT_CONTAINS} contains, 0 edges of any other type, 0 metadata keys lost.`)
if (problems.length === 0) {
  console.log(`VERDICT: PASS — every prediction held.`)
} else {
  console.log(`VERDICT: FAIL`)
  for (const p of problems) console.log(`  - ${p}`)
  process.exit(1)
}