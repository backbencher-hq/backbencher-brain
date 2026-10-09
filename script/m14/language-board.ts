/**
 * LANGUAGE BOARD — read-only status board for the 23 "laptop B" language lanes.
 *
 * WHY. "How far are we" was answered by a human reading logs and spec JSON by hand and was wrong
 * twice: a coverage table built from source-derivation, and a firing table built from a biased
 * 120-file sample. So this board prints only what the artefacts MEASURED, how old each measurement
 * is, and what it could not read instead of a zero. READ-ONLY: it reads files and `git log`, and
 * writes nothing but its own stdout.
 *
 * INPUTS (read, never re-derived): the lane set in script/m14/incoming-gate.ts (`LANES_B`); firing
 * from validation/m14/results/firing-laptop-b.corrected.log; verdicts from
 * validation/m14/results/incoming-laptop-b.after-sep-fix.log; declared gaps from
 * script/m14/spec/<lane>-completeness.json; analyzer dates from
 * `git log -1 --date=short -- src/ast/real-<lane>-analyzer.ts`.
 *
 * THE LANE SET IS PARSED FROM THE LIVE FILE, NOT `import`ed — so nobody "fixes" it back:
 * `incoming-gate.ts` is a CLI whose module body runs its self-test and then, with no positional
 * argv, prints usage and calls `process.exit(2)`. A dynamic `import()` of it REJECTS during
 * evaluation (verified), so `LANES_B` is unreachable from an importer; and argv that gets past that
 * check makes the module run `measure()` over the corpus, i.e. call an analyzer, which this board
 * must not do. Parsing the object literal out of the same file cannot drift either: every run
 * re-reads it, and the header prints that file's mtime and the lane count it yielded. NO REGEX
 * anywhere (this repo enforces a no-regex rule for analysis code) and nothing is `eval`ed.
 *
 * STALENESS. Firing and incoming are point-in-time measurements of a tree agents edit continuously.
 * A lane's EFFECTIVE LAST CHANGE is its analyzer file's mtime — the moment its bytes last changed on
 * disk, which is what "the analyzer changed after the log was written" means. If the file is gone,
 * its last COMMIT time dates it instead. A commit date is NOT the change time while the file is
 * present: committing does not rewrite the working file, so a commit can postdate a log while the
 * measured bytes are untouched — php is the live example (committed 17:43, last written 17:31,
 * incoming log 17:32), and STALE there would be a false alarm. Those rows are still flagged in a
 * NOTE and in the JSON (`commitAfterLog`), never hidden. Per log: log after the change => `current`;
 * change after the log => `STALE`; either side dateless (analyzer missing, or lane absent from that
 * log, i.e. no measurement date for it) => `unknown`. A row is the WORST of the two logs. A STALE
 * row keeps printing its numbers — they are what was measured; the column says they may no longer
 * describe the tree, and STALE is never rounded to 0. Limitation: staleness covers the lane's own
 * analyzer file, not the grammar, engine or shared code it sits on.
 *
 * `gap.gaps` vs PROSE. The machine-readable gap list is the ARRAY `gap.gaps`. `gap._description` is
 * prose (sql's is 5,318 characters) and is NOT a gap; counting prose, sibling members of `gap`, or
 * sentences inside them is how a "57 gaps" figure was produced while the array held more. Only array
 * ELEMENTS are counted, and any other shape prints as its own state ("no spec", "no field",
 * "gaps≠array", "gap[]=N*") — never as a zero.
 */
import { readFileSync, statSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve, dirname } from "node:path"

