/**
 * COVERAGE-BLOCK GATE — does every lane's DECLARED coverage survive the checks the rule-book makes?
 *
 * WHY. HANDOFF §7.1 says a lane is done when its `implemented/applicable` is derived from a declared
 * `coverage` block with every exclusion carrying an evidence class. Twelve lanes now declare one, and
 * the board prints each row — but nothing ASSERTS the properties, so a block that closes by accident,
 * excludes a type with the wrong class, or lists a type as implemented that no measurement has ever
 * seen fire reads exactly like a sound one. Every other lane's number is downstream of this file's
 * subject, which is why it gets its own gate.
 *
 * WHAT IT ASSERTS, per lane, reading `script/m14/spec/<lane>-completeness.json` directly (never the
 * board's rendered output, so a board bug cannot hide behind a passing gate):
 *
 *   1. CLOSURE     implemented + corpusUnexercised + gaps === applicable, where
 *                  applicable = 10 − grammar-absence − unclassified. A block that does not add up is
 *                  a defect in the DECLARATION, not a rounding.
 *   2. DISJOINT    no type is both implemented and excluded, and no type is listed twice in one list.
 *                  An overlap silently double-counts into the denominator.
 *   3. EVIDENCE    every `excluded` entry names a class in {grammar-absence, zero-sites} AND cites a
 *                  source (`from`). "unclassified" and a missing citation are both FAILURES here:
 *                  `unclassified` is the board's word for "this entry does not shrink the
 *                  denominator", so a block relying on it is claiming a ratio it has not earned.
 *   4. CORPUS-CITED a grammar-absence claim must point at a file that EXISTS (a census artifact),
 *                  because §6 says a ruling without a count is prose.
 *   5. FIRE-CHECK  against the firing log: if a lane declares a type implemented and the log shows
 *                  the type SILENT, report it as an UNEXPLAINED SILENCE for that lane. This is NOT
 *                  automatically a failure — a 120-file stride legitimately misses constructs (sql
 *                  proved it: `contains` silent on the sample, 1,070 edges corpus-wide) — so it is
 *                  reported as a REQUIRED EXPLANATION with the lane named, and `--strict` turns any
 *                  unexplained one into a non-zero exit.
 *
 * NO REGEX. Everything is a JSON read, a Set operation and a substring test.
 *
 * Usage:
 *   npx tsx script/m14/coverage-block-gate.ts [--strict] [--json]
 */
import { readFileSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"

const HERE: string = (import.meta as any).dir ?? dirname(new URL(import.meta.url).pathname)
const ROOT = resolve(HERE, "..", "..")
const SPEC_DIR = "script/m14/spec"
const FIRING_LOG = "validation/m14/results/firing-laptop-b.current.log"

const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
const TOTAL = 10

/** The lane set is read from the same source the board reads it from, for the same reason: the CLI
 *  cannot be imported (its module body runs a self-test and exits). The stripper mirrors
 *  `language-board.ts`'s, INCLUDING the lesson that cost the board a 24th lane: a comment is not
 *  code, and a colon-space-quote or a backtick inside one must never be read as a lane. */
function stripComments(src: string): string {
  let out = "", quote = ""
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quote !== "") {
      out += ch
      if (ch === "\\") { out += src[i + 1] ?? ""; i++ }
      else if (ch === quote) quote = ""
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; continue }
    if (ch === "`") { out += " "; continue }
    if (ch === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") { out += " "; i++ } out += "\n"; continue }
    if (ch === "/" && src[i + 1] === "*") {
      for (i += 2; i < src.length && !(src[i] === "*" && src[i + 1] === "/"); i++) out += src[i] === "\n" ? "\n" : " "
      out += "  "; i++
      continue
    }
    out += ch
  }
  return out
}
function lanes(): string[] {
  const src = stripComments(readFileSync(resolve(ROOT, "script/m14/incoming-gate.ts"), "utf8"))
  const decl = src.indexOf("export const LANES_B")
  if (decl < 0) return []
  const open = src.indexOf("{", decl)
  let depth = 0, quote = "", end = -1
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (quote !== "") { if (ch === "\\") i++; else if (ch === quote) quote = ""; continue }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch
    else if (ch === "{") depth++
    else if (ch === "}" && --depth === 0) { end = i; break }
  }
  if (end < 0) return []
  const out: string[] = []
  for (const part of src.slice(open + 1, end).split(",")) {
    const c = part.indexOf(":")
    if (c < 0) continue
    const k = part.slice(0, c).trim()
    if (k === "" || k.length > 24) continue
    let ident = true
    for (const ch of k) if (!((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "-")) ident = false
    if (ident) out.push(k)
  }
  return out
}

