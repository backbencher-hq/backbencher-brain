/**
 * perl LANE — THE CLAUSE-3 CAUSE FALSIFIER.  (lane-owned instrument)
 *
 * WHAT IT IS.  The gate's clause 3 says: every NAMED cause the analyzer declares must be either
 * fixed (so it carries no count) or RULED with a RUN falsifier over the SAME population.  A
 * ruling with no run is prose, and the gate refuses it.  This file is the RUN.
 *
 * THE RULING IT FALSIFIES.  The perl analyzer publishes `metadata.baseBeyondRunScope = <Base>`
 * on an edge whose target names nothing in the project, and the claim means: *"the class this
 * edge names is beyond this run's reach"*.  The arbiter already checks HALF of that — the base
 * must be the target's own owner and identifier-shaped, or the claim is REFUTED and counted
 * against the lane as causeFAIL.  The other half — "the run could not have reached it" — is the
 * part no arbiter can see, and this file sees it, in TWO scopes, because "the run" is ambiguous
 * and the two readings are different facts:
 *
 *   Q1 · THE ARM'S SCOPE (the PROJECT).  The arm parsed every admitted file of every repository,
 *        so it holds a project-scoped key space.  If the base is declared as a class in the SAME
 *        repository as the edge, then the arm COULD reach it, and the claim is false in the scope
 *        the arm measures.  (A class of the same name in a DIFFERENT repository is not in reach:
 *        production's resolver scope is the project, `parallel-indexer.resolveRelationships`.)
 *
 *   Q2 · THE ANALYZER'S OWN SCOPE (the FILE).  The analyzer reads ONE file.  If the SOURCE
 *        wrote a QUALIFIED name whose leaf is the base (`Mojo::UserAgent->new`), then the
 *        analyzer HELD the base and merely published its LEAF — so "beyond this run's reach" is
 *        false in the analyzer's own scope too, and the truthful statement is not "I could not
 *        reach it" but "I chose not to publish what I held".
 *
 * THE EDGES COME FROM THE COMMITTED ARM LOG, not from a re-parse: the dump's `causeDeclared` rows
 * are the run's own rows, and the base of each is `targetOwner(target)` — the arbiter's own
 * function, and the arbiter's own cause branch REQUIRES `base === targetOwner(tgt)`, so deriving
 * the base from the target is exact for every row the arbiter accepted.
 *
 *   EXIT 0 — every named cause survives both questions: the rulings hold.
 *   EXIT 1 — at least one cause fails: the lane's cause channel is claiming something the
 *            population, or the source, refutes.  Every failing cause is printed with the
 *            declaration that refutes it, so the claim can be read and not merely counted.
 *
 * THE KEY SPACE IS THE ANALYZER'S OWN.  The declarations come from the production parse path
 * (`pool-worker.parseFile` → `RealPerlAnalyzer.analyze`), so the falsifier cannot pass by
 * disagreeing with the analyzer about what a perl file declares.
 */

import { statSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? path.resolve(process.cwd(), ".corpus")
const LOG = process.argv[2] ?? "validation/m14/fixtures/perl/arm-whole-2026-10-20.log"
const EXTS = ["pl", "pm", "t", "pod", "perl"]
const SIZE_CAP = 1024 * 1024

// ── THE EDGES, from the arm's own dump ─────────────────────────────────────────
const raw = (await Bun.file(LOG).text()).split("\n")
type CauseEdge = { label: string; target: string; base: string; file: string; repo: string; line: number }
const causeEdges: CauseEdge[] = []
for (const line of raw) {
  if (!line.startsWith("DUMP\t")) continue
  const f = line.split("\t")
  if (f[1] === "BOUND" || f[2] !== "causeDeclared") continue
  const target = f[3]
  const file = f[4]
  const colon = file.lastIndexOf(":")
  const srcFile = file.slice(0, colon)
  const lineNo = Number(file.slice(colon + 1)) || 0
  const dot = target.lastIndexOf(".")
  if (dot <= 0) continue                     // a cause always has an owner (the arbiter requires it)
  causeEdges.push({
    label: f[1], target, base: target.slice(0, dot), file: srcFile, line: lineNo,
    repo: srcFile.replace(/^.*\/\.corpus\//, "").split("/")[0],
  })
}
if (causeEdges.length === 0) {
  console.error(`NO causeDeclared EDGES in ${LOG} — the falsifier has nothing to test, and a falsifier with nothing to test cannot fail.`)
  process.exit(1)
}

// ── THE POPULATION, by the gate's own discovery rule ───────────────────────────
function admitByExtension(rel: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (EXTS.some((e) => low.endsWith(`.${e}`))) return true
  return EXTS.some((e) => base === e) && detectLanguageFromPath(rel) === "perl"
}
const files: string[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!admitByExtension(rel)) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    files.push(abs)
  }
}

