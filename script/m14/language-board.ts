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
// THE DEFAULTS ARE THE PROGRAMME'S CURRENT LOGS. They were not: firing pointed at
// `firing-laptop-b.corrected.log` (17:39) and incoming at `incoming-laptop-b.after-sep-fix.log`
// (17:32) while this file's own header, and HANDOFF §1, named
// `firing-laptop-b.current.log` and `incoming-laptop-b.current.log` as the inputs to refresh and
// point at. Measured 2026-10-09: `corrected` was 2h11m older than `current` on firing (17:39 vs
// 19:50) and 45m older on incoming (17:32 vs 18:17), so anyone running the board WITHOUT the
// env overrides read a board older than the one the session was refreshing — and the fix to
// `firing-check.mjs` that moved markdown 1 -> 3 types lived entirely in the newer file. A board
// whose default input is a stale artefact reports a stale programme, whatever its own arithmetic.
// The env overrides stay, for the reason the comment below gives.
const FIRING_LOG = process.env.BB_BOARD_FIRING ?? "validation/m14/results/firing-laptop-b.current.log"
const INCOMING_LOG = process.env.BB_BOARD_INCOMING ?? "validation/m14/results/incoming-laptop-b.current.log"
const SPEC_DIR = process.env.BB_BOARD_SPEC_DIR ?? "script/m14/spec"
const TOTAL_TYPES = 10 // the ontology's ten relationship types: `fired + SILENT` must sum to this
const JSON_MODE = process.argv.slice(2).includes("--json")
/** `--coverage` prints ONLY the derivation per lane, with every source named — the inspection
 *  mode used to audit the extractor against the lanes whose specs are prose rather than fields. */
