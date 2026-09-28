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
  // M60 functional/clean lane. The four repos are every Clean source base on this box
  // (312 tracked .icl/.dcl in total, and the lane's own M12 pin is a 41-file subset of one
  // of them), so this is the widest draw the grammar decision can be taken on TODAY —
  // disclosed as below the owner's heavy-corpus standard (900+), which the lane still owes.
  // `eastwood` is a Clean language server, not the Clojure linter of the same name.
  clean: { wasm: "wasm/tree-sitter-clean.wasm", repos: ["Clyde", "clean-stdlib", "Prelude", "cloogle.org", "eastwood"], sample: 400 },
  // M60 sql lane. TWO corpora, deliberately, and the reason is a caveat the M12
  // claim could not discharge on its own:
  //   proxicall (438 tracked .sql) is the owner's OWN project
  //     (github.com/ishaq2321/ProxiCall) — PostgreSQL DDL, one team's style. A
  //     verdict taken on it alone is a claim about their corpus, not about SQL.
  //   postgrest (32 tracked .sql) is a public third-party Postgres project, and
  //     it is the only public Postgres DDL corpus on this box, so the same
  //     grammar decision gets read against a corpus nobody here wrote.
  // Both are reported; a candidate that only wins on one is not a win.
  sql: { wasm: "wasm/tree-sitter-sql.wasm", repos: ["proxicall", "postgrest"], sample: 400 },
  // M60 fsharp lane. The corpus is the F# compiler itself — 6,627 tracked
  // .fs/.fsi/.fsx at 22a8a5dc, the heaviest draw any of these lanes has, and the
  // lane the repo's own triage (commit 344f176b) reduced from a 26.8% parse rate
  // to six named grammar gaps.
  //
  // TWO corpora, because the first is not representative: the compiler's `src/` is
  // where procedural and inline-IL code lives, and `tests/` plus the tooling repos
  // are ordinary library F#. A candidate that wins on one and not the other has not
  // won. `fsharp` is the compiler; `FSharp.Core` is a separate checkout if present.
  fsharp: { wasm: "wasm/tree-sitter-fsharp.wasm", repos: ["fsharp"], sample: 400 },
}
const CORPUS = "$HOME/fixtures/repositories"

const LANG = argValue("--lang", "cpp")!
const CANDIDATE = argValue("--candidate")
const lane = LANES[LANG]
if (!lane) { console.error(`unknown --lang ${LANG} (expected ${Object.keys(LANES).join(" | ")})`); process.exit(2) }
if (!CANDIDATE || !existsSync(CANDIDATE)) { console.error(`usage: verify-grammar-leaves.ts --lang <${Object.keys(LANES).join("|")}> --candidate <wasm> [--repo X] [--emit]`); process.exit(2) }
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
// The ADDED side, for the same reason the removed side is listed: without it a reader
// cannot tell a LOSS from a MOVE. Measured on the clean v1.2.7 candidate: G3 keys are
// line-inclusive, and that grammar's whole point is fixing positions (`conversions` is
// published at the source's line 354 while the file writes the name at 31/118/122/123),
// so a corrected position reads as one vanished name plus one added name — a move.
const addedSymbolRows: string[] = []
const addedPairRows: string[] = []
// Uncapped copies, because the repair-aware classification below must see EVERY row to be
// sound: a 400-row cap would make "is this name declared in its file?" depend on row order.
const vanishedAll: string[] = []
const addedSymAll: string[] = []
const lostAll: string[] = []
const addedPairAll: string[] = []
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
    for (const s of addedSyms) { addedSymAll.push(`${repo}/${rel}  ${s}`); if (addedSymbolRows.length < 400) addedSymbolRows.push(`${repo}/${rel}  ${s}`) }
    for (const r of addedRels) { addedPairAll.push(`${repo}/${rel}  ${r}`); if (addedPairRows.length < 400) addedPairRows.push(`${repo}/${rel}  ${r}`) }
    const addedBases = new Set(addedSyms.map(baseOf))
    for (const s of removedSyms) {
      if (addedBases.has(baseOf(s))) { qualifierChanged++; if (qualifierRows.length < 100) qualifierRows.push(`${repo}/${rel}  ${s}`) }
      else { vanished++; vanishedAll.push(`${repo}/${rel}  ${s}`); if (vanishedRows.length < 400) vanishedRows.push(`${repo}/${rel}  ${s}`) }
    }
    pairsAdded += addedRels.length; pairsRemoved += removedRels.length
    const addedKeys = new Set(addedRels.map(pairOf))
    for (const r of removedRels) {
      if (addedKeys.has(pairOf(r))) reAttributed++
      else { lost++; lostAll.push(`${repo}/${rel}  ${r}`); if (lostRows.length < 400) lostRows.push(`${repo}/${rel}  ${r}`) }
    }
  }
}