const leafOf = (n: string): string => { const c = n.lastIndexOf("::"); return c >= 0 ? n.slice(c + 2) : n }
/** repo -> leaf -> the class-like declarations that answer to it. */
const classesByRepo = new Map<string, Map<string, { name: string; file: string; line: number; kind: string }[]>>()
/** repo -> the set of qualified leaves the SOURCE writes (Q2). */
const qualifiedByRepo = new Map<string, Set<string>>()
/** file -> its text, for the per-edge Q2 window. */
const sourceText = new Map<string, string>()
let parsed = 0
for (const f of files) {
  const repo = f.replace(/^.*\/\.corpus\//, "").split("/")[0]
  let r: any
  try { r = await parseFile(f, path.dirname(f), { projectRoot: path.dirname(f) } as any) } catch { continue }
  parsed++
  let cls = classesByRepo.get(repo)
  if (!cls) classesByRepo.set(repo, (cls = new Map()))
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    const kind = String(s?.kind ?? "")
    const line = Number((s as any)?.range?.startLine ?? 0) || 0
    const kl = kind.toLowerCase()
    if (kl.includes("package") || kl.includes("class") || kl.includes("role") || kl.includes("module")) {
      const leaf = leafOf(name)
      const at = cls.get(leaf)
      if (at) at.push({ name, file: f, line, kind })
      else cls.set(leaf, [{ name, file: f, line, kind }])
    }
  }
  // Q2's evidence is the SOURCE.  Read as text on purpose: the question is about what the
  // source says, and the analyzer's own answer to it is a truncation.
  let text = ""
  try { text = await Bun.file(f).text() } catch { continue }
  sourceText.set(f, text)
  const set = qualifiedByRepo.get(repo) ?? new Set<string>()
  qualifiedByRepo.set(repo, set)
  for (const leaf of qualifiedLeavesIn(text)) set.add(leaf)
}

/** Does this LINE write a qualified name whose leaf is `base`?  No regex: the same
 *  character-class discipline the analyzer uses, so the two agree on an identifier. */
function writesQualified(line: string, base: string): boolean {
  let i = 0
  while (i < line.length) {
    if (line[i] === ":" && line[i + 1] === ":") {
      let start = i
      while (start > 0 && isWordChar(line[start - 1])) start--
      let end = i + 2
      while (end < line.length && isWordChar(line[end])) end++
      const run = line.slice(start, end)
      if (run.includes("::")) {
        const c = run.lastIndexOf("::")
        if (run.slice(c + 2) === base) return true
      }
      i = end
      continue
    }
    i++
  }
  return false
}
function isWordChar(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_"
}
/** Every leaf of every `Word::Word` run in a text. */
function qualifiedLeavesIn(text: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < text.length) {
    if (text[i] === ":" && text[i + 1] === ":") {
      let start = i
      while (start > 0 && isWordChar(text[start - 1])) start--
      let end = i + 2
      while (end < text.length && isWordChar(text[end])) end++
      const run = text.slice(start, end)
      if (run.includes("::")) {
        const c = run.lastIndexOf("::")
        out.push(run.slice(c + 2))
      }
      i = end
      continue
    }
    i++
  }
  return out
}