const HERE: string = (import.meta as any).dir ?? (import.meta as any).dirname ?? dirname(new URL(import.meta.url).pathname)
const ROOT = resolve(HERE, "..", "..")
// The four inputs. The env overrides exist ONLY so a reviewer can point the board at a missing or
// malformed artefact and watch the degradation (the board never writes a fixture of its own); the
// defaults are the real inputs, and nothing else in this file reads the environment.
const LANES_SRC = process.env.BB_BOARD_LANES ?? "script/m14/incoming-gate.ts"
const FIRING_LOG = process.env.BB_BOARD_FIRING ?? "validation/m14/results/firing-laptop-b.corrected.log"
const INCOMING_LOG = process.env.BB_BOARD_INCOMING ?? "validation/m14/results/incoming-laptop-b.after-sep-fix.log"
const SPEC_DIR = process.env.BB_BOARD_SPEC_DIR ?? "script/m14/spec"
const TOTAL_TYPES = 10 // the ontology's ten relationship types: `fired + SILENT` must sum to this
const JSON_MODE = process.argv.slice(2).includes("--json")
const NOTES = new Map<string, string[]>() // note -> lanes that raised it (grouped, so notes stay short)
const addNote = (note: string, lane: string) => NOTES.set(note, [...(NOTES.get(note) ?? []), lane])
const fatal = (msg: string): never => { console.error(`FATAL: ${msg}`); process.exit(1) }

// ------------------------------------------------------------------ helpers (no regex anywhere)
const WS = " \t\r\n"
/** Whitespace split without a regex. */
function words(s: string): string[] {
  const out: string[] = []; let cur = ""
  for (const ch of s) if (WS.includes(ch)) { if (cur !== "") out.push(cur); cur = "" } else cur += ch
  return cur === "" ? out : [...out, cur]
}
/** Strip wrapping punctuation so "edges," and "(0" compare as "edges" and "0". */
function bare(t: string): string {
  const P = ".,;:()[]"; let a = 0, b = t.length
  while (a < b && P.includes(t[a])) a++
  while (b > a && P.includes(t[b - 1])) b--
  return t.slice(a, b)
}
/** Integer immediately BEFORE `word` in a token list, else null: only the log's own wording is
 *  trusted, so a number the log does not print stays null (rendered `?`) and never becomes 0. */
function numBefore(toks: string[], word: string): number | null {
  for (let i = 1; i < toks.length; i++) {
    if (bare(toks[i]) !== word) continue
    const raw = bare(toks[i - 1]).split(",").join(""); const n = raw === "" ? NaN : Number(raw)
    if (Number.isFinite(n)) return n
  }
  return null
}
const stamp = (ms: number | null): string => {
  if (ms === null) return "?"
  const d = new Date(ms), p = (n: number) => (n < 10 ? "0" + n : String(n))
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ------------------------------------------------------------------ the lane set, read live
/** Split on commas that are outside quotes (a lane value must not be able to fake a separator). */
function splitOutside(body: string): string[] {
  const out: string[] = []; let quote = "", cur = ""
  for (const ch of body) {
    if (quote !== "") { cur += ch; if (ch === quote) quote = "" }
    else if (ch === '"' || ch === "'" || ch === "`") { quote = ch; cur += ch }
    else if (ch === ",") { out.push(cur); cur = "" }
    else cur += ch
  }
  return [...out, cur]
}
const unquote = (s: string): string => {
  const q = s[0]
  return (q === '"' || q === "'" || q === "`") && s[s.length - 1] === q ? s.slice(1, -1) : s
}
function readLaneExtensions(): Array<[string, string]> {
  let src = ""
  try { src = readFileSync(resolve(ROOT, LANES_SRC), "utf8") } catch { fatal(`cannot read ${LANES_SRC}; the lane set is the board's spine`) }
  const decl = src.indexOf("export const LANES_B")
  if (decl < 0) fatal(`no \`export const LANES_B\` declaration in ${LANES_SRC}`)
  const open = src.indexOf("{", decl)
  let depth = 0, quote = "", end = -1
  for (let i = open; open >= 0 && i < src.length; i++) { // quote-aware brace match, so a brace in a string cannot end the literal
    const ch = src[i]
    if (quote !== "") { if (ch === "\\") i++; else if (ch === quote) quote = ""; continue }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch
    else if (ch === "{") depth++
    else if (ch === "}" && --depth === 0) { end = i; break }
  }
  if (open < 0 || end < 0) fatal(`no balanced \`export const LANES_B = { ... }\` literal in ${LANES_SRC}`)
  const pairs: Array<[string, string]> = []
  for (const part of splitOutside(src.slice(open + 1, end))) {
    const c = part.indexOf(":")
    const k = c < 0 ? "" : unquote(part.slice(0, c).trim()), v = c < 0 ? "" : unquote(part.slice(c + 1).trim())
    if (k !== "" && v !== "") pairs.push([k, v])
  }
  return pairs.length === 0 ? fatal(`LANES_B in ${LANES_SRC} parsed to zero lanes`) : pairs
}

// ------------------------------------------------------------------ input files
type Src = { path: string; mtimeMs: number | null; size: number | null; text: string | null }
function readSource(rel: string): Src {
  try {
    const st = statSync(resolve(ROOT, rel))
    return { path: rel, mtimeMs: st.mtimeMs, size: st.size, text: readFileSync(resolve(ROOT, rel), "utf8") }
  } catch { return { path: rel, mtimeMs: null, size: null, text: null } }
}
/** `git log -1` for one path: the date to display AND an epoch, so same-day cases are decidable. */
function gitLastChange(rel: string): { date: string | null; ms: number | null; failed: boolean } {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%ad|%at", "--date=short", "--", rel],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
    if (out === "") return { date: null, ms: null, failed: false }
    const [date, epoch] = out.split("|"); const ms = Number(epoch) * 1000
    return { date: date ?? null, ms: Number.isFinite(ms) ? ms : null, failed: false }
  } catch { return { date: null, ms: null, failed: true } }
}

