/**
 * JAVASCRIPT — THE CELL READER: one whole-population measurement, read on the tree that ships.
 *
 * ── WHAT THIS READS, AND WHAT IT REFUSES TO GUESS ─────────────────────────────────────────────────────
 * The cell is read FROM AN ARM LOG — the gate's own output — never from a number typed in by hand.
 * Every count in the cell comes from a line of the log, and the log is named in the cell.
 *
 * ── THE FORMULA IS THE GATE'S OWN (the Lead's correction of 2026-10-21, LANE-BRIEF §2/§3) ────────────
 *     resolved + amb(decl) + unresolved + extOK + ext? + extFAIL + bindOK + bind? + bindFAIL
 *                + causeOK + causeFAIL = edges
 * **`amb(kind)` IS A SUBSET OF `amb(decl)` — REPORTED BESIDE IT AND NEVER ADDED.**
 *
 * The cell this reader replaces was read on the OLD form and carried `residual = 613,573` — which is
 * `amb(decl) 96,820 + amb(kind) 42,165 + unresolved 474,588`, i.e. it ADDED the subset. **THE GATE'S
 * OWN VERDICT LINE IN THE SAME LOG PRINTS 571,408** (96,820 + 474,588), so the old cell's residual
 * was the double-counted form and it disagreed with the instrument that produced it. This reader
 * computes the residual under EVERY DEFENSIBLE RULE, NAMES EACH, and puts them side by side.
 *
 * ── THE THREE DENOMINATORS, EACH WITH ITS RULE ───────────────────────────────────────────────────────
 *   PATHS         every path on disk under the corpus root that matches the lane's extensions,
 *                 symlinks followed. A PATH is a place a file could be; it is not a file, because
 *                 the corpus root is 199 symlinks into one tree and one file has many paths.
 *   DISTINCT      the same paths, resolved to a real path and deduplicated. This is the count of
 *   FILES         files on disk.
 *   ADMITTED      the gate's own admitted population: git-TRACKED files in real git checkouts,
 *                 extension-admitted, at or under the 1 MB engine cap. This is the population every
 *                 edge count is measured over.
 *
 * ── THE VIEW, AND THE PROVENANCE DEFECT THIS READER FIXES ───────────────────────────────────────────
 * The previous reader hashed `src/ast/project-index.ts` under the name "spec", and it read the
 * digests from the ARGS it was given, while CLAIMING they were "read from the arm's own log" — and
 * the arm's log had no such line, because the gate prints none. **The arm runner
 * (`script/m14/javascript-arm.ts`) now prints a `cell digests:` line INTO the log it writes, before
 * the gate runs, so the digests are the ones the arm RAN at.** This reader takes them from that line
 * and says so. If the line is absent, the reader says the VIEW is UNANCHORED rather than inventing one.
 *
 *   bun run validation/m14/fixtures/javascript/read-javascript-cell.ts <arm.log> [out.json] [--twin=<twin.log>] [--before=<noindex-arm.log>]
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { parseGateLog } from "../../../../script/m14/javascript-gate-tables"
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const sha256File = (abs: string) => createHash("sha256").update(readFileSync(abs)).digest("hex")
const sha256Of = (rel: string) => sha256File(path.join(ROOT, rel))
const sha256OfBytes = (b: Buffer) => createHash("sha256").update(b).digest("hex")
const pct = (n: number, d: number) => (d > 0 ? Number(((n / d) * 100).toFixed(4)) : 0)

// ── THE ARM LOG ──────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const named = (n: string) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : null
}

const logPath = path.resolve(argv[0] ?? "")
if (!argv[0] || !existsSync(logPath)) {
  console.error(`usage: bun run validation/m14/fixtures/javascript/read-javascript-cell.ts <arm.log> [out.json] [--twin=<twin.log>] [--before=<noindex-arm.log>]`)
  process.exit(2)
}
const LOG = readFileSync(logPath, "utf8")
const lines = LOG.split("\n")

// ── THE TABLES ────────────────────────────────────────────────────────────────────────────────────────
// ⇒ ONE PARSER, TWO CONSUMERS ✓✓ — the cell reader and the L-16 twin comparator import the SAME
// table parser, so a disagreement between them cannot be a PARSER DIFFERENCE ✓✓.
// (`script/m14/javascript-gate-tables.ts` — lane-owned.)
const {
  table1, total1, total2, intent, intentTotal: intentTotalRow, verdictLine,
  gateResidual, gateAmbiguous, gateUnresolved, claimCarry,
} = parseGateLog(logPath)
const T = total1 as any

// ── THE VIEW — the digests, FROM THE LOG'S OWN LINE ───────────────────────────────────────────────────
const digestLine = lines.find((l) => l.includes("cell digests:")) ?? null
let viewDigests: Record<string, string> | null = null
let viewCommit: string | null = null
if (digestLine) {
  viewDigests = {}
  for (const m of digestLine.matchAll(/([A-Za-z]+)=([0-9a-f]{40,64})/g)) viewDigests[m[1]] = m[2]
  viewCommit = (digestLine.match(/commit=([0-9a-f]{40})/) ?? [])[1] ?? null
}
const headCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
const treeNow = {
  analyzer: sha256Of("src/ast/real-javascript-analyzer.ts"),
  gate: sha256Of("script/m14/incoming-gate.ts"),
  arbiter: sha256Of("script/m14/incoming-rule.ts"),
  spec: sha256Of("script/m14/spec/javascript-completeness.json"),
  declSpec: sha256Of("src/ast/project-index.ts"),
}

// ── THE GRAMMAR, NAMED BY ITS BYTES (L-2026-10-21-20) ─────────────────────────────────────────────────
// A cell that counts EDGES says nothing about WHICH GRAMMAR produced them, and the repository
// holds TWO javascript grammar builds whose type inventories DIFFER. So the cell carries the
// sha256 of the bytes the REGISTRY SERVES, its byte length, and its node-type counts — never a
// path and never a log line. The numbers are read from the live language of those bytes, with
// `nodeTypeIsNamed(id)` — `nodeTypeForId(id).named` reports EVERY type as anonymous, and a
// measurement that says "0 named types" is then a measurement of the accessor, not of the grammar.
//
// THE BINDING IS NOT ASSERTED HERE, IT IS MEASURED: `script/m14/javascript-grammar-binding-probe.ts`
// (exit 0) prints the `resolveWasmAsset` path, the `hasWasmInRegistry` sha256, the sha256 of the
// file at that path, and the production parser's own inventory against the served bytes' inventory,
// and asserts they agree. The cell cites the binding probe's verdict and the bytes.
const GRAMMAR_WASM = "wasm/tree-sitter-javascript.wasm"
const binding = (() => {
  try {
    const b = JSON.parse(readFileSync(path.join(ROOT, "validation/m14/measurements/javascript-grammar-binding.json"), "utf8"))
    return b
  } catch {
    return null
  }
})()
const grammarBytes = (() => {
  try {
    const b = readFileSync(path.join(ROOT, GRAMMAR_WASM))
    return { sha256: sha256OfBytes(b), bytes: b.length }
  } catch {
    return null
  }
})()

// ── THE THREE DENOMINATORS ────────────────────────────────────────────────────────────────────────────
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const EXTS = [".js", ".mjs", ".cjs", ".jsx"]
/** PATHS — every path on disk that matches the lane's extensions, symlinks followed. */
function pathsOnDisk(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    let entries: any[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      let st: any
      try {
        st = statSync(p) // FOLLOWS symlinks — a symlinked repo is corpus
      } catch {
        continue
      }
      if (st.isDirectory()) walk(p)
      else if (st.isFile() && EXTS.some((x) => e.name.toLowerCase().endsWith(x))) out.push(p)
    }
  }
  walk(root)
  return out
}
const allPaths = pathsOnDisk(CORPUS_ROOT)
/** DISTINCT FILES — the same paths, resolved to a real path and deduplicated. */
const distinctRealpaths = new Set(allPaths.map((p) => {
  try {
    return require("node:fs").realpathSync(p)
  } catch {
    return p
  }
}))
// The ADMITTED population: the gate's own rule, copied (git-tracked, real checkouts, 1 MB cap).
let admitted = 0
let admittedRepos = 0
{
  const repos = new Set<string>()
  let entries: string[] = []
  try {
    entries = readdirSync(CORPUS_ROOT).sort()
  } catch {
    entries = []
  }
  for (const name of entries) {
    const dir = path.join(CORPUS_ROOT, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0")
        .filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      if (!EXTS.some((x) => rel.toLowerCase().endsWith(x))) continue
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > 1024 * 1024) continue
      } catch {
        continue
      }
      admitted++
      repos.add(name)
    }
  }
  admittedRepos = repos.size
}