// ---------------------------------------------- G3 repair-aware identity (moved / fabricated)
//
// Two repairs, both measured on tree-sitter-clean v1.2.7 before being written down.
//
// 1. POSITION IS NOT IDENTITY. `baseOf` keys a symbol on `^\d+:kind:name@owner`, so a
//    corrected LINE reads as one vanished symbol plus one added one. On a grammar whose whole
//    release note is fixing positions that is the wrong instrument: 7 of 142 vanished names
//    were the same (kind,name,owner) at a different line. Identity is (kind,name,owner); the
//    line is evidence.
//
// 2. FABRICATION. A vanished name is not a loss unless the file declares it. Three classes are
//    not declarations under this analyzer's own design — a `where`-local is scoped noise by
//    declaration (M11.11 closure boundary), a reserved word is not a name, and a StdEnv
//    predefine is bound by the environment. Measured: 63 of the 122 residue rows were
//    where-locals and 58 had no module-level declaration at all, including the first
//    parameter of a function published under the parameter's own name.
//
// What survives both repairs and IS declared at module level is the residue, and only the
// residue blocks. The repairs remove false accusations, never evidence: every class is
// emitted with its rows.
type SymRow = { file: string; line: number | null; kind: string; name: string; owner: string | null }
const parseSymRow = (row: string): SymRow | null => {
  const file = row.split(/\s+/)[0]
  const rest = row.slice(file.length).trim()
  const m = rest.match(/^(\d+):([a-z]+):(.+)$/)
  if (!m) return null
  let name = m[3]
  let owner: string | null = null
  const at = name.lastIndexOf("@")
  if (at >= 0) { owner = name.slice(at + 1); name = name.slice(0, at) }
  return { file, line: Number(m[1]), kind: m[2], name, owner }
}
const symIdent = (s: SymRow) => `${s.kind}:${s.name}@${s.owner ?? ""}`

const CLEAN_KEYWORDS = new Set(["where", "type", "instance", "class", "import", "from", "of", "if", "then", "else", "case", "let", "in", "with", "derive", "foreign", "export", "module", "implementation", "definition", "system", "infix", "infixl", "infixr", "special", "generic", "priority"])
const CLEAN_PREDEFINES = new Set(["Int", "Real", "Bool", "Char", "String", "List", "Maybe", "Array", "Void", "otherwise", "True", "False", "Nil", "Cons", "Just", "Nothing", "File", "World"])
// The scope rules are Clean's node vocabulary; for another lane only the (sound, language
// independent) position repair applies and every remaining row stays residue. A lane that
// wants its own fabrication rule adds its own declaration shapes here.
const scopeRulesForLang = LANG === "clean"

