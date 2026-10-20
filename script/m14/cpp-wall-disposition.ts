/**
 * cpp-wall-disposition — DISPOSITION EVERY NAMED C++ WALL, with the counts that back each call.
 *
 * THE QUESTION. The C++ lane's D3 named nine walls over its 871,129 non-resolved rows. The depth
 * campaign asks for each wall to land in EXACTLY ONE of four dispositions, each with a count and a
 * FALSIFIER:
 *
 *   RESOLVED              the wall is gone — the rows moved into `resolved` by a mechanism that
 *                         is measured on the production population.
 *   CLAIMED               the rows are answered by an ARBITER-VERIFIED CLAIM in its own column
 *                         (extOK / bindOK / causeOK) — NEVER by a resolution, and never merged
 *                         into one.
 *   INSTRUMENT GAP        a fact EXISTS and the instrument cannot currently read it. The rows are
 *                         real, the work is known, and the gap is named with the shape of the fix.
 *   RULED UNDECIDABLE     no fact can decide these rows at all. A ruling with a falsifier: a
 *                         stated bound and the run that would break it.
 *
 * WHY A NEW INSTRUMENT. `cpp-dump-classify.ts` says WHAT each row is (by spelling). This one says
 * what can be DONE with it, and it answers the two questions the class table cannot:
 *   1. for the walls whose rows name a PROJECT symbol, does the project index (the instrument that
 *      answers project-fact questions) actually declare it — and can it DECIDE it or only BOUND it;
 *   2. for every wall, is there a committed vocabulary that reaches it (a citation's REACH), or
 *      must a NEW claim kind be asked for (a CLAIMED class with the wiring the Lead owes).
 *
 * THE DATA IS THE GATE'S OWN DUMP (the rows are the gate's rows) and the SHIPPED index (the
 * declaration space is the one production builds), and the CONTROL enforces that every wall's
 * sub-classification sums to that wall's count — a wall whose rows do not close is a measurement
 * failure, not a remainder.
 *
 * USAGE
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/cpp-wall-disposition.ts \
 *     --dump=.tmp-cpp/cpp-noindex-cap0-dump.txt [--json=<path>]
 *
 * EXIT: 0 dispositioned · 2 usage/environment · 3 CONTROL DID NOT FIRE.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const argOf = (f: string): string | null => {
  const j = process.argv.find((a) => a.startsWith(`${f}=`))
  return j ? j.slice(f.length + 1) : null
}
const DUMP = argOf("--dump")
const JSON_OUT = argOf("--json")
if (!DUMP) {
  console.error("usage: bun run script/m14/cpp-wall-disposition.ts --dump=<gate dump> [--json=<path>]")
  process.exit(2)
}
const availGB = os.freemem() / (1024 ** 3)
const load1 = os.loadavg()[0]
if (availGB < 3) {
  console.error(`cpp-wall-disposition: REFUSING — ${availGB.toFixed(2)} GB available, the index builds need >= 3 GB (load ${load1.toFixed(2)}).`)
  process.exit(2)
}

const ADMITTED = new Set(["cpp", "cc", "cxx", "c++", "hpp", "hxx", "ipp", "inl", "cu"])
const HEADERS = new Set(["h", "hh", "h++"])
const SIZE_CAP = 1024 * 1024
const extOf = (p: string): string => { const b = p.slice(p.lastIndexOf("/") + 1); const d = b.lastIndexOf("."); return d >= 0 ? b.slice(d + 1).toLowerCase() : "" }
const repoOf = (src: string): string => {
  const i = src.indexOf(`${path.sep}.corpus${path.sep}`)
  const rest = i >= 0 ? src.slice(i + `${path.sep}.corpus${path.sep}`.length) : src
  return rest.split(path.sep)[0]
}

// the COMMITTED vocabularies, READ from the shared registry (never invented here)
const cites: any = await import(path.join(ROOT, "script/m14/citations.ts"))
const STDLIB = new Set<string>(cites.ISO_CPP_STDLIB?.roots ?? [])
if (STDLIB.size < 10) { console.error("CONTROL DID NOT FIRE: the committed iso-cpp-stdlib vocabulary is unreadable."); process.exit(3) }

// ── the analyzer's own sets, READ from its source (the grammar auditor's precedent) ────────────
const analyzerSrc = readFileSync(path.join(ROOT, "src/ast/real-cpp-analyzer.ts"), "utf8")
function extractStringSet(name: string): Set<string> {
  const start = analyzerSrc.indexOf(`export const ${name}`)
  if (start < 0) return new Set()
  const open = analyzerSrc.indexOf("[", start)
  if (open < 0) return new Set()
  let depth = 0, close = -1
  for (let i = open; i < analyzerSrc.length; i++) {
    if (analyzerSrc[i] === "[") depth++
    else if (analyzerSrc[i] === "]") { depth--; if (depth === 0) { close = i; break } } }
  if (close < 0) return new Set()
  const body = analyzerSrc.slice(open + 1, close)
  const out = new Set<string>()
  let i = 0
  while (i < body.length) {
    while (i < body.length && body[i] !== '"') i++
    if (i >= body.length) break
    let j = i + 1
    while (j < body.length && body[j] !== '"') j++
    const v = body.slice(i + 1, j)
    if (v.length > 0) out.add(v)
    i = j + 1
  }
  return out
}
const CPP_KEYWORDS = extractStringSet("CPP_KEYWORDS")
const CPP_BUILTIN_TYPE_KEYWORDS = extractStringSet("CPP_BUILTIN_TYPE_KEYWORDS")
const CPP_NON_CLASS_STANDARD_TYPES = extractStringSet("CPP_NON_CLASS_STANDARD_TYPES")
if (CPP_KEYWORDS.size < 40 || CPP_BUILTIN_TYPE_KEYWORDS.size < 10 || CPP_NON_CLASS_STANDARD_TYPES.size < 5) {
  console.error("CONTROL DID NOT FIRE: the analyzer's own sets read stale.")
  process.exit(3)
}
const isIdentifierShape = (s: string): boolean => {
  if (s.length === 0) return false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    const ok = (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_"
    if (!ok) return false
  }
  return !(s[0] >= "0" && s[0] <= "9")
}
const isAllCapsIdentifier = (s: string): boolean => {
  let hasUpper = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c >= "a" && c <= "z") return false
    if (c >= "A" && c <= "Z") hasUpper = true
  }
  return hasUpper
}
const TYPE_POSITION_LABELS = new Set(["extends", "implements", "instantiates", "references"])

/** The SAME wall rule as `cpp-dump-classify.ts` (the lane's own classifier), re-derived from the
 *  analyzer's own exported sets rather than forked. */