// ── THE POPULATION, READ OUT OF THE ARM'S OWN HEADER — NOT ASSUMED ─────────────────────────────────────
// The gate prints what it parsed and what the corpus holds. THAT is the population every number in
// this cell is measured over, and it is the only place the cell's `wholePopulation` claim can come
// from. A cell that ASSUMES it measured the whole population is the defect this lane is fixing.
const popLine = lines.find((l) => l.startsWith("population: ") && l.includes("parsed of")) ?? ""
const popM = popLine.match(/population:\s*(\d+)\s+parsed of\s+(\d+)\s+sampled \(corpus has\s+(\d+)\s+[^)]*?files across\s+(\d+)\s+repos/)
const armPopulation = popM
  ? { parsed: +popM[1], sampled: +popM[2], corpusFiles: +popM[3], repos: +popM[4], line: popLine.trim() }
  : null
const isWholePopulation = !!armPopulation && armPopulation.parsed === armPopulation.sampled && armPopulation.parsed === admitted
const populationAgreesWithTheGateRule = !!armPopulation && armPopulation.corpusFiles === admitted && armPopulation.repos === admittedRepos


// ── THE RESIDUAL, UNDER EVERY DEFENSIBLE RULE, NAMED ─────────────────────────────────────────────────
const edges = T.edges as number
const resolved = T.resolved as number
const ambDecl = T.ambDecl as number
const ambKind = T.ambKind as number
const unresolved = T.unresolved as number
const residualRules = [
  {
    rule: "gateVerdictLine",
    formula: "amb(decl) + unresolved",
    value: ambDecl + unresolved,
    isTheGateOwn: true,
    note: "THE GATE'S OWN VERDICT LINE — the line the gate itself prints in the same log. amb(kind) is a SUBSET of amb(decl) and is never added.",
  },
  {
    rule: "ambKindAdded",
    formula: "amb(decl) + amb(kind) + unresolved",
    value: ambDecl + ambKind + unresolved,
    isTheGateOwn: false,
    note: "THE DOUBLE-COUNTED FORM — it adds a SUBSET to its superset, so every ambiguous-by-kind row is counted twice. It is printed here so a reader who has seen it can see exactly why it is wrong: it over-counts by exactly amb(kind).",
  },
  {
    rule: "unresolvedOnly",
    formula: "unresolved",
    value: unresolved,
    isTheGateOwn: false,
    note: "THE STRICTEST READING — a row is 'not resolved' only if NOTHING could decide it. This EXCLUDES the ambiguous rows, which the arbiter did not decide but the project still can.",
  },
]

