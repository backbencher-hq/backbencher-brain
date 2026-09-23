/**
 * M14.0.F11 — grammar-leaf admissibility gate
 *
 * WHY THIS EXISTS. #743's waves each measured three things by hand: per-file tree
 * digests, "zero clean files change tree shape", and "REAL-LOSS 0" on the analyzer's
 * own output. Those are the right three, but they lived in whichever analysis script
 * the wave happened to be running, so the next candidate started from zero — and the
 * #825 / #743 lineage shows what that costs: a candidate relaxation of the bare
 * macro-statement class collapsed the single biggest recovery cluster in both cpp
 * corpora (411 MISSING `;` sites / 67 files -> 65 / 55), fixed 9 files and broke none
 * *by ERROR/MISSING counts*, while silently re-shaping **119 of 361 already-clean cpp
 * files** (71 of 200 in c). The count-level view said "pure win". This gate is the
 * other two views, made runnable and pinned.
 *
 * F10 (`verify-parse-success.ts`) measures how much of each corpus the PINNED grammar
 * parses. It cannot judge a candidate that improves that number, and it deliberately
 * does not: a grammar leaf is admissible only when it moves damage in the right
 * direction AND leaves everything else alone. Three gates, all required:
 *
 *   G1 damage   — per-file ERROR/MISSING census, pinned vs candidate: no file may
 *                 become newly damaged; fixed / improved / worse are reported with
 *                 the direction of the site kinds (an ERROR node that becomes a
 *                 MISSING token is a KIND change at equal severity, reported as such
 *                 rather than as a win or a loss)
 *   G2 identity — every file that is CLEAN under the pinned grammar must produce a
 *                 byte-identical s-expression. This is the gate that catches alias and
 *                 hidden-rule spellings, which add a wrapper node without disturbing
 *                 any count.
 *   G3 output   — the production analyzer (`parseFile`, the entry the pipeline uses)
 *                 must lose no symbol name, no owner qualifier and no (label,target)
 *                 pair across the designated corpora. A pair whose source moved is a
 *                 re-attribution; one with no counterpart at all is real loss.
 *
 * The candidate is an artifact on disk, not a tree mutation: this gate never edits a
 * grammar or a committed wasm. It swaps the language's wasm around the analyzer phase
 * and restores it in a `finally` plus on exit/SIGINT/SIGTERM, because a killed run
 * must never leave a candidate grammar in the tree. Each analyzer phase runs in its
 * own child process (`--dump`), so no parser cache from one grammar survives into the
 * other — the same reason F10 gives every lane its own module.
 *
 * Verdicts: `admissible` (0) · `inadmissible` (1) with the failing gate named.
 *
 * Usage:
 *   bun script/m14/verify-grammar-leaves.ts --lang cpp --candidate /tmp/cand.wasm
 *   bun script/m14/verify-grammar-leaves.ts --lang c --candidate /tmp/cand.wasm --repo jq
 *   bun script/m14/verify-grammar-leaves.ts --lang cpp --candidate /tmp/cand.wasm --emit
 */