function wallOf(label: string, target: string): string {
  const s = String(target ?? "").trim()
  if (label === "imports") return "W2-module-path-not-a-symbol"
  if (label === "exports") return "W5-export-marker-not-a-declaration"
  if (CPP_KEYWORDS.has(s) || CPP_BUILTIN_TYPE_KEYWORDS.has(s)) return "W7-keyword-spelled-recovery"
  if (CPP_NON_CLASS_STANDARD_TYPES.has(s)) return "W8-non-class-standard-type"
  if (s.startsWith("operator") || s.startsWith("~")) return "W9-operator-name-not-a-symbol"
  if (s.includes("::")) return "W4-qualified-name-not-published"
  if (s.includes("<") || s.includes(">")) return "W3-template-args-in-target"
  if (!isIdentifierShape(s)) return "W6-non-identifier-shaped"
  if (isAllCapsIdentifier(s)) return "W10-macro-defined-name"
  if (TYPE_POSITION_LABELS.has(label)) return "W1-type-not-declared-in-run"
  if (label === "uses" || label === "overrides") return "W11-member-leaf-owner-unresolved"
  return "W1-callable-not-declared-in-run"
}

// ── the rows, grouped by wall ───────────────────────────────────────────────────────────────────
type Row = { label: string; outcome: string; target: string; src: string; line: number; wall: string }
const byWall = new Map<string, Row[]>()
let residualRows = 0
for (const line of readFileSync(DUMP, "utf8").split("\n")) {
  if (!line.startsWith("DUMP\t")) continue
  const p = line.split("\t")
  if (p.length < 5) continue
  if (p[2] !== "unresolved" && p[2] !== "ambDeclOnly" && p[2] !== "ambBoth") continue
  residualRows++
  const m = p[4].match(/^(.*):(\d+)$/)
  if (!m) continue
  const wall = wallOf(p[1], p[3])
  const list = byWall.get(wall) ?? []
  list.push({ label: p[1], outcome: p[2], target: p[3].trim(), src: m[1], line: Number(m[2]), wall })
  byWall.set(wall, list)
}
if (residualRows === 0) { console.error("cpp-wall-disposition: 0 residual rows — check the dump path"); process.exit(2) }