// ------------------------------------------------------------------ firing log
type FiringRec = { label: string; fired: number | null; parsed: string | null; silent: string[] | null; types: Record<string, number> }
const norm = (s: string) => s.toUpperCase()
const firingAliases: Record<string, string> = { R: "R_LANG" } // the firing log spells the R lane R_LANG
function parseFiring(text: string) {
  const byLabel = new Map<string, FiringRec>()
  let label = "", unparsed = 0, cur: FiringRec | null = null
  for (const raw of text.split("\n")) {
    const t = raw.trim()
    if (t === "") continue
    if (t.startsWith("### ")) { label = t.slice(4).trim(); cur = null; continue }
    const toks = words(t)
    if (t.includes("types fired")) {
      const j = toks.indexOf("parsed")
      cur = { label: label !== "" ? label : (toks[0] ?? "?"), fired: numBefore(toks, "types"), parsed: j > 0 ? bare(toks[j - 1]) : null, silent: null, types: {} }
      byLabel.set(norm(cur.label), cur); continue
    }
    if (t.startsWith("SILENT") && cur) { const c = t.indexOf(":"); cur.silent = c >= 0 ? words(t.slice(c + 1)) : []; continue }
    if (cur && t.includes(":")) { // `calls:1298 contains:766 ...` — the per-type counts, for the JSON
      for (const tok of toks) {
        const c = tok.indexOf(":"), n = c > 0 ? Number(bare(tok.slice(c + 1))) : NaN
        if (c > 0 && Number.isFinite(n)) cur.types[tok.slice(0, c)] = n
      }
      continue
    }
    unparsed++
  }
  return { byLabel, unparsed }
}

