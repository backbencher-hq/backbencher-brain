/**
 * SCSS INCOMING AUDIT — the arithmetic half of this round's question.
 *
 * ## The question
 *
 * `incoming-whole.tsv` records, for 23 lanes, how many edge TARGETS resolve and how many
 * are AMBIGUOUS at 600 files each. This lane's row reads `scss  600  8  0  1185`:
 * eight types fired, ZERO ambiguous, 1,185 unresolved. Two of those three numbers need
 * more than a repeat, because the two instruments in this file answer different
 * questions and the round brief asks a question only one of them was built for.
 *
 * ## WHY THE EXISTING AMBIGUITY NUMBER IS A FLOOR, not a measurement
 *
 * `incoming-check.ts:218-223` builds `published: Map<name, kind[]>` — a name mapped to
 * the set of DISTINCT KINDS that name was published under — and calls a target ambiguous
 * when `hits.length > 1`. So three `.btn` rules in three files, all of kind `class`, give
 * `hits.length === 1` and are NOT counted ambiguous.
 *
 * That is a defensible definition and it is not the definition the round brief uses. The
 * brief says an ambiguous edge is "ONE edge that the reverse walk attributes to N
 * declarations", and the reverse walk is `src/lsp/impact.ts`, which matches on TARGET
 * STRINGS. The SCSS analyzer publishes edge endpoints as NAMES — `source: ctx.moduleName,
 * target: name` — never as symbol ids. So the number of DECLARATIONS a name binds to is
 * the number of candidates the reverse walk has to choose between, and that is the
 * instance count, not the distinct-kind count.
 *
 * So this file reports BOTH, names which is which, and never lets the smaller one stand
 * in for the larger. A lane that reports only the kind count when the instance count is
 * four times larger is reporting the number that reads best.
 *
 * ## THE AMBIGUITY SPLIT — three buckets, three different owners
 *
 *   S1  SAME FILE      every declaration of the name is in the edge's OWN file. The
 *                      analyzer published one name N times at different scopes, so an
 *                      edge that means one of them cannot say which. This is a scoping
 *                      failure in this lane and it is repairable.
 *   S2  CROSS FILE,    the name is declared in >1 file under ONE kind. Two rules that
 *       ONE KIND      both call themselves `.btn` is not a bug in the analyzer; the
 *                      published name is simply not a unique identifier. Reporting it as
 *                      an analyzer defect would be wrong, and repairing it inside the
 *                      analyzer is not possible without renaming what the analyzer
 *                      publishes. It is a finding about the published-name contract.
 *   S3  CROSS FILE,    >1 file and >1 kind. The name is both shared and overloaded, so
 *       MIXED KINDS    the kind signal narrows it and does not close it.
 *
 * ## THE UNRESOLVED SPLIT — and why widening the sample is the wrong repair
 *
 * The brief is explicit that an unresolved target naming a file outside the window is not
 * a defect. This file therefore asks, for every unresolved target, a second question
 * against the WHOLE walked corpus rather than the window:
 *
 *   U1  DECLARED ELSEWHERE   the name is published by some file outside the window. The
 *                            window is too small; the edge is fine. Not a defect.
 *   U2  NOWHERE              no file in the corpus publishes the name. Then it is either a
 *                            name that is not a declaration at all — a CSS/Sass built-in,
 *                            a module path from `@use`, a property, a keyword — or a real
 *                            miss. Those are counted apart and the names are printed, so
 *                            the split is checkable rather than asserted.
 *
 * A count is reported with its population every time: edges in the window, files in the
 * window, files walked. A bare rate is a finding about the wrong thing.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/scss/scss-incoming-audit.ts <dump.ndjson> [windowSize]
 *
 * READ-ONLY. Writes nothing.
 */
import { readFileSync } from "node:fs"

const DUMP = process.argv[2] ?? "/tmp/opencode/scss/scss-incoming-walk-full.ndjson"
const WINDOW = Number(process.argv[3] ?? 600)