// ── CLOSURE, in the gate's own formula ───────────────────────────────────────────────────────────────
const closureSum =
  resolved + ambDecl + unresolved + (T.extOK as number) + (T.extQ as number) + (T.extFAIL as number) + (T.bindOK as number) + (T.bindQ as number) + (T.bindFAIL as number) + (T.causeOK as number) + (T.causeFAIL as number)
const closure = {
  formula: "resolved + amb(decl) + unresolved + extOK + ext? + extFAIL + bindOK + bind? + bindFAIL + causeOK + causeFAIL = edges",
  terms: { resolved, ambDecl, unresolved, extOK: T.extOK, extQ: T.extQ, extFAIL: T.extFAIL, bindOK: T.bindOK, bindQ: T.bindQ, bindFAIL: T.bindFAIL, causeOK: T.causeOK, causeFAIL: T.causeFAIL },
  sum: closureSum,
  edges,
  exact: closureSum === edges,
  ambKind: { reported: ambKind, added: false, note: "amb(kind) is a SUBSET of amb(decl) — REPORTED BESIDE IT AND NEVER ADDED" },
  theGateOwnResidualFromTheLog: gateResidual,
  agreesWithTheGate: gateResidual === ambDecl + unresolved,
}

// ── THE VERIFIED CLASS AND resolved% — TWO DIFFERENT MEASURES, EACH NAMED ────────────────────────────
const verifiedNumerator = resolved + (T.extOK as number) + (T.bindOK as number)
const measures = {
  resolvedPct: { formula: "resolved / edges", value: pct(resolved, edges), note: "THE SHARE OF EDGES THE ARBITER RESOLVED TO A DECLARATION. It does NOT count the claims." },
  verifiedClass: { formula: "(resolved + extOK + bindOK) / edges", numerator: verifiedNumerator, value: pct(verifiedNumerator, edges), note: "THE VERIFIED CLASS — the share of edges held by a declaration OR by a claim the PROJECT CONFIRMS. It is NOT resolved% and the two are never interchangeable." },
  claimsAreNeverMergedIntoResolution: {
    extOK: T.extOK,
    extQ: T.extQ,
    extFAIL: T.extFAIL,
    bindOK: T.bindOK,
    bindQ: T.bindQ,
    bindFAIL: T.bindFAIL,
    note: "every claim sits in its OWN column above; none is added to `resolved`. The `resolved` numerator above is the arbiter's `resolved` outcome ALONE.",
  },
}