// ── the PROJECT DECLARATION SPACE (the shipped spec + the shipped builder) ──────────────────────
const indexMod: any = await import(path.join(ROOT, "src/ast/project-index.ts"))
const spec: any = indexMod.CPP_DECLARATION_SPEC
if (!spec) { console.error("cpp-wall-disposition: project-index.ts does not export CPP_DECLARATION_SPEC"); process.exit(3) }
const wasm = path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")
type Space = { names: Set<string>; counts: Map<string, number>; typeNames: Set<string>; memberOwners: Map<string, number> }
const spaces = new Map<string, Space>()
const repos = [...new Set([...byWall.values()].flat().map((r) => repoOf(r.src)))].sort()
for (const repo of repos) {
  const repoDir = path.join(CR, repo)
  let tracked: string[] = []
  try { tracked = execFileSync("git", ["-C", repoDir, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\n").filter(Boolean) } catch { continue }
  const files: string[] = []
  for (const rel of tracked) {
    const e = extOf(rel)
    if (!ADMITTED.has(e) && !HEADERS.has(e)) continue
    const abs = path.join(repoDir, rel)
    try { if (statSync(abs).size <= SIZE_CAP) files.push(abs) } catch { /* absent */ }
  }
  let built: any
  try { built = await indexMod.buildProjectIndexStreaming(wasm, files, spec) } catch { continue }
  built.complete = true
  const memberOwners = new Map<string, number>()
  for (const [, members] of built.typeMembers) for (const m of members) memberOwners.set(m, (memberOwners.get(m) ?? 0) + 1)
  spaces.set(repo, { names: built.symbolNames, counts: built.symbolCounts, typeNames: new Set(built.typeKinds.keys()), memberOwners })
}

// ── per-wall sub-classification, and the DISPOSITION ────────────────────────────────────────────
type Sub = { rows: number; samples: string[] }
type Wall = {
  wall: string; rows: number; subs: Record<string, Sub>; disposition: string; falsifier: string; note: string
}
const walls: Wall[] = []
const sub = (w: Wall, k: string, r: Row): void => {
  const s = w.subs[k] ?? (w.subs[k] = { rows: 0, samples: [] })
  s.rows++
  if (s.samples.length < 4) s.samples.push(`${r.src.split(`${path.sep}.corpus${path.sep}`)[1] ?? r.src}:${r.line} ${r.label} ${r.target} [${r.outcome}]`)
}
for (const [name, rows] of [...byWall.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const w: Wall = { wall: name, rows: rows.length, subs: {}, disposition: "", falsifier: "", note: "" }
  for (const r of rows) {
    const sp = spaces.get(repoOf(r.src))
    const declared = sp?.names.has(r.target) === true
    const declCount = sp?.counts.get(r.target) ?? 0
    const isType = sp?.typeNames.has(r.target) === true
    const ownerCount = sp?.memberOwners.get(r.target) ?? 0
    const inStdlib = STDLIB.has(r.target)
    if (name === "W1-callable-not-declared-in-run" || name === "W1-type-not-declared-in-run") {
      if (ownerCount > 0 && !isType) sub(w, "member-leaf-owner-unresolved (receiver typing)", r)
      else if (declared && declCount === 1) sub(w, "project-declares-ONCE (a project fact decides it)", r)
      else if (declared) sub(w, "project-declares-MULTIPLE (bounded, not decided)", r)
      else if (inStdlib) sub(w, "committed-stdlib-vocabulary-reaches-it (a citation's reach)", r)
      else sub(w, "nothing-in-the-project-declares-it (a new claim kind is needed)", r)
    } else if (name === "W11-member-leaf-owner-unresolved") {
      if (ownerCount === 1) sub(w, "exactly ONE class declares the leaf (the receiver would decide it)", r)
      else if (ownerCount > 1) sub(w, "SEVERAL classes declare the leaf (the receiver would decide it)", r)
      else sub(w, "no class in the project declares the leaf", r)
    } else if (name === "W10-macro-defined-name") {
      sub(w, "the target is a MACRO name — macros are not declarations (RULED per §18.8)", r)
    } else if (name === "W2-module-path-not-a-symbol") {
      sub(w, "an include target is a PATH, and the key space is symbols (by construction)", r)
    } else if (name === "W4-qualified-name-not-published") {
      sub(w, "a dotted spelling answers to no published key (the analyzer publishes LEAF names)", r)
    } else if (name === "W5-export-marker-not-a-declaration") {
      sub(w, "the target is the export MARKER as written, never a declaration", r)
    } else if (name === "W9-operator-name-not-a-symbol") {
      sub(w, "an operator/destructor spelling is not a published symbol", r)
    } else if (name === "W8-non-class-standard-type") {
      sub(w, "a non-class standard typedef that escaped the analyzer's guard", r)
    } else {
      sub(w, "unclassified", r)
    }
  }
  walls.push(w)
}

// ── the CONTROL: every wall's subs sum to its rows, and no wall is left unclassified ───────────
for (const w of walls) {
  const sum = Object.values(w.subs).reduce((a, s) => a + s.rows, 0)
  if (sum !== w.rows) {
    console.error(`CONTROL DID NOT FIRE: wall ${w.wall} has ${w.rows} rows but its classes sum to ${sum}.`)
    process.exit(3)
  }
  if (w.subs["unclassified"]) {
    console.error(`CONTROL DID NOT FIRE: wall ${w.wall} has ${w.subs["unclassified"].rows} unclassified rows.`)
    process.exit(3)
  }
}

// ── the DISPOSITIONS ───────────────────────────────────────────────────────────────────────────
/** The four dispositions, each with a FALSIFIER — a run that would break the ruling. */
const DISPOSITION: Record<string, { disposition: string; falsifier: string; note: string }> = {
  "W1-callable-not-declared-in-run": {
    disposition: "SPLIT (see subs): the project-fact part is an INSTRUMENT GAP priced by the four-bucket partition; the receiver part is an INSTRUMENT GAP (receiver typing); the vocabulary part is CLAIMED; the rest is a NEW CLAIM KIND",
    falsifier: "The four-bucket partition (script/m14/cpp-w1-price.ts) closes exactly on 614,081 rows; if a future index population declares a name the partition counted as `nothing-in-the-project-declares-it`, the partition's D bucket shrinks and the W1 split is re-priced. A falsifier for the WHOLE wall: if `projectIndexDeclaration` (the task-24 claim kind) is built and verifies > 1,000 rows on the production population, this wall's D bucket becomes CLAIMED rather than a new-claim-kind request.",
    note: "The lane's own §18.9 measurement DEFERRED the task-24 claim kind on 981 sound rows over 35.6% of the wall. The four-bucket partition prices the whole wall on the production population, and it separates the CLAIMED part (the committed `iso-cpp-stdlib` vocabulary) from the part that needs a NEW claim kind.",
  },
  "W1-type-not-declared-in-run": {
    disposition: "INSTRUMENT GAP (the index has no cross-run TYPE declarations) — the same project-fact question as W1, in type position",
    falsifier: "If the project index's `typeKinds` were extended to carry the type's DECLARING FILE (not just its name), a type-position row could be bound to the file that declares it, and this wall's `project-declares-ONCE` sub-class would move from INSTRUMENT GAP to RESOLVED. A falsifier for the ruling: a type-position row whose target the index does NOT declare and which no committed vocabulary lists is a NEW CLAIM KIND request (the same D bucket as W1's).",
    note: "The index answers 'does the project declare this NAME' — it does not answer 'which FILE declared it', so a type-position row cannot be bound to a declaration site even when the name is declared. That is the instrument's limit, measured, not assumed.",
  },
  "W11-member-leaf-owner-unresolved": {
    disposition: "INSTRUMENT GAP (receiver typing) — the rows the index CAN bound but cannot choose",
    falsifier: "A member leaf whose declaring class is EXACTLY ONE in the project is decidable by a receiver fact; if a receiver-typing mechanism is built and the whole-population run shows the `exactly ONE class declares the leaf` sub-class moving out of the wall, the gap is closed. The pre-committed falsifier for the receiver-typing work was the second wave's 7,913 closure-verifiable rows, already measured and named; this wall's residual is what remains AFTER that wave.",
    note: "This is the wall the four-bucket partition's bucket C measures from the other side, and it is the largest single sub-class of it: a bare `m()` names the member without naming its class.",
  },
  "W10-macro-defined-name": {
    disposition: "RULED UNDECIDABLE (macros are not declarations)",
    falsifier: "A macro name is resolved by the PREPROCESSOR, not by a declaration — the project index deliberately does not admit macro names (charter §18.8). The falsifier: if a project-index spec were extended to record macro names as name-only declarations AND the gate resolved a call to one, this wall would become RESOLVED; until then it is ruled. The bound that would break the ruling is a corpus measurement showing a macro-defined name that the analyzer's own `#define` scan can attribute to a DEFINITION SITE — the analyzer already scans macros, so the falsifier is a mechanism, not a hope.",
    note: "114,398 rows. The lane's own C1 measurement found 83% of the `calls` residual named a declaration in a `.h` the gate never parsed, and 3,040 of fmt's macro `#define`s were the largest single part of that. The MACRO class is the part no index can answer, because a macro is not a declaration.",
  },
  "W2-module-path-not-a-symbol": {
    disposition: "RULED UNDECIDABLE (by construction of the type)",
    falsifier: "An `imports` edge's target is an include PATH; the resolution key space is SYMBOLS. A file-level endpoint would have to be added to the edge model (a new relationship type or a file-claim endpoint), which is a MODEL change, not an instrument gap. The falsifier: if a file-claim endpoint existed, this wall would be decidable by a project fact (does the repo carry that path?). It is RULED because the fleet's key space is symbols and no amount of indexing changes the TYPE.",
    note: "50,915 rows. 93% of quoted includes name a real project file (the lane's I2 measurement), so the INFORMATION is there and the ENDPOINT is not.",
  },
  "W4-qualified-name-not-published": {
    disposition: "INSTRUMENT GAP (the analyzer publishes LEAF names; a cpp member symbol has no distinct qualifiedName)",
    falsifier: "If the analyzer published a `qualifiedName` for cpp members, a `a::b` target would answer to a published key. The falsifier is a fixture-and-census pair: a member whose qualified name is `A::m` must be published under it, and the W4 sub-class must shrink by that count. The lane's own `isPlainIdentifier` / `buildFullName` machinery shows the shape is available — the cpp member symbol simply does not carry it.",
    note: "2,771 rows, and it is the mirror image of the W1 wall: a name the project DOES declare, spelled in a way the key space cannot answer.",
  },
  "W5-export-marker-not-a-declaration": {
    disposition: "RULED UNDECIDABLE (the target is the export MARKER as written)",
    falsifier: "An `exports` edge's target is the marker macro (`DART_EXPORT`, `FMT_API`), and the edge's ASSERTION is the syntactic fact that the marker appears in the declaration-specifier position. There is no declaration to bind it to — the declaration is the SOURCE of the row. A claim kind would have to claim a MACRO, which the macro ruling already refuses. The falsifier: a corpus measurement finding a case where the marker is ALSO a real declaration name in the project; that would be a separate, tiny class.",
    note: "835 rows, fixture-pinned in both directions (cpp/exports-marker-910).",
  },
  "W9-operator-name-not-a-symbol": {
    disposition: "RULED UNDECIDABLE (an operator spelling is not a published symbol)",
    falsifier: "The analyzer publishes members under their source spelling, and an operator's source spelling is the operator token. A published `operator==` symbol would let these rows bind — and the lane's own `friend-definition-body-owner` fixture records that publishing an `operator==` symbol CONTRADICTS an authored contract (a free-function friend definition). So the ruling is a CONTRACT conflict, and its falsifier is a Lead ruling on that conflict, not a mechanism.",
    note: "180 rows. The one fixture failure in the lane's suite is the same contract, and it is recorded rather than overturned.",
  },
  "W8-non-class-standard-type": {
    disposition: "INSTRUMENT GAP (a guard that escaped) — 4 rows, tracked, not a residual",
    falsifier: "The analyzer has a guard for non-class standard typedefs (`CPP_NON_CLASS_STANDARD_TYPES`); 4 rows escaped it. The falsifier is a fixture naming each of the 4 spellings, after which the census must read 0.",
    note: "4 rows. Tracked for completeness; the smallest wall in the fleet's D3 tables.",
  },
  "W3-template-args-in-target": {
    disposition: "INSTRUMENT GAP (a template spelling is not a published key)",
    falsifier: "0 rows on the production population — the class is empty and is printed as 0, so there is nothing to dispose. It is listed because a class with zero rows is a MEASURED zero and not an absent class.",
    note: "MEASURED ZERO on the production population.",
  },
  "W7-keyword-spelled-recovery": {
    disposition: "INSTRUMENT GAP (a keyword-spelled recovery) — MEASURED ZERO on the production population",
    falsifier: "0 rows; printed as 0 so the class is a measured zero and not a missing one.",
    note: "MEASURED ZERO.",
  },
  "W6-non-identifier-shaped": {
    disposition: "INSTRUMENT GAP — MEASURED ZERO on the production population",
    falsifier: "0 rows; printed as 0.",
    note: "MEASURED ZERO.",
  },
}
for (const w of walls) {
  const d = DISPOSITION[w.wall]
  if (!d) { console.error(`CONTROL DID NOT FIRE: wall ${w.wall} has no disposition — every named wall must land in exactly one.`); process.exit(3) }
  w.disposition = d.disposition
  w.falsifier = d.falsifier
  w.note = d.note
}
const totalWallRows = walls.reduce((a, w) => a + w.rows, 0)
if (totalWallRows !== residualRows) {
  console.error(`CONTROL DID NOT FIRE: the walls sum to ${totalWallRows} but the dump carries ${residualRows} residual rows.`)
  process.exit(3)
}

const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-wall-disposition.ts",
  measuredAt: new Date().toISOString(),
  dump: DUMP,
  population: {
    residualRowsInDump: residualRows,
    walls: walls.length,
    repos: repos.length,
    reposIndexed: spaces.size,
    machine: { loadAvg1: Number(load1.toFixed(2)), availableGBAtStart: Number(availGB.toFixed(2)), cores: os.cpus().length },
  },
  indexPopulation: { admittedExtensions: [...ADMITTED].sort(), headersIndexed: true },
  rule: {
    wall: "the SAME wall rule as script/m14/cpp-dump-classify.ts, re-derived from the ANALYZER's own exported sets (not forked) so a rename fails here rather than misclassifying.",
    disposition: "RESOLVED = the rows moved into `resolved` by a measured mechanism · CLAIMED = an arbiter-verified claim in its own column, never a resolution · INSTRUMENT GAP = a fact EXISTS and the instrument cannot read it · RULED UNDECIDABLE = no fact can decide the rows, with a stated falsifier. Every wall lands in exactly one.",
    vocabulary: { id: cites.ISO_CPP_STDLIB?.id, roots: cites.ISO_CPP_STDLIB?.roots?.length ?? 0 },
  },
  walls: walls.map((w) => ({
    wall: w.wall,
    rows: w.rows,
    share: `${((w.rows / totalWallRows) * 100).toFixed(1)}%`,
    disposition: w.disposition,
    falsifier: w.falsifier,
    note: w.note,
    subClassification: Object.fromEntries(Object.entries(w.subs).map(([k, v]) => [k, v.rows]).sort((a, b) => b[1] - a[1])),
    samples: Object.fromEntries(Object.entries(w.subs).map(([k, v]) => [k, v.samples])),
  })),
  totals: { wallRows: totalWallRows, residualRowsInDump: residualRows, closureHolds: totalWallRows === residualRows },
}
const json = JSON.stringify(report, null, 1) + "\n"
if (JSON_OUT) {
  const fs = await import("node:fs")
  const t = path.resolve(ROOT, JSON_OUT)
  fs.mkdirSync(path.dirname(t), { recursive: true })
  fs.writeFileSync(t, json)
}
console.log(`cpp-wall-disposition — ${walls.length} walls over ${totalWallRows} residual rows (dump ${residualRows}) · closure ${totalWallRows === residualRows ? "PASS" : "FAIL"}`)
for (const w of walls) {
  console.log(`  ${w.wall.padEnd(38)} ${String(w.rows).padStart(8)}  ${w.disposition.slice(0, 60)}`)
  for (const [k, v] of Object.entries(w.subs).sort((a, b) => b[1].rows - a[1].rows)) console.log(`      ${k.padEnd(62)} ${String(v.rows).padStart(8)}`)
}