const declCache = new Map<string, Set<string>>()
/** Names declared at module level under the CANDIDATE tree (where-locals excluded). */
const moduleLevelDecls = (rel: string): Set<string> => {
  const hit = declCache.get(rel)
  if (hit) return hit
  const out = new Set<string>()
  let src: string
  try { src = readFileSync(path.join(CORPUS, rel), "utf8") } catch { declCache.set(rel, out); return out }
  const root = candParser.parse(src).rootNode
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "function_declaration" || n.type === "type_signature") {
      let nm: string | undefined
      const byField = n.childForFieldName?.("name") ?? null
      if (byField?.text) nm = byField.text
      if (!nm) {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (n.type === "function_declaration" && c.type === "identifier") { nm = c.text; break }
          if (n.type === "type_signature" && c.type === "signature_name") { nm = c.text; break }
        }
      }
      if (nm) {
        let cur = n.parent
        let local = false
        while (cur) { if (cur.type === "where_block") { local = true; break } cur = cur.parent }
        if (!local) out.add(nm)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  declCache.set(rel, out)
  return out
}

const addedIdentLines = new Map<string, Set<number>>()
for (const row of addedSymAll) {
  const s = parseSymRow(row)
  if (!s) continue
  const k = `${s.file}\u0000${symIdent(s)}`
  const set = addedIdentLines.get(k) ?? new Set<number>()
  if (s.line !== null) set.add(s.line)
  addedIdentLines.set(k, set)
}

const symbolMoved: string[] = []
const symbolRetiredKeyword: string[] = []
const symbolRetiredPredefine: string[] = []
const symbolFabricated: string[] = []
const symbolResidue: string[] = []
const retiredNamesByFile = new Map<string, Set<string>>()
const retireName = (file: string, name: string) => {
  const s = retiredNamesByFile.get(file) ?? new Set<string>()
  s.add(name)
  retiredNamesByFile.set(file, s)
}
for (const row of vanishedAll) {
  const s = parseSymRow(row)
  if (!s) { symbolResidue.push(row); continue }
  const lines = addedIdentLines.get(`${s.file}\u0000${symIdent(s)}`)
  if (lines && [...lines].some((l) => l !== s.line)) { symbolMoved.push(row); retireName(s.file, s.name); continue }
  if (scopeRulesForLang && CLEAN_KEYWORDS.has(s.name)) { symbolRetiredKeyword.push(row); retireName(s.file, s.name); continue }
  if (scopeRulesForLang && CLEAN_PREDEFINES.has(s.name)) { symbolRetiredPredefine.push(row); retireName(s.file, s.name); continue }
  if (scopeRulesForLang && !moduleLevelDecls(s.file).has(s.name)) { symbolFabricated.push(row); retireName(s.file, s.name); continue }
  symbolResidue.push(row)
}