// ------------------------------------------------------------------ incoming log
type IncomingRec = {
  label: string; verdict: "PASS" | "FAIL" | null; amb: number | null; unres: number | null; edges: number | null
  ext: { count: number; kind: string } | null; extVerified: number | null; extUnverifiable: number | null
  countersFrom: "explicit" | "pass-prose" | "absent"; selfTest: string | null; line: string
}
function parseIncoming(text: string) {
  const byLabel = new Map<string, IncomingRec>()
  let label = "", unparsed = 0
  for (const raw of text.split("\n")) {
    const t = raw.trim()
    if (t === "") continue
    if (t.startsWith("### ")) { label = t.slice(4).trim(); continue }
    if (!t.startsWith("VERDICT")) {
      if (t.startsWith("instrument self-test")) {
        const rec = byLabel.get(norm(label)), c = t.indexOf(":")
        if (rec && c >= 0) rec.selfTest = words(t.slice(c + 1))[0] ?? null; else unparsed++
      } else unparsed++
      continue
    }
    const d = t.indexOf("—") // the verdict's own em dash separates its claim from its evidence
    const head = d >= 0 ? t.slice(0, d) : t, tk = words(d >= 0 ? t.slice(d + 1) : "")
    const verdict: IncomingRec["verdict"] = head.includes("FAIL") ? "FAIL" : head.includes("PASS") ? "PASS" : null
    let amb = numBefore(tk, "ambiguous"), unres = numBefore(tk, "unresolved")
    // A PASS sentence asserts every edge resolves to exactly one declaration, so its two counters
    // are zero BY THAT WORDING; a FAIL that omits them stays `?` (the json lane does exactly that).
    const hadAmb = amb !== null, hadUnres = unres !== null
    if (verdict === "PASS") { amb = amb ?? 0; unres = unres ?? 0 }
    let ext: IncomingRec["ext"] = null, extUnverifiable: number | null = null
    for (let i = 0; i + 2 < tk.length; i++) {
      if (bare(tk[i]) !== "external" || !tk[i + 1].startsWith("claim")) continue
      const count = numBefore(tk.slice(0, i + 1), "external"), kind = bare(tk[i + 2])
      ext = count === null ? null : { count, kind: kind === "unverifiable" ? "u" : kind === "REFUTED" ? "R" : "?" }
    }
    for (let i = 1; i < tk.length; i++)
      if (bare(tk[i]) === "unverifiable" && (tk[i + 1] ?? "").startsWith("external")) extUnverifiable = numBefore(tk, "unverifiable")
    byLabel.set(norm(label !== "" ? label : "?"), {
      label: label !== "" ? label : "?", verdict, amb, unres, edges: numBefore(tk, "edges"), ext,
      extVerified: numBefore(tk, "verified"), extUnverifiable, selfTest: null, line: t,
      // Where the counters came from: printed outright, or derived from a PASS sentence's wording,
      // or absent because the verdict prints none at all. A derived 0 is never passed off as read.
      countersFrom: amb === null && unres === null && numBefore(tk, "edges") === null ? "absent"
        : verdict === "PASS" && (!hadAmb || !hadUnres) ? "pass-prose" : "explicit",
    })
  }
  return { byLabel, unparsed }
}

// ------------------------------------------------------------------ declared gaps
type GapState = "array" | "no-spec" | "bad-json" | "no-field" | "gap-is-array" | "gaps-not-array"
function readGaps(lane: string) {
  const rel = `${SPEC_DIR}/${lane}-completeness.json`
  const none = (state: GapState, specCount: number | null = null, proseKeys: string[] = []) =>
    ({ path: rel, state, count: null as number | null, specCount, proseKeys })
  if (!existsSync(resolve(ROOT, rel))) return none("no-spec")
  let doc: any
  try { doc = JSON.parse(readFileSync(resolve(ROOT, rel), "utf8")) } catch { return none("bad-json") }
  const g = doc?.gap
  if (g === undefined || g === null) return none("no-field")
  // `gap` ITSELF being the list (protobuf) is reported but NOT counted: only `gap.gaps` is the
  // declared machine-readable list, and folding another key in would repeat the count error.
  if (Array.isArray(g)) return none("gap-is-array", g.length)
  const proseKeys = Object.keys(g).filter((k) => k !== "gaps")
  if (!Array.isArray(g.gaps)) return none("gaps-not-array", typeof g.count === "number" ? g.count : null, proseKeys)
  return { path: rel, state: "array" as GapState, count: g.gaps.length as number | null, specCount: null, proseKeys }
}