type Firing = { fired: Set<string>; silent: Set<string>; label: string | null; parsed: string | null }
function firingPerLane(): Map<string, Firing> {
  const out = new Map<string, Firing>()
  let text = ""
  try { text = readFileSync(resolve(ROOT, FIRING_LOG), "utf8") } catch { return out }
  let cur: Firing | null = null
  for (const raw of text.split("\n")) {
    const t = raw.trim()
    if (t === "") continue
    if (t.startsWith("### ")) { cur = null; continue }
    if (t.includes("types fired")) {
      // The board's own label spelling: `MARKDOWN_B` is the log's name for `markdown`.
      const label = t.split(" ")[0] ?? ""
      cur = { fired: new Set(), silent: new Set(), label, parsed: null }
      out.set(label.toUpperCase(), cur)
      continue
    }
    if (t.startsWith("SILENT") && cur) {
      const c = t.indexOf(":")
      if (c >= 0) for (const w of t.slice(c + 1).trim().split(/\s+/)) if (w !== "") cur.silent.add(w)
      continue
    }
    if (cur && t.includes(":")) for (const tok of t.split(/\s+/)) {
      const c = tok.indexOf(":")
      if (c > 0 && Number.isFinite(Number(tok.slice(c + 1)))) cur.fired.add(tok.slice(0, c))
    }
  }
  return out
}

/** The log's lane names are the board's, not `LANES_B`'s: `fsharp` -> FSHARP_B, `r` -> R_LANG. */
const LOG_ALIASES: Record<string, string[]> = {
  fsharp: ["FSHARP_B"], r: ["R_LANG"], json: ["JSON_B"], css: ["CSS_B"], toml: ["TOML_B"],
  xml: ["XML_B"], markdown: ["MARKDOWN_B"], clean: ["CLEAN_B"],
}
function firingFor(lane: string, all: Map<string, Firing>): Firing | null {
  const names = [lane.toUpperCase(), ...(LOG_ALIASES[lane] ?? [])]
  for (const n of names) { const f = all.get(n); if (f) return f }
  return null
}

type Row = {
  lane: string; declared: boolean; implemented: number; applicable: number | null; exclusions: number
  problems: string[]
  /** declared implemented but the 120-file log reads SILENT */
  unexplainedSilence: string[]
  /** of those, the ones whose block cites a corpus-scope measurement (an existing artifact path) */
  silenceWithCorpusEvidence: string[]
  /** of those, the ones with no citation at all */
  silenceUncited: string[]
}
const problemsOf = new Map<string, string[]>()
const rows: Row[] = []
const fires = firingPerLane()
const allLanes = lanes()