import { execFileSync, execSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import * as WTS from "web-tree-sitter"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { emitEvidence } from "./evidence-harness"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const argv = process.argv.slice(2)
const hasArg = (a: string) => argv.includes(a)
const argValue = (a: string, dflt?: string) => (argv.includes(a) ? argv[argv.indexOf(a) + 1] : dflt)

// Child mode first: the analyzer phase must never be gated on the parent's own
// argument validation.
if (hasArg("--dump")) {
  await dump(argValue("--dump-lang", "cpp")!, argv[argv.indexOf("--dump") + 1], argv[argv.indexOf("--dump") + 2], parseInt(argValue("--dump-limit", "0")!, 10))
  process.exit(0)
}

type Lane = { wasm: string; repos: string[]; sample: number }
const LANES: Record<string, Lane> = {
  c: { wasm: "wasm/tree-sitter-c.wasm", repos: ["sqlite", "jq"], sample: 400 },
  cpp: { wasm: "wasm/tree-sitter-cpp.wasm", repos: ["fmt", "nlohmann-json"], sample: 400 },
}
const CORPUS = "$HOME/fixtures/repositories"

const LANG = argValue("--lang", "cpp")!
const CANDIDATE = argValue("--candidate")
const lane = LANES[LANG]
if (!lane) { console.error(`unknown --lang ${LANG} (expected ${Object.keys(LANES).join(" | ")})`); process.exit(2) }
if (!CANDIDATE || !existsSync(CANDIDATE)) { console.error("usage: verify-grammar-leaves.ts --lang <c|cpp> --candidate <wasm> [--repo X] [--emit]"); process.exit(2) }
const repos = hasArg("--repo") ? [argValue("--repo")!] : lane.repos
const sample = parseInt(argValue("--sample", String(lane.sample))!, 10)

// ---------------------------------------------------------------- child: analyzer dump
// Routing is the product's: a file is in the lane when the pipeline's own
// `detectLanguageFromPath` names that language, so the `.h` sniff included.
async function dump(lang: string, repoDir: string, outPath: string, limit: number) {
  const { parseFile } = await import("../../src/ast/engine")
  const files = execSync("git ls-files", { cwd: repoDir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
    .split("\n").map(f => f.trim()).filter(Boolean)
    .filter(f => detectLanguageFromPath(f) === lang)
    .sort()
  const drawn = limit > 0 ? files.slice(0, limit) : files
  const out: Record<string, any> = {}
  for (const rel of drawn) {
    const abs = path.join(repoDir, rel)
    let src: string
    try { src = readFileSync(abs, "utf8") } catch { continue }
    let res: any
    try {
      res = await parseFile(abs, src, { language: lang })
    } catch (e: any) {
      out[rel] = { error: String(e?.message ?? e).slice(0, 120) }
      continue
    }
    out[rel] = {
      symbols: (res.symbols ?? [])
        .map((s: any) => `${s.range?.startLine}:${s.kind}:${s.name}${s.ownerName ? "@" + s.ownerName : ""}`).sort(),
      rels: (res.relationships ?? [])
        .map((r: any) => `${r.line_number}:${r.type}:${r.source}->${r.target}#${r.metadata?.relationshipType ?? ""}`).sort(),
    }
  }
  writeFileSync(outPath, JSON.stringify(out, null, 0))
  console.log(`dump ${lang} ${path.basename(repoDir)}: ${drawn.length} files`)
}

// ---------------------------------------------------------------- shared parsing
const WTSAny: any = WTS
const ParserCtor = WTSAny.Parser ?? WTSAny.default ?? WTSAny
const LanguageCtor = WTSAny.Language ?? WTSAny.default?.Language
await ParserCtor.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })

async function makeParser(wasmPath: string) {
  const lang = await LanguageCtor.load(readFileSync(wasmPath))
  const p = new ParserCtor()
  p.setLanguage(lang)
  return p
}

type Census = { errorSites: number; missingSites: number; errorLines: number }
function census(root: any): Census {
  let errorSites = 0, missingSites = 0, errorLines = 0
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()!
    if (n.isError || n.type === "ERROR") { errorSites++; errorLines += n.endPosition.row - n.startPosition.row + 1 }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c?.isMissing) missingSites++
      st.push(c)
    }
  }
  return { errorSites, missingSites, errorLines }
}
const damaged = (c: Census) => c.errorSites + c.missingSites > 0

function laneFiles(repo: string): string[] {
  const repoDir = path.join(CORPUS, repo)
  const files: string[] = []
  const collect = (dir: string) => {
    if (files.length >= sample) return
    let entries: any[] = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (files.length >= sample) return
      const p = path.join(dir, e.name)
      if (e.isDirectory()) collect(p)
      else if (detectLanguageFromPath(path.relative(CORPUS, p)) === LANG) files.push(p)
    }
  }
  collect(repoDir)
  return files.sort()
}