const TYPES = [
  "calls",
  "uses",
  "contains",
  "imports",
  "references",
  "exports",
  "extends",
  "implements",
  "overrides",
  "instantiates",
] as const
type Type = (typeof TYPES)[number]

type SymRec = { k: "s"; f: string; n: string; k2: string; q: string; sc: string; l: number }
type EdgeRec = { k: "e"; f: string; t: string; s: string; g: string; c: number | null; ec: string; ln: number }
type FileRec = { k: "file"; f: string; fb?: boolean; dg?: boolean; err?: number; ns?: number; ne?: number; thrown?: boolean }

const files: FileRec[] = []
const syms: SymRec[] = []
const edges: EdgeRec[] = []
for (const line of readFileSync(DUMP, "utf8").split("\n")) {
  if (line.length === 0) continue
  let o: any
  try {
    o = JSON.parse(line)
  } catch {
    continue
  }
  if (o.k === "s") syms.push(o as SymRec)
  else if (o.k === "e") edges.push(o as EdgeRec)
  else if (o.k === "file") files.push(o as FileRec)
}

// The walk dumped the whole admitted corpus, so sorting its file records reproduces the
// sorted admitted list the window is a stride of. The stride convention is the census's:
// every Nth, never the first N, because the first N of a sorted path list is one
// repository's alphabetically-early directories.
const allFiles = files.filter((f) => !f.thrown).map((f) => f.f).sort()
const step = Math.max(1, Math.floor(allFiles.length / WINDOW))
const windowFiles = new Set(allFiles.filter((_, i) => i % step === 0).slice(0, WINDOW))

type Pub = { kinds: Set<string>; instances: number; fileSet: Set<string> }
function buildUniverse(recs: SymRec[]): Map<string, Pub> {
  const m = new Map<string, Pub>()
  for (const s of recs) {
    if (s.n.length === 0) continue
    let e = m.get(s.n)
    if (!e) {
      e = { kinds: new Set(), instances: 0, fileSet: new Set() }
      m.set(s.n, e)
    }
    e.kinds.add(s.k2)
    e.instances++
    e.fileSet.add(s.f)
    // incoming-check also indexes the qualified name, so a target that names a scoped
    // symbol by its qualified name resolves under it. Indexed the same way here or the
    // two instruments would disagree about the same file for a reason that is not a fact
    // about the language.
    if (s.q.length > 0 && s.q !== s.n) {
      let q = m.get(s.q)
      if (!q) {
        q = { kinds: new Set(), instances: 0, fileSet: new Set() }
        m.set(s.q, q)
      }
      q.kinds.add(s.k2)
      q.instances++
      q.fileSet.add(s.f)
    }
  }
  return m
}

const symsWin = syms.filter((s) => windowFiles.has(s.f))
const pubWin = buildUniverse(symsWin)
const pubAll = buildUniverse(syms)

const edgesWin = edges.filter((e) => windowFiles.has(e.f))
const edgesByFile = new Map<string, Set<string>>()
for (const s of symsWin) {
  let set = edgesByFile.get(s.f)
  if (!set) {
    set = new Set()
    edgesByFile.set(s.f, set)
  }
  set.add(s.n)
  if (s.q.length > 0) set.add(s.q)
}

type Row = {
  edges: number
  filesWithEdge: number
  distinctTargets: number
  // the instrument the 26-lane sweep used
  kindAmbiguous: number
  // the instrument the reverse walk is actually subject to
  instanceAmbiguous: number
  s1SameFile: number
  s2CrossFileOneKind: number
  s3CrossFileMixedKinds: number
  unresolved: number
  u1DeclaredElsewhere: number
  u2Nowhere: number
  u2Names: Map<string, number>
  srcResolved: number
  confMissing: number
  confLow: number
  ec: Map<string, number>
}
function blank(): Row {
  return {
    edges: 0,
    filesWithEdge: 0,
    distinctTargets: 0,
    kindAmbiguous: 0,
    instanceAmbiguous: 0,
    s1SameFile: 0,
    s2CrossFileOneKind: 0,
    s3CrossFileMixedKinds: 0,
    unresolved: 0,
    u1DeclaredElsewhere: 0,
    u2Nowhere: 0,
    u2Names: new Map(),
    srcResolved: 0,
    confMissing: 0,
    confLow: 0,
    ec: new Map(),
  }
}
const perType = new Map<Type, Row>()
for (const t of TYPES) perType.set(t, blank())
const otherLabels = new Map<string, number>()
const filesWithType = new Map<Type, Set<string>>()
for (const t of TYPES) filesWithType.set(t, new Set())