// ------------------------------------------------------------------ one row
function buildRow(lane: string, ext: string, firing: ReturnType<typeof parseFiring>, incoming: ReturnType<typeof parseIncoming>) {
  // Labels: the firing log upper-cases and suffixes some lanes (`FSHARP_B`, `R_LANG`); try both.
  const find = <T>(m: Map<string, T>): T | null => m.get(norm(lane)) ?? m.get(norm(lane) + "_B") ?? m.get(firingAliases[norm(lane)] ?? "") ?? null
  const f = find(firing.byLabel), inc = find(incoming.byLabel)

  // Firing: `fired + SILENT` must be the ten ontology types; anything else is a visible note.
  let silent = f ? f.silent : null
  let silentFrom = f ? (f.silent === null ? "absent" : "log") : "no-row"
  if (f && f.silent === null && f.fired === TOTAL_TYPES) { silent = []; silentFrom = "derived-from-10" }
  if (f && f.silent !== null && f.fired !== null && f.fired + f.silent.length !== TOTAL_TYPES)
    addNote(`fired + SILENT ≠ ${TOTAL_TYPES} (log says ${f.fired} + ${f.silent.length})`, lane)
  if (f && f.fired !== null && f.fired < TOTAL_TYPES && silent === null) addNote("no SILENT line although fewer than ten types fired: silent set NOT LISTED", lane)
  if (!f) addNote(`lane absent from the firing log (${FIRING_LOG})`, lane)
  if (!inc) addNote(`lane absent from the incoming log (${INCOMING_LOG})`, lane)
  if (inc && inc.verdict === null) addNote("incoming block has no readable VERDICT line", lane)
  if (inc && inc.verdict === "FAIL" && (inc.amb === null || inc.unres === null || inc.edges === null))
    addNote("FAIL verdict prints no amb/unres/edges totals — shown as `?`, which is not zero", lane)
  if (inc && inc.selfTest === null) addNote("incoming block has no `instrument self-test` line", lane)

  const gaps = readGaps(lane)
  if (gaps.state === "no-spec") addNote(`no spec file ${gaps.path} — the lane declares no gap list at all`, lane)
  if (gaps.state === "no-field") addNote(`${gaps.path} has no \`gap\` field — NOT the same as zero gaps`, lane)
  if (gaps.state === "gaps-not-array")
    addNote(`${gaps.path}'s \`gap\` object has no \`gaps\` array (siblings: ${gaps.proseKeys.join(", ") || "none"}) — not counted, not zero`, lane)
  if (gaps.state === "gap-is-array") addNote(`${gaps.path} puts the list on \`gap\` itself (${gaps.specCount} entries), not \`gap.gaps\` — reported, not counted`, lane)
  if (gaps.state === "bad-json") addNote(`${gaps.path} is not parseable JSON`, lane)

  // Analyzer change: the repo's convention is src/ast/real-<lane>-analyzer.ts.
  const analyzerPath = `src/ast/real-${lane}-analyzer.ts`
  const g = gitLastChange(analyzerPath)
  let mtimeMs: number | null = null
  try { mtimeMs = statSync(resolve(ROOT, analyzerPath)).mtimeMs } catch { mtimeMs = null }
  if (g.failed) addNote("`git log` failed: commit dates unavailable (mtime still used where a file exists)", lane)
  if (mtimeMs === null && g.ms === null)
    addNote(lane === "make"
      ? `${analyzerPath} does not exist (the lane's analyzer is src/ast/real-makefile-analyzer.ts); the board reports the convention path's absence rather than guessing a date`
      : `${analyzerPath} does not exist and has no commit — lane last change UNKNOWN`, lane)

  // STALENESS — see the header. mtime is the change time; the commit date only dates a gone file.
  const change = mtimeMs ?? g.ms
  const staleOf = (src: Src, found: boolean): "current" | "STALE" | "unknown" =>
    src.mtimeMs === null || change === null || !found ? "unknown" : change > src.mtimeMs ? "STALE" : "current"
  const fs = staleOf(firingSrc, !!f), is = staleOf(incomingSrc, !!inc)
  const stale = fs === "STALE" || is === "STALE" ? "STALE" : fs === "unknown" || is === "unknown" ? "unknown" : "current"
  const commitAfter = (logMs: number | null) => g.ms !== null && mtimeMs !== null && logMs !== null && mtimeMs <= logMs && g.ms > logMs
  const commitAfterLog = [commitAfter(firingSrc.mtimeMs) ? "firing" : "", commitAfter(incomingSrc.mtimeMs) ? "incoming" : ""].filter(Boolean)
  if (commitAfterLog.length > 0)
    addNote(`last commit (${stamp(g.ms)}) is after the ${commitAfterLog.join("+")} log while the file's mtime (${stamp(mtimeMs)}) is before it: a commit does not rewrite the working file, so the measured bytes are unchanged — mtime is the rule (see header)`, lane)

  const gapCell = { array: String(gaps.count), "no-spec": "no spec", "no-field": "no field", "gaps-not-array": "gaps≠array",
    "gap-is-array": `gap[]=${gaps.specCount}*`, "bad-json": "bad json" }[gaps.state]
  return {
    lane, ext,
    cells: [
      lane,
      f ? `${f.fired ?? "?"}/${TOTAL_TYPES}` : "not in log",
      !f ? "not in log" : silent === null ? "NOT LISTED" : silent.length === 0 ? "none" : silent.join(" "),
      !inc ? "not in log" : `${inc.verdict ?? "?"} ${inc.amb ?? "?"}/${inc.unres ?? "?"}/${inc.edges ?? "?"}`,
      inc?.ext ? `${inc.ext.count}${inc.ext.kind}` : "—",
      gapCell,
      g.date ?? (mtimeMs === null ? "no file" : `${stamp(mtimeMs).slice(0, 10)}~`),
      stale,
    ],
    json: {
      lane, extension: ext,
      firing: { label: f?.label ?? null, fired: f?.fired ?? null, parsed: f?.parsed ?? null, silent, silentFrom, types: f?.types ?? {} },
      incoming: inc && { label: inc.label, verdict: inc.verdict, ambiguous: inc.amb, unresolved: inc.unres, edges: inc.edges,
        externalClaim: inc.ext, externalVerified: inc.extVerified, externalUnverifiable: inc.extUnverifiable,
        countersFrom: inc.countersFrom, instrumentSelfTest: inc.selfTest, raw: inc.line },
      gaps: { spec: gaps.path, state: gaps.state, declared: gaps.count, gapItselfEntries: gaps.specCount, notCountedKeys: gaps.proseKeys },
      analyzer: { conventionPath: analyzerPath, exists: mtimeMs !== null, lastCommitDate: g.date, lastCommitMs: g.ms, mtimeMs, effectiveChangeMs: change },
      staleness: { verdict: stale, firing: fs, incoming: is, commitAfterLog,
        rule: "content mtime (fallback: last commit when the file is gone) vs each log's mtime; row = worst" },
    },
  }
}