// ---------------------------------------------------------------- G1 + G2
const pinnedWasm = path.join(ROOT, lane.wasm)
const pinnedParser = await makeParser(pinnedWasm)
const candParser = await makeParser(CANDIDATE)

let filesPinnedDamaged = 0, filesCandDamaged = 0, cleanChecked = 0
const fixed: string[] = [], newlyDamaged: string[] = [], improved: string[] = [], worse: string[] = []
const identityBreaks: string[] = []
const kinder: string[] = [] // ERROR node -> MISSING token at equal site count
let sitesPinned = 0, sitesCand = 0, missingPinned = 0, missingCand = 0, errorLinesPinned = 0, errorLinesCand = 0

for (const repo of repos) {
  for (const file of laneFiles(repo)) {
    let src: string
    try { src = readFileSync(file, "utf8") } catch { continue }
    const rootA = pinnedParser.parse(src).rootNode
    const ca = census(rootA)
    const rootB = candParser.parse(src).rootNode
    const cb = census(rootB)
    sitesPinned += ca.errorSites + ca.missingSites; sitesCand += cb.errorSites + cb.missingSites
    missingPinned += ca.missingSites; missingCand += cb.missingSites
    errorLinesPinned += ca.errorLines; errorLinesCand += cb.errorLines
    if (damaged(ca)) filesPinnedDamaged++
    if (damaged(cb)) filesCandDamaged++
    const rel = path.relative(CORPUS, file)
    const sa = ca.errorSites + ca.missingSites, sb = cb.errorSites + cb.missingSites
    if (sa !== sb || ca.errorSites !== cb.errorSites) {
      if (sa > 0 && sb === 0) fixed.push(rel)
      else if (sb > 0 && sa === 0) newlyDamaged.push(rel)
      else if (sb < sa) improved.push(rel)
      else if (sb > sa) worse.push(rel)
      else kinder.push(rel)
    }
    // G2: clean under pinned must be byte-identical under the candidate
    if (!damaged(ca)) {
      cleanChecked++
      if (rootA.toString() !== rootB.toString()) {
        identityBreaks.push(`${rel}${damaged(cb) ? " (now damaged)" : ""}`)
      }
    }
  }
}

// ---------------------------------------------------------------- G3: analyzer A/B
const work = mkdtempSync(path.join(tmpdir(), "f11-"))
const pinnedBytes = readFileSync(pinnedWasm)
let restored = false
const restore = () => { if (!restored) { writeFileSync(pinnedWasm, pinnedBytes); restored = true } }
process.on("exit", restore)
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { restore(); process.exit(130) })

const self = process.argv[1]
const spawnDump = (wasmInTree: string, repo: string, tag: string) => {
  const dir = path.join(CORPUS, repo)
  if (!existsSync(dir)) return null
  const outPath = path.join(work, `${LANG}-${tag}-${repo}.json`)
  writeFileSync(pinnedWasm, wasmInTree === "candidate" ? readFileSync(CANDIDATE) : pinnedBytes)
  execFileSync(process.execPath, [self, "--dump", dir, outPath, "--dump-lang", LANG, "--dump-limit", String(sample)], { stdio: ["ignore", "pipe", "pipe"], cwd: ROOT })
  return outPath
}

try {
  for (const repo of repos) spawnDump("candidate", repo, "post")
} finally {
  restore()
}
for (const repo of repos) spawnDump("pinned", repo, "pre")
restore()