// ── THE TWO QUESTIONS ─────────────────────────────────────────────────────────
// Q1 · THE ARM'S SCOPE (the PROJECT).  The base must be declared as a class in the edge's OWN
//      repository.  The declaration is looked up by LEAF, because the claim names the leaf.
// Q2 · THE ANALYZER'S OWN SCOPE (the FILE).  The qualified spelling must appear in the edge's
//      own file, within a WINDOW of the edge's own line, because that is the evidence that the
//      analyzer HELD the base and published only its leaf.  The window is stated and its
//      distance is reported, so a reader can see how far the evidence was.
const WINDOW = 15
const q1Fail = new Map<string, { edges: number; decl: string }>()
const q2Fail = new Map<string, { edges: number; sample: string; dist: number }>()
const survivors = new Map<string, number>()
for (const e of causeEdges) {
  const cls = classesByRepo.get(e.repo)
  const decls = cls?.get(e.base) ?? []
  let q2hit: { dist: number; text: string } | null = null
  const text = sourceText.get(e.file)
  if (text) {
    const lines = text.split("\n")
    for (let d = 0; d <= WINDOW; d++) {
      for (const ln of [e.line - d, e.line + d]) {
        const s = lines[ln - 1]
        if (!s) continue
        if (writesQualified(s, e.base)) { q2hit = { dist: d, text: s.trim().slice(0, 90) }; break }
      }
      if (q2hit) break
    }
  }
  if (decls.length > 0) {
    const at = q1Fail.get(e.base) ?? { edges: 0, decl: `${decls[0].kind} '${decls[0].name}' at ${decls[0].file}:${decls[0].line}` }
    at.edges++
    q1Fail.set(e.base, at)
  }
  if (q2hit) {
    const at = q2Fail.get(e.base) ?? { edges: 0, sample: `${e.file}:${e.line}`, dist: q2hit.dist }
    at.edges++
    at.dist = Math.min(at.dist, q2hit.dist)
    q2Fail.set(e.base, at)
  }
  if (decls.length === 0 && !q2hit) survivors.set(e.base, (survivors.get(e.base) ?? 0) + 1)
}
const q1Edges = [...q1Fail.values()].reduce((a, b) => a + b.edges, 0)
const q2Edges = [...q2Fail.values()].reduce((a, b) => a + b.edges, 0)
const q1Names = q1Fail.size
const q2Names = q2Fail.size
const totalNames = new Set(causeEdges.map((e) => e.base)).size
const survivingEdges = [...survivors.values()].reduce((a, b) => a + b, 0)

console.log("perl LANE — THE CLAUSE-3 CAUSE FALSIFIER")
console.log(`root:   ${CR}`)
console.log(`log:    ${LOG}`)
console.log(`population: ${parsed} parsed of ${files.length} admitted`)
console.log(`cause edges under test: ${causeEdges.length} over ${totalNames} named bases`)
console.log("")
console.log("Q1 · THE ARM'S SCOPE (the PROJECT): is the base declared as a class in the edge's OWN repository?")
console.log(`    REFUTED causes: ${q1Names} of ${totalNames}  ·  edges: ${q1Edges} of ${causeEdges.length}`)
console.log("Q2 · THE ANALYZER'S OWN SCOPE (the FILE): does the source write a QUALIFIED name with that leaf within 15 lines?")
console.log(`    REFUTED causes: ${q2Names} of ${totalNames}  ·  edges: ${q2Edges} of ${causeEdges.length}`)
console.log("")
const both = new Set([...q1Fail.keys()].filter((k) => q2Fail.has(k)))
const q1Only = new Set([...q1Fail.keys()].filter((k) => !q2Fail.has(k)))
const q2Only = new Set([...q2Fail.keys()].filter((k) => !q1Fail.has(k)))
console.log("THE CLASSIFICATION OF THE 182 NAMED CAUSES")
console.log(`  refuted by BOTH scopes              : ${both.size} causes`)
console.log(`  refuted by the arm's scope only     : ${q1Only.size} causes  (the project declares it; the file did not write it qualified)`)
console.log(`  refuted by the analyzer's scope only: ${q2Only.size} causes  (the file DID write it qualified; the project does not declare it)`)
console.log(`  SURVIVING BOTH (the rulings hold)   : ${survivors.size} causes  ·  ${survivingEdges} edge(s) of ${causeEdges.length}`)
console.log("")
if (q1Fail.size > 0) {
  console.log("Q1 — the bases the PROJECT declares (the claim 'beyond this run's reach' is FALSE in the arm's scope):")
  for (const [k, v] of [...q1Fail.entries()].sort((a, b) => b[1].edges - a[1].edges).slice(0, 25)) {
    console.log(`    ${k.padEnd(18)} ${String(v.edges).padStart(5)} edge(s)  <- ${v.decl}`)
  }
  if (q1Fail.size > 25) console.log(`    ... and ${q1Fail.size - 25} more`)
  console.log("")
}
if (q2Fail.size > 0) {
  console.log("Q2 — the bases the SOURCE writes QUALIFIED (the analyzer HELD them; the claim is FALSE in its own scope):")
  for (const [k, v] of [...q2Fail.entries()].sort((a, b) => b[1].edges - a[1].edges).slice(0, 25)) {
    console.log(`    ${k.padEnd(18)} ${String(v.edges).padStart(5)} edge(s)  e.g. ${v.sample}`)
  }
  if (q2Fail.size > 25) console.log(`    ... and ${q2Fail.size - 25} more`)
  console.log("")
}
if (q1Fail.size === 0 && q2Fail.size === 0) {
  console.log(`THE FALSIFIER DID NOT FIRE: all ${totalNames} named causes survive both scopes — every ruling holds.`)
} else {
  console.log(`THE FALSIFIER FIRED: ${q1Names} cause(s) are refuted by the PROJECT, ${q2Names} by the ANALYZER'S OWN FILE.`)
  console.log("  Each one is an edge whose analyzer claims a base is 'beyond this run's reach' while the")
  console.log("  population (or the source it read) says otherwise. The claim is not true as worded.")
}