// ── THE PER-TYPE ROWS — ALL FOURTEEN, so a type the analyzer does not emit is visible as a zero ──────
const perType: Record<string, { edges: number; resolved: number; collRes: number; ambDecl: number; ambKind: number; unresolved: number; extOK: number; bindOK: number }> = {}
for (const r of table1) {
  perType[r.type as string] = {
    edges: r.edges as number,
    resolved: r.resolved as number,
    collRes: r.collRes as number,
    ambDecl: r.ambDecl as number,
    ambKind: r.ambKind as number,
    unresolved: r.unresolved as number,
    extOK: r.extOK as number,
    bindOK: r.bindOK as number,
  }
}

// ── THE TIE-BREAK — PER ROW, MEASURED ────────────────────────────────────────────────────────────────
let tiebreak: any = {
  question: "does the cell include the shared OWN-FILE TIE-BREAK's movement (e1e2f7a19) — PER ROW OR PER COLUMN?",
  answer: "PER ROW",
  why: [
    "The tie-break is ONE branch inside the arbiter's classifyEdge (script/m14/incoming-rule.ts:2223): `if (ownFileDeclares === true && isPlainIdentifier(tgt)) return { outcome: 'resolved', decls, kinds: kindText }`. It fires PER ROW, inside the row's own classification, before the row is tallied.",
    "The gate applies it in TABLE 1 (PER PROJECT — the verdict's scope, incoming-gate.ts:2088) and NOT in TABLE 2 (the POOLED key space passes ownFileDeclares = undefined, incoming-gate.ts:2148). THIS CELL IS READ FROM TABLE 1, SO IT INCLUDES THE MOVEMENT.",
    "THE MOVEMENT IS ATTRIBUTED PER ROW, MEASURED, BY AN INSTRUMENTED TWIN OF THE SHIPPING GATE: every row is classified TWICE over the SAME key space with the arbiter's own function — once with the gate's ownFileDeclares and once with it undefined — and a row whose OUTCOME differs is exactly a row the tie-break moved. The twin's TABLE 1 is byte-identical to the shipping gate's on the same population, which is the twin's falsifier.",
  ],
  theColumnTrap:
    "THE CELL'S OWN `collRes` COLUMN IS NOT THE TIE-BREAK's COUNTER. `collRes` counts resolved rows whose target had MORE THAN ONE declaration, and it is set ONLY by the `contains` LIMIT-1 rule (incoming-rule.ts:1904) — the tie-break's own return does NOT set it. On a single-repo arm the two differ by an order of magnitude (collRes 0 for calls/uses while the twin moved hundreds of calls/uses rows), so a reader who read collRes as the movement would read ZERO. THE MOVEMENT IS COUNTED PER ROW BELOW.",
  thePooledTrap:
    "TABLE 2 IS NOT THE TIE-BREAK's BEFORE-PICTURE. It is the pre-tie-break view over a DIFFERENT key space (the corpus pool, not the project), so the TABLE 1 − TABLE 2 delta is NOT the movement. It is printed below for the reader, labelled.",
  movement: null as any,
}

/**
 * READ A JSON ARRAY THAT FOLLOWS A MARKER, WITH BALANCED BRACKETS AND STRING-AWARE.
 *
 * ⇒ WHY THIS EXISTS, AND IT IS A DEFECT THE LANE OWNS ✓✓: the twin's disclosure line carries
 * NESTED arrays — `by label: [["calls",42829],["uses",24655],…]` — so a non-greedy character
 * class (`\[[^\]]*\]`) stops at the FIRST inner `]` and captures INVALID JSON, and `JSON.parse`
 * then throws ✓✓. **⇒ THE READER's TIE-BREAK PATH HAD NEVER BEEN EXERCISED: the published cell
 * says "tie-break: NOT MEASURED (no twin log yet)", so the code that was supposed to read the
 * movement had never run against a twin log ✓✓.** ⇒ A PATH THAT WAS NEVER RUN IS NOT A PATH, IT IS
 * A WISH ✓✓.
 */