const COVERAGE_MODE = process.argv.slice(2).includes("--coverage")
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
/**
 * STRIP LINE AND BLOCK COMMENTS, WITHOUT TOUCHING ANYTHING INSIDE A STRING.
 *
 * Why this exists: `readLaneExtensions` is not allowed to `import()` the lane table, so it PARSES
 * the object literal, and the parse was not comment-aware. Measured 2026-10-09: a comment inside
 * `LANES_B` whose text contained a COLON-SPACE-QUOTE sequence was read as a lane — the board
 * printed 24 lanes, the extra one being the sentence `free of `key: "value"` shapes`. The same
 * happened twice more, once because a BACKTICK in a comment opened a string that `splitOutside`
 * then refused to close.
 *
 * That is not a comment's fault; it is a parser that cannot tell prose from code, and it is this
 * programme's most repeated defect shape — a check anchored to a formatting choice, which expires
 * without failing. So comments are removed properly instead of the commenters being warned.
 *
 * Comment text and backticks become SPACES and newlines are preserved, so offsets (and therefore
 * both brace matchers) stay aligned. Backticks are stripped wherever they appear outside a quoted
 * string: a template literal in this table would be new machinery, while a backtick in PROSE is
 * the common case, and assuming prose is the safe direction.
 */
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
  let raw = ""
  try { raw = readFileSync(resolve(ROOT, LANES_SRC), "utf8") } catch { fatal(`cannot read ${LANES_SRC}; the lane set is the board's spine`) }
  // COMMENTS GO FIRST. Without this the literal below is parsed as prose-plus-code, and a comment
  // containing a colon-space-quote or a backtick becomes a lane (measured: 24 lanes for 23).
  const src = stripComments(raw)
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
  const unknown: string[] = []
  for (const part of splitOutside(src.slice(open + 1, end))) {
    const c = part.indexOf(":")
    const k = c < 0 ? "" : unquote(part.slice(0, c).trim()), v = c < 0 ? "" : unquote(part.slice(c + 1).trim())
    // A lane key is an identifier. Anything else a stray comma produced is reported BY NAME rather
    // than silently returned as a lane — a 24th "lane" called `free of ...` is worse than a fatal,
    // because it prints a row and looks like data.
    if (k !== "" && v !== "" && isIdentifierKey(k)) pairs.push([k, v])
    else if (k !== "" || v !== "") unknown.push(part.trim())
  }
  if (unknown.length > 0) console.error(`lane set: ${unknown.length} unparseable entry/entries in ${LANES_SRC} ignored: ${unknown.slice(0, 3).map((u) => JSON.stringify(u.slice(0, 60))).join(", ")}`)
  return pairs.length === 0 ? fatal(`LANES_B in ${LANES_SRC} parsed to zero lanes`) : pairs
}
/** A lane key looks like `bash`, `fsharp`, `objective-c`. Not a sentence, not a fragment. */
function isIdentifierKey(k: string): boolean {
  if (k.length === 0 || k.length > 24) return false
  for (const ch of k) {
    const ok = (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "-" || ch === "_"
    if (!ok) return false
  }
  return true
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


// ------------------------------------------------------------------ implemented / applicable
/**
 * THE CONTRACT COLUMN: `implemented / applicable`, derived from the lane's own spec.
 *
 * FIRED n/10 is not the contract. The denominator of the contract excludes only what the lane
 * has PROVEN not-applicable, and those proofs are not equally strong, so the classes are
 * printed beside every exclusion instead of being flattened into the count:
 *
 *   grammar-absence  a node-type/keyword inventory over the whole grammar: the language cannot
 *                    express the construct. STRONGEST — it leaves the denominator.
 *   zero-sites       the construct EXISTS in the language and occurs 0 times in OUR corpus.
 *                    WEAKER, and it therefore STAYS IN the denominator as corpus-unexercised.
 *   unclassified     the spec rules the label out and the evidence class could not be read
 *                    from it. Reported as its own bucket and excluded from `applicable`
 *                    exactly as the lead's rule states — never promoted to grammar-absence.
 *
 * THE ARITHMETIC, printed in the row so it is auditable there:
 *   applicable        = 10 − grammar-absence − unclassified
 *   corpus-unexercised= applicable − implemented   (types the lane implements with no corpus
 *                       construct to fire on: yaml's `calls` needs a workflow file)
 *   implemented       = the spec's DECLARED emitted set (preferred) ∪ the firing log's fired set,
 *                       restricted to `applicable`. `implementedFrom` names which source spoke.
 *
 * NOTHING IS RENDERED AS A ZERO THAT WAS NOT MEASURED: a lane whose spec declares no emitted set
 * and whose firing row is absent reads `implemented ?`, and a label whose class cannot be read
 * lands in `unclassified` rather than being counted as a proven exclusion.
 */
const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
const typeSet = new Set(TYPES)
/** A field value that IS a relationship-type name, allowing the `relationship:` and
 *  `relationship resolution:` prefixes the specs use, and a trailing parenthetical. */
function asTypeName(v: unknown): string | null {
  if (typeof v !== "string") return null
  let t = v.trim()
  for (const pre of ["relationship resolution:", "relationship:", "type:"]) if (t.toLowerCase().startsWith(pre)) t = t.slice(pre.length).trim()
  const par = t.indexOf("(")
  if (par >= 0) t = t.slice(0, par).trim()
  return typeSet.has(t) ? t : null
}
type Exclusion = { label: string; evidence: "grammar-absence" | "zero-sites" | "unclassified"; from: string; quote: string }
type Coverage = {
  /** does the spec declare ANY relationship-type coverage? A well-formed `coverage` block, an
   *  exclusion, an emitted set or a field-valued ruling. `false` is "not declared", which must
   *  never render as "none". */
  coverageDeclared: boolean
  /** where the declaration came from: the structured block, or prose/fields */
  declaredBy: "spec coverage block" | "spec prose + firing log"
  /** applicable, not implemented, not excluded — the honest remainder, named rather than folded
   *  into `corpus-unexercised` (a zero-sites type is unimplemented, not "implemented but unexercised") */
  gaps: string[] | null
  implemented: string[] | null
  implementedFrom: string
  declaredEmitted: string[] | null
  fired: string[] | null
  excluded: Exclusion[]
  unexercised: string[] | null
  applicable: number | null
  spec: string
  specState: string
}

/** Every text this derivation is allowed to read from one entry, in the spec's own words. */
function entryTexts(e: any): string[] {
  const out: string[] = []
  for (const k of ["ruling", "resolution", "decision", "missing", "measured", "measured_size", "probe", "why", "describe", "_description", "overturn"]) {
    const v = e?.[k]
    if (typeof v === "string") out.push(v)
  }
  return out
}
const has = (s: string, needles: string[]): boolean => {
  const up = s.toUpperCase()
  return needles.some((n) => up.includes(n))
}

/** The class of a ruling's EVIDENCE, in the spec's own words and fields. */
function evidenceClass(e: any, texts: string[]): Exclusion["evidence"] {
  const inst = typeof e?.instrument === "string" ? e.instrument.toLowerCase() : ""
  // An explicit `instrument` field WINS: the lane has already classified its own evidence.
  if (inst.startsWith("a")) return "grammar-absence"
  if (inst.startsWith("b")) return "zero-sites"
  const blob = texts.join(" ")
  // A whole-grammar vocabulary/wording test is the grammar-absence signal. It is checked
  // BEFORE the corpus-count signal, because a lane that proves the grammar cannot express a
  // construct usually ALSO reports the corpus count of the construct it cannot see — and
  // reading that count as the class would demote the strongest evidence to the weakest.
  if (has(blob, ["INSTRUMENT A", "GRAMMAR-INVENTORY", "NODE TYPES", "NODE TYPE", "NODE-TYPE", "DECLARATION NODE", "GRAMMAR PRODUCES", "PINNED GRAMMAR", "GRAMMAR HAS NO", "NO PRODUCTION", "GRAMMAR CANNOT", "HAS NO PRODUCTION", "DISTINCT NODE TYPES"])) return "grammar-absence"
  if (has(blob, ["0 OCCURRENCES", "ZERO OCCURRENCES", "OCCURS 0", "0 TIMES", "0 SITES", "ZERO SITES", "0 IN THE CORPUS", "CORPUS CENSUS", "COUNTED ON THE TREE", "ACROSS 1,", "OVER THE WHOLE CORPUS"])) return "zero-sites"
  return "unclassified"
}
const NOT_APPLICABLE = ["INAPPLICABLE", "NOT APPLICABLE", "NO CONSTRUCT", "HAS NO CONSTRUCT", "EXCLUDED BY THE LANGUAGE", "RULED OUT", "CANNOT BE EXPRESSED", "NOTHING FOR AN", "HAS NO ", "OUT OF THE DENOMINATOR", "IS NOT EMITTED", "NOT EMITTED", "NO DECLARATION FORM", "NO CONSTRUCT TO", "REMAINS EXCLUDED", "IS EXCLUDED", "ARE EXCLUDED", "EXCLUDED IS", "AND ONLY ", "NONE OF THE"]
/** The NEGATIVE polarity of an entry that exists to RULE ON one label: `NO, and the measurement
 *  is positive...` (zig O.1), `RULED — YAML has no construct...` (yaml D10), `NONE of the six
 *  node types` (lua BD-implements). Kept separate from NOT_APPLICABLE so a field-valued entry is
 *  classified by ITS OWN verdict rather than by prose markers anywhere in its text. */
const NEGATIVE_MARK = ["INAPPLICABLE", "NOT APPLICABLE", "NO,", "NO.", "NO —", "NEVER", "CANNOT", "HAS NO ", "HAVE NO ", "NONE OF", "IS NOT ", "ARE NOT ", "DOES NOT ", "0 NODE", "0 ", "ZERO "]
// POSITIVE markers only, and the NEGATED spellings are checked FIRST: "EMITTED" alone matches
// "is NOT emitted", which silently cancelled the two json exclusions this table is built on.
const EMITTED_MARK = ["IS EMITTED", "ARE EMITTED", "NOW EMITTED", "EMITTED,", "BOTH ARE IMPLEMENTED", "BOTH FIRE", "FALSIFIED", "WITHDRAWN", "AND `OVERRIDES` EMITS", "EMITS —", "IS IMPLEMENTED", "ARE IMPLEMENTED"]
const NEGATED_EMITTED = ["NOT EMITTED", "IS NOT EMITTED", "ARE NOT EMITTED", "NEVER EMITTED", "NOTHING IS EMITTED"]

/** The declared EMITTED set: `counts.emitted_edges` keys with a positive count, or an
 *  "N are emitted — a, b, c" sentence. Both are the spec's own words about its own output. */
function declaredEmittedSet(e: any): string[] | null {
  const counts = e?.counts
  if (counts && typeof counts === "object") {
    const em = (counts as any).emitted_edges
    if (em && typeof em === "object") {
      const got = Object.entries(em).filter(([k, v]) => typeSet.has(k) && typeof v === "number" && v > 0).map(([k]) => k)
      if (got.length > 0) return got
    }
  }
  for (const t of entryTexts(e)) {
    const UP = t.toUpperCase()
    // "TEN of ten types fire" declares the WHOLE set with no list to read (php PHPD40).
    if (UP.includes("TEN OF TEN TYPES FIRE") || UP.includes("10 OF 10 TYPES FIRE")) return [...TYPES]
    const toks = words(t)
    for (let i = 0; i < toks.length; i++) {
      const w = bare(toks[i]).toLowerCase()
      if (w !== "emitted" && w !== "emits" && w !== "fire" && w !== "fires") continue
      // "TEN of ten types fire" is a declaration of the WHOLE set, with no list to read.
      if (toks.slice(i, i + 4).map((x) => bare(x).toLowerCase()).join(" ").startsWith("fire of ten")) return [...TYPES]
      if (toks.slice(Math.max(0, i - 1), i + 3).map((x) => bare(x).toLowerCase()).join(" ").includes("of ten types fire")) return [...TYPES]
      // A set declaration is "N are emitted — a, b, c" or "lanes emits SEVEN — a, b". Walk
      // forward collecting type names, and STOP at the boundary that ends the list: a number
      // word (the next clause counts something else) or an exclusion marker.
      const got: string[] = []
      for (let j = i + 1; j < Math.min(toks.length, i + 40); j++) {
        const raw = toks[j]
        const b = bare(raw).toLowerCase()
        if (["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "but", "excluded", "ruled", "neither"].includes(b)) break
        if (raw.endsWith(".") || raw.endsWith(";")) break
        if (typeSet.has(b)) got.push(b)
      }
      if (got.length >= 3) return [...new Set(got)]
    }
  }
  return null
}

/**
 * Labels a sentence RULES OUT, taken from the spec's own prose because some lanes declare it
 * nowhere else: "ONE is ruled: `implements`" (lua BD-implements), "TWO are excluded by the
 * language: implements and instantiates" (json BD-ontology). A set-phrase is read only when its
 * own sentence carries a not-applicable marker, and the labels are collected from the tokens
 * between that marker and the end of the sentence.
 */
function proseRuledLabels(text: string): string[] {
  const toks = words(text)
  const STOP = new Set(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "but", "while", "and", "or", "the", "a", "by", "for", "is", "are", "it", "its"])
  // `bare()` strips the colon, so the marker set is spelled without it. `no`/`not`/`neither`
  // are deliberately ABSENT: with them the extractor read fsharp's prose as excluding
  // `instantiates` (a type the lane emits and fires) — a FALSE exclusion shrinks the
  // denominator and inflates the ratio, which is worse here than a missing one.
  const MARK = new Set(["ruled", "excluded", "inapplicable"])
  const out: string[] = []
  for (let i = 0; i < toks.length; i++) {
    const b = bare(toks[i]).toLowerCase()
    if (!MARK.has(b)) continue
    for (let j = i + 1; j < Math.min(toks.length, i + 14); j++) {
      const raw = toks[j]
      const w = bare(raw).toLowerCase()
      if (raw.endsWith(".") || raw.endsWith(";")) break
      if (w !== "" && STOP.has(w) && out.length > 0) break
      if (typeSet.has(w)) out.push(w)
    }
    if (typeSet.has(b)) out.push(b)
  }
  return [...new Set(out)]
}

/**
 * EXCLUSIONS DECLARED AS ZEROS IN `counts` — CSS-D14's shape: the census object carries one key
 * per construct it looked for, with the count it found, plus `vocabulary_candidates_found` whose
 * EMPTY arrays are the grammar-absence half. A key naming a type with a 0 value is a zero-site
 * exclusion; an empty candidate array for a type is a grammar-absence exclusion.
 */
function countsExclusions(e: any, id: string): Exclusion[] {
  const out: Exclusion[] = []
  const c = e?.counts
  if (!c || typeof c !== "object") return out
  for (const [k, v] of Object.entries(c)) {
    if (typeof v === "number" && v === 0 && typeSet.has(k)) out.push({ label: k, evidence: "zero-sites", from: `counts:${id}:${k}`, quote: `${k} = 0` })
  }
  const vocab = (c as any).vocabulary_candidates_found
  if (vocab && typeof vocab === "object") {
    for (const [k, v] of Object.entries(vocab)) {
      if (typeSet.has(k) && Array.isArray(v) && v.length === 0) out.push({ label: k, evidence: "grammar-absence", from: `counts:${id}:vocabulary_candidates_found.${k}`, quote: `no node type expresses ${k}` })
    }
  }
  return out
}

function deriveCoverage(lane: string, firedTypes: string[] | null, silent: string[] | null): Coverage {
  const rel = `${SPEC_DIR}/${lane}-completeness.json`
  let doc: any = null
  try { doc = JSON.parse(readFileSync(resolve(ROOT, rel), "utf8")) } catch { /* state below */ }
  // THE DECLARED BLOCK WINS. The lead approved killing the prose miner: a lane states its
  // coverage in `coverage`, the board reads the field, and a lane that has not declared one
  // reads `not declared` rather than a guess. The prose path below stays ONLY as a fallback for
  // the lanes that have not migrated yet, and it is deliberately CONSERVATIVE — measured, the
  // loosened version produced FALSE exclusions for julia, dart and yaml, and a false exclusion
  // shrinks the denominator and inflates n/N, which is the one error direction that flatters.
  const blk = doc?.coverage
  if (blk && typeof blk === "object" && Array.isArray(blk.implemented)) {
    const impl = TYPES.filter((t) => blk.implemented.includes(t))
    const exc: Exclusion[] = []
    for (const x of Array.isArray(blk.excluded) ? blk.excluded : []) {
      const lab = asTypeName(x?.label)
      if (lab === null) continue
      const ev = x?.evidence === "grammar-absence" ? "grammar-absence" : x?.evidence === "zero-sites" ? "zero-sites" : "unclassified"
      exc.push({ label: lab, evidence: ev as Exclusion["evidence"], from: String(x?.from ?? "declared"), quote: `coverage.excluded ${lab}` })
    }
    const gAbs = exc.filter((x) => x.evidence === "grammar-absence").map((x) => x.label)
    const uncl = exc.filter((x) => x.evidence === "unclassified").map((x) => x.label)
    const applicable = TOTAL_TYPES - gAbs.length - uncl.length
    const unex = (Array.isArray(blk.corpusUnexercised) ? blk.corpusUnexercised : [])
      .map((x: any) => (typeof x === "string" ? x : asTypeName(x?.label) ?? ""))
      .filter((x: string) => typeSet.has(x))
    const gaps = TYPES.filter((t) => !impl.includes(t) && !gAbs.includes(t) && !uncl.includes(t) && !unex.includes(t))
    // THE DECLARATION MUST CLOSE. implemented + unexercised + gaps === applicable, or the block
    // is internally inconsistent and says so — a declared number that does not add up is a
    // defect in the declaration, not a rounding.
    if (impl.length + unex.length + gaps.length !== applicable) {
      addNote(`coverage block does not close: implemented ${impl.length} + unexercised ${unex.length} + gaps ${gaps.length} ≠ applicable ${applicable}`, lane)
    }
    return { coverageDeclared: true, declaredBy: "spec coverage block", gaps, implemented: impl, implementedFrom: "spec coverage block",
      declaredEmitted: impl, fired: firedTypes, excluded: exc, unexercised: unex, applicable, spec: rel, specState: "read" }
  }
  const excluded: Exclusion[] = []
  let declared: string[] | null = null
  let coverageDeclared = false
  const fieldEmitted = new Set<string>()
  let specState = doc === null ? "no spec" : "read"
  if (doc !== null) {
    const entries: Array<{ kind: string; e: any }> = []
    const g = doc?.gap
    if (Array.isArray(g?.gaps)) for (const e of g.gaps) if (e && typeof e === "object") entries.push({ kind: "gap.gaps", e })
    const dd = doc?.design_decision
    if (Array.isArray(dd?.decisions)) for (const e of dd.decisions) if (e && typeof e === "object") entries.push({ kind: "design_decision", e })
    for (const { kind, e } of entries) {
      const texts = entryTexts(e)
      const blob = texts.join(" ")
      const id = String(e.id ?? e.label ?? "?")
      const status = String(e.status ?? "")
      if (status.toUpperCase() === "SUPERSEDED") continue
      // the declared emitted set
      const decl = declaredEmittedSet(e)
      if (decl !== null && declared === null) declared = decl
      // a label this entry RULES ON
      // The null-safe positive/negated test: a NEGATED emitted phrase cannot cancel a ruling.
      const emitted = has(blob, EMITTED_MARK) && !has(blob, NEGATED_EMITTED)
      const label = asTypeName(e.subject) ?? asTypeName(e.label) ?? asTypeName(e.relationship) ?? asTypeName(e.node_type)
      // A FIELD-VALUED label means this entry exists to RULE ON that type, so its own POLARITY
      // decides — positive marker => emitted, negative marker => excluded, neither => the entry
      // is about the type without ruling it, and it is not counted either way. Requiring the
      // generic NOT_APPLICABLE prose as well is what lost zig's three exclusions (whose verdict
      // is the word "NO") and lua's BD-implements.
      // THE VERDICT MUST BE STATED UP FRONT. Measured: with the whole text searched, an entry
      // that merely DESCRIBES how a type is emitted matched a negative word somewhere in its
      // prose (julia's overrides/implements, dart's contains, yaml's calls all read as excluded
      // from text that says the opposite). A lane's specs in this fleet state the verdict in the
      // first sentence — "RULED — YAML has no construct…", "NO, and the measurement…",
      // "EMITTED, and ZIG.D.1's claim…" — so the polarity test reads only the head of the text.
      const head = blob.slice(0, 160)
      if (label !== null) coverageDeclared = true
      // BOTH STATES CAN BE TRUE AT ONCE, and conflating them was a real bug the planted
      // zero-sites case caught: the construct EXISTS and is implemented, and it occurs 0 times in
      // our corpus. That is an exclusion RECORD (`zero-sites`, which stays in the denominator) and
      // an implemented label at the same time. The first version treated the positive marker as
      // cancelling the exclusion, so the record vanished and the row read as if the spec had said
      // nothing. Polarity now decides the RECORD; the positive marker independently feeds the
      // declared-emitted set.
      if (label !== null && (has(head, NEGATIVE_MARK) || has(blob, NOT_APPLICABLE))) {
        excluded.push({ label, evidence: evidenceClass(e, texts), from: `${kind}:${id}`, quote: head.slice(0, 120) })
      }
      // …and the labels a sentence rules out, which some lanes declare nowhere else.
      if (has(blob, NOT_APPLICABLE) && !emitted) {
        for (const lab of proseRuledLabels(blob)) {
          excluded.push({ label: lab, evidence: evidenceClass(e, texts), from: `${kind}:${id}(prose)`, quote: blob.slice(0, 120) })
        }
      }
      for (const x of countsExclusions(e, id)) excluded.push(x)
      // A FIELD-VALUED label with a POSITIVE emitted marker is the lane stating "this type is
      // emitted": yaml D12 (`overrides` EMITTED), zig ZIG.O.4 (`instantiates`), powershell PSD8,
      // sql D11. It is structured evidence — the label is a field, the verdict is a marker — so
      // it feeds the DECLARED EMITTED set, not the exclusions.
      if (label !== null && emitted) fieldEmitted.add(label)
    }
    // A label ruled under TWO entries (yaml D10 and an older D2) is one exclusion.
    const seen = new Map<string, Exclusion>()
    for (const x of excluded) if (!seen.has(x.label)) seen.set(x.label, x)
    excluded.length = 0
    excluded.push(...seen.values())
  }
  const grammarAbsence = excluded.filter((x) => x.evidence === "grammar-absence").map((x) => x.label)
  const zeroSites = excluded.filter((x) => x.evidence === "zero-sites").map((x) => x.label)
  const unclassified = excluded.filter((x) => x.evidence === "unclassified").map((x) => x.label)
  const applicable = doc === null ? null : TOTAL_TYPES - grammarAbsence.length - unclassified.length
  if (declared === null && fieldEmitted.size > 0) declared = TYPES.filter((t) => fieldEmitted.has(t))
  else if (declared !== null) declared = TYPES.filter((t) => declared!.includes(t) || fieldEmitted.has(t))
  const fired = firedTypes
  let implemented: string[] | null = null
  let implementedFrom = "not declared"
  if (doc !== null) {
    const union = new Set<string>([...(declared ?? []), ...(fired ?? [])])
    if (union.size > 0) {
      implemented = TYPES.filter((t) => union.has(t) && !grammarAbsence.includes(t) && !unclassified.includes(t))
      implementedFrom = declared !== null && fired !== null ? "spec-declared ∪ firing-log"
        : declared !== null ? "spec-declared" : "firing-log"
    }
  }
  const unexercised = implemented !== null && applicable !== null
    ? TYPES.filter((t) => !implemented.includes(t) && !grammarAbsence.includes(t) && !unclassified.includes(t))
    : null
  if (declared !== null && declared.length > 0) coverageDeclared = true
  const gAbs2 = excluded.filter((x) => x.evidence === "grammar-absence").map((x) => x.label)
  const uncl2 = excluded.filter((x) => x.evidence === "unclassified").map((x) => x.label)
  const gaps = applicable === null || implemented === null ? null
    : TYPES.filter((t) => !implemented.includes(t) && !gAbs2.includes(t) && !uncl2.includes(t) && !(unexercised ?? []).includes(t))
  return { coverageDeclared, declaredBy: "spec prose + firing log", gaps, implemented, implementedFrom, declaredEmitted: declared, fired, excluded, unexercised, applicable, spec: rel, specState }
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

  // THE CONTRACT COLUMN — derived from the lane's own spec (see `deriveCoverage`).
  const firedTypes: string[] | null = f === null ? null
    : Object.keys(f.types).filter((k) => (f.types[k] ?? 0) > 0).length > 0
      ? Object.keys(f.types).filter((k) => (f.types[k] ?? 0) > 0)
      : silent === null ? null : TYPES.filter((t) => !silent.includes(t))
  const cov = deriveCoverage(lane, firedTypes, silent)
  if (cov.specState === "no spec") addNote(`no spec ${cov.spec} — implemented/applicable is NOT DERIVED (not 0/0)`, lane)
  if (cov.implemented === null && cov.specState !== "no spec") addNote("the spec declares no emitted set and the firing log has no row: `implemented` is `?`, which is not zero", lane)
  for (const x of cov.excluded) if (x.evidence === "unclassified")
    addNote(`${cov.spec}: ${x.from} rules \`${x.label}\` out and its evidence class could not be read — counted as UNCLASSIFIED, which leaves the denominator; classify it rather than letting it pass as grammar-absence`, lane)

  // Analyzer change: the repo's convention is src/ast/real-<lane>-analyzer.ts, and two lanes do not
  // follow it. The board used to build the convention path, find nothing, and then SPECIAL-CASE
  // `make` with a hand-written note saying where its analyzer really is — which reported the absence
  // rather than dating the file, so `make` sat at `STALE unknown` with no mtime and no commit date
  // while the file that decides its freshness was sitting right there. A map is the general form of
  // that exception: every deviation is named here, and the row gets a real date.
  const ANALYZER_FILE_DEVIATION: Record<string, string> = {
    make: "src/ast/real-makefile-analyzer.ts",
    // `docs/analyzers/real-<lane>-analyzer.md` is not the question here; this maps the ANALYZER.
  }
  const analyzerPath = ANALYZER_FILE_DEVIATION[lane] ?? `src/ast/real-${lane}-analyzer.ts`
  const g = gitLastChange(analyzerPath)
  let mtimeMs: number | null = null
  try { mtimeMs = statSync(resolve(ROOT, analyzerPath)).mtimeMs } catch { mtimeMs = null }
  if (g.failed) addNote("`git log` failed: commit dates unavailable (mtime still used where a file exists)", lane)
  if (mtimeMs === null && g.ms === null)
    addNote(`${analyzerPath} does not exist and has no commit — lane last change UNKNOWN`, lane)

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
      cov.applicable === null ? "no spec" : `${cov.implemented === null ? "?" : cov.implemented.length}/${cov.applicable}`,
      cov.declaredBy,
      !cov.coverageDeclared ? "not declared"
        : cov.excluded.map((x) => `${x.label}(${x.evidence === "grammar-absence" ? "G" : x.evidence === "zero-sites" ? "0" : "?"})`).join(" ") || "none",
      cov.unexercised === null ? "—" : cov.unexercised.length === 0 ? "none" : cov.unexercised.join(" "),
      cov.gaps === null ? "—" : cov.gaps.length === 0 ? "none" : cov.gaps.join(" "),
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
      coverage: {
        contract: "implemented / applicable",
        implemented: cov.implemented, implementedFrom: cov.implementedFrom,
        applicable: cov.applicable, coverageDeclared: cov.coverageDeclared, declaredEmitted: cov.declaredEmitted, fired: cov.fired,
        corpusUnexercised: cov.unexercised, gaps: cov.gaps, declaredBy: cov.declaredBy,
        excluded: cov.excluded.map((x) => ({ label: x.label, evidence: x.evidence, from: x.from })),
        arithmetic: cov.applicable === null ? "no spec: not derived"
          : `applicable = 10 - ${cov.excluded.filter((x) => x.evidence === "grammar-absence").length} grammar-absence - ${cov.excluded.filter((x) => x.evidence === "unclassified").length} unclassified = ${cov.applicable}; corpus-unexercised = applicable - implemented`,
        spec: cov.spec, specState: cov.specState,
      },
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
if (COVERAGE_MODE) {
  for (const r of rows) {
    const c = r.json.coverage
    console.log(`${r.lane.padEnd(12)} ${String(c.implemented === null ? "?" : c.implemented.length)}/${c.applicable === null ? "?" : c.applicable}  from=${c.implementedFrom}`)
    console.log(`             coverageDeclared=${c.coverageDeclared} declared=${c.declaredEmitted === null ? "not declared" : JSON.stringify(c.declaredEmitted)}`)
    console.log(`             fired=${c.fired === null ? "?" : JSON.stringify(c.fired)}`)
    for (const x of c.excluded) console.log(`             EXCLUDED ${x.label.padEnd(12)} ${x.evidence.padEnd(16)} ${x.from}`)
    console.log(`             unexercised=${c.corpusUnexercised === null ? "?" : JSON.stringify(c.corpusUnexercised)}`)
    console.log(`             ${c.arithmetic}`)
  }
  // THE NOTES BELONG HERE TOO. This mode ends the process, so it used to exit before the notes
  // were rendered at all — meaning the ONE mode lanes are told to verify a declaration with
  // could not show a block that does not close. Measured by clean-lane: a spec declaring
  // `extends` in BOTH `excluded` and `corpusUnexercised` produced
  //   coverage block does not close: implemented 9 + unexercised 1 + gaps 0 ≠ applicable 9
  // in `--json`, and an ordinary-looking row in `--coverage`. A verification mode that hides the
  // failure it exists to reveal is worse than no mode: it certifies.
  if (notes.length > 0) {
    console.log()
    console.log(`NOTES (${notes.length}) — a declaration that does not close is a defect in the DECLARATION:`)
    for (const n of notes) console.log(`  ${n}`)
  }
  process.exit(notes.length > 0 ? 1 : 0)
}
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
  const headers = ["LANE", "FIRED", "SILENT", "INCOMING", "EXT CLM", "GAPS", "IMPL/APPL", "EXCLUDED (class)", "CORPUS-UNEXERCISED", "UNIMPLEMENTED (gaps)", "FROM", "LAST COMMIT", "STALE"]
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r.cells[i].length)))
  const line = (cells: string[]) => cells.map((c, i) => c + " ".repeat(Math.max(0, widths[i] - c.length))).join("  ")
  console.log(`language board — ${rows.length} laptop-B lanes — READ-ONLY — ${stamp(Date.now())}`)
  console.log(`lane set  ${LANES_SRC} (parsed live, not importable — see header) mtime ${stamp(statSync(resolve(ROOT, LANES_SRC)).mtimeMs)}`)
  console.log(`firing    ${FIRING_LOG} mtime ${stamp(firingSrc.mtimeMs)} — ${firing.byLabel.size}/${rows.length} lanes read`)
  console.log(`incoming  ${INCOMING_LOG} mtime ${stamp(incomingSrc.mtimeMs)} — ${incoming.byLabel.size}/${rows.length} lanes read`)
  console.log(`\n${line(headers)}\n${widths.map((w) => "-".repeat(w)).join("  ")}`)
  for (const r of rows) console.log(line(r.cells))
  const covRows = rows.filter((r) => r.json.coverage.applicable !== null)
  const covSum = {
    derived: covRows.length,
    implemented: covRows.reduce((n, r) => n + (r.json.coverage.implemented?.length ?? 0), 0),
    applicable: covRows.reduce((n, r) => n + (r.json.coverage.applicable ?? 0), 0),
    grammarAbsence: covRows.reduce((n, r) => n + r.json.coverage.excluded.filter((x: any) => x.evidence === "grammar-absence").length, 0),
    zeroSites: covRows.reduce((n, r) => n + r.json.coverage.excluded.filter((x: any) => x.evidence === "zero-sites").length, 0),
    unclassified: covRows.reduce((n, r) => n + r.json.coverage.excluded.filter((x: any) => x.evidence === "unclassified").length, 0),
    unexercised: covRows.reduce((n, r) => n + (r.json.coverage.corpusUnexercised?.length ?? 0), 0),
  }
  console.log(`\nSUMMARY   ${summary.lanes} lanes · incoming PASS ${summary.incomingPass} · fire 10/10 ${summary.firedAll10} · declared gaps ${summary.declaredGaps} (gap.gaps elements only, ${summary.gapArrays} lanes) · STALE ${summary.stale} · unknown ${summary.unknown} · current ${summary.current}`)
  console.log(`CONTRACT  ${covSum.derived}/${summary.lanes} lanes have a spec to derive from · implemented ${covSum.implemented}/${covSum.applicable} across them · excluded: ${covSum.grammarAbsence} grammar-absence + ${covSum.zeroSites} zero-sites (kept IN the denominator) + ${covSum.unclassified} unclassified · corpus-unexercised ${covSum.unexercised}`)
  console.log(`LEGEND    FIRED n/10 = relationship types that fired (the log's own denominator; fired + SILENT must be 10)`)
  console.log(`          SILENT = types the lane can construct but produced nothing; NOT LISTED = no SILENT line despite <10 fired`)
  console.log(`          INCOMING = verdict + amb/unres/edges; ? = the log does not print that number (NOT zero); not in log = lane absent
                    a PASS row's 0/0 is the verdict's own "every edge resolves" claim (JSON: countersFrom)`)
  console.log(`          EXT CLM = external claims the verdict singles out: u unverifiable, R REFUTED, ? other wording, — none named`)
  console.log(`          GAPS = number of gap.gaps array elements; no spec / no field / gaps≠array / gap[]=N* are NOT zeros (see notes)`)
  console.log(`          IMPL/APPL = implemented / applicable, DERIVED FROM THE LANE'S OWN SPEC (read-only; no analyzer runs)`)
  console.log(`                      applicable = 10 - grammar-absence - unclassified; corpus-unexercised = applicable - implemented`)
  console.log(`                      implemented = the spec's declared emitted set (union) the firing log's fired set, restricted to applicable;`)
  console.log(`                      JSON carries implementedFrom (which source spoke) and the arithmetic as a string. '?' = not declared, NOT zero`)
  console.log(`          EXCLUDED = 'not declared' when the spec declares no coverage at all (which is NOT 'none'); otherwise the ruled labels`)
  console.log(`                      with their EVIDENCE CLASS beside each: G grammar-absence (a whole-grammar`)
  console.log(`                      node/keyword inventory: the language cannot express it, so it leaves the denominator), 0 zero-sites (the`)
  console.log(`                      construct exists but occurs 0 times in OUR corpus: it STAYS in the denominator as corpus-unexercised),`)
  console.log(`                      ? unclassified (ruled out, evidence class unreadable: its own bucket, never promoted to G)`)
  console.log(`          CORPUS-UNEXERCISED = declared implemented with no construct in our corpus to fire on (its own block key names the proof)`)
  console.log(`          UNIMPLEMENTED (gaps) = applicable, not implemented, not excluded — the remainder the declaration leaves open`)
  console.log(`          FROM = which declaration the row was derived from: 'spec coverage block' (structured, preferred) or the prose fallback`)
  console.log(`          STALE = worst of firing+incoming vs the analyzer's content mtime (fallback: last commit if the file is gone)`)
  console.log(`                  a commit that postdates a log without an mtime change is NOT stale and is listed in a note; ~ = no commit date`)
  for (const n of notes) console.log(`NOTE      ${n}`)
}