let selfLoops = 0
let emptyTargets = 0
for (const e of edgesWin) {
  const t = e.t as Type
  const row = perType.get(t)
  if (!row) {
    otherLabels.set(e.t, (otherLabels.get(e.t) ?? 0) + 1)
    continue
  }
  row.edges++
  filesWithType.get(t)!.add(e.f)
  if (e.c === null) row.confMissing++
  else if (e.c < 0.7) row.confLow++
  row.ec.set(e.ec, (row.ec.get(e.ec) ?? 0) + 1)
  if (e.s.length > 0 && (edgesByFile.get(e.f)?.has(e.s) ?? false)) row.srcResolved++
  if (e.g.length === 0) {
    emptyTargets++
    continue
  }
  if (e.s === e.g) {
    selfLoops++
    continue
  }
  row.distinctTargets++
  const hit = pubWin.get(e.g)
  if (!hit) {
    row.unresolved++
    if (pubAll.get(e.g)) row.u1DeclaredElsewhere++
    else {
      row.u2Nowhere++
      row.u2Names.set(e.g, (row.u2Names.get(e.g) ?? 0) + 1)
    }
    continue
  }
  if (hit.kinds.size > 1) row.kindAmbiguous++
  if (hit.instances > 1) {
    row.instanceAmbiguous++
    if (hit.fileSet.size === 1) row.s1SameFile++
    else if (hit.kinds.size === 1) row.s2CrossFileOneKind++
    else row.s3CrossFileMixedKinds++
  }
}