// ── THE MEASUREMENT, WRITTEN WHERE THE RULING GENERATOR CAN READ IT ──────────
// One instrument, one number: the ruling file is generated FROM this measurement, so the
// ruling and the falsification cannot drift apart.
const out = {
  generated: "2026-10-20",
  root: CR,
  log: LOG,
  population: { parsed, admitted: files.length, repos: classesByRepo.size },
  causeEdges: causeEdges.length,
  namedCauses: totalNames,
  q1_projectScope: {
    question: "is the base declared as a class in the edge's OWN repository?",
    refutedCauses: q1Names, refutedEdges: q1Edges,
    detail: Object.fromEntries([...q1Fail.entries()].map(([k, v]) => [k, { edges: v.edges, declaration: v.decl }])),
  },
  q2_analyzerScope: {
    question: `does the source write a QUALIFIED name with that leaf within ${WINDOW} lines of the edge?`,
    refutedCauses: q2Names, refutedEdges: q2Edges, window: WINDOW,
    detail: Object.fromEntries([...q2Fail.entries()].map(([k, v]) => [k, { edges: v.edges, sample: v.sample, minDistance: v.dist }])),
  },
  surviving: {
    causes: [...survivors.keys()].sort(),
    edges: survivingEdges,
  },
  // THE BEFORE STATE, CARRIED IN THE MEASUREMENT SO THE RECORD CANNOT LOSE IT.  The
  // lane-side fix of 2026-10-20 moved the cause channel from 182 named causes over 2251
  // edges down to 6 over 33; the measurement of THAT population is preserved beside this
  // one, and this block names its numbers so the ruling file can carry them without
  // anyone transcribing them a second time.  It is READ, never asserted: if the
  // preserved file is absent the block is null and the generator says so.
  before: await (async () => {
    const BEFORE = "validation/m14/fixtures/perl/cause-falsification-BEFORE-fix-2026-10-20.json"
    try {
      const b = JSON.parse(await Bun.file(BEFORE).text())
      return {
        file: BEFORE,
        causeEdges: b.causeEdges,
        namedCauses: b.namedCauses,
        refutedCauses: b.surviving ? b.namedCauses - (b.surviving?.causes?.length ?? 0) : null,
        survivingCauses: b.surviving?.causes?.length ?? null,
        survivingEdges: b.surviving?.edges ?? null,
      }
    } catch { return null }
  })(),
}
await Bun.write("validation/m14/fixtures/perl/cause-falsification.json", JSON.stringify(out, null, 2) + "\n")
console.log(`WROTE validation/m14/fixtures/perl/cause-falsification.json — ${survivors.size} surviving cause(s), ${survivingEdges} edge(s)`)

process.exit(q1Fail.size === 0 && q2Fail.size === 0 ? 0 : 1)