// ------------------------------------------------------------------ run
const lanes = readLaneExtensions()
const firingSrc = readSource(FIRING_LOG)
const incomingSrc = readSource(INCOMING_LOG)
const firing = firingSrc.text === null ? { byLabel: new Map<string, FiringRec>(), unparsed: 0 } : parseFiring(firingSrc.text)
const incoming = incomingSrc.text === null ? { byLabel: new Map<string, IncomingRec>(), unparsed: 0 } : parseIncoming(incomingSrc.text)
if (firingSrc.text === null) addNote(`firing log MISSING (${FIRING_LOG}) — every firing column is unmeasured`, "-")
if (incomingSrc.text === null) addNote(`incoming log MISSING (${INCOMING_LOG}) — every verdict is unmeasured`, "-")
if (firing.unparsed > 0) addNote(`${firing.unparsed} line(s) of the firing log were not recognised`, "-")
if (incoming.unparsed > 0) addNote(`${incoming.unparsed} line(s) of the incoming log were not recognised`, "-")
const rows = lanes.map(([lane, ext]) => buildRow(lane, ext, firing, incoming))
// Two lanes reading one log block would be a silent double-count; say so if it ever happens.
for (const lbl of firing.byLabel.keys()) {
  const owners = lanes.filter(([l]) => norm(l) === lbl || norm(l) + "_B" === lbl || firingAliases[norm(l)] === lbl)
  if (owners.length > 1) addNote(`firing block \`${lbl}\` is claimed by ${owners.length} lanes`, owners.map(([l]) => l).join("+"))
}
const gapArrays = rows.filter((r) => r.json.gaps.state === "array")
const summary = {
  lanes: rows.length,
  incomingPass: rows.filter((r) => r.json.incoming?.verdict === "PASS").length,
  firedAll10: rows.filter((r) => r.json.firing.fired === TOTAL_TYPES).length,
  declaredGaps: gapArrays.reduce((n, r) => n + (r.json.gaps.declared ?? 0), 0),
  gapArrays: gapArrays.length,
  gapsNotCounted: rows.length - gapArrays.length,
  stale: rows.filter((r) => r.json.staleness.verdict === "STALE").length,
  unknown: rows.filter((r) => r.json.staleness.verdict === "unknown").length,
  current: rows.filter((r) => r.json.staleness.verdict === "current").length,
  notInFiringLog: rows.filter((r) => r.json.firing.fired === null).map((r) => r.lane),
  notInIncomingLog: rows.filter((r) => r.json.incoming === null).map((r) => r.lane),
}
const notes = [...NOTES].map(([note, who]) => `${[...new Set(who)].join(", ")}: ${note}`)