// ── report ────────────────────────────────────────────────────────────────────
const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`)
const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const rpad = (s: string, n: number) => (s.length >= n ? s : " ".repeat(n - s.length) + s)

console.log(`scss incoming audit — arithmetic over a fixed dump, no parse`)
console.log(`dump               ${DUMP}`)
console.log(`files walked       ${allFiles.length}   files in window ${windowFiles.size} (every ${step}th of the sorted list)`)
console.log(`symbols            ${syms.length.toLocaleString()} walked, ${symsWin.length.toLocaleString()} in window`)
console.log(`edges              ${edges.length.toLocaleString()} walked, ${edgesWin.length.toLocaleString()} in window`)
console.log(`self loops         ${selfLoops}   empty targets ${emptyTargets}`)
console.log(`labels outside the ten: ${otherLabels.size === 0 ? "none" : [...otherLabels].map(([k, v]) => `${k} x${v}`).join(", ")}`)
console.log("")
console.log(`${pad("type", 12)}${rpad("edges", 8)}${rpad("files", 7)}${rpad("distinct", 9)}${rpad("kindAmbig", 10)}${rpad("instAmbig", 10)}${rpad("S1", 6)}${rpad("S2", 7)}${rpad("S3", 6)}${rpad("unres", 8)}${rpad("U1", 8)}${rpad("U2", 8)}`)
console.log("-".repeat(93))
for (const t of TYPES) {
  const r = perType.get(t)!
  console.log(
    pad(t, 12) +
      rpad(r.edges === 0 ? "-" : String(r.edges), 8) +
      rpad(r.edges === 0 ? "-" : String(filesWithType.get(t)!.size), 7) +
      rpad(r.edges === 0 ? "-" : String(r.distinctTargets), 9) +
      rpad(r.edges === 0 ? "-" : String(r.kindAmbiguous), 10) +
      rpad(r.edges === 0 ? "-" : String(r.instanceAmbiguous), 10) +
      rpad(r.edges === 0 ? "-" : String(r.s1SameFile), 6) +
      rpad(r.edges === 0 ? "-" : String(r.s2CrossFileOneKind), 7) +
      rpad(r.edges === 0 ? "-" : String(r.s3CrossFileMixedKinds), 6) +
      rpad(r.edges === 0 ? "-" : String(r.unresolved), 8) +
      rpad(r.edges === 0 ? "-" : String(r.u1DeclaredElsewhere), 8) +
      rpad(r.edges === 0 ? "-" : String(r.u2Nowhere), 8),
  )
}
console.log("-".repeat(93))

const tot = blank()
for (const t of TYPES) {
  const r = perType.get(t)!
  tot.edges += r.edges
  tot.kindAmbiguous += r.kindAmbiguous
  tot.instanceAmbiguous += r.instanceAmbiguous
  tot.s1SameFile += r.s1SameFile
  tot.s2CrossFileOneKind += r.s2CrossFileOneKind
  tot.s3CrossFileMixedKinds += r.s3CrossFileMixedKinds
  tot.unresolved += r.unresolved
  tot.u1DeclaredElsewhere += r.u1DeclaredElsewhere
  tot.u2Nowhere += r.u2Nowhere
  tot.srcResolved += r.srcResolved
  tot.confMissing += r.confMissing
  tot.confLow += r.confLow
}
console.log(`TOTAL over ${edgesWin.length.toLocaleString()} in-window edges from ${windowFiles.size} files of ${allFiles.length} walked:`)
console.log(`  ambiguous by DISTINCT KIND (the 26-lane sweep's definition) ${tot.kindAmbiguous}  ${pct(tot.kindAmbiguous, tot.edges)}`)
console.log(`  ambiguous by DECLARATION COUNT (what src/lsp/impact.ts picks between)`)
console.log(`      ${tot.instanceAmbiguous}  ${pct(tot.instanceAmbiguous, tot.edges)}   of which`)
console.log(`      S1 same file, >1 declaration        ${tot.s1SameFile}`)
console.log(`      S2 cross file, one kind             ${tot.s2CrossFileOneKind}`)
console.log(`      S3 cross file, mixed kinds          ${tot.s3CrossFileMixedKinds}`)
console.log(`  unresolved ${tot.unresolved}  ${pct(tot.unresolved, tot.edges)}   of which`)
console.log(`      U1 declared outside the window     ${tot.u1DeclaredElsewhere}   ${pct(tot.u1DeclaredElsewhere, tot.unresolved)}`)
console.log(`      U2 declared NOWHERE in ${allFiles.length} files  ${tot.u2Nowhere}   ${pct(tot.u2Nowhere, tot.unresolved)}`)
console.log(`  source endpoint resolves in its own file ${tot.srcResolved}/${tot.edges}  ${pct(tot.srcResolved, tot.edges)}`)
console.log(`  confidence ABSENT ${tot.confMissing} (${pct(tot.confMissing, tot.edges)})   present and <0.7 ${tot.confLow}`)

console.log(`\nconfidence / evidenceClass per type (absent is not 1.0):`)
for (const t of TYPES) {
  const r = perType.get(t)!
  if (r.edges === 0) continue
  console.log(
    `  ${pad(t, 12)} absent ${rpad(String(r.confMissing), 6)} of ${rpad(String(r.edges), 6)}  <0.7 ${rpad(String(r.confLow), 5)}  evidenceClass ${[...r.ec].map(([k, v]) => `${k || "(none)"}:${v}`).join(" ")}`,
  )
}

console.log(`\nU2 — targets declared NOWHERE, by name (top 40 of the distinct names):`)
const u2All = new Map<string, number>()
for (const t of TYPES) for (const [n, c] of perType.get(t)!.u2Names) u2All.set(n, (u2All.get(n) ?? 0) + c)
const u2Sorted = [...u2All].sort((a, b) => b[1] - a[1])
console.log(`  distinct U2 names ${u2All.size}   U2 edges ${tot.u2Nowhere}`)
for (const [n, c] of u2Sorted.slice(0, 40)) console.log(`  ${rpad(String(c), 5)}  ${JSON.stringify(n)}`)
if (u2Sorted.length > 40) console.log(`  ... and ${u2Sorted.length - 40} more distinct names`)

// U2 is one bucket with several causes, and the causes have different owners, so they
// are counted apart by the SHAPE of the target string. The predicates are stated here
// rather than hidden in a classifier so a reviewer can disagree with a boundary.
const SHAPES: { key: string; test: (n: string) => boolean; why: string }[] = [
  {
    key: "module-specifier",
    test: (n) => n.includes("/") || /\.(scss|sass|css)$/.test(n) || n.startsWith("sass:"),
    why: "a LOAD PATH — the argument of @use/@forward/@import. It names a FILE, not a declaration, so no published symbol can carry it without a module-path resolver that a single-file analyzer does not have.",
  },
  {
    key: "custom-property",
    test: (n) => n.startsWith("--"),
    why: "a CSS custom property. Sass does not declare these; they are set by :root or by another stylesheet and are only READ here.",
  },
  {
    key: "declaration-shaped",
    test: (n) => /^[$@%&#.:]/.test(n) && !/\s/.test(n),
    why: "the shape a symbol THIS lane publishes ($var, @mixin x, %placeholder, .class, #id) with no declaration of that name in the corpus. This is the bucket that could be a real miss.",
  },
  {
    key: "source-text",
    test: (n) => /[\s()=;,+\-*/]/.test(n) && !/\.(scss|sass|css)$/.test(n),
    why: "SOURCE TEXT rather than a name — the edge publishes an expression as its endpoint.",
  },
  { key: "bare-identifier", test: () => true, why: "a bare word: no marker this lane publishes under." },
]
type U2Row = { edges: number; names: Set<string>; byType: Map<string, number> }
const u2Shapes = new Map<string, U2Row>()
for (const sh of SHAPES) u2Shapes.set(sh.key, { edges: 0, names: new Set(), byType: new Map() })
for (const t of TYPES) {
  const r = perType.get(t)!
  for (const [n, c] of r.u2Names) {
    const sh = SHAPES.find((s) => s.test(n))!
    const row = u2Shapes.get(sh.key)!
    row.edges += c
    row.names.add(n)
    row.byType.set(t, (row.byType.get(t) ?? 0) + c)
  }
}
console.log(`\nU2 by TARGET SHAPE — ${tot.u2Nowhere} edges, ${u2All.size} distinct names:`)
for (const sh of SHAPES) {
  const row = u2Shapes.get(sh.key)!
  if (row.edges === 0) {
    console.log(`  ${sh.key.padEnd(22)} 0`)
    continue
  }
  console.log(
    `  ${sh.key.padEnd(22)} ${String(row.edges).padStart(5)} edges  ${String(row.names.size).padStart(4)} names  types: ${[...row.byType].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ")}`,
  )
  console.log(`    ${sh.why}`)
}

console.log(`\nS1 — same-file multiple declarations, by name (the bucket this lane can repair):`)
const s1Names = new Map<string, { edges: number; files: Set<string> }>()
for (const e of edgesWin) {
  if (!(perType.get(e.t as Type)?.edges ?? 0)) continue
  const hit = pubWin.get(e.g)
  if (!hit || hit.instances <= 1 || hit.fileSet.size !== 1) continue
  let ent = s1Names.get(e.g)
  if (!ent) {
    ent = { edges: 0, files: new Set() }
    s1Names.set(e.g, ent)
  }
  ent.edges++
  ent.files.add(e.f)
}
const s1Sorted = [...s1Names].sort((a, b) => b[1].edges - a[1].edges)
console.log(`  distinct S1 names ${s1Names.size}   S1 edges ${tot.s1SameFile}`)
for (const [n, v] of s1Sorted.slice(0, 30)) {
  const inst = pubWin.get(n)?.instances ?? 0
  console.log(`  ${rpad(String(v.edges), 5)} edges  ${rpad(String(inst), 3)} declarations  ${JSON.stringify(n)}   e.g. ${[...v.files][0]}`)
}
if (s1Sorted.length > 30) console.log(`  ... and ${s1Sorted.length - 30} more distinct names`)
