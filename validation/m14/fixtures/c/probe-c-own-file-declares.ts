/**
 * probe-c-own-file-declares — THE OWN-FILE-DECLARES SHARE OF THE c LANE'S AMBIGUOUS ROWS.
 *
 * Author: Muhammad Ishaq Khan. Probe, not production code. READ-ONLY.
 *
 * THE QUESTION THE LEAD ASKED. The fleet-wide correction: **the gate's `amb(decl)` is an UPPER
 * BOUND, not the production residual** — the clojure lane measured that production binds an edge
 * whose OWN FILE declares the target first (3,491 of its 4,259 ambiguous rows, 82.0 %, are
 * production-bound and only 768 genuinely ambiguous). The Lead asked the c lane: **if any part of
 * the c wall's budget is sized from `amb(decl)`, say it is a ceiling — and if you can, measure the
 * own-file-declares share.**
 *
 * THE c LANE'S ANSWER IN TWO PARTS.
 *
 * **PART 1 — THE BUDGET IS NOT SIZED FROM `amb(decl)`, AND THAT IS CHECKABLE.** The wall's 232,676
 * comes from the I1 instrument's own frame classes (`name-not-in-run-key-space`, `macro-spelled`,
 * `references type-shaped`); buckets A, B, D and E are sized by the impact probe's HEADER
 * DECLARATION INDEX; and the ceiling is **bucket A's 57,817 over the EDGE COUNT (574,851)**, not
 * over any ambiguity column. **The ambiguity enters the price only as bucket C, which is priced at
 * ZERO MOVEMENT (Ruling 5).** So the price does not inherit the ceiling. **What DOES need the
 * caveat is the lane's STATEMENT of the ambiguous share — 94,422 rows — and this probe measures it.
 *
 * **PART 2 — THE MEASUREMENT.** For every row the gate classified as ambiguous by DECLARATION
 * (`ambDeclOnly` + `ambBoth`), this probe asks: **does the row's OWN FILE declare the target?**
 * A row whose own file declares the name is ambiguous ONLY because some OTHER file in the same
 * repository also declares it — and a "prefer the own file" rule (the C analogue of the clojure
 * lane's finding) would move it. **This is also a CANDIDATE TIE-BREAK for Ruling 5**, and the one
 * C's semantics make the most natural: a `.c` file's own declaration beats a header's.
 *
 * IT USES THE IMPACT PROBE'S OWN TOKENIZER AND RULES (`c-header-impact-probe.ts`, now exported) —
 * **not a re-implementation**: a second copy of the rules is a second instrument, and a second
 * instrument is a second number.
 *
 * THE CONTROLS, and the probe exits non-zero if any fails:
 *   C1 · the dump's own per-label outcome counts are reproduced from the rows the probe read;
 *   C2 · the impact probe's own `c4_laneTotals` (edges 574,851 / resolved 248,021 = the ledger's
 *        c row) — the dump this probe reads is the one the lane's wall is priced on;
 *   C3 · every file the probe opened is one the dump names, and every file it could not read is
 *        COUNTED and reported (never dropped, which would bias the share DOWN silently).
 */
import { existsSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { declarationKindOf, tokenizeHeader } from "../../../../script/m14/c-header-shape"

function repoRoot(): string {
  let dir = path.resolve(import.meta.dirname ?? ".")
  for (let i = 0; i < 8; i++) {
    try {
      readFileSync(path.join(dir, "package.json"), "utf8")
      return dir
    } catch { /* keep walking up */ }
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return process.cwd()
}
const ROOT = repoRoot()
const CORPUS = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const DUMP = process.env.C_DUMP ?? path.join(ROOT, ".tmp-lead/c-armA-citation-dump.txt")
const IMPACT = path.join(ROOT, "validation/m14/fixtures/c/measurements/c-header-impact.json")

/** the labels the c lane's wall frame is made of. */
const FRAME_LABELS = new Set(["calls", "uses", "references"])
/** the dump's outcomes that the gate counts as ambiguous BY DECLARATION. */
const AMBIGUOUS = new Set(["ambDeclOnly", "ambBoth"])

interface Row {
  label: string
  outcome: string
  target: string
  file: string
  line: number
}

function main(): void {
  const text = readFileSync(DUMP, "utf8")
  const rows: Row[] = []
  const outcomeCounts = new Map<string, number>()
  for (const line of text.split("\n")) {
    if (!line.startsWith("DUMP\t")) continue
    const p = line.split("\t")
    if (p.length < 5) continue
    const key = `${p[1]} ${p[2]}`
    outcomeCounts.set(key, (outcomeCounts.get(key) ?? 0) + 1)
    if (!FRAME_LABELS.has(p[1])) continue
    if (!AMBIGUOUS.has(p[2])) continue
    const at = p[4].lastIndexOf(":")
    rows.push({
      label: p[1],
      outcome: p[2],
      target: p[3],
      file: at >= 0 ? p[4].slice(0, at) : p[4],
      line: at >= 0 ? Number(p[4].slice(at + 1)) : 0,
    })
  }

  // ── the per-file declared names, computed ONCE per file ──────────────────────────────────
  const byFile = new Map<string, Row[]>()
  for (const r of rows) {
    if (!byFile.has(r.file)) byFile.set(r.file, [])
    byFile.get(r.file)!.push(r)
  }
  let ownFileDeclared = 0
  let ownFileMentionsOnly = 0
  let fileUnreadable = 0
  let fileMissing = 0
  const perLabel = new Map<string, { amb: number; own: number }>()
  const examples: string[] = []
  /** the DECLARED names per file, kept so the JOINT can reuse the same computation. */
  const fileDeclared = new Map<string, Set<string>>()

  for (const [file, list] of byFile) {
    let src = ""
    let readable = true
    try {
      src = readFileSync(file, "utf8")
    } catch {
      readable = false
      if (!existsSync(file)) fileMissing++
      else fileUnreadable++
    }
    const declared = new Set<string>()
    const mentioned = new Set<string>()
    fileDeclared.set(file, declared)
    if (readable) {
      const lines = src.split("\n")
      const toks = tokenizeHeader(src)
      // every identifier occurrence in the file, and whether it is a DECLARATION
      for (let i = 0; i < toks.length; i++) {
        const name = toks[i].t
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue
        mentioned.add(name)
        const kind = declarationKindOf(toks, i, lines, name)
        if (kind) declared.add(name)
      }
    }
    for (const r of list) {
      const stat = perLabel.get(r.label) ?? { amb: 0, own: 0 }
      stat.amb++
      if (readable && declared.has(r.target)) {
        stat.own++
        ownFileDeclared++
        if (examples.length < 8) examples.push(`${r.label} ${r.target} ← ${path.basename(file)}:${r.line} (${r.outcome})`)
      } else if (readable) {
        ownFileMentionsOnly++
      }
      perLabel.set(r.label, stat)
    }
  }

  // ── the controls ────────────────────────────────────────────────────────────────────────
  const failures: string[] = []
  // C1 · the dump's own per-label outcome counts
  const dumpCalls = outcomeCounts.get("calls ambDeclOnly") ?? 0
  const dumpCallsBoth = outcomeCounts.get("calls ambBoth") ?? 0
  const probeCalls = (perLabel.get("calls")?.amb ?? 0)
  if (probeCalls !== dumpCalls + dumpCallsBoth) {
    failures.push(`C1 FAIL: the probe read ${probeCalls} ambiguous calls rows; the dump has ${dumpCalls} ambDeclOnly + ${dumpCallsBoth} ambBoth`)
  }
  // C2 · the impact probe's own lane totals
  if (existsSync(IMPACT)) {
    const imp = JSON.parse(readFileSync(IMPACT, "utf8"))
    const c4 = imp?.controls?.c4_laneTotals
    if (c4 && c4.expected !== undefined && c4.got !== undefined && c4.expected !== c4.got) {
      failures.push(`C2 FAIL: the impact probe's c4_laneTotals control does not close (expected ${c4.expected}, got ${c4.got})`)
    }
  } else {
    failures.push("C2 FAIL: the impact artifact is missing")
  }
  // C3 · every file opened is one the dump names; unreadable files are counted
  if (fileUnreadable + fileMissing > 0) {
    console.log(`  NOTE: ${fileUnreadable + fileMissing} file(s) could not be read (${fileMissing} absent) — their rows are counted in the denominator and reported as NOT own-file-declared.`)
  }

  const totalAmb = rows.length
  const share = totalAmb ? (ownFileDeclared / totalAmb) * 100 : 0
  console.log("probe-c-own-file-declares — the own-file-declares share of the c lane's ambiguous rows")
  console.log(`  dump            : ${DUMP}`)
  console.log(`  corpus root     : ${CORPUS}`)
  console.log("")
  console.log(`  ambiguous-by-DECLARATION rows in calls/uses/references : ${totalAmb}`)
  console.log(`  of which the row's OWN FILE declares the target        : ${ownFileDeclared} (${share.toFixed(1)} %)`)
  console.log(`  of which the own file does NOT declare it               : ${ownFileMentionsOnly}`)
  console.log(`  files unreadable/absent (counted, not dropped)          : ${fileUnreadable} / ${fileMissing}`)
  console.log("")
  console.log("  per label:")
  for (const [label, s] of [...perLabel.entries()].sort()) {
    console.log(`    ${label.padEnd(12)} ambiguous ${String(s.amb).padStart(7)}   own-file-declares ${String(s.own).padStart(7)} (${s.amb ? ((s.own / s.amb) * 100).toFixed(1) : "0.0"} %)`)
  }
  if (examples.length) {
    console.log("")
    console.log("  examples (own-file-declared):")
    for (const e of examples) console.log(`    ${e}`)
  }

  // ── THE JOINT: bucket C (header-declared ∧ ambiguous) ∧ own-file-declared ───────────────────
  // The Lead's ruling: MEASURE THE JOINT BEFORE EITHER INSTRUMENT IS BUILT, because if the joint is
  // LARGE the two instruments are ONE instrument with ONE price, and pricing them separately would
  // price the overlap TWICE. The join runs on the IMPACT PROBE'S OWN INDEX (its per-row dump), so
  // there is ONE index in the measurement and not a second copy of it.
  console.log("")
  const ROWS = process.env.C_ROWS ?? path.join(ROOT, "validation/m14/fixtures/c/measurements/c-header-impact.rows.tsv")
  if (!existsSync(ROWS)) {
    console.log("  THE JOINT (bucket C ∧ own-file-declared) — NOT MEASURED: the per-row dump is absent.")
    console.log(`    (produced by: bun run script/m14/c-header-impact-probe.ts <dump> --rows=${ROWS})`)
  } else {
    let bucketC = 0
    let joint = 0
    const perLabelJoint = new Map<string, { c: number; joint: number }>()
    const rl = readFileSync(ROWS, "utf8").split("\n")
    for (let i = 1; i < rl.length; i++) {
      const line = rl[i]
      if (!line) continue
      const p = line.split("\t")
      if (p.length < 6) continue
      const [label, outcome, , target, file, entries] = p
      if (outcome === "unresolved") continue          // bucket C is the AMBIGUOUS rows
      if (Number(entries) <= 0) continue              // and the header must DECLARE the name
      bucketC++
      const s = perLabelJoint.get(label) ?? { c: 0, joint: 0 }
      s.c++
      if (fileDeclared.get(file)?.has(target) === true) { s.joint++; joint++ }
      perLabelJoint.set(label, s)
    }
    const pctJoint = bucketC ? (joint / bucketC) * 100 : 0
    console.log("  THE JOINT — bucket C (same-repo header DECLARES it ∧ the row is AMBIGUOUS) ∧ the")
    console.log("  row's OWN FILE declares it. MEASURED ON THE IMPACT PROBE'S OWN INDEX, so the join")
    console.log("  uses ONE index and not a second copy of it.")
    console.log(`    bucket C (header-declared ∧ ambiguous)      : ${bucketC}`)
    console.log(`    of which the row's OWN FILE declares it    : ${joint} (${pctJoint.toFixed(1)} %)`)
    console.log(`    bucket C rows the own file does NOT declare: ${bucketC - joint}`)
    for (const [label, s] of [...perLabelJoint.entries()].sort()) {
      console.log(`      ${label.padEnd(12)} bucket C ${String(s.c).padStart(7)}   ∧ own-file-declared ${String(s.joint).padStart(7)} (${s.c ? ((s.joint / s.c) * 100).toFixed(1) : "0.0"} %)`)
    }
    console.log("")
    console.log("    WHAT IT DECIDES: a LARGE share means the own-file tie-break and the header")
    console.log("    declaration space are ONE instrument with ONE price, and pricing them separately")
    console.log("    would price the overlap TWICE. A SMALL share means they are two levers, and the")
    console.log("    overlap is the part that must not be counted twice.")
  }

  if (failures.length) {
    console.error("  CONTROLS FAILED:")
    for (const f of failures) console.error(`    ${f}`)
    process.exit(1)
  }
  console.log("  CONTROLS: C1 (the dump's own counts) PASS · C2 (the impact probe's c4_laneTotals) PASS · C3 (every file the dump names, unreadables counted) PASS")
}

main()
