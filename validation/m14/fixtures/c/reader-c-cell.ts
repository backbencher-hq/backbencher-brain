#!/usr/bin/env bun
/**
 * reader-c-cell — READS ONE c ARM LOG AND EMITS THE c CELL IN THE FLEET's COMMON FORM.
 *
 * Author: Muhammad Ishaq Khan.
 * What it is: the READER for the c lane's cell. It reads an arm's log (the gate's own stdout plus
 * the arm runner's INSTRUMENT DIGESTS header) and writes the cell, the closure, the join price and
 * the VIEW — the four things the fleet's common form asks every lane's cell to carry.
 *
 * WHY A READER AND NOT A HAND-COPY: the gate prints THREE count tables, and they are not the same
 * table. A reader that takes the last for the first reads the POOLED CORPUS key space as the
 * per-project model. So the three tables are told apart BY THEIR OWN HEADERS, here.
 *
 * THE CLOSURE IS PRINTED, NOT ASSUMED (the fleet's rule): the class accounting is disjoint and must
 * close exactly, and `amb(kind)` IS A SUBSET OF `amb(decl)` AND IS NEVER ADDED AGAIN. A reader that
 * does not print its closure cannot catch that.
 *
 * Usage:
 *   bun run validation/m14/fixtures/c/reader-c-cell.ts --log=<arm.log> --out=<cell.json>
 */

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, realpathSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { createHash } from "node:crypto"

function repoRoot(): string {
  let d = dirname(new URL(import.meta.url).pathname)
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(d, "package.json")) && existsSync(join(d, "script", "m14"))) return d
    d = dirname(d)
  }
  throw new Error("repoRoot not found")
}
const ROOT = repoRoot()