// An edge to a retired name is not an edge. Parse both endpoints of each lost pair.
const parsePairRow = (row: string) => {
  const file = row.split(/\s+/)[0]
  const rest = row.slice(file.length).trim()
  const m = rest.match(/^([^:]*):([a-z]+):(.*)$/)
  if (!m) return null
  const arrow = m[3].indexOf("->")
  if (arrow < 0) return null
  return { file, kind: m[2], src: m[3].slice(0, arrow), dst: m[3].slice(arrow + 2).replace(/#.*$/, "") }
}
const pairRetired: string[] = []
const pairResidue: string[] = []
for (const row of lostAll) {
  const p = parsePairRow(row)
  if (!p) { pairResidue.push(row); continue }
  const retired = retiredNamesByFile.get(p.file)
  const keywordEndpoint = scopeRulesForLang && (CLEAN_KEYWORDS.has(p.src) || CLEAN_KEYWORDS.has(p.dst))
  const retiredEndpoint = retired ? retired.has(p.src) || retired.has(p.dst) : false
  if (keywordEndpoint || retiredEndpoint) { pairRetired.push(row); continue }
  // A LOCAL call edge is emitted only for an application head the analyzer found in
  // `declaredFunctions`, and an edge is only attributed while a function is in scope. So for
  // `calls`, BOTH endpoints are declarations in this file by construction — `calls:step->paths`
  // where `paths` is a `#`-let local, or `calls:a->createArray` where `a` is a type variable, is
  // a pinned-side invention, not a lost edge. The rule is deliberately limited to `calls`:
  // `instantiates`/`references` targets legitimately live in other modules, and `contains`
  // targets include constructors that are not `function_declaration`s.
  if (scopeRulesForLang && p.kind === "calls") {
    const decls = moduleLevelDecls(p.file)
    if (!decls.has(p.src) || !decls.has(p.dst)) { pairRetired.push(row); continue }
  }
  pairResidue.push(row)
}

// ---------------------------------------------------------------- verdict
const reasons: string[] = []
if (newlyDamaged.length) reasons.push(`G1: ${newlyDamaged.length} file(s) newly damaged`)
if (symbolResidue.length) reasons.push(`G3: ${symbolResidue.length} declared symbol name(s) vanished`)
if (qualifierChanged) reasons.push(`G3: ${qualifierChanged} symbol(s) changed owner qualifier`)
if (pairResidue.length) reasons.push(`G3: ${pairResidue.length} (label,target) pair(s) lost`)
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
// The repair is reported as its own line, always: a repair that only shrinks a number without
// showing what it removed is indistinguishable from a gate that stopped looking.
console.log(`G3 repair    of ${vanished} vanished: moved-to-a-new-line ${symbolMoved.length}, retired keyword ${symbolRetiredKeyword.length}, retired predefine ${symbolRetiredPredefine.length}, not-a-declaration ${symbolFabricated.length} -> RESIDUE ${symbolResidue.length}`)
console.log(`             of ${lost} lost pairs: endpoint retired ${pairRetired.length} -> RESIDUE ${pairResidue.length}`)
for (const r of symbolResidue.slice(0, 10)) console.log(`             VANISHED ${r}`)
for (const r of qualifierRows.slice(0, 6)) console.log(`             qualifier ${r}`)
for (const r of pairResidue.slice(0, 8)) console.log(`             LOST ${r}`)

console.log(`\nverdict: ${admissible ? "ADMISSIBLE (exit 0)" : "INADMISSIBLE (exit 1)"}`)
for (const r of reasons) console.log(`  ${r}`)

// M60 (functional/clean lane): a SCOPED run must not overwrite another lane's evidence.
//
// Measured while adjudicating tree-sitter-clean v1.2.7: `emitEvidence` derives the file
// name from `issueId` alone, so `--lang clean --emit` overwrote the committed c/cpp
// verdict (`data.lang: "cpp"`, the f11-control-cpp run) — a scoped run destroying
// canonical evidence, which is the mirror of #943 (a gate trusting committed evidence
// that no longer describes HEAD). Fail-closed: when the canonical target already
// describes a DIFFERENT lane, this run writes its own lane-scoped artifact and leaves
// the other lane's evidence byte-identical; a run for the lane that already owns the
// canonical name keeps writing it.
const CANONICAL_F11 = path.join(ROOT, "validation/m14/results/M14.0.F11.json")
let ownsCanonical = true
try {
  const prev = JSON.parse(readFileSync(CANONICAL_F11, "utf8"))
  const prevLang = prev?.data?.lang ?? null
  if (prevLang && prevLang !== LANG) ownsCanonical = false
} catch { /* no prior artifact: the canonical name is free */ }

if (hasArg("--emit")) {
  const base = {
    title: `Grammar-leaf admissibility gate — ${LANG} candidate ${path.basename(CANDIDATE)}`,
    claimLevel: "L3",
    layers: ["grammar", "analyzer", "corpus"],
    checks: [
      { id: "F11.G1", description: "no file becomes newly damaged", status: newlyDamaged.length ? "fail" : "pass", detail: `fixed=${fixed.length} newly=${newlyDamaged.length} improved=${improved.length} worse=${worse.length}` },
      { id: "F11.G2", description: "every file clean under the pinned grammar keeps a byte-identical s-expression", status: identityBreaks.length ? "fail" : "pass", detail: `${cleanChecked} clean file(s) checked, ${identityBreaks.length} difference(s)` },
      { id: "F11.G3", description: "the analyzer loses no declared symbol name, qualifier or (label,target) pair", status: symbolResidue.length + qualifierChanged + pairResidue.length === 0 ? "pass" : "fail", detail: `residue=[symbols ${symbolResidue.length}, qualifier-changed ${qualifierChanged}, pairs ${pairResidue.length}] raw=[vanished ${vanished} lost ${lost}] repaired=[moved ${symbolMoved.length}, keyword ${symbolRetiredKeyword.length}, predefine ${symbolRetiredPredefine.length}, not-a-declaration ${symbolFabricated.length}, pairs-retired ${pairRetired.length}] added=[symbols ${symAdded}, pairs ${pairsAdded}]` },
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
      // A gate that reports "142 symbol name(s) vanished" as a COUNT and names eight of them
      // on stdout leaves its own worklist unreadable — the adjudication cannot be reproduced,
      // and a later run cannot say which items were ruled. The lists are bounded, and where a
      // bound bites it is recorded (`truncated`), never silently dropped.
      g2: { cleanChecked, identityBreaks: identityBreaks.length, identityBreakFiles: identityBreaks.slice(0, 200), identityBreakFilesTruncated: Math.max(0, identityBreaks.length - 200) },
      g3: {
        filesChanged, symAdded, symRemoved, qualifierChanged, vanished, pairsAdded, pairsRemoved, reAttributed, lost,
        vanishedSymbols: vanishedRows,
        vanishedSymbolsTruncated: Math.max(0, vanished - vanishedRows.length),
        addedSymbols: addedSymbolRows,
        qualifierChangedSymbols: qualifierRows,
        lostPairs: lostRows,
        lostPairsTruncated: Math.max(0, lost - lostRows.length),
        addedPairs: addedPairRows,
        // Repair-aware classes. `residue` is what the verdict reads; the other four are what
        // was ruled out and on what grounds, so the ruling is reproducible row by row.
        symbolMoved,
        symbolRetiredKeyword,
        symbolRetiredPredefine,
        symbolFabricated,
        symbolResidue,
        pairRetired,
        pairResidue,
        rawVanished: vanished,
        rawLost: lost,
      },
      admissible,
      reasons,
    },
  }
  // The artifact id must be a PLAIN LITERAL in the emit call: M49's producer
  // register (`verify-evidence-identity`) discovers a producer by the exact shape
  // `issueId: "M14…"` inside the emit window, so the variable id this gate used
  // first left BOTH M14.0.F11 and M14.0.F11.clean as orphans there. One declared
  // branch per lane, and an undeclared lane is refused rather than written as an
  // orphan.
  let out: string
  if (ownsCanonical) out = emitEvidence({ ...base, issueId: "M14.0.F11" })
  else if (LANG === "clean") out = emitEvidence({ ...base, issueId: "M14.0.F11.clean" })
  else if (LANG === "sql") out = emitEvidence({ ...base, issueId: "M14.0.F11.sql" })
  else if (LANG === "fsharp") out = emitEvidence({ ...base, issueId: "M14.0.F11.fsharp" })
  else throw new Error(
    `verify-grammar-leaves: --emit has no declared artifact id for lane "${LANG}" — add one literal emit call `
    + '(`{ ...base, issueId: "M14.0.F11.<lane>" }`) beside clean\'s, because a computed id writes an artifact that '
    + `M49 verify-evidence-identity reports as an orphan`,
  )
  console.log(`evidence: ${path.relative(ROOT, out)}`)
}

rmSync(work, { recursive: true, force: true })
restore()
process.exit(admissible ? 0 : 1)