// classification
const pairOf = (r: string): string => {
  const m = r.match(/^\d+:([^:]+):(.*?)#/)
  if (!m) return r
  const arrow = m[2].lastIndexOf("->")
  return `${m[1]}|${arrow >= 0 ? m[2].slice(arrow + 2) : m[2]}`
}
const baseOf = (s: string): string => s.match(/^(\d+:(?:function|class|method|variable|interface|enum|struct|property|constructor):[^@]+)/)?.[1] ?? s
let symAdded = 0, symRemoved = 0, qualifierChanged = 0, vanished = 0
const vanishedRows: string[] = []
const qualifierRows: string[] = []
let pairsAdded = 0, pairsRemoved = 0, reAttributed = 0, lost = 0
const lostRows: string[] = []
let filesChanged = 0

for (const repo of repos) {
  const prePath = path.join(work, `${LANG}-pre-${repo}.json`)
  const postPath = path.join(work, `${LANG}-post-${repo}.json`)
  if (!existsSync(prePath) || !existsSync(postPath)) continue
  const pre = JSON.parse(readFileSync(prePath, "utf8"))
  const post = JSON.parse(readFileSync(postPath, "utf8"))
  for (const rel of Object.keys(pre)) {
    const a = pre[rel], b = post[rel]
    if (!a || !b || a.error || b.error) continue
    const symA = new Set<string>(a.symbols), symB = new Set<string>(b.symbols)
    const removedSyms: string[] = a.symbols.filter((s: string) => !symB.has(s))
    const addedSyms: string[] = b.symbols.filter((s: string) => !symA.has(s))
    const setA = new Set<string>(a.rels), setB = new Set<string>(b.rels)
    const removedRels: string[] = a.rels.filter((r: string) => !setB.has(r))
    const addedRels: string[] = b.rels.filter((r: string) => !setA.has(r))
    if (!removedSyms.length && !addedSyms.length && !removedRels.length && !addedRels.length) continue
    filesChanged++
    symAdded += addedSyms.length; symRemoved += removedSyms.length
    const addedBases = new Set(addedSyms.map(baseOf))
    for (const s of removedSyms) {
      if (addedBases.has(baseOf(s))) { qualifierChanged++; if (qualifierRows.length < 20) qualifierRows.push(`${repo}/${rel}  ${s}`) }
      else { vanished++; if (vanishedRows.length < 20) vanishedRows.push(`${repo}/${rel}  ${s}`) }
    }
    pairsAdded += addedRels.length; pairsRemoved += removedRels.length
    const addedKeys = new Set(addedRels.map(pairOf))
    for (const r of removedRels) {
      if (addedKeys.has(pairOf(r))) reAttributed++
      else { lost++; if (lostRows.length < 20) lostRows.push(`${repo}/${rel}  ${r}`) }
    }
  }
}

// ---------------------------------------------------------------- verdict
const reasons: string[] = []
if (newlyDamaged.length) reasons.push(`G1: ${newlyDamaged.length} file(s) newly damaged`)
if (vanished) reasons.push(`G3: ${vanished} symbol name(s) vanished`)
if (qualifierChanged) reasons.push(`G3: ${qualifierChanged} symbol(s) changed owner qualifier`)
if (lost) reasons.push(`G3: ${lost} (label,target) pair(s) lost`)
if (identityBreaks.length) reasons.push(`G2: ${identityBreaks.length} clean file(s) changed tree shape`)
const admissible = reasons.length === 0

console.log(`\n# M14.0.F11 grammar-leaf admissibility — ${LANG}`)
console.log(`candidate: ${CANDIDATE}  (pinned: ${lane.wasm} ${pinnedBytes.length} B / candidate ${readFileSync(CANDIDATE).length} B)`)
console.log(`corpora: ${repos.join(", ")}   sample cap: ${sample} file(s) per corpus\n`)
console.log(`G1 damage    files damaged ${filesPinnedDamaged} -> ${filesCandDamaged} | sites ${sitesPinned} -> ${sitesCand} | MISSING ${missingPinned} -> ${missingCand} | ERROR lines ${errorLinesPinned} -> ${errorLinesCand}`)
console.log(`             fixed ${fixed.length} · newly damaged ${newlyDamaged.length} · improved ${improved.length} · worse ${worse.length} · ERROR->MISSING kind-change ${kinder.length}`)
if (fixed.length) console.log(`             fixed: ${fixed.slice(0, 8).join(", ")}${fixed.length > 8 ? ` (+${fixed.length - 8})` : ""}`)
if (newlyDamaged.length) console.log(`             NEWLY DAMAGED: ${newlyDamaged.slice(0, 8).join(", ")}`)
if (worse.length) console.log(`             worse: ${worse.slice(0, 8).join(", ")}`)
console.log(`G2 identity  clean-under-pinned ${cleanChecked} · tree differences ${identityBreaks.length}${identityBreaks.length ? " <-- BLOCKS" : ""}`)
for (const r of identityBreaks.slice(0, 10)) console.log(`             ${r}`)
console.log(`G3 output    files changed ${filesChanged} | symbols +${symAdded} -${symRemoved} (qualifier-changed ${qualifierChanged}, VANISHED ${vanished}) | pairs +${pairsAdded} -${pairsRemoved} (re-attributed ${reAttributed}, LOST ${lost})`)
for (const r of vanishedRows.slice(0, 8)) console.log(`             VANISHED ${r}`)
for (const r of qualifierRows.slice(0, 6)) console.log(`             qualifier ${r}`)
for (const r of lostRows.slice(0, 8)) console.log(`             LOST ${r}`)

console.log(`\nverdict: ${admissible ? "ADMISSIBLE (exit 0)" : "INADMISSIBLE (exit 1)"}`)
for (const r of reasons) console.log(`  ${r}`)

if (hasArg("--emit")) {
  const out = emitEvidence({
    issueId: "M14.0.F11",
    title: `Grammar-leaf admissibility gate — ${LANG} candidate ${path.basename(CANDIDATE)}`,
    claimLevel: "L3",
    layers: ["grammar", "analyzer", "corpus"],
    checks: [
      { id: "F11.G1", description: "no file becomes newly damaged", status: newlyDamaged.length ? "fail" : "pass", detail: `fixed=${fixed.length} newly=${newlyDamaged.length} improved=${improved.length} worse=${worse.length}` },
      { id: "F11.G2", description: "every file clean under the pinned grammar keeps a byte-identical s-expression", status: identityBreaks.length ? "fail" : "pass", detail: `${cleanChecked} clean file(s) checked, ${identityBreaks.length} difference(s)` },
      { id: "F11.G3", description: "the analyzer loses no symbol name, qualifier or (label,target) pair", status: vanished + qualifierChanged + lost === 0 ? "pass" : "fail", detail: `vanished=${vanished} qualifier-changed=${qualifierChanged} lost=${lost} added=[symbols ${symAdded}, pairs ${pairsAdded}]` },
    ],
    limitations: [
      { description: "G3 measures the designated corpora at the gate's sample cap, not every repo the product will see.", justification: "the sample is the same deterministic draw F10 pins, so a regression inside the draw is caught and the digest makes the set reproducible" },
      { description: "The gate decides admissibility of an artifact; it does not re-pin F10 floors or fixtures, which stay the wave's own commit.", justification: "separation of measurement from adoption" },
    ],
    corpusPins: Object.fromEntries(repos.map(r => {
      try { return [r, execSync("git rev-parse HEAD", { cwd: path.join(CORPUS, r) }).toString().trim()] }
      catch { return [r, "unknown"] }
    })),
    data: {
      lang: LANG,
      candidate: path.basename(CANDIDATE),
      repos,
      sample,
      g1: { filesPinnedDamaged, filesCandDamaged, sitesPinned, sitesCand, missingPinned, missingCand, errorLinesPinned, errorLinesCand, fixed: fixed.length, newlyDamaged: newlyDamaged.length, improved: improved.length, worse: worse.length, kindChange: kinder.length },
      g2: { cleanChecked, identityBreaks: identityBreaks.length },
      g3: { filesChanged, symAdded, symRemoved, qualifierChanged, vanished, pairsAdded, pairsRemoved, reAttributed, lost },
      admissible,
      reasons,
    },
  })
  console.log(`evidence: ${path.relative(ROOT, out)}`)
}

rmSync(work, { recursive: true, force: true })
restore()
process.exit(admissible ? 0 : 1)