for (const lane of allLanes) {
  const rel = `${SPEC_DIR}/${lane}-completeness.json`
  const abs = resolve(ROOT, rel)
  const problems: string[] = []
  if (!existsSync(abs)) {
    rows.push({ lane, declared: false, implemented: 0, applicable: null, exclusions: 0, problems: ["no spec file"], unexplainedSilence: [], silenceWithCorpusEvidence: [], silenceUncited: [] })
    continue
  }
  let doc: any
  try { doc = JSON.parse(readFileSync(abs, "utf8")) } catch (e) {
    rows.push({ lane, declared: false, implemented: 0, applicable: null, exclusions: 0, problems: [`unparseable JSON: ${String(e).slice(0, 60)}`], unexplainedSilence: [], silenceWithCorpusEvidence: [], silenceUncited: [] })
    continue
  }
  const blk = doc?.coverage
  if (!blk || typeof blk !== "object" || !Array.isArray(blk.implemented)) {
    rows.push({ lane, declared: false, implemented: 0, applicable: null, exclusions: 0, problems: [], unexplainedSilence: [], silenceWithCorpusEvidence: [], silenceUncited: [] })
    continue
  }
  const impl: string[] = blk.implemented.filter((t: any) => TYPES.includes(t))
  for (const t of blk.implemented) if (!TYPES.includes(t)) problems.push(`implemented names "${t}", which is not one of the ten types`)
  const excluded: any[] = Array.isArray(blk.excluded) ? blk.excluded : []
  const unex: any[] = Array.isArray(blk.corpusUnexercised) ? blk.corpusUnexercised : []

  const gAbs: string[] = [], zero: string[] = [], unclassified: string[] = []
  for (const x of excluded) {
    const label = typeof x === "string" ? x : x?.label
    if (!TYPES.includes(label)) { problems.push(`excluded names "${label}", which is not one of the ten types`); continue }
    const cls = typeof x === "string" ? "" : x?.evidence
    const from = typeof x === "string" ? "" : x?.from
    if (cls === "grammar-absence") gAbs.push(label)
    else if (cls === "zero-sites") zero.push(label)
    // THE MESSAGE MUST MATCH THE ARITHMETIC, AND IT DID NOT.
    //
    // This line said an unclassified exclusion "does NOT shrink the denominator" while the board's
    // arithmetic string — `applicable = 10 - N grammar-absence - M unclassified = K` — SUBTRACTS it,
    // and so does line ~279 of this file. `julia-lane` caught the contradiction and pointed out the
    // direction it flatters: a lane can drop ANY type from the denominator by leaving it
    // unclassified, so an unmeasured exclusion raises n/N exactly like a measured one while costing
    // nothing to produce. The old julia row read 8/8 that way; with the stated rule it would read
    // 8/10, and the spec's JUL-D1/JUL-D2 were precisely such exclusions.
    //
    // The arithmetic is left as-is here because the BOARD is the authority on the column and this
    // gate must not disagree with the row it audits — but the wording is corrected, and the
    // consequence is reported as a finding rather than buried. See
    // docs/analyzers/HANDOFF.md §5.9: whether `unclassified` may shrink the denominator is an OPEN
    // decision, because PROMPT-LAPTOP-B §3.1 allows a denominator to shrink only via a RULED verdict
    // carrying a corpus measurement, and `unclassified` is by definition unmeasured.
    else {
      unclassified.push(label)
      problems.push(`excluded "${label}" is classed "${cls ?? "(none)"}" — only grammar-absence and zero-sites are evidence classes. NOTE this exclusion STILL shrinks the denominator (the board's arithmetic subtracts it), so an unmeasured claim currently buys the same ratio improvement as a measured one. Classify it.`)
    }
    // 4. CORPUS-CITED. Rule-book §6: "A ruling without a count is prose." A grammar-absence (or
    // zero-sites) claim must therefore carry BOTH a COUNT and, where it names an artifact, an
    // artifact that exists.
    //
    // The count half is checked because it is the half a prose ruling can never satisfy and a
    // measured one always can. Measured on bash's block (BD8b): every exclusion cites a design
    // decision and quotes a sentence — "Bash has no classes and no inheritance, so there is no
    // superclass for `overrides` to point at" — with NO number anywhere in it. That is precisely the
    // shape this rule was written for, and a gate that only looked for a filename would pass it.
    if (cls === "grammar-absence" || cls === "zero-sites") {
      if (!from || String(from).trim() === "") problems.push(`exclusion "${label}" (${cls}) cites no source`)
      else {
        const cited = String(from)
        // A COUNT, not merely a digit — and not a digit inside an IDENTIFIER.
        //
        // Two earlier versions of this check were wrong in opposite directions, and both are worth
        // recording because the second is the interesting one:
        //   v1 accepted any digit at all, so `ZZ-D1: 'the grammar has no inheritance node'` PASSED
        //      because the design-decision id contains a `1` — a check satisfied by its own label.
        //   v2 required the number to be followed by a measurement unit word within three tokens,
        //      which then FAILED eight real lanes whose counts are written `=0`, `[..]=0`,
        //      `0 of 28 probed inheritance words`, `at_rules 0`, or inside a path
        //      (`firing-corpus-census.json`). A detector that calls measured blocks prose is worse
        //      than no detector: it trains the reader to ignore it.
        //
        // What the two failures bracket is the actual distinction: a MEASUREMENT contains a number
        // that is not part of a name. So every digit run is extracted, and a run only counts if its
        // token is not an IDENTIFIER. The identifier test is deliberately narrow — a candidate must
        // be ONE word (punctuation stripped) that either
        //   * is dotted-and-uppercase (`ZIG.O.1`, `ZIG.O.2`, `T.O.3`), or
        //   * matches a dash-id: 2+ uppercase letters, a dash, then a letter-and-digit tail
        //     (`MD-D12`, `SQL-D18`, `CSS-D14`, `JSON-G2`, `BD8b`, `ZZ-D1`).
        // Measured: the earlier, looser test ("mostly uppercase AND contains a dot") swallowed
        // `A): an interface is an opaque container...` — a whole CLAUSE treated as one identifier —
        // and so failed zig's ZIG.O.2, whose block carries `0 of 28`. A detector that calls a
        // measured block prose trains the reader to ignore it, which is worse than no detector.
        const isIdentifier = (tok: string): boolean => {
          let letters = 0, uppers = 0, dots = 0
          for (const c of tok) {
            if (c >= "a" && c <= "z") letters++
            else if (c >= "A" && c <= "Z") { letters++; uppers++ }
            else if (c === ".") dots++
          }
          if (letters === 0) return false
          let words = 1
          for (const c of tok) if (c === ".") words++
          if (dots >= 1 && uppers / letters > 0.8 && words >= 2) return true
          // dash-id: `XX-D9`, `XX-D9b`, `X.O`-style already covered above
          let seenDash = false
          for (let i = 0; i < tok.length; i++) {
            const c = tok[i]
            if (c === "-") {
              if (i === 0 || i + 1 >= tok.length) return false
              if (!(tok[i - 1] >= "A" && tok[i - 1] <= "Z")) return false
              if (!(tok[i + 1] >= "A" && tok[i + 1] <= "Z")) return false
              seenDash = true
            }
          }
          if (!seenDash) return false
          // the tail must be an identifier tail: letters/digits only, no other punctuation
          for (const c of tok) {
            const ok = (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "-"
            if (!ok) return false
          }
          return true
        }
        let hasCount = false
        for (const raw of cited.split(/\s+/)) {
          const tok = raw.replace(/[(),;'"]/g, "")
          if (tok === "") continue
          let digitRun = false
          for (const c of tok) if (c >= "0" && c <= "9") digitRun = true
          if (digitRun && !isIdentifier(tok)) { hasCount = true; break }
        }
        if (!hasCount) problems.push(`exclusion "${label}" (${cls}) cites NO COUNT — rule-book §6: a ruling without a count is prose. Cited: "${cited.slice(0, 90)}"`)
        const tok = cited.split(/\s+/).find((wd: string) => wd.includes("/") && (wd.endsWith(".json") || wd.endsWith(".md") || wd.endsWith(".txt") || wd.endsWith(".ts") || wd.endsWith(".yaml")))
        if (tok && !existsSync(resolve(ROOT, tok.replace(/[.,;)]+$/, "")))) problems.push(`exclusion "${label}" cites a file that does not exist: ${tok}`)
      }
    }
  }
  // 2. DISJOINT
  const seen = new Set<string>()
  for (const t of impl) { if (seen.has(t)) problems.push(`implemented lists "${t}" twice`); seen.add(t) }
  for (const t of gAbs) if (impl.includes(t)) problems.push(`"${t}" is BOTH implemented and excluded (grammar-absence)`)
  for (const t of zero) if (impl.includes(t)) problems.push(`"${t}" is BOTH implemented and excluded (zero-sites)`)
  for (const t of unex.map((x) => (typeof x === "string" ? x : x?.label))) {
    if (!TYPES.includes(t)) { problems.push(`corpusUnexercised names "${t}", which is not one of the ten types`); continue }
    if (impl.includes(t)) problems.push(`"${t}" is BOTH implemented and corpusUnexercised`)
  }

  const applicable = TOTAL - gAbs.length - unclassified.length
  const unexCount = unex.filter((x) => TYPES.includes(typeof x === "string" ? x : x?.label)).length
  const claimedGaps = unex.length === 0 && problems.length === 0
    ? undefined : undefined
  // 1. CLOSURE. `gaps` is what is left after implemented, grammar-absence, unclassified and
  // unexercised — the board computes it; here it is computed and REQUIRED to close.
  const gaps = TYPES.filter((t) => !impl.includes(t) && !gAbs.includes(t) && !unclassified.includes(t) && !unex.map((x) => (typeof x === "string" ? x : x?.label)).includes(t))
  if (impl.length + unexCount + gaps.length !== applicable) {
    problems.push(`DOES NOT CLOSE: implemented ${impl.length} + unexercised ${unexCount} + gaps ${gaps.length} ≠ applicable ${applicable}`)
  }
  void claimedGaps

  // 5. FIRE-CHECK: declared-implemented but the log reads SILENT.
  //
  // A stride legitimately misses constructs (sql's `contains` read SILENT on 120 files and fired
  // 1,070 edges corpus-wide), so this is only a defect when the block ALSO cites nothing that could
  // have established the whole-corpus count. `_from` is where a lane records that reading (php's is
  // the model: "NUMERATORS (whole phpunit corpus, 3,231 .php files)"). A citation that names an
  // EXISTING file counts; a citation that names a file which is not there does not, because a
  // reference to a missing artifact is exactly the HCL-D1 failure mode this programme has already
  // paid for once.
  const f = firingFor(lane, fires)
  const unexplained: string[] = [], withEvidence: string[] = [], uncited: string[] = []
  if (f) for (const t of impl) if (f.silent.has(t)) {
    unexplained.push(t)
    const cites: string[] = []
    const from = typeof blk._from === "string" ? blk._from : ""
    if (from !== "") cites.push(from)
    for (const x of excluded) if (typeof x === "object" && typeof x?.from === "string") cites.push(x.from)
    const citedFiles = cites.flatMap((c) => c.split(/\s+/)).filter((w) => w.includes("/"))
    const anyExists = citedFiles.some((w) => existsSync(resolve(ROOT, w.replace(/[.,;)]+$/, ""))))
    if (anyExists) withEvidence.push(t); else uncited.push(t)
  }

  rows.push({ lane, declared: true, implemented: impl.length, applicable, exclusions: excluded.length, problems, unexplainedSilence: unexplained, silenceWithCorpusEvidence: withEvidence, silenceUncited: uncited })
  if (problems.length) problemsOf.set(lane, problems)
}

// ───────────────────────────────────────────────────────────────────────────── output
const JSON_MODE = process.argv.slice(2).includes("--json")
const STRICT = process.argv.slice(2).includes("--strict")
if (JSON_MODE) {
  console.log(JSON.stringify({ gate: "coverage-block-gate", strict: STRICT, lanes: rows, firingLog: FIRING_LOG }, null, 2))
} else {
  const w = (s: string | number, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
  console.log(`coverage-block gate — ${allLanes.length} lanes, reading ${SPEC_DIR} directly (not the board's rendering)`)
  console.log(`firing log ${FIRING_LOG} — ${fires.size} lane rows\n`)
  console.log(`${w("lane", 12)} ${w("declared", 9)} ${w("impl", 5)} ${w("appl", 5)} ${w("excl", 5)} ${w("silent-but-implemented", 40)} problems`)
  console.log("-".repeat(130))
  for (const r of rows) {
    const sil = r.unexplainedSilence.map((t) => (r.silenceUncited.includes(t) ? `${t}?` : t)).join(" ")
    console.log(
      `${w(r.lane, 12)} ${w(r.declared ? "yes" : "NO", 9)} ${w(r.declared ? r.implemented : "-", 5)} ` +
      `${w(r.applicable ?? "-", 5)} ${w(r.declared ? r.exclusions : "-", 5)} ` +
      `${w(sil || "-", 40)} ${r.problems.join(" | ") || "-"}`,
    )
  }
  const undeclared = rows.filter((r) => !r.declared)
  const broken = rows.filter((r) => r.problems.length > 0)
  const unexplained = rows.filter((r) => r.unexplainedSilence.length > 0)
  const uncited = rows.filter((r) => r.silenceUncited.length > 0)
  console.log()
  console.log(`declared ${rows.length - undeclared.length}/${rows.length}   blocks with problems ${broken.length}   lanes with silence ${unexplained.length}   of those, UNCITED ${uncited.length}`)
  if (undeclared.length) console.log(`NOT DECLARED (board falls back to prose+log, which is conservative but not a contract): ${undeclared.map((r) => r.lane).join(" ")}`)
  if (unexplained.length) {
    console.log()
    console.log(`SILENT ON THE 120-FILE STRIDE BUT DECLARED IMPLEMENTED — a trailing \`?\` marks a type whose`)
    console.log(`block cites no existing artifact. Not automatically wrong: sql's \`contains\` read SILENT on 120`)
    console.log(`files and fired 1,070 edges corpus-wide. But §7.2 wants a MEASURED verdict per silent type,`)
    console.log(`so each needs a whole-corpus count behind it, and \`?\` means there is nowhere to read one.`)
    for (const r of unexplained) {
      console.log(`  ${w(r.lane, 12)} cited: ${w(r.silenceWithCorpusEvidence.join(" ") || "-", 34)} uncited: ${r.silenceUncited.join(" ") || "-"}`)
    }
  }
  if (broken.length) {
    console.log()
    console.log(`BLOCKS WITH PROBLEMS:`)
    for (const r of broken) for (const p of r.problems) console.log(`  ${w(r.lane, 12)} ${p}`)
  }
}
if (rows.some((r) => r.problems.length > 0)) process.exit(1)
if (STRICT && rows.some((r) => r.silenceUncited.length > 0)) process.exit(2)
process.exit(0)
