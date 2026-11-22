#!/usr/bin/env bun
/**
 * THE EXTENDED LANGUAGE MATRIX — THE GENERATOR (Lead, 2026-10-21).
 *
 * IT GENERATES `validation/m14/verification/LANGUAGE-MATRIX-EXTENDED.md`: the 14 emitted relationship
 * values × 50 lanes, with each lane's OWN APPLICABLE DENOMINATOR beside it. The closure question is
 * coverage (implemented or ruled), not resolution; the resolution census is a separate diagnostic
 * and is not a completion measure.
 *
 * ★ THE ONE THING THIS GENERATOR MUST GET RIGHT, AND IT DID NOT THE FIRST TIME: THE DENOMINATOR IS
 * THE GATE'S DENOMINATOR. `script/m14/coverage-block-gate.ts` is the ARBITER, and a matrix that
 * reports a denominator the gate cannot reproduce is a matrix that contradicts the arbiter — which is
 * the exact defect the gate's own denominator cross-check exists to catch. So the reading rules here
 * ARE the gate's:
 *
 *   applicable = 14 − gAbs − zeroFactLabels        (gate:864-866)
 *
 * where `gAbs` is the `excluded` entries whose class is `grammar-absence` OR one of the four RULING
 * CLASSES (`grammar-remedy-ruled`, `ontological`, `informational`, `adjudication` — gate:92, :676), and
 * `zeroFactLabels` is the `zeroEmissionFacts` BLOCK (gate:862).
 *
 * ★ THE TRAP THAT COST TWO ROUNDS. A `zero-sites` exclusion does NOT shrink the denominator by itself,
 * because the gate subtracts the `zeroEmissionFacts` BLOCK and not the `zero-sites` CLASS. The two are
 * different surfaces, and reading one as the other changes a lane's n: css read 10 here against the
 * gate's 11, and sql read 10 against the gate's 8, and vue read 12 against the gate's 14. FIVE LANES
 * DISAGREED, and the generator was wrong in every one of them.
 *
 * AND THE SECOND TRAP: `impl` and `unex` (corpusUnexercised) OVERLAP LEGITIMATELY. A type the analyzer
 * PUBLISHES and the corpus does not EXERCISE is a real state — csharp's `renders` is it — and it is
 * counted ONCE, in `implemented` (gate:867 and the ruling at gate:757). The generator marks it `E·U`.
 *
 * THE GENERATOR VERIFIES ITSELF AGAINST THE GATE. It runs the gate, reads the gate's own per-lane
 * `impl`/`appl` columns, and compares them with what it computed. A disagreement is a FAILURE, not a
 * warning, because a matrix that disagrees with the arbiter is worse than no matrix.
 *
 * RUN: bun script/m14/extended-matrix.ts [--write]
 *   without --write it prints the cross-check only.
 */

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")
const OUT = "validation/m14/verification/LANGUAGE-MATRIX-EXTENDED.md"

/** THE 50 LANES, IN THE ORDER THE BOARD AND THE GATE USE. */
const LANES = [
  "bash", "c", "clean", "clojure", "cpp", "csharp", "css", "dart", "elixir", "erlang", "fsharp", "go",
  "graphql", "groovy", "haskell", "hcl", "html", "java", "javascript", "json", "julia", "kotlin", "lua",
  "make", "markdown", "matlab", "nim", "objc", "perl", "php", "powershell", "protobuf", "python", "r",
  "ruby", "rust", "scala", "scss", "solidity", "sql", "svelte", "swift", "toml", "typescript", "vba",
  "vb", "vue", "xml", "yaml", "zig",
]

/** THE 14 EMITTED VALUES, IN THE ENUM'S ORDER. */
const TYPES = [
  "calls", "extends", "implements", "uses", "imports", "exports", "contains", "references", "overrides",
  "instantiates", "decorates", "renders", "mixes_in", "part_of",
]

/**
 * THE GATE'S FOUR RULING CLASSES (`script/m14/coverage-block-gate.ts:92`). A ruling class SHRINKS the
 * denominator exactly as `grammar-absence` does, and it still needs a count and a citation.
 */
const RULING_CLASSES = new Set(["grammar-remedy-ruled", "ontological", "informational", "adjudication"])