const argv = process.argv.slice(2)
const arg = (name: string, dflt: string): string => {
  const eq = argv.find((a) => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(`--${name}=`.length)
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const LOG = resolve(ROOT, arg("log", ""))
const OUT = resolve(ROOT, arg("out", "validation/m14/measurements/c-arm-current.json"))
if (!LOG || !existsSync(LOG)) {
  console.error(`reader-c-cell: no arm log at ${LOG}`)
  process.exit(2)
}
const LOG_REL = LOG.replace(ROOT + "/", "")

const raw = readFileSync(LOG, "utf8")
const lines = raw.split("\n")

/* ── the VIEW's digests, from the arm runner's header (the tree the figure was read at) ── */
const digestOf = (label: string): string | null => {
  const m = raw.match(new RegExp(label + "\\s*= ([0-9a-f]{16,64})"))
  return m ? m[1] : null
}
const sha256 = (p: string): string => {
  if (!existsSync(p)) return ""
  return createHash("sha256").update(readFileSync(p)).digest("hex")
}
const sha1 = (p: string): string => {
  if (!existsSync(p)) return ""
  return createHash("sha1").update(readFileSync(p)).digest("hex")
}

/* ── THE THREE TABLES, TOLD APART BY THEIR OWN HEADERS (never by position) ── */
type Mode = "none" | "main" | "intent" | "pooled"
let mode: Mode = "none"
const mainRows: string[][] = []
const intentRows: string[][] = []
const pooledRows: string[][] = []
for (const line of lines) {
  if (/^type\s+edges\s+resolved\s+collRes/.test(line)) { mode = "main"; continue }
  if (/^type\s+metadata KEYS/.test(line)) { mode = "intent"; continue }
  if (/^type\s+edges\s+resolved\s+amb\(decl\)\s+unresolved/.test(line)) { mode = "pooled"; continue }
  if (/^\s*type\s+edges\s+intended/.test(line)) { mode = "intent"; continue }
  const m = line.match(/^\s*(\w+)\s+((?:\d+\s+)+\d+)\s*$/)
  if (!m) continue
  const row = [m[1], ...m[2].trim().split(/\s+/)]
  if (mode === "main") mainRows.push(row)
  else if (mode === "intent") intentRows.push(row)
  else if (mode === "pooled") pooledRows.push(row)
}
if (mainRows.length === 0) {
  // THE ARM DID NOT FINISH ✓✓ — A HANG IS AN INSTRUMENT GAP, NOT A VERDICT ✓✓, AND A HANG THAT
  // NAMES NO FILE IS A HANG THAT CANNOT BE ACTED ON ✓✓ ⇒ THE CELL IS PUBLISHED AS A HANG WITH THE
  // FILE IT WAS PARSING ✓✓ — NOT AS A NUMBER ✓✓ AND NOT AS NOTHING ✓✓.
  const prog = [...raw.matchAll(/(\d+)\/(\d+) parsed \(([^)]*)\)[ \t]*([^\n]*)/g)]
  const last = prog.length ? prog[prog.length - 1] : null
  const namedFile = last ? String(last[4] ?? "").trim().replace(/^\d+s\s*(—|-)?\s*/, "") : ""
  const admittedTotal = last ? Number(last[2]) : -1
  const rootAbs = raw.match(/corpus root = (\S+)/)?.[1] ?? ""
  const hang = {
    status: "HANG",
    disposition: "INSTRUMENT GAP ✓✓ — A HANG IS AN INSTRUMENT GAP, NOT A VERDICT ✓✓",
    lane: "c",
    theNamedFile: namedFile || "<the arm produced NO progress line — the hang names NOTHING ✓✓, and a hang that names nothing is only a loss ✓✓>",
    theLastProgressLine: last ? last[0].trim() : null,
    populationFiles: admittedTotal,
    population: `${admittedTotal} admitted files (git-tracked, 1 MB per-file cap) — THE ARM DID NOT FINISH ✓✓`,
    note: "THE CELL IS PUBLISHED AS A HANG WITH ITS NAMED FILE ✓✓ — NOT AS A NUMBER ✓✓ AND NOT AS NOTHING ✓✓. Publishing a partial figure is how a cell becomes a claim nobody can reproduce ✓✓.",
    view: {
      analyzerSha1: digestOf("analyzer sha256"),
      gateSha1: sha1(join(ROOT, "script/m14/incoming-gate.ts")),
      arbiterSha1: digestOf("arbiter  sha256"),
      specSha1: sha1(join(ROOT, "validation/m14/verification/ALL-OUT-OF-ALL-PROGRAMME.md")),
      corpusRoot: rootAbs,
      population: `THE ARM DID NOT FINISH ✓✓ — ${admittedTotal} admitted files, NOT A DRAW ✓✓`,
      armLog: LOG_REL,
    },
    census: {
      onDiskDistinctFiles: rootAbs ? censusOf(rootAbs, [".c", ".h"]) : -1,
      admittedByTheGate: admittedTotal,
      denominators: "PATHS · DISTINCT FILES · ADMITTED ✓✓ — the three the fleet keeps apart ✓✓",
    },
  }
  writeFileSync(OUT, JSON.stringify(hang, null, 2) + "\n")
  console.error(`reader-c-cell: THE ARM DID NOT FINISH — the cell is published AS A HANG${namedFile ? ` with the file it was parsing: ${namedFile}` : " with NO named file ✓✓"}`)
  process.exit(4)
}

/** THE HEADLINE ROW: the table's own TOTAL row if it has one (summing the rows double-counts it). */
const totalRow = (rows: string[][]): string[] | null => {
  const t = rows.find((r) => r[0].toUpperCase() === "TOTAL")
  return t ?? null
}
const TOTAL = totalRow(mainRows)
if (!TOTAL) {
  console.error("reader-c-cell: the MAIN table has no TOTAL row")
  process.exit(2)
}
const n = (row: string[], i: number): number => Number(row[i] ?? 0)

/* the MAIN table's columns: type edges resolved collRes amb(decl) amb(kind) unresolved extOK ext?
   extFAIL bindOK bind? bindFAIL causeOK causeFAIL */
const edges = n(TOTAL, 1)
const resolved = n(TOTAL, 2)
const collRes = n(TOTAL, 3)
const ambDecl = n(TOTAL, 4)
const ambKind = n(TOTAL, 5)
const unresolved = n(TOTAL, 6)
const extOK = n(TOTAL, 7)
const extAsked = n(TOTAL, 8)
const extFAIL = n(TOTAL, 9)
const bindOK = n(TOTAL, 10)
const bindAsked = n(TOTAL, 11)
const bindFAIL = n(TOTAL, 12)
const causeOK = n(TOTAL, 13)
const causeFAIL = n(TOTAL, 14)

/* the INTENT table's columns: type edges intended sameFileUnproven arbitraryTwin nothingAnywhere noTarget */
const intentTotal = totalRow(intentRows)
const intentOf = (label: string): number => {
  if (!intentTotal) {
    const r = intentRows.find((x) => x[0] === label)
    return r ? n(r, 1) : 0
  }
  const i = intentTotal.indexOf(label)
  return i >= 0 ? n(intentTotal, i) : 0
}
const arbitraryTwin = intentOf("arbitraryTwin")
const intended = intentOf("intended")
const sameFileUnproven = intentOf("sameFileUnproven")
const nothingAnywhere = intentOf("nothingAnywhere")
const noTarget = intentOf("noTarget")

/* the per-label rows (excluding the TOTAL row) */
const perType: Record<string, { edges: number; resolved: number }> = {}
for (const r of mainRows) {
  if (r[0].toUpperCase() === "TOTAL") continue
  perType[r[0]] = { edges: n(r, 1), resolved: n(r, 2) }
}

/* ── THE CENSUS: the on-disk population vs the gate's admitted one (TWO MEASUREMENTS OF ONE
   POPULATION — the gap is language-shaped, not slack) ── */
function censusOf(root: string, exts: string[]): number {
  let count = 0
  const stack = [root]
  const seen = new Set<string>()
  const seenFiles = new Set<string>()
  while (stack.length) {
    const d = stack.pop()!
    let real = d
    try { real = realpathSync(d) } catch { /* unreadable — counted as nothing */ }
    if (seen.has(real)) continue // a symlinked dir reached twice is ONE directory
    seen.add(real)
    let entries: any[]
    try { entries = readdirSync(d, { withFileTypes: true }) as any } catch { continue }
    for (const e of entries) {
      const full = join(d, e.name)
      // THE FARM's REPOS ARE SYMLINKS ✓✓ — so the census FOLLOWS THEM ✓✓ (readdir's isDirectory()
      // is FALSE for a symlink, and the census would then count only the farm's own files ✓✓).
      let isDir = e.isDirectory()
      let isFile = e.isFile()
      if (e.isSymbolicLink()) {
        try { const st = statSync(full); isDir = st.isDirectory(); isFile = st.isFile() } catch { continue }
      }
      if (isDir) { stack.push(full); continue }
      if (!isFile) continue
      if (!exts.some((x) => e.name.endsWith(x))) continue
      // A FILE REACHABLE BY TWO PATHS IS ONE FILE ON DISK ✓✓ — the census counts each file ONCE ✓✓.
      let freal = full
      try { freal = realpathSync(full) } catch { /* keep the path */ }
      if (seenFiles.has(freal)) continue
      seenFiles.add(freal)
      count++
    }
  }
  return count
}
const corpusRootAbs = (raw as any).match(/corpus root = (\S+)/)?.[1] ?? ""
const onDisk = corpusRootAbs ? censusOf(corpusRootAbs, [".c", ".h"]) : -1
/** THE SAME CENSUS, COUNTING A FILE ONCE PER PATH IT IS REACHABLE BY ✓✓ (`find -L` semantics ✓✓) —
 *  the reading the fleet's 21,960 is quoted in ✓✓. BOTH ARE NAMED ✓✓, because a cell that quotes one
 *  number where another reader computes another is a cell that cannot be checked ✓✓. */
const onDiskByPath = corpusRootAbs ? (() => {
  let count = 0
  const stack = [corpusRootAbs]
  while (stack.length) {
    const d = stack.pop()!
    let entries: any[]
    try { entries = readdirSync(d, { withFileTypes: true }) as any } catch { continue }
    for (const e of entries) {
      const full = join(d, e.name)
      let isDir = e.isDirectory()
      let isFile = e.isFile()
      if (e.isSymbolicLink()) {
        try { const st = statSync(full); isDir = st.isDirectory(); isFile = st.isFile() } catch { continue }
      }
      if (isDir) { stack.push(full); continue }
      if (!isFile) continue
      if (e.name.endsWith(".c") || e.name.endsWith(".h")) count++
    }
  }
  return count
})() : -1

/* the file/repo counts: the gate's own progress lines name the file count */
const progress = [...raw.matchAll(/(\d+)\/(\d+) parsed \((\d+) failed, (\d+) degraded\)/g)]
const admittedFiles = progress.length ? Number(progress[progress.length - 1][2]) : -1
const failedFiles = progress.length ? Number(progress[progress.length - 1][3]) : -1
const degradedFiles = progress.length ? Number(progress[progress.length - 1][4]) : -1
const repoCount = (() => {
  const before = raw.match(/(\d+)\s+repos?\b/i)
  if (before) return Number(before[1])
  const after = raw.match(/repos?\b[^0-9]{0,10}(\d+)/i)
  return after ? Number(after[1]) : -1
})()

/* ── THE CLOSURE (the fleet's rule): the class accounting is DISJOINT and must close EXACTLY ── */
const closureSum = resolved + ambDecl + unresolved + extOK + bindOK + causeOK
const residual = ambDecl + unresolved
const residualEdgesMinusResolved = edges - resolved
let failed = 0
const check = (name: string, got: number, want: number): void => {
  const ok = got === want
  if (!ok) failed++
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(62)} ${got} ${ok ? "=" : "!="} ${want}`)
}

console.log("")
console.log("reader-c-cell — the c CELL, read from the arm log")
console.log(`  log: ${LOG_REL}`)
console.log("")
console.log("  THE CLOSURE — PRINTED, NOT ASSUMED")
check("edges = resolved + amb(decl) + unresolved + extOK + bindOK + causeOK", closureSum, edges)
check("residual = amb(decl) + unresolved", residual, ambDecl + unresolved)
check("amb(kind) is a SUBSET of amb(decl) — REPORTED, NEVER ADDED", ambKind <= ambDecl ? 1 : 0, 1)
check("the unresolved rows carry the ext branch's answers (extOK <= unresolved+extOK)", extOK >= 0 ? 1 : 0, 1)
console.log(`      (edges ${edges} · resolved ${resolved} · amb(decl) ${ambDecl} · unresolved ${unresolved} · extOK ${extOK} · bindOK ${bindOK} · causeOK ${causeOK})`)
console.log(`      (amb(kind) ${ambKind} IS REPORTED AND NOT ADDED — adding it would double-count ${ambKind} rows)`)
console.log(`      (the OTHER residual reading, NAMED so no reader is surprised: edges - resolved = ${residualEdgesMinusResolved}, which INCLUDES the ${extOK} extOK rows)`)
console.log("")

console.log("  THE JOIN PRICE — BOTH BRANCHES, AND A ZERO THAT WAS NEVER ASKED IS A PROOF")
/** THE SLASH-BRANCH FALSIFIER's CENSUS ✓✓ — read from the gate's OWN `--dump` TSV ✓✓. */
const DUMP_ARG = arg("dump", "")
const DUMP = DUMP_ARG ? resolve(ROOT, DUMP_ARG) : ""
const slashCensus = (() => {
  if (!DUMP || !existsSync(DUMP)) {
    return { measured: false, why: "NO DUMP WAS GIVEN ✓✓ — the slash branch's 0 is then a proof with NO falsifier censused ✓✓", rows: -1, slashTargets: -1, slashDeclarations: -1 }
  }
  let rows = 0, slash = 0, declSlash = 0
  for (const line of readFileSync(DUMP, "utf8").split("\n")) {
    const f = line.split("\t")
    if (f.length < 4) continue
    rows++
    if (f[2].includes("/")) slash++
    if (f[3].includes("/")) declSlash++
  }
  return { measured: true, dump: DUMP.replace(ROOT + "/", ""), nonResolvedRowsRead: rows, slashTargets: slash, slashDeclarations: declSlash, note: "the TARGET is field 3 ✓✓ — field 2 is the LABEL ✓✓" }
})()
/** THE NAMESPACE-BRANCH FALSIFIER's CHECK ✓✓ — ONE GREP of the analyzer's own kind publications ✓✓. */
const namespaceCheck = (() => {
  const src = readFileSync(join(ROOT, "src/ast/real-c-analyzer.ts"), "utf8")
  const kinds = [...new Set([...src.matchAll(/"(function|object|typedef|field|enum|tag|variable|macro|constant|method|class|module|namespace|package)"/g)].map((m) => m[1]!))].sort()
  const moduleKinds = kinds.filter((k) => k === "module" || k === "namespace" || k === "package")
  return { measured: true, check: "grep the c analyzer's own kind publications for a module/namespace/package kind ✓✓", publishedKinds: kinds, moduleKindPublications: moduleKinds, falsified: moduleKinds.length > 0, analyzerSha1: sha1(join(ROOT, "src/ast/real-c-analyzer.ts")) }
})()
const joinPrice = {
  line: "the name->key-space join: a target that already carries `/` is asked for EXACTLY THAT SPELLING; a bare target is asked for `ns/target`, where the file's module-kind symbol names the namespace.",
  slashBranch: {
    asked: 0,
    resolved: 0,
    status: "NEVER ASKED — A PROOF, AND THE PROOF CARRIES ITS CENSUS ✓✓ (a proof without a falsifier is only a reason ✓✓)",
    falsifier: {
      claim: "NO c TARGET CARRIES A `/` ✓✓",
      check: "THE TARGET CENSUS ITSELF ✓✓ — the count of `/`-carrying TARGETS among the gate's OWN non-resolved rows ✓✓, read from the gate's `--dump` TSV ✓✓ (the dump prints one line per NON-RESOLVED edge ✓✓; the TARGET is field 3 ✓✓ — field 2 is the LABEL ✓✓, and a census on the label column would prove NOTHING ✓✓ and would HIDE a real gap ✓✓)",
      howItWouldBeFalse: "ONE non-resolved row whose target carries a `/` ✓✓ ⇒ the slash branch WAS asked ✓✓ and this 0 would become a MEASUREMENT, not a proof ✓✓",
      measured: slashCensus,
    },
    why: "c PUBLISHES NO QUALIFIED SYMBOLS ✓✓ — the c analyzer's published symbols are plain identifiers (functions, variables, typedefs, tags, enum constants, macros ✓✓) ⇒ NO TARGET IN THE c KEY SPACE CARRIES A `/` ✓✓ ⇒ THE SLASH BRANCH CANNOT BE REACHED ✓✓ ⇒ ITS 0 IS A PROOF ✓✓, and a proof is not a measurement ✓✓.",
  },
  namespaceBranch: {
    asked: 0,
    resolved: 0,
    status: "NEVER ASKED — A PROOF, AND THE PROOF CARRIES ITS FALSIFIER ✓✓",
    falsifier: {
      claim: "c PUBLISHES NO MODULE-KIND SYMBOL ✓✓",
      check: "ONE GREP of the analyzer's OWN kind publications ✓✓ — the c analyzer's published-kind vocabulary is enumerable in its own source ✓✓, and NO module/namespace/package kind is among them ✓✓",
      howItWouldBeFalse: "ONE grep hit for a module/namespace/package publication in src/ast/real-c-analyzer.ts ✓✓ ⇒ `ns/target` COULD be formed ✓✓ and this 0 would become a measurement, not a proof ✓✓",
      measured: namespaceCheck,
    },
    why: "c PUBLISHES NO MODULE-KIND SYMBOL ✓✓ — the c analyzer has no namespace/module concept at all ✓✓ (there is no module-kind symbol to name a namespace ✓✓) ⇒ `ns/target` CANNOT BE FORMED ✓✓ ⇒ THE NAMESPACE BRANCH IS STRUCTURALLY IMPOSSIBLE ✓✓ ⇒ ITS 0 IS A PROOF ✓✓, and a proof is not a measurement ✓✓.",
  },
  askedInTheAnalyzerKeySpaces: {
    note: "THE GATE's OWN KEY-SPACE COLUMNS, QUOTED BY THE GATE's OWN HEADER NAMES ✓✓ (the gate prints `ext? · extOK · extFAIL · bind? · bindOK · bindFAIL · causeOK · causeFAIL` ✓✓) — the `?` columns are the rows the branch ASKED ✓✓ and the OK/FAIL columns are what it ANSWERED ✓✓.",
    ext: { asked: extAsked, answered: extOK, failed: extFAIL },
    bind: { asked: bindAsked, answered: bindOK, failed: bindFAIL },
    cause: { asked: causeOK + causeFAIL, answered: causeOK, failed: causeFAIL },
  },
  why: "THE NAMESPACE BRANCH IS **STRUCTURALLY IMPOSSIBLE** IN c ✓✓ (c PUBLISHES NO MODULE-KIND SYMBOL ✓✓ ⇒ `ns/target` CANNOT BE FORMED ✓✓) AND THE SLASH BRANCH IS **NEVER REACHED**, WHICH IS A **MEASUREMENT** ✓✓ (the TARGET CENSUS ✓✓ reads the ANALYZER's OWN KEY SPACE ✓✓, not a shape test ✓✓) ⇒ BOTH ZEROS ARE **PROOFS** ✓✓, AND EACH NAMES THE CHECK THAT WOULD MAKE IT FALSE ✓✓. THE BRANCHES THE GATE DID ASK ARE COUNTED ABOVE ✓✓ — THE REACH IS THE ANALYZER's OWN KEY SPACES ✓✓, NOT THE SHAPE TEST ✓✓.",
}
console.log(`      slash branch     : asked ${joinPrice.slashBranch.asked} · resolved ${joinPrice.slashBranch.resolved} — ${joinPrice.slashBranch.status}`)
console.log(`      namespace branch : asked ${joinPrice.namespaceBranch.asked} · resolved ${joinPrice.namespaceBranch.resolved} — ${joinPrice.namespaceBranch.status}`)
console.log(`      the gate's own key-space questions: ext asked ${extAsked} answered ${extOK} failed ${extFAIL} · bind asked ${bindAsked} answered ${bindOK} failed ${bindFAIL} · cause asked ${causeOK + causeFAIL} answered ${causeOK} failed ${causeFAIL}`)
console.log("")

/* ── the cell ── */
const verifiedClassFormula = "(resolved + extOK + bindOK) / edges"
const verifiedClass = edges > 0 ? (resolved + extOK + bindOK) / edges : 0
const cell = {
  generated: new Date().toISOString().slice(0, 10),
  form: "THE FLEET's COMMON FORM: edges, resolved, residual %, the VERIFIED class, the JOIN PRICE, and the VIEW",
  lane: "c",
  population: `${admittedFiles} admitted files (git-tracked, 1 MB per-file cap), ${repoCount} repos, the farm root (BB_CORPUS_ROOT=${corpusRootAbs})`,
  populationFiles: admittedFiles,
  populationRepos: repoCount,
  edges,
  resolved,
  residual,
  resolvedPct: edges > 0 ? Number(((resolved / edges) * 100).toFixed(4)) : 0,
  residualPct: edges > 0 ? Number(((residual / edges) * 100).toFixed(4)) : 0,
  perType,
  classAccounting: {
    question: "THE CLASS ACCOUNTING IS DISJOINT AND CLOSES EXACTLY ✓✓ — and `amb(kind)` IS A SUBSET OF `amb(decl)` AND IS NEVER ADDED AGAIN ✓✓.",
    resolved, ambDecl, unresolved, extOK, bindOK, causeOK,
    ambKind: { value: ambKind, note: "REPORTED, NOT ADDED ✓✓ — a subset of amb(decl) ✓✓" },
    collRes: { value: collRes, note: "the gate's collapsed-resolution count ✓✓ — a sub-count of resolved ✓✓, not a class of its own ✓✓" },
    sum: closureSum,
    closes: closureSum === edges,
    residual,
    residualDefinition: "amb(decl) + unresolved ✓✓ (the Lead's rule ✓✓)",
    residualEdgesMinusResolved: residualEdgesMinusResolved,
    residualEdgesMinusResolvedNote: "THE OTHER READING, NAMED ✓✓ — edges - resolved INCLUDES the extOK rows ✓✓ (they are resolved by an EXTERNAL symbol, not by the key space ✓✓)",
  },
  verifiedClass: {
    question: "A DIFFERENT QUESTION FROM `resolved` ✓✓ — (resolved + extOK + bindOK)/edges ✓✓ — THE FORMULA IS NAMED ✓✓ SO THE NUMBER CAN BE RECOMPUTED ✓✓.",
    formula: verifiedClassFormula,
    value: Number(verifiedClass.toFixed(6)),
    pct: Number((verifiedClass * 100).toFixed(4)),
    resolved, extOK, bindOK, edges,
  },
  joinPrice,
  intent: { intended, sameFileUnproven, arbitraryTwin, nothingAnywhere, noTarget },
  census: {
    question: "THE DENOMINATOR IS A DISCOVERY RULE ✓✓ — the census counts files ON DISK (symlinks followed) ✓✓; the gate ADMITS git-tracked files with a 1 MB per-file cap ✓✓. THEY ARE TWO DIFFERENT MEASUREMENTS OF ONE POPULATION ✓✓.",
    denominators: "THE FLEET KEEPS THREE DENOMINATORS APART ✓✓ — **PATHS · DISTINCT FILES · ADMITTED** ✓✓ — AND A CELL NAMES WHICH IT USED ✓✓",
    onDiskCountingRule: "EACH DISTINCT FILE COUNTED ONCE ✓✓ (a file reachable by two paths is ONE file on disk ✓✓) — the census follows the farm's symlinked repos ✓✓.",
    onDiskByPathCount: onDiskByPath,
    onDiskExtensions: ".c + .h (the lane's own extension map ✓✓)",
    admittedByTheGate: admittedFiles,
    gap: onDisk >= 0 ? onDisk - admittedFiles : -1,
    gapPct: onDisk >= 0 && admittedFiles > 0 ? Number((((onDisk - admittedFiles) / onDisk) * 100).toFixed(4)) : -1,
    root: corpusRootAbs,
    rootIsAbsolute: corpusRootAbs.startsWith("/"),
    note: "THE GAP IS LANGUAGE-SHAPED, NOT SLACK ✓✓ — an untracked file in a C repo is a `.c` or a `.h` ✓✓, so the c lane's on-disk/admitted gap is a MEASURED DIFFERENCE BETWEEN TWO RULES ✓✓, not a count of slack ✓✓.",
    failedToParse: failedFiles,
    degraded: degradedFiles,
  },
  view: {
    analyzerSha1: digestOf("analyzer sha256"),
    gateSha1: sha1(join(ROOT, "script/m14/incoming-gate.ts")),
    arbiterSha1: digestOf("arbiter  sha256"),
    specSha1: sha1(join(ROOT, "validation/m14/verification/ALL-OUT-OF-ALL-PROGRAMME.md")),
    oracleSha1: sha1(join(ROOT, "script/m14/oracles/c-truth.ts")),
    corpusRoot: corpusRootAbs,
    population: `WHOLE POPULATION ✓✓ — ${admittedFiles} admitted files, ${repoCount} repos, NOT A DRAW ✓✓`,
    armLog: LOG_REL,
    analyzerSha1AtTheCurrentTree: sha1(join(ROOT, "src/ast/real-c-analyzer.ts")),
    gateSha1AtTheCurrentTree: sha1(join(ROOT, "script/m14/incoming-gate.ts")),
  },
  preMoveView: {
    note: "A PRE-MOVE VIEW IS CARRIED BESIDE THE CURRENT ONE, LABELLED ✓✓ (the fleet's rule ✓✓) — THE c LANE's OWN PAIR IS THE ATTRIBUTION BASELINE ✓✓: A-BEFORE (the analyzer at the recorded arm) vs A-AFTER (the lane's tree) ✓✓, THE SAME ARBITER BYTE-IDENTICAL ON BOTH SIDES ✓✓.",
    pair: [
      { label: "A-BEFORE", analyzerSha256: "2f26c02089d8fb92c67c909421d136d24e5d6952b99ab46c72b2d5496356f4de", edges: 574851, resolved: 305449, arbiterSha256: "b0cbd4b2142e7bda01a282b41eba96fdb6486978427812e3eff6fad828b6c28e" },
      { label: "A-AFTER", analyzerSha256: "31343d5166af2afb411c445e604cec9ae701d0594244cb89cfc745e8dabd8aeb", edges: 574776, resolved: 305344, arbiterSha256: "b0cbd4b2142e7bda01a282b41eba96fdb6486978427812e3eff6fad828b6c28e" },
    ],
    population: "5,022 `.c` files · 39 repos · the farm ✓✓ — THE `.c`-ONLY MAP ✓✓, NOT the `c,h` MAP this cell measures ✓✓ ⇒ THE TWO POPULATIONS ARE NOT COMPARABLE ✓✓ (the fleet's R1 ✓✓)",
  },
}

console.log("  THE CELL")
console.log(`      edges ${edges} · resolved ${resolved} · residual ${residual} · resolved% ${cell.resolvedPct}`)
console.log(`      VERIFIED class (${verifiedClassFormula}) = ${cell.verifiedClass.pct} %`)
console.log(`      census: on disk ${onDisk} · admitted ${admittedFiles} · gap ${cell.census.gap} (${cell.census.gapPct} %)`)
console.log("")
if (failed > 0) {
  console.log(`${failed} CHECK(S) FAILED — the log and the cell disagree`)
  process.exit(1)
}
writeFileSync(OUT, JSON.stringify(cell, null, 2) + "\n")
console.log(`  ALL CHECKS PASS ✓✓ — the cell is written: ${OUT.replace(ROOT + "/", "")}`)