// ------------------------------------------------------------------ output
if (JSON_MODE) {
  console.log(JSON.stringify({
    board: "language-board", readOnly: true, generatedAt: new Date().toISOString(),
    sources: {
      laneSet: { path: LANES_SRC, lanes: lanes.length, mtimeMs: statSync(resolve(ROOT, LANES_SRC)).mtimeMs },
      firing: { path: firingSrc.path, mtimeMs: firingSrc.mtimeMs, bytes: firingSrc.size, lanesRead: firing.byLabel.size, linesUnrecognised: firing.unparsed },
      incoming: { path: incomingSrc.path, mtimeMs: incomingSrc.mtimeMs, bytes: incomingSrc.size, lanesRead: incoming.byLabel.size, linesUnrecognised: incoming.unparsed },
    },
    lanes: rows.map((r) => r.json), summary, notes,
  }, null, 2))
} else {
  const headers = ["LANE", "FIRED", "SILENT", "INCOMING", "EXT CLM", "GAPS", "LAST COMMIT", "STALE"]
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r.cells[i].length)))
  const line = (cells: string[]) => cells.map((c, i) => c + " ".repeat(Math.max(0, widths[i] - c.length))).join("  ")
  console.log(`language board — ${rows.length} laptop-B lanes — READ-ONLY — ${stamp(Date.now())}`)
  console.log(`lane set  ${LANES_SRC} (parsed live, not importable — see header) mtime ${stamp(statSync(resolve(ROOT, LANES_SRC)).mtimeMs)}`)
  console.log(`firing    ${FIRING_LOG} mtime ${stamp(firingSrc.mtimeMs)} — ${firing.byLabel.size}/${rows.length} lanes read`)
  console.log(`incoming  ${INCOMING_LOG} mtime ${stamp(incomingSrc.mtimeMs)} — ${incoming.byLabel.size}/${rows.length} lanes read`)
  console.log(`\n${line(headers)}\n${widths.map((w) => "-".repeat(w)).join("  ")}`)
  for (const r of rows) console.log(line(r.cells))
  console.log(`\nSUMMARY   ${summary.lanes} lanes · incoming PASS ${summary.incomingPass} · fire 10/10 ${summary.firedAll10} · declared gaps ${summary.declaredGaps} (gap.gaps elements only, ${summary.gapArrays} lanes) · STALE ${summary.stale} · unknown ${summary.unknown} · current ${summary.current}`)
  console.log(`LEGEND    FIRED n/10 = relationship types that fired (the log's own denominator; fired + SILENT must be 10)`)
  console.log(`          SILENT = types the lane can construct but produced nothing; NOT LISTED = no SILENT line despite <10 fired`)
  console.log(`          INCOMING = verdict + amb/unres/edges; ? = the log does not print that number (NOT zero); not in log = lane absent
                    a PASS row's 0/0 is the verdict's own "every edge resolves" claim (JSON: countersFrom)`)
  console.log(`          EXT CLM = external claims the verdict singles out: u unverifiable, R REFUTED, ? other wording, — none named`)
  console.log(`          GAPS = number of gap.gaps array elements; no spec / no field / gaps≠array / gap[]=N* are NOT zeros (see notes)`)
  console.log(`          STALE = worst of firing+incoming vs the analyzer's content mtime (fallback: last commit if the file is gone)`)
  console.log(`                  a commit that postdates a log without an mtime change is NOT stale and is listed in a note; ~ = no commit date`)
  for (const n of notes) console.log(`NOTE      ${n}`)
}