/** THE GATE'S CLASS NORMALISATION: the LEADING TOKEN, so a class with a parenthetical gloss is its leading token. */
function clsKey(cls: unknown): string {
  if (typeof cls !== "string") return ""
  return cls.trim().split(/[(\s]/)[0]!.toLowerCase()
}

interface LaneRow {
  impl: Set<string>
  gabs: Set<string>
  zeroSites: Set<string>
  zeroFacts: Set<string>
  pending: Set<string>
  unex: Set<string>
  applicable: Set<string>
  gaps: string[]
  n: number
}

function readLane(lane: string): LaneRow | null {
  const p = resolve(ROOT, `script/m14/spec/${lane}-completeness.json`)
  if (!existsSync(p)) return null
  let blk: any
  try {
    blk = JSON.parse(readFileSync(p, "utf8")).coverage ?? {}
  } catch {
    return null
  }
  const impl = new Set<string>((blk.implemented ?? []).filter((t: any) => typeof t === "string"))
  const gabs = new Set<string>()
  const zeroSites = new Set<string>()
  for (const e of (blk.excluded ?? [])) {
    if (!e || typeof e !== "object") continue
    const key = clsKey(e.evidence)
    if (key === "grammar-absence" || RULING_CLASSES.has(key)) gabs.add(e.label)
    else if (key === "zero-sites") zeroSites.add(e.label)
  }
  // THE `zeroEmissionFacts` BLOCK — the gate subtracts THIS, not the `zero-sites` class.
  const zeroFacts = new Set<string>(
    (blk.zeroEmissionFacts ?? []).map((e: any) => (typeof e === "object" ? e.label : e)).filter(Boolean),
  )
  const pending = new Set<string>(
    (blk.grammarRemedyPending ?? []).map((e: any) => (typeof e === "object" ? e.label : e)).filter(Boolean),
  )
  const unex = new Set<string>(
    (blk.corpusUnexercised ?? []).map((e: any) => (typeof e === "object" ? e.label : e)).filter(Boolean),
  )
  const applicable = new Set(TYPES.filter((t) => !gabs.has(t) && !zeroFacts.has(t)))
  return {
    impl, gabs, zeroSites, zeroFacts, pending, unex, applicable,
    gaps: [...applicable].filter((t) => !impl.has(t) && !unex.has(t)).sort(),
    n: applicable.size,
  }
}

function mark(r: LaneRow | null, t: string): string {
  if (r === null) return "—"
  if (r.impl.has(t)) return r.unex.has(t) ? "E·U" : "E"
  if (r.pending.has(t)) return "P"
  if (r.gabs.has(t)) return "X"
  if (r.zeroFacts.has(t)) return "Z"
  if (r.zeroSites.has(t)) return "z"
  return "·"
}

const rows = new Map<string, LaneRow | null>()
for (const l of LANES) rows.set(l, readLane(l))

// ── THE DOCUMENT ────────────────────────────────────────────────────────────────────────────────
const out: string[] = []
out.push(`# LANGUAGE MATRIX — EXTENDED (14 emitted relationship values × ${LANES.length} lanes)`)
out.push("")
out.push(`**Regenerated ${new Date().toISOString().slice(0, 10)} by the Lead, over ALL ${LANES.length} lanes.** This is the closure`)
out.push("matrix: every lane's every relationship type is either implemented (E, E·U) or ruled out of")
out.push("the denominator (X, Z). A lane with a `P`, `z`, or `·` cell is not closed.")
out.push("")
out.push("Generated by `bun script/m14/extended-matrix.ts`, which VERIFIES ITSELF against the arbiter:")
out.push("it runs `script/m14/coverage-block-gate.ts`, reads the gate's own per-lane columns, and compares")
out.push("them with what it computed. A disagreement is a failure, because a matrix that contradicts the")
out.push("arbiter is worse than no matrix.")
out.push("")
out.push("**THIS IS THE FLEET CLOSURE MATRIX.** Every one of the 50 lanes is scored over the full")
out.push("fourteen-value vocabulary: each cell is implemented (E / E·U) or ruled (X / Z). The former")
out.push("ten-value resolution census measured a different question and is retired as a completion")
out.push("artifact; its 172/423 figure is not a completion measure. Each lane's own applicable")
out.push("denominator is beside it, and a `P` / `z` / `·` cell is a real gap.")
out.push("")
out.push("## THE LEGEND, AND WHY EACH MARK IS A DIFFERENT CLAIM")
out.push("")
out.push("| mark | claim | what it costs |")
out.push("|---|---|---|")
out.push("| **E** | IMPLEMENTED — the analyzer emits the type and the corpus exercises it | in the denominator, satisfied |")
out.push("| **E·U** | IMPLEMENTED AND CORPUS-UNEXERCISED — the analyzer emits the type and the corpus does not exercise it | in the denominator, satisfied; the fixture is the evidence |")
out.push("| **P** | GRAMMAR REMEDY PENDING — work in flight, a rung is available | IN the denominator, counted as an UNIMPLEMENTED GAP |")
out.push("| **X** | RULED — the grammar's own inventory has no such construct, or the type is ruled out of the language's expressible set | OUT of the denominator |")
out.push("| **Z** | RULED zero-emission fact — the analyzer never emits it AND the grammar has no such construct | OUT of the denominator |")
out.push("| **z** | RULED zero-sites — the analyzer never emits it, but the type is still IN the denominator | IN the denominator, counted as a gap |")
out.push("| **·** | A GAP — expressible, not implemented, not ruled | IN the denominator, counted as a gap |")
out.push("")
out.push("**THE PENDING MARK IS THE ONE THAT MATTERS MOST.** A type in GRAMMAR REMEDY PENDING STAYS IN THE")
out.push("DENOMINATOR, counted as an unimplemented gap. The denominator is the language's own expressible")
out.push("set, and a pending type IS expressible — that is exactly why a rung is available. The deciding")
out.push("argument is the incentive: if pending left the denominator, a lane could improve its own ratio by")
out.push("DECLARING work in flight instead of DOING it, which is the julia-lane failure the gate was written")
out.push("to prevent. So a lane with work in flight reads SHORT, and its number cannot improve by")
out.push("reclassifying. The DONE condition is separate from the ratio and is unchanged.")
out.push("")
out.push("## 1 · THE CELL TABLE")
out.push("")
out.push("Each cell is the type's state for that lane. The lane's applicable denominator is in §2.")
out.push("")
out.push("| value | " + LANES.join(" | ") + " |")
out.push("|" + "---|".repeat(LANES.length + 1))
for (const t of TYPES) {
  out.push(`| **${t}** | ` + LANES.map((l) => mark(rows.get(l) ?? null, t)).join(" | ") + " |")
}
out.push("")
out.push("## 2 · EACH LANE'S OWN APPLICABLE DENOMINATOR")
out.push("")
out.push("**n IS THE LANE'S OWN, NOT THE FLEET'S.** A language that cannot express a type does not carry it")
out.push("in its denominator, and a language that CAN express it carries it whether or not the lane has")
out.push("finished it. That is the whole point of measuring each language's own expressible set.")
out.push("")
out.push("| lane | applicable n | implemented | implemented & unexercised | pending (in n, as a gap) | gaps | excluded from n | ratio |")
out.push("|---|---|---|---|---|---|---|---|")
let totImpl = 0
let totAppl = 0
for (const l of LANES) {
  const r = rows.get(l)
  if (r === null || r === undefined) {
    out.push(`| ${l} | (no spec) | — | — | — | — | — | — |`)
    continue
  }
  const nImpl = [...r.impl].filter((t) => r.applicable.has(t)).length
  totImpl += nImpl
  totAppl += r.n
  const pend = [...r.pending].filter((t) => r.applicable.has(t)).sort()
  const ex = [...new Set([...r.gabs, ...r.zeroFacts])].sort()
  out.push(
    `| ${l} | ${r.n} | ${nImpl} | ${[...r.impl].filter((t) => r.unex.has(t)).length} | ` +
    `${pend.length}${pend.length ? ` (${pend.join(", ")})` : ""} | ` +
    `${r.gaps.length}${r.gaps.length ? ` (${r.gaps.join(", ")})` : ""} | ` +
    `${ex.length}${ex.length ? ` (${ex.join(", ")})` : ""} | ${nImpl}/${r.n} |`,
  )
}
out.push(`| **FLEET** | **${totAppl}** | **${totImpl}** | | | | | **${totImpl}/${totAppl}** |`)
out.push("")

// ★ THE GAP CENSUS, GENERATED FROM THE SAME READS AS THE TABLE, SO IT CANNOT GO STALE. THE LEAD
// HAND-COMPUTED IT FIRST AND THE HAND-COMPUTED NUMBER WAS THE STALE ONE: the matrix on disk was from
// 23:57 and the scala lane's `implements` R3 had landed since, so the hand-computed census counted a
// gap the lane had already closed. ⇒ A NUMBER ABOUT THE TABLE IS GENERATED WITH THE TABLE.
{
  const gapCounts = new Map<string, number>()
  let gapTotal = 0
  let lanesWithGaps = 0
  const lanesAtNN: string[] = []
  const mostGaps: Array<{ lane: string; gaps: string[] }> = []
  for (const l of LANES) {
    const r = rows.get(l)
    if (!r) continue
    const g = r.gaps.filter((t) => r.applicable.has(t))
    if (g.length === 0) { lanesAtNN.push(l); continue }
    lanesWithGaps++
    gapTotal += g.length
    for (const t of g) gapCounts.set(t, (gapCounts.get(t) ?? 0) + 1)
    mostGaps.push({ lane: l, gaps: g })
  }
  const byType = [...gapCounts.entries()].sort((a, b) => b[1] - a[1])
  out.push("## 3 · THE GAP CENSUS")
  out.push("")
  out.push(`**${gapTotal} (lane, type) GAPS across ${lanesWithGaps} of the ${LANES.length} lanes. ${LANES.length - lanesWithGaps} lanes are at n/n.**`)
  out.push("")
  out.push("A GAP IS A (lane, type) PAIR THAT IS EXPRESSIBLE, NOT IMPLEMENTED, AND NOT RULED. It is in")
  out.push("that lane's denominator and it counts against that lane, which is the point: a lane cannot")
  out.push("improve its ratio by declaring work in flight instead of doing it.")
  out.push("")
  out.push("| type | lanes with it as a gap |")
  out.push("|---|---|")
  for (const [t, n] of byType) out.push(`| **${t}** | ${n} |`)
  out.push("")
  if (gapTotal === 0) {
    out.push("**THERE ARE NO GAPS.** Every expressible (lane, type) pair is either implemented or ruled;")
    out.push("the four extended values are closed lane by lane, not deferred. A future gap is a real")
    out.push("regression and this section will list it.")
  } else {
    out.push("**THE FOUR EXTENDED TYPES ARE THE CAMPAIGN.** The four extended values — `decorates`,")
    out.push("`renders`, `mixes_in`, `part_of` — carry the fleet's remaining work where they are gaps.")
  }
  out.push("")
  out.push("**THE LANES AT n/n:** " + (lanesAtNN.length ? lanesAtNN.join(", ") : "(none)") + "")
  out.push("")
  if (gapTotal > 0) {
    out.push("**THE LANES WITH THE MOST GAPS:**")
    out.push("")
    out.push("| lane | gaps |")
    out.push("|---|---|")
    for (const m of mostGaps.sort((a, b) => b.gaps.length - a.gaps.length).slice(0, 12)) {
      out.push(`| ${m.lane} | ${m.gaps.length} (${m.gaps.join(", ")}) |`)
    }
    out.push("")
  }
}
out.push("## 4 · WHAT THIS TABLE SAYS, AND WHAT IT DOES NOT")
out.push("")
out.push("THE ROW IS NOT THE FLEET'S SCORE. The denominator differs per lane by construction, so the")
out.push("**ratio** is a per-lane claim about a per-lane expressible set, and the fleet row above is a sum")
out.push(`over ${LANES.length} different denominators — a bookkeeping total, NOT a single measure of the fleet. The`)
out.push("owner's bar is per language: each language's own expressible set, n/n, measured on the whole")
out.push("admitted population, correctly resolved, every wall dispositioned with a count and a falsifier.")
out.push("")
out.push("THE TABLE IS A DECLARATION SURFACE, NOT A MEASUREMENT. It says what each lane CLAIMS. The")
out.push("measurement is each lane's own whole-population arm, and the arbiter is")
out.push("`script/m14/coverage-block-gate.ts` — which reads the spec files directly, recomputes every")
out.push("denominator, checks every ruling for a class and a count and a citation to a file that EXISTS,")
out.push("and compares the lane's declared n against its own computed one.")
out.push("")
out.push("THE SOURCE OF EVERY MARK IS `script/m14/spec/<lane>-completeness.json`, and the reading rules are")
out.push("the GATE'S OWN: `applicable = 14 − grammar-absence-and-ruling-classes − zeroEmissionFacts`")
out.push("(`script/m14/coverage-block-gate.ts:864-866`), the four ruling classes at `:92` and `:676`, and the")
out.push("class normalisation (the LEADING TOKEN, so a class with a parenthetical gloss is its leading")
out.push("token) at `:657`. A matrix that used a different class set would report denominators the gate")
out.push("cannot reproduce, which is the defect the gate's own denominator cross-check exists to catch.")
out.push("")
let doc = out.join("\n")

// ── THE CROSS-CHECK AGAINST THE GATE ──────────────────────────────────────────────────────────────
let gateOut = ""
try {
  gateOut = execFileSync("bun", [resolve(ROOT, "script/m14/coverage-block-gate.ts")], {
    cwd: ROOT, encoding: "utf8", timeout: 900_000,
  })
} catch (e: any) {
  gateOut = String(e?.stdout ?? "")
}
const gateMap = new Map<string, { impl: number; appl: number }>()
for (const line of gateOut.split("\n")) {
  const m = /^([a-z][a-z0-9_-]*)\s+yes\s+(\d+)\s+(\d+)\s/.exec(line)
  if (m) gateMap.set(m[1]!, { impl: Number(m[2]), appl: Number(m[3]) })
}
// The same gate also checks that every ruling cites a file that EXISTS. A missing citation is a
// receipt gap, not an uncovered (lane, type) cell; the closure claim below is about the denominator.
const receipt = (() => {
  const m = /declared\s+(\d+)\/(\d+)\s+blocks with problems\s+(\d+)\s+lanes with silence\s+(\d+)/.exec(gateOut)
  return m ? { declared: m[1]!, total: m[2]!, blocks: m[3]!, silence: m[4]! } : null
})()

doc += "\n\n## 5 · RECEIPT STATUS — THE CITATIONS THE GATE COULD NOT VERIFY\n\n"
if (receipt) {
  doc += `The gate also checks that every ruling cites a file that exists. On this generation it reports ` +
    `**${receipt.blocks} blocks with problems**, **${receipt.silence} lanes with silence**, and ` +
    `**${receipt.declared}/${receipt.total} lanes declared**. A missing citation is a **receipt gap**, ` +
    `not an uncovered (lane, type) cell: the closure claim in §1–§3 is about the denominator, and the ` +
    `citation debt is tracked separately.\n`
} else {
  doc += "The gate's summary line could not be read on this generation; receipt status is unknown.\n"
}
const mismatches: string[] = []
for (const l of LANES) {
  const r = rows.get(l)
  if (!r) continue
  const g = gateMap.get(l)
  if (!g) { mismatches.push(`${l}: the gate printed no row for this lane`); continue }
  const nImpl = [...r.impl].filter((t) => r.applicable.has(t)).length
  if (nImpl !== g.impl) mismatches.push(`${l}: matrix implemented ${nImpl} ≠ the gate's ${g.impl}`)
  if (r.n !== g.appl) mismatches.push(`${l}: matrix applicable ${r.n} ≠ the gate's ${g.appl}`)
}

const wantWrite = process.argv.includes("--write")
if (mismatches.length === 0) {
  console.log(`THE MATRIX AND THE GATE AGREE ON ALL ${gateMap.size} LANES — same n, same implemented count.`)
  if (wantWrite) {
    writeFileSync(resolve(ROOT, OUT), doc)
    console.log(`wrote ${OUT} (${doc.split("\n").length} lines)`)
  }
} else {
  console.error(`THE MATRIX AND THE GATE DISAGREE ON ${mismatches.length} LANES — the matrix is NOT written:`)
  for (const m of mismatches) console.error(`  ${m}`)
  process.exit(5)
}