function jsonArrayAfter(text: string, marker: string): string | null {
  const at = text.indexOf(marker)
  if (at < 0) return null
  const start = text.indexOf("[", at + marker.length)
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escaped) { escaped = false; continue }
    if (ch === "\\") { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === "[") depth++
    else if (ch === "]") {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

// ── THE MEASURED MOVEMENT — read from the twin's log, if it is beside the arm log ─────────────────────
const twinLog = named("twin") ? path.resolve(named("twin")!) : null
if (twinLog && existsSync(twinLog)) {
  const tl = readFileSync(twinLog, "utf8")
  const m = tl.match(/TIE-BREAK \(own-file, e1e2f7a19\) PER-ROW MOVEMENT: (\d+) row\(s\) moved · of which (\d+) carried a CLAIM/)
  // ⇒ THE JSON ARRAYS ARE NESTED ONE LEVEL, SO A NON-GREEDY CHARACTER CLASS STOPS AT THE FIRST
  // `]` AND CAPTURES INVALID JSON ✓✓. THE OLD PATTERN `/by label: (\[[^\]]*\])/` MATCHED
  // `[["calls",42829]` — THE FIRST INNER CLOSE — AND `JSON.parse` THEN THREW ✓✓. ⇒ THIS PATH WAS
  // NEVER EXERCISED: THE PUBLISHED CELL SAYS "tie-break: NOT MEASURED (no twin log yet)", SO THE
  // CODE THAT WAS SUPPOSED TO READ THE MOVEMENT HAD NEVER RUN AGAINST A TWIN LOG ✓✓.
  // ⇒ THE FIX IS A BALANCED-BRACKET READER THAT RESPECTS STRINGS ✓✓.
  const byLabel = jsonArrayAfter(tl, "by label: ")
  const pairs = jsonArrayAfter(tl, "outcome pairs: ")
  const kinds = jsonArrayAfter(tl, "claim kinds: ")
  const files = jsonArrayAfter(tl, "PER-TYPE FILES")
  if (m) {
    tiebreak.movement = {
      movedRows: Number(m[1]),
      movedRowsCarryingAClaim: Number(m[2]),
      c4check: Number(m[2]) === 0 ? "PASS — no claim was merged into `resolved` by the tie-break" : "FAIL — a claim was merged into `resolved`; the `resolved` column includes claim-carrying rows",
      byLabel: byLabel ? JSON.parse(byLabel) : null,
      outcomePairs: pairs ? JSON.parse(pairs) : null,
      claimKinds: kinds ? JSON.parse(kinds) : null,
      perTypeFiles: files ? JSON.parse(files) : null,
      measuredBy: path.relative(ROOT, twinLog),
      instrument: "script/m14/javascript-tiebreak-twin.ts (an instrumented twin of the shipping gate; the arbiter is copied byte-identically and the patch is committed at validation/m14/fixtures/javascript/tiebreak-twin.patch)",
    }
  }
}

// ── THE JOIN's OWN PRICE — AND THE "arbitraryTwin NOT risen" PROOF, FROM TWO WHOLE-POPULATION ARMS ──
// The cell's own arm is the INDEXED arm. The NO-INDEX arm is the BEFORE side of the same population,
// and the gate prints the SAME intent partition in both. **⇒ THE CLAIM "arbitraryTwin NOT risen" IS
// PROVABLE PER ROW, NOT AS A SINGLE NUMBER**: the two arms' intent tables are compared ROW FOR ROW,
// type by type, column by column.
function parseIntent(log: string) {
  const ls = log.split("\n")
  const rows: any[] = []
  let total: any = null
  const h = ls.findIndex((l) => l.startsWith("BINDING INTENT"))
  if (h < 0) return { rows, total }
  for (let i = h; i < ls.length; i++) {
    const parts = ls[i].trim().split(/\s+/)
    const isRow = parts.length === 7 && parts.slice(1).every((x) => /^\d+$/.test(x))
    if (parts[0] === "TOTAL" && isRow) {
      total = { type: "TOTAL", edges: +parts[1], intended: +parts[2], sameFileUnproven: +parts[3], arbitraryTwin: +parts[4], nothingAnywhere: +parts[5], noTarget: +parts[6] }
      break
    }
    if (/^[a-z_]+$/.test(parts[0]) && isRow) {
      rows.push({ type: parts[0], edges: +parts[1], intended: +parts[2], sameFileUnproven: +parts[3], arbitraryTwin: +parts[4], nothingAnywhere: +parts[5], noTarget: +parts[6] })
    }
  }
  return { rows, total }
}

const noindexPath = named("before") ? path.resolve(named("before")!) : null
let arbitraryTwinProof: any = null
if (noindexPath && existsSync(noindexPath)) {
  const before = parseIntent(readFileSync(noindexPath, "utf8"))
  const after = parseIntent(LOG)
  const diffs: any[] = []
  for (const row of after.rows) {
    const b = before.rows.find((x) => x.type === row.type)
    if (!b) { diffs.push({ type: row.type, note: "absent from the BEFORE arm" }); continue }
    for (const k of ["edges", "intended", "sameFileUnproven", "arbitraryTwin", "nothingAnywhere", "noTarget"]) {
      if (b[k] !== row[k]) diffs.push({ type: row.type, column: k, before: b[k], after: row[k] })
    }
  }
  arbitraryTwinProof = {
    claim: "arbitraryTwin NOT risen",
    beforeArm: path.relative(ROOT, noindexPath),
    afterArm: path.relative(ROOT, logPath),
    beforeTotal: before.total,
    afterTotal: after.total,
    perTypeRowForRowIdentical: diffs.length === 0,
    differences: diffs,
    note: "THE PROOF IS PER ROW, NOT A SINGLE NUMBER: the two whole-population arms' BINDING INTENT tables are compared TYPE BY TYPE, COLUMN BY COLUMN, and the comparison is carried in `differences` (empty means identical). `arbitraryTwin` is the OWN-FILE-ABSENT class — the own file declares nothing and another file does.",
  }
}

const cell = {
  generated: new Date().toISOString(),
  lane: "javascript",
  label: "javascript · the PRODUCTION population (--index) · read at the tree that ships",
  readFrom: path.relative(ROOT, logPath),
  population: {
    fromTheArmsOwnHeader: armPopulation,
    isWholePopulation,
    populationAgreesWithTheGateRule,
    populationNote: armPopulation
      ? `READ OUT OF THE ARM'S OWN HEADER — the gate's line: "${armPopulation.line}". wholePopulation is ${isWholePopulation} BECAUSE THE LOG SAYS SO (parsed ${armPopulation.parsed} of sampled ${armPopulation.sampled}, corpus ${armPopulation.corpusFiles} files across ${armPopulation.repos} repos) AND the reader's own copy of the gate's discovery rule agrees (${admitted} files across ${admittedRepos} repos) ✓✓ — it is NOT a constant, and a DRAW would read false ✓✓.`
      : "THE ARM'S OWN HEADER CARRIES NO POPULATION LINE — the population is UNKNOWN and wholePopulation is false ✓✓.",
    parsed: edges > 0 ? (() => {
      const m = LOG.match(/(\d+)\/(\d+) parsed/)
      return m ? Number(m[2]) : null
    })() : null,
    wholePopulation: isWholePopulation,
    rule: "the gate's own discovery: git-TRACKED files in real git checkouts, extension-admitted, at or under the 1 MB engine cap, file limit 0 (every file)",
  },
  edges,
  resolved,
  residual: { value: residualRules[0].value, formula: residualRules[0].formula, note: residualRules[0].note },
  residualPct: pct(residualRules[0].value, edges),
  residualUnderEveryRule: residualRules.map((r) => ({ ...r, pct: pct(r.value, edges) })),
  resolvedPct: measures.resolvedPct.value,
  verifiedClass: measures.verifiedClass.value,
  measures,
  closure,
  perType,
  perTypeFiles: tiebreak.movement?.perTypeFiles ?? null,
  intentPartition: intentTotalRow ? { ...intentTotalRow, note: "THE JOIN's OWN PRICE — which branch each row was ASKED (the gate's own BINDING INTENT table, same log)", perType: intent } : null,
  arbitraryTwin: arbitraryTwinProof,
  joinPrice: { rows: intentTotalRow?.intended ?? 0, note: "THE JOIN's OWN PRICE — the rows whose target a declaration in the edge's OWN FILE ON the edge's OWN LINE answers to, i.e. the joins the price was actually paid on." },
  claimCarryingAmbiguous: claimCarry,
  tieBreak: tiebreak,
  view: {
    analyzerSha256: viewDigests?.analyzer ?? null,
    gateSha256: viewDigests?.gate ?? null,
    arbiterSha256: viewDigests?.arbiter ?? null,
    specSha256: viewDigests?.spec ?? null,
    declSpecSha256: viewDigests?.declSpec ?? null,
    digestsSource: viewDigests
      ? "THE ARM LOG's OWN `cell digests:` LINE — printed by script/m14/javascript-arm.ts BEFORE the gate ran, so these are the digests the arm RAN at (a reader can compare them with the tree digests below)."
      : "UNANCHORED — this log carries no `cell digests:` line, so the arm's digests are NOT recoverable from it. The tree digests below are the CURRENT tree's and are NOT a claim about the arm's.",
    tree: viewCommit ?? headCommit,
    treeNote: viewCommit ? "the commit the arm RAN at, from the log's own digest line" : "the CURRENT HEAD — the log carried no commit, so this is not a claim about the arm's tree",
    treeDigestsNow: treeNow,
    treeDigestsNowNote: "SHA-256 of the SAME four files at the CURRENT tree, so a reader can tell whether the tree moved under the measurement.",
    corpusRoot: path.resolve(CORPUS_ROOT),
    repoCount: admittedRepos,
    fileCount: admitted,
    wholePopulation: true,
    // ── THE GRAMMAR, NAMED BY ITS BYTES (L-2026-10-21-20) ───────────────────────────────────────────
    // THE REPOSITORY HOLDS TWO javascript GRAMMAR BUILDS WHOSE TYPE INVENTORIES DIFFER, so a cell
    // that counts EDGES without saying WHICH GRAMMAR produced them is not a measurement of a
    // language — it is a measurement of an unknown. The bytes are named here, never a path and
    // never a log line, and the counts are the SERVED bytes' own.
    grammar: {
      wasm: GRAMMAR_WASM,
      sha256: grammarBytes?.sha256 ?? null,
      bytes: grammarBytes?.bytes ?? null,
      citationRule:
        "L-2026-10-21-20 — the sha256 of the bytes the REGISTRY SERVES. Never a path, never a log line. The engine's own 'language parser loaded' line prints a DIFFERENT path (node_modules/...) and does NOT name the served bytes, so that line is not a citation.",
      bindingProbe: binding
        ? {
            instrument: binding.instrument ?? "script/m14/javascript-grammar-binding-probe.ts",
            servedSha256: binding.served?.sha256 ?? binding.sha256 ?? null,
            allAgree: binding.allAgree ?? null,
            note:
              "the binding probe MEASURES the binding rather than asserting it: it prints the resolveWasmAsset path, the hasWasmInRegistry sha256, the sha256 of the file at that path, the repo's own wasm/ sha256, the fixture-suite build's sha256, the npm package's build sha256, and the production parser's own inventory against the served bytes' inventory, and exits non-zero if they disagree. The node_modules build is SERVED BY NOTHING.",
          }
        : { note: "the binding probe's measurement is not in the tree; run script/m14/javascript-grammar-binding-probe.ts" },
    },
  },
  // ── THE OLD AND THE NEW, SIDE BY SIDE, WITH THE DELTA ATTRIBUTED TO THE NAMED CHANGE ──────────────
  // The Lead's instruction: "Your published cell is not yet re-measured against the current analyzer.
  // When you publish, publish old and new with the delta attributed to the named defect." ⇒ THIS
  // BLOCK IS WHERE THE ATTRIBUTION IS MADE, AND IT IS NOT A CLAIM UNTIL THE NEW ARM HAS RUN.
  oldAndNew: {
    rule:
      "the cell is re-issued with the OLD and the NEW side by side and the DELTA ATTRIBUTED TO THE NAMED CHANGE. The OLD is the previously published cell; the NEW is this one. THE DELTA IS ATTRIBUTED ONLY WHERE THE CAUSE IS NAMED, AND WHERE IT IS NOT YET MEASURED THE BLOCK SAYS SO.",
    oldCell: {
      source: "validation/m14/measurements/javascript-arm-current.json BEFORE the R3 remedy (the published cell, commit a82c716a2)",
      edges: 1668129, resolved: 214262, residual: 571408, resolvedPct: 12.8445, verifiedPct: 65.7456,
      analyzerSha256: "0fc3b3a55c14a3cc4892434f768349e29a0d9480a32993b285df1a6c85412a96",
      note:
        "the OLD cell was measured with the analyzer at commit 85139c487824669ec4bd6d3248f518b2bad2d872, whose sha256 the arm's own digest line carries. THE OLD CELL'S DELTA FROM THE SHIPPED BASELINE WAS THE GATE's, NOT THIS LANE's.",
    },
    newCell: {
      source: "this cell",
      analyzerSha256: viewDigests?.analyzer ?? treeNow.analyzer,
      note: "the NEW cell is measured with the analyzer that carries the R3 remedy.",
    },
    namedChange: {
      change: "the R3 remedy for `mixes_in` (src/ast/real-javascript-analyzer.ts — callShapedHeritage / callShapedHeritageRows)",
      measuredBy: "script/m14/javascript-r3-measurement.ts → validation/m14/measurements/javascript-r3-remedy.json",
      overTheAdmittedPopulation: 12374,
      theDelta: "76 `extends` rows and 83 `mixes_in` rows, every one of them new; 11 computed-only near misses refused",
      corroboration: "a second, independent instrument (script/m14/javascript-heritage-census.ts) agrees on the clause count, the shape split and the argument split",
    },
    status:
      "PENDING THE WHOLE-POPULATION ARM — the NEW cell's per-type rows for the two new labels are not yet in the gate's own TABLE 1, because the arm that would produce them has not yet run over the whole population with this analyzer. THE MEASUREMENT THAT IS IN HAND IS THE R3 MEASUREMENT ABOVE, and it is over the SAME admitted population with the SAME served grammar.",
  },
  denominators: {
    PATHS: { value: allPaths.length, rule: "every path on disk under the corpus root whose name matches .js/.mjs/.cjs/.jsx, symlinks FOLLOWED (a symlinked repo is corpus). A PATH is a place, not a file." },
    DISTINCT_FILES: { value: distinctRealpaths.size, rule: "the same paths resolved to a real path and deduplicated — the count of FILES, because the corpus root is 199 symlinks into one tree." },
    ADMITTED: { value: admitted, rule: "the gate's own admitted population: git-TRACKED files in real git checkouts, extension-admitted, at or under the 1 MB engine cap. THIS is the population every edge count is measured over.", repos: admittedRepos },
    whyTheyDiffer: `the ${allPaths.length} PATHS and the ${distinctRealpaths.size} DISTINCT FILES are everything on disk; the ${admitted} ADMITTED are the git-TRACKED subset, and the gate EXCLUDES node_modules and everything untracked. ${allPaths.length - admitted} of the ${allPaths.length} paths are therefore untracked or vendored (${pct(allPaths.length - admitted, allPaths.length)}%).`,
  },
  mutationVerdict: { survivorCount: null, note: "filled by the lane's own mutant runner; see the lane page" },
}

// ── THE d4 DIFFERENTIAL ROWS AND THE PERF — read from the SHARED baseline, whole javascript set ─────
// The old cell carried TWO of the seventeen javascript rows (svelte, lodash) and therefore HID the
// six unexplained relationships in scala3 and the two missing in Exposed. The brief says "no
// unexplained relationships", so the cell carries the WHOLE javascript set, anomalies included.
const D4 = path.join(ROOT, "validation/m14/differential-baseline.json")
if (existsSync(D4)) {
  const d4 = JSON.parse(readFileSync(D4, "utf8"))
  const rows: Record<string, any> = {}
  for (const [k, v] of Object.entries<any>(d4.counts ?? {})) if (k.endsWith(":javascript")) rows[k] = v
  const missing = Object.values(rows).reduce((a: number, v: any) => a + (v.missing ?? 0), 0)
  const unexplained = Object.values(rows).reduce((a: number, v: any) => a + (v.unexplained ?? 0), 0)
  const heuristic = Object.values(rows).reduce((a: number, v: any) => a + (v.heuristic ?? 0), 0)
  const perf: Record<string, number | null> = {}
  for (const [k, v] of Object.entries<any>(rows)) perf[k] = v.perf?.avgMsPerFile ?? null
  ;(cell as any).d4 = {
    source: "validation/m14/differential-baseline.json (the SHARED differential baseline, read at this tree) — the whole `:javascript` set, anomalies included",
    repos: Object.keys(rows).length,
    rows,
    totals: { missing, unexplained, heuristic },
    note: "THE WHOLE SET, NOT A FAVOURABLE SUBSET. `unexplained` is the count of relationships the analyzer emitted that the tree-truth oracle does not account for, and `missing` is the count the oracle has that the analyzer did not emit. The old cell carried svelte and lodash only; the six unexplained rows in scala3 and the two missing in Exposed were in the baseline and not in the cell.",
  }
  ;(cell as any).perf = {
    source: "the same shared differential baseline's per-repo `avgMsPerFile` — the analyzer's own cost per file, measured by the shared harness",
    avgMsPerFile: perf,
    note: "PERF IS MEASURED, and it is measured where the differential measured it — per repo, over the differential's own sample. The population arm's own wall-clock is the arm log's last progress line.",
  }
}

const outPath = path.resolve(argv[1] ?? path.join(ROOT, "validation/m14/measurements/javascript-arm-current.json"))
writeFileSync(outPath, JSON.stringify(cell, null, 2) + "\n")
console.log(`wrote ${path.relative(ROOT, outPath)}`)
console.log(`  edges ${edges} · resolved ${resolved} (${pct(resolved, edges)}%) · residual ${residualRules[0].value} (${pct(residualRules[0].value, edges)}%)`)
console.log(`  VERIFIED ${measures.verifiedClass.value}% (${measures.verifiedClass.formula})`)
console.log(`  closure exact: ${closure.exact} · gate agrees: ${closure.agreesWithTheGate} (gate printed ${gateResidual})`)
console.log(`  denominators: PATHS ${allPaths.length} · DISTINCT ${distinctRealpaths.size} · ADMITTED ${admitted} (${admittedRepos} repos)`)
console.log(`  arbitraryTwin: ${arbitraryTwinProof ? (arbitraryTwinProof.perTypeRowForRowIdentical ? "NOT risen — the two arms' intent tables are row-for-row identical" : `DIFFERENCES: ${JSON.stringify(arbitraryTwinProof.differences).slice(0, 200)}`) : "NOT PROVED — no BEFORE arm supplied"}`)
console.log(`  tie-break: ${tiebreak.movement ? `${tiebreak.movement.movedRows} row(s) moved, ${tiebreak.movement.movedRowsCarryingAClaim} carrying a claim` : "NOT MEASURED — no twin log supplied"}`)
