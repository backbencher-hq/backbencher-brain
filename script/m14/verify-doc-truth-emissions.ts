/**
 * Doc-Truth Emissions Gate — the "Emitted?" column must agree with the analyzer.
 *
 * THE BUG CLASS
 * Every per-analyzer doc carries a relationship-ontology table whose second
 * column answers "is this emitted?". Those cells are written BY HAND, and a
 * hand-written cell is only ever checked against ONE channel — the
 * `ASTEngine.RelationshipType.*` references in the analyzer source. An analyzer
 * can publish its imports through a completely separate channel (the
 * import-site channel: `ASTEngine.ImportInfo[]` returned as an `imports`
 * field) while referencing NO relationship kind for imports at all. A doc that
 * greps for `RelationshipType` then concludes "not emitted", and that sentence
 * is wrong.
 *
 * TWO instances were commissioned, in real-cpp-analyzer.md and
 * real-java-analyzer.md. Building the gate found SIX MORE of the same class,
 * each verified by hand against the analyzer source before this file was
 * written: the `exports` row in real-cpp-analyzer.md and real-go-analyzer.md
 * (both deny a populated `ExportInfo[]` payload), `uses` in
 * real-csharp-analyzer.md, real-scala-analyzer.md and real-yaml-analyzer.md
 * (each denies an edge its own measured tables count), and `exports` in
 * real-yaml-analyzer.md. Eight FALSE_NEGATIVEs, all of them one cell wide.
 *
 * Per docs/M14-HONESTY-CONTRACT.md, a newly found bug class becomes a
 * PERMANENT GATE before its fix counts as landed. This is that gate. It does
 * not fix the docs (doc lanes own their own text); it makes the class
 * impossible to reintroduce and measures the population.
 *
 * WHAT "THE ANALYZER'S EMITTED SURFACE" MEANS HERE
 * Three channels, all derived from the analyzer source with comments and string
 * literals removed (see stripComments), so the gate accuses CODE and never
 * prose — a comment that mentions `RelationshipType.Imports` must not be able
 * to manufacture an emission:
 *   1. RELATIONSHIP CHANNEL — every `ASTEngine.RelationshipType.X` reference,
 *      resolved through the enum's ALIASES to the serialized kind it means
 *      (`Inheritance` and `Extends` are both `extends`; `Imports` is
 *      `brain_import`; nine names collapse onto six serialized values, and a
 *      doc row named `extends` is therefore comparable to `Inheritance`).
 *   2. IMPORT-SITE CHANNEL — live when the analyzer constructs `ImportInfo`
 *      values or pushes onto an `imports` array. This is the channel the old
 *      docs never looked at. Measured on this tree: 47 of 48 analyzers.
 *   3. EXPORT-SITE CHANNEL — the same shape for exports: `ExportInfo[]` or an
 *      `exports.push`. This one was NOT in the original commission, and the
 *      gate found it by being wrong first: an early version graded an
 *      `exports | ✅` row against `RelationshipType.Exports` alone and
 *      returned 13 FALSE_POSITIVE verdicts against analyzers that return a
 *      populated `ExportInfo[]` and emit no such edge. Those 13 were the same
 *      single-channel error the gate exists to catch, committed by the gate.
 *      Measured on this tree: 40 of 48 analyzers, and real-toml-analyzer.ts is
 *      the only one publishing neither payload.
 *
 * A verdict is therefore taken over ALL THREE. A doc row is a claim about a
 * FACT, not about the one channel that happens to carry it, and a gate that
 * picks one channel is the bug class rather than the cure for it.
 *
 * THE CLAIM VOCABULARY IS EXACT, NOT APPROXIMATED
 * A doc row whose first cell does not resolve to a `RelationshipType` alias is
 * NOT compared. `depends` and `field_access` are not members of
 * `RelationshipType` in src/ast/types.ts — real-java-analyzer.md says so and is
 * right — so a row claiming they are "not emitted" makes no emission claim and
 * this gate reports it as `NON_ENGINE_KIND` instead of inventing a verdict.
 * A row that MIXES engine kinds with non-kinds (`| extends / overrides | — |`
 * in real-css-analyzer.md, and the eight-name `❌ n/a` row in
 * real-go-analyzer.md) is likewise reported as `MIXED_ROW` and excluded: its
 * single claim cell cannot honestly be attributed to each of its names, and
 * guessing which name it meant is exactly the kind of inference that produced
 * this bug class. A row naming SEVERAL engine kinds and nothing else IS
 * compared per name, and a finding against it is labelled `COMPOUND_ROW` so a
 * reader knows the claim came from a shared cell.
 *
 * DISAGREEMENT KINDS, which are not equally serious
 *   FALSE_NEGATIVE  doc says "not emitted", the analyzer emits it. A lie that
 *                   makes a consumer search a channel that is already
 *                   populated. FAILS the gate.
 *   FALSE_POSITIVE  doc says "emitted", nothing emits it. A lie that makes a
 *                   consumer trust a channel that is empty. FAILS the gate.
 *   UNDOCUMENTED    a live channel the table makes no checkable claim about.
 *                   Reported, measured, and NOT fatal — see below.
 *   MISSING_DOC     an analyzer with no canonical doc. Reported, not fatal.
 *
 * WHY UNDOCUMENTED AND MISSING_DOC DO NOT FAIL THE GATE
 * Both populations are large today and both are owned by doc lanes this gate
 * must not pre-empt: 43 analyzers publish a live channel their table makes no
 * checkable claim about, and two analyzers (real-julia-analyzer.ts,
 * real-makefile-analyzer.ts) have no canonical doc at all. A gate that failed
 * on those would be blocked on ~45 doc edits nobody asked this change to make,
 * and would train its readers to ignore it — the standard M14 warns about. So
 * the gate fails ONLY on a demonstrable falsehood, each of which is ONE CELL in
 * ONE table, and PAYS for the rest by measuring it into
 * docs/DOC-TRUTH-EMISSIONS.md, which is regenerated on every run and is
 * therefore always the current census. That is the trade: lies are blocked at
 * the source, silence is counted where a reader will look for it.
 *
 * DOC LANES OWN THEIR TEXT. This gate reports; it does not edit. The eight
 * FALSE_NEGATIVEs it currently reports were all verified by hand against the
 * analyzer source and the doc's own measured tables before this file was
 * written, and repairing all eight plus one deliberately injected lie was
 * confirmed to take a full run to exit 0 — so the gate is satisfiable, not
 * merely unsatisfiable.
 *
 * DECLARED LIMITS (measured, not guessed)
 *   - Emission is derived from `RelationshipType.X` REFERENCES in code, never
 *     in comments. Measured on this tree: zero aliases are comment-only, so
 *     the accusation set and a raw grep agree today; the distinction is kept
 *     because a comment naming `RelationshipType.Imports` is precisely how
 *     this bug class starts, and the selftest pins it.
 *   - A serialized kind emitted by assigning a STRING literal would be invisible
 *     to this gate. Measured on this tree: exactly one `type: "<serialized
 *     kind>"` string exists in src/ast, and it is a type ANNOTATION at
 *     src/ast/real-sql-analyzer.ts:2087, not an emission — so the gap is empty
 *     today, and it is named here so the next reader need not rediscover it.
 *   - Only the FIRST ontology-shaped table in a doc is compared (the heading
 *     row whose first cell starts with "Relationship" and whose second cell
 *     reads Emitted?/Supported?). A doc with two such tables has its second
 *     one ignored; the count is reported so that is visible rather than
 *     silent. Measured: `c` and `erlang` each hold two.
 *   - A claim cell that carries no marker at all (a prose "Emitted for" column,
 *     as in real-scss-analyzer.md) yields NO_MARKER: no verdict, no finding.
 *
 * USAGE
 *   bun run script/m14/verify-doc-truth-emissions.ts             # writes the register, exits 1 on a lie
 *   bun run script/m14/verify-doc-truth-emissions.ts --no-write  # print only
 *   bun run script/m14/verify-doc-truth-emissions.ts --root DIR  # inspect another tree (used by --selftest)
 *   bun run script/m14/verify-doc-truth-emissions.ts --selftest  # prove the gate can still fail
 */

import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const REPO_ROOT = path.resolve(__dirname, "..", "..")
const REGISTER_REL = path.join("docs", "DOC-TRUTH-EMISSIONS.md")
const REGISTER_CMD = "bun run script/m14/verify-doc-truth-emissions.ts"

/**
 * The alias table from `src/ast/types.ts`, as of the schema this gate reads.
 * Nine names share six serialized values (`Inheritance`/`Extends` are both
 * `extends`, `Imports` alone is `brain_import`, and `DependsOn` is
 * `references`), so an analyzer and a doc can name the SAME edge differently.
 * This table is what makes "comparable" mean comparable. It is intentionally
 * NOT fuzzy: `depends` is absent because `DependsOn` is a different name, and
 * inventing a mapping there would let a doc's own non-kind rows be graded as
 * emission claims.
 */
const RELATIONSHIP_ALIASES: Record<string, string> = {
  calls: "calls",
  call: "calls",
  extends: "extends",
  extend: "extends",
  inheritance: "extends",
  inherits: "extends",
  implements: "implements",
  implement: "implements",
  implementation: "implements",
  uses: "uses",
  use: "uses",
  dependency: "uses",
  imports: "imports",
  import: "imports",
  brain_import: "imports",
  exports: "exports",
  export: "exports",
  provides: "exports",
  contains: "contains",
  contain: "contains",
  composition: "contains",
  partof: "contains",
  references: "references",
  reference: "references",
  dependson: "references",
  related: "references",
  overrides: "overrides",
  override: "overrides",
  instantiates: "instantiates",
  instantiate: "instantiates",
}

/**
 * The payload channels: a second, non-graph way an analyzer can publish the
 * SAME fact a doc row names. A doc row reading `exports | ✅` can be true
 * because the analyzer emits an `exports` RELATIONSHIP, or true because it
 * returns an `ExportInfo[]` payload and emits no such edge. Grading such a row
 * against the relationship channel alone declares a correct doc a lie — which
 * is the precise mistake this gate was written to stop, so the gate must not
 * make it. Measured on this tree: `imports` is live in 47 of 48 analyzers and
 * `exports` in 40 of 48; only real-toml-analyzer.ts publishes neither.
 *
 * The second regex of each pair covers an analyzer that keeps an untyped
 * `exports` array and pushes onto it, with no `ExportInfo` token to find.
 */
const PAYLOAD_CHANNELS: { kind: string; label: string; type: RegExp; push: RegExp }[] = [
  { kind: "imports", label: "import-site: ImportInfo[]", type: /ImportInfo/, push: /imports\s*\.\s*push\s*\(/ },
  { kind: "exports", label: "export-site: ExportInfo[]", type: /ExportInfo/, push: /exports\s*\.\s*push\s*\(/ },
]

function payloadLabel(kind: string): string {
  return PAYLOAD_CHANNELS.find((c) => c.kind === kind)?.label ?? kind
}

/** Every serialized relationship kind, in the order the register lists them. */
const ALL_KINDS = [
  "calls",
  "contains",
  "exports",
  "extends",
  "implements",
  "instantiates",
  "overrides",
  "references",
  "uses",
  "imports",
]

type Claim = "YES" | "NO" | "NA" | "NO_MARKER"
type VerdictKind =
  | "FALSE_NEGATIVE"
  | "FALSE_POSITIVE"
  | "UNDOCUMENTED"
  | "MISSING_DOC"
  | "NON_ENGINE_KIND"
  | "MIXED_ROW"
  | "COMPOUND_ROW"
  | "NO_CLAIM_TABLE"

/** A disagreement kind that makes the gate exit 1. UNDOCUMENTED and the rest do not. */
const FAILING: ReadonlySet<VerdictKind> = new Set<VerdictKind>(["FALSE_NEGATIVE", "FALSE_POSITIVE"])

interface Verdict {
  lang: string
  kind: VerdictKind
  subject: string
  detail: string
  /** The doc line the claim came from, when there was one. 0 when there was not. */
  docLine: number
  /** The verbatim claim cell, truncated, so the register can be read without opening the doc. */
  cell: string
}

interface TableRow {
  names: string[]
  claim: Claim
  line: number
  cell: string
}

interface ClaimTable {
  headerCell1: string
  rows: TableRow[]
  line: number
  /** How many ontology-shaped tables the doc holds. >1 means the extras are ignored. */
  tableCount: number
}

export interface Surface {
  /** Serialized relationship kinds, from `RelationshipType.X` references in code. */
  kinds: Set<string>
  /** Payload kinds this analyzer publishes outside the graph: `imports`, `exports`. */
  payload: Set<string>
  /** Aliases seen ONLY in comments. A non-zero count means the accusation set differs from a raw grep. */
  commentOnly: string[]
}

export interface Report {
  langs: string[]
  verdicts: Verdict[]
  /** lang -> what the analyzer emits, for the census table. */
  surfaces: Map<string, Surface>
  /** lang -> the parsed claim table, or null. */
  tables: Map<string, ClaimTable | null>
  missingDocs: string[]
  /** Analyzer files whose docs hold no ontology-shaped claim table at all. */
  noTable: string[]
  /** Docs with more than one ontology-shaped table, where only the first is compared. */
  multiTable: string[]
}

/**
 * Remove `//` line comments, `/* *\/` block comments and string/template
 * literals, preserving newlines so line numbers stay meaningful. A small
 * hand-rolled scanner is used rather than a regex because the two cases
 * interact: a `//` inside a string is not a comment, and a `${ ... }` inside a
 * template can hold either.
 */
export function stripComments(src: string): string {
  let out = ""
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === '"' || c === "'" || c === "`") {
      const quote = c
      out += c
      i++
      while (i < n) {
        const d = src[i]
        if (d === "\\") {
          out += src.slice(i, i + 2)
          i += 2
          continue
        }
        out += d
        i++
        if (d === quote) break
        if (quote === "`" && d === "$" && src[i] === "{") {
          let depth = 1
          i++
          while (i < n && depth > 0) {
            const e = src[i]
            if (e === "{") depth++
            else if (e === "}") depth--
            out += e
            i++
          }
        }
      }
      continue
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++
      continue
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n"
        i++
      }
      i += 2
      continue
    }
    out += c
    i++
  }
  return out
}

/** Read one analyzer file and reduce it to the surface it emits. */
export function readSurface(file: string): Surface {
  const raw = fs.readFileSync(file, "utf8")
  const code = stripComments(raw)
  const kinds = new Set<string>()
  const commentOnly: string[] = []
  // The analyzer names a kind with the enum MEMBER (`RelationshipType.Exports`,
  // PascalCase) and a doc names it with the SERIALIZED value (`exports`,
  // lowercase). Both land in this one table, so the member name is folded before
  // lookup — an unfound lookup is how a first run of this gate reported 162
  // FALSE_POSITIVE verdicts against analyzers that plainly emit `contains`.
  const resolve = (member: string): string | undefined => RELATIONSHIP_ALIASES[member.toLowerCase()]
  // CODE ONLY. A first draft unioned the raw scan in as well, and the
  // selftest caught it: a doc honestly denying `overrides` was graded a
  // FALSE_NEGATIVE because one analyzer's COMMENT mentioned
  // `RelationshipType.Override`. Prose cannot emit an edge, so the raw text is
  // read only to count the aliases that appear in prose and nowhere else.
  for (const m of code.matchAll(/RelationshipType\.([A-Za-z]+)/g)) {
    const kind = resolve(m[1])
    if (kind) kinds.add(kind)
  }
  const codeKinds = new Set(kinds)
  for (const m of raw.matchAll(/RelationshipType\.([A-Za-z]+)/g)) {
    const kind = resolve(m[1])
    if (kind && !codeKinds.has(kind)) commentOnly.push(m[1])
  }
  // The payload channels. `ImportInfo` / `ExportInfo` in CODE covers a typed
  // declaration, a cast or an annotation; the `push(` arm covers a plain
  // untyped array. real-toml-analyzer.ts returns `imports: []` and pushes
  // nothing, so it is correctly measured as publishing NEITHER payload.
  const payload = new Set<string>()
  for (const ch of PAYLOAD_CHANNELS) if (ch.type.test(code) || ch.push.test(code)) payload.add(ch.kind)
  return { kinds, payload, commentOnly }
}

/**
 * Split a table row into cells.
 *
 * The row's own leading and trailing pipes are delimiters, not empty cells:
 * `| a | b |` has TWO cells. Keeping the artefacts would shift every index by
 * one and silently turn "Relationship type" into a cell this gate never looks
 * at — which is exactly how the first run of this gate found 46 claim tables
 * that were all there. The unescaped-trailing-pipe test matters too: a cell
 * may legitimately be empty, and only the row's own final delimiter is dropped.
 */
function cells(line: string): string[] {
  let s = line.trim()
  if (s.startsWith("|")) s = s.slice(1)
  if (/(?:[^\\]|\\\\)*\|$/.test(s)) s = s.slice(0, -1)
  const out: string[] = []
  let cur = ""
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|"
      i++
      continue
    }
    if (ch === "|") {
      out.push(cur)
      cur = ""
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

/** A header row is a table's first line; the second line of the block is its `---` rule. */
function isRuleRow(cellsOfLine: string[]): boolean {
  return cellsOfLine.length > 0 && cellsOfLine.every((c) => /^:?-{2,}:?$/.test(c))
}

/**
 * A claim table's header names WHAT the rows are and WHAT the second column
 * answers.
 *
 * The first-cell test accepts a bare `type` because real-c-analyzer.md heads
 * its two emission tables `| type | emitted | count | metadata.relationshipType |`
 * — a complete and correct claim table that a stricter test would have skipped,
 * losing the one doc in the tree with per-kind measured import AND export
 * counts. It is deliberately narrower than "any table with a Supported? column":
 * real-c-analyzer.md's symbol table is headed `| Field | Supported? | … |`, and
 * grading `field_access` rows as emission claims would be a new invention.
 */
function looksLikeClaimHeader(cs: string[]): boolean {
  if (cs.length < 2) return false
  const first = cs[0].toLowerCase()
  const second = cs[1].toLowerCase()
  if (!/^(?:relationship\b|relationship type|relationship kind|relationship kinds|type|types|edge|edge type|kind|kinds)/.test(first))
    return false
  return /emitted|supported/.test(second)
}

/**
 * Read the FIRST ontology-shaped claim table out of a doc.
 *
 * Returns null when the doc holds none — a real and common case, and reported
 * as NO_CLAIM_TABLE rather than silently skipped, because "I found no table to
 * check" and "I checked the table and it was clean" must not look alike.
 */
export function parseClaimTable(text: string): ClaimTable | null {
  const lines = text.split(/\r?\n/)
  // A markdown table is a row, a `---` rule, then body rows. The header is
  // the row immediately ABOVE a rule row; `isRuleRow` on the row itself must be
  // false or a second rule inside a table would be mistaken for a header.
  const headers: { at: number; cs: string[] }[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i])) continue
    const cs = cells(lines[i])
    if (cs.length < 2 || isRuleRow(cs)) continue
    if (i + 1 >= lines.length || !/^\s*\|/.test(lines[i + 1])) continue
    const rule = cells(lines[i + 1])
    if (!isRuleRow(rule) || rule.length !== cs.length) continue
    if (looksLikeClaimHeader(cs)) headers.push({ at: i, cs })
  }
  if (headers.length === 0) return null
  const chosen = headers[0]
  const rows: TableRow[] = []
  let started = false
  for (let i = chosen.at; i < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i])) {
      if (started) break
      continue
    }
    const cs = cells(lines[i])
    if (i === chosen.at) continue
    if (isRuleRow(cs)) continue
    if (!started) {
      started = true
      continue
    }
    if (cs.length < 2) continue
    const cell = cs[1]
    rows.push({
      names: cs[0]
        .split(/\s*(?:\/|\||,)\s*/)
        .map((n) => n.replace(/[`*_]/g, "").trim().toLowerCase())
        .filter((n) => n.length > 0),
      claim: classifyClaim(cell),
      line: i + 1,
      cell: cell.replace(/\s+/g, " ").trim().slice(0, 72),
    })
  }
  return {
    headerCell1: chosen.cs[0][1],
    rows,
    line: chosen.at + 1,
    tableCount: headers.length,
  }
}

/**
 * Reduce a claim cell to a verdict.
 *
 * The order matters and is the whole design. A leading glyph decides on its
 * own; only a cell that opens with prose falls through to the keyword scan,
 * which is why a prose "Emitted for" column (real-scss-analyzer.md) lands on
 * NO_MARKER instead of being graded from whatever words it happens to contain.
 * Negation is read before affirmation so "not emitted" cannot be scored YES by
 * its own "emitted".
 */
export function classifyClaim(cell: string): Claim {
  const c = cell.replace(/\s+/g, " ").trim()
  if (c.length === 0) return "NO_MARKER"
  if (/^(?:[*_\s]*)(?:—|–|-|\+)(?:[*_\s]*)$/.test(c)) return "NA"
  if (/^(?:[*_\s]*)(?:n\/?a|not applicable)(?:[*_\s]*)(?:[).,;:]|$)/i.test(c)) return "NA"
  if (/^[*_\s]*(?:✅|✔|✓)/.test(c)) return "YES"
  if (/^[*_\s]*(?:❌|✘|✗|✕)/.test(c)) return "NO"
  if (/^(?:yes|true|y)\b/i.test(c)) return "YES"
  if (/^(?:no|false|n)\b/i.test(c)) return "NO"
  if (/^(?:not|none|never|never\s+as)\b/i.test(c)) return "NO"
  // Prose cells: fall through to the keyword scan, most specific first.
  if (/\bnever\s+emitted\b|\bnot\s+emitted\b|\bnot\s+as\b/i.test(c)) return "NO"
  if (/\bis\s+not\s+a\s+kind\b|\bno\s+such\b/i.test(c)) return "NO"
  if (/\bemitted\b|\byes\b/i.test(c)) return "YES"
  if (/\bnot\b|\bnever\b|\bno\b/i.test(c)) return "NO"
  return "NO_MARKER"
}

/**
 * Does this cell itself state that the import-SITE channel is live?
 *
 * This is the rule the two live lies turn on. real-cpp-analyzer.md's imports
 * cell reads "❌ never as a relationship" and its PROSE below the table explains
 * that imports ride along as `ImportInfo[]`. That prose is true and it is also
 * exactly the sentence that produced the wrong conclusion, because the cell is
 * what a reader — or the next agent — extracts. So the cell, not the document,
 * has to carry the payload channel's affirmative statement.
 */
function cellStatesPayload(cell: string): boolean {
  return /(ImportInfo|payload|imports?\s+array|import-site)/i.test(cell)
}

/** The population one analyzer/doc pair contributes. */
function evaluateOne(lang: string, surface: Surface, table: ClaimTable | null): Verdict[] {
  const out: Verdict[] = []
  const doc = `docs/analyzers/real-${lang}-analyzer.md`
  if (!table) {
    out.push({
      lang,
      kind: "NO_CLAIM_TABLE",
      subject: lang,
      detail:
        surface.payload.size > 0 || surface.kinds.size > 0
          ? "doc holds no ontology-shaped claim table (no 'Relationship …' header with an Emitted?/Supported? column), so no emission claim is checkable"
          : "doc holds no ontology-shaped claim table and the analyzer emits nothing",
      docLine: 0,
      cell: "",
    })
    return out
  }

  /** kind -> the rows that made a claim about it, so the channel can be judged once. */
  const claimed = new Map<string, TableRow>()
  for (const row of table.rows) {
    const resolved = row.names.map((n) => RELATIONSHIP_ALIASES[n] ?? null)
    const known = resolved.filter((r): r is string => r !== null)
    if (row.names.length === 0) continue
    if (resolved.length === 1 && known.length === 0) {
      out.push({
        lang,
        kind: "NON_ENGINE_KIND",
        subject: row.names[0],
        detail: "row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim",
        docLine: row.line,
        cell: row.cell,
      })
      continue
    }
    if (resolved.length > 1 && known.length < resolved.length) {
      out.push({
        lang,
        kind: "MIXED_ROW",
        subject: row.names.join(" / "),
        detail: "row mixes engine kinds with names that are not RelationshipType aliases, so one shared cell cannot be attributed per kind; excluded from comparison",
        docLine: row.line,
        cell: row.cell,
      })
      continue
    }
    for (const kind of known) {
      if (row.claim === "NO_MARKER" || row.claim === "NA") continue
      if (resolved.length > 1) {
        out.push({
          lang,
          kind: "COMPOUND_ROW",
          subject: kind,
          detail: "kind claimed by a multi-name row; the cell is shared, so this verdict came from a compound claim",
          docLine: row.line,
          cell: row.cell,
        })
      }
      const prev = claimed.get(kind)
      if (!prev) claimed.set(kind, row)
      else if (prev.claim !== row.claim) {
        // Two rows disagreeing with each other cannot both be the claim; the
        // analyzer is the tie-breaker, so hand this one to the comparison and
        // keep the first, which is the row a reader meets first.
        out.push({
          lang,
          kind: "COMPOUND_ROW",
          subject: kind,
          detail: `kind claimed twice with opposite verdicts (line ${prev.line} and line ${row.line}); the first row is treated as the claim`,
          docLine: row.line,
          cell: row.cell,
        })
      }
    }
  }

  /**
   * Does the analyzer publish this kind ANYWHERE — as an edge or as a payload?
   *
   * This is the whole point of the gate. A doc row is about the FACT, not about
   * one channel that happens to carry it, so a verdict must be taken over every
   * channel. Grading `exports | ✅` against `RelationshipType.Exports` alone
   * calls real-objective-c-analyzer.md a liar for an analyzer that returns a
   * populated `ExportInfo[]`; the first run of this gate made that accusation 13
   * times before the export-site channel was measured, which is the same defect
   * in the gate that the gate exists to catch.
   */
  const emits = (kind: string): boolean => surface.kinds.has(kind) || surface.payload.has(kind)
  const liveChannels = (kind: string): string[] => {
    const ch: string[] = []
    if (surface.kinds.has(kind)) ch.push("relationship")
    if (surface.payload.has(kind)) ch.push(payloadLabel(kind))
    return ch
  }

  // 1. Every claim the table makes, against every channel.
  for (const [kind, row] of claimed) {
    const live = emits(kind)
    const where = liveChannels(kind).join(" + ")
    const claimLabel = kind === "imports" || kind === "exports" ? `${kind} (${where || "no channel"})` : `${kind} (relationship)`
    if (row.claim === "YES" && !live) {
      out.push({
        lang,
        kind: "FALSE_POSITIVE",
        subject: claimLabel,
        detail: `doc claims emitted, but src/ast/real-${lang}-analyzer.ts neither references a RelationshipType alias for "${kind}" nor constructs an ${payloadLabel(kind)} payload — no channel publishes it`,
        docLine: row.line,
        cell: row.cell,
      })
      continue
    }
    if (row.claim === "NO" && live) {
      // A negative cell is only honest when it says WHICH channel it denies,
      // and there is one more channel it cannot have looked at.
      if (surface.payload.has(kind) && !cellStatesPayload(row.cell)) {
        out.push({
          lang,
          kind: "FALSE_NEGATIVE",
          subject: claimLabel,
          detail: `the cell denies emission without naming the live ${payloadLabel(kind)} payload channel; src/ast/real-${lang}-analyzer.ts publishes "${kind}" on ${where} — the single-channel reasoning this gate exists to kill${doc}`,
          docLine: row.line,
          cell: row.cell,
        })
        continue
      }
      out.push({
        lang,
        kind: "FALSE_NEGATIVE",
        subject: claimLabel,
        detail: `doc claims not emitted; src/ast/real-${lang}-analyzer.ts emits "${kind}" on ${where}${doc}`,
        docLine: row.line,
        cell: row.cell,
      })
    }
  }

  // 2. Live channels with no checkable claim at all. Two independent
  //    populations, reported separately: an EDGE nobody wrote a row for, and a
  //    PAYLOAD nobody wrote a row for. The second is the class this gate was
  //    commissioned against and it is by far the larger.
  for (const kind of ALL_KINDS) {
    if (surface.kinds.has(kind) && !claimed.has(kind)) {
      out.push({
        lang,
        kind: "UNDOCUMENTED",
        subject: `${kind} (relationship)`,
        detail: `analyzer emits "${kind}" and the ontology table makes no checkable claim about it`,
        docLine: table.line,
        cell: "",
      })
    }
  }
  for (const ch of PAYLOAD_CHANNELS) {
    if (!surface.payload.has(ch.kind)) continue
    if (claimed.has(ch.kind)) continue
    out.push({
      lang,
      kind: "UNDOCUMENTED",
      subject: `${ch.kind} (${ch.label})`,
      detail: `analyzer publishes "${ch.kind}" through the ${ch.label} channel${surface.kinds.has(ch.kind) ? " as well as a relationship edge" : ""}, and the ontology table makes no checkable claim about it`,
      docLine: table.line,
      cell: "",
    })
  }

  return out
}

/** Every `src/ast/real-<lang>-analyzer.ts` in a tree, sorted for a stable report. */
export function discoverAnalyzers(srcDir: string): string[] {
  if (!fs.existsSync(srcDir)) return []
  return fs
    .readdirSync(srcDir)
    .filter((f) => /^real-.*-analyzer\.ts$/.test(f))
    .sort()
}

/** Evaluate every analyzer/doc pair in a tree. Pure with respect to the tree. */
export function evaluate(root: string): Report {
  const srcDir = path.join(root, "src", "ast")
  const docDir = path.join(root, "docs", "analyzers")
  const files = discoverAnalyzers(srcDir)
  const verdicts: Verdict[] = []
  const surfaces = new Map<string, Surface>()
  const tables = new Map<string, ClaimTable | null>()
  const missingDocs: string[] = []
  const noTable: string[] = []
  const multiTable: string[] = []
  const langs: string[] = []
  for (const file of files) {
    const lang = file.replace(/^real-/, "").replace(/-analyzer\.ts$/, "")
    langs.push(lang)
    const surface = readSurface(path.join(srcDir, file))
    surfaces.set(lang, surface)
    const docPath = path.join(docDir, `real-${lang}-analyzer.md`)
    if (!fs.existsSync(docPath)) {
      missingDocs.push(lang)
      tables.set(lang, null)
      verdicts.push({
        lang,
        kind: "MISSING_DOC",
        subject: lang,
        detail: `src/ast/${file} has no canonical docs/analyzers/real-${lang}-analyzer.md; doc-presence is owned by script/m14/verify-analyzer-docs.ts, so this gate reports it without failing on it`,
        docLine: 0,
        cell: "",
      })
      continue
    }
    const table = parseClaimTable(fs.readFileSync(docPath, "utf8"))
    tables.set(lang, table)
    if (!table) noTable.push(lang)
    else if (table.tableCount > 1) multiTable.push(lang)
    verdicts.push(...evaluateOne(lang, surface, table))
  }
  return { langs, verdicts, surfaces, tables, missingDocs, noTable, multiTable }
}

function countBy(verdicts: Verdict[], kind: VerdictKind): number {
  return verdicts.filter((v) => v.kind === kind).length
}

function mdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ")
}

function kindList(set: Set<string>): string {
  const known = ALL_KINDS.filter((k) => set.has(k))
  const extra = [...set].filter((k) => !ALL_KINDS.includes(k)).sort()
  return [...known, ...extra].join(" ") || "—"
}

/**
 * The register. Deterministic by construction — no timestamp, no run id, no
 * path outside the repo — because five agents share this worktree and a
 * register that churns on every run is a register nobody commits.
 */
export function renderRegister(report: Report): string {
  const v = report.verdicts
  const fn = v.filter((x) => x.kind === "FALSE_NEGATIVE")
  const fp = v.filter((x) => x.kind === "FALSE_POSITIVE")
  const und = v.filter((x) => x.kind === "UNDOCUMENTED")
  const lines: string[] = []
  lines.push("# Doc-truth emissions register")
  lines.push("")
  lines.push(
    "GENERATED FILE — do not hand-edit. Regenerate with `" + REGISTER_CMD + "`. The gate that writes it is `script/m14/verify-doc-truth-emissions.ts`; its header is the argument for every rule below.",
  )
  lines.push("")
  lines.push("## What is measured")
  lines.push("")
  lines.push(
    "For each `src/ast/real-<lang>-analyzer.ts` and `docs/analyzers/real-<lang>-analyzer.md`: the analyzer's emitted surface over BOTH channels — the `ASTEngine.RelationshipType.*` references in code, and the import-site channel (`ImportInfo[]` returned as `imports`) — against the \"Emitted?\" cells of the doc's relationship-ontology table. Comments and string literals are stripped first, so only code is accused.",
  )
  lines.push("")
  lines.push("| Measure | Count | Fails the gate |")
  lines.push("| --- | --- | --- |")
  lines.push(`| analyzers examined | ${report.langs.length} | — |`)
  lines.push(`| analyzers with a canonical doc | ${report.langs.length - report.missingDocs.length} | — |`)
  lines.push(`| FALSE_NEGATIVE — doc says \"not emitted\", analyzer emits it | ${fn.length} | **yes** |`)
  lines.push(`| FALSE_POSITIVE — doc says \"emitted\", nothing emits it | ${fp.length} | **yes** |`)
  lines.push(`| UNDOCUMENTED — live channel, no checkable claim | ${und.length} | no (measured here) |`)
  lines.push(`| MISSING_DOC — no canonical doc | ${countBy(v, "MISSING_DOC")} | no (owned by verify-analyzer-docs.ts) |`)
  lines.push(`| NO_CLAIM_TABLE — no ontology table to compare | ${countBy(v, "NO_CLAIM_TABLE")} | no |`)
  lines.push(`| NON_ENGINE_KIND — row is not a RelationshipType alias | ${countBy(v, "NON_ENGINE_KIND")} | no |`)
  lines.push(`| MIXED_ROW — engine and non-kind names share one cell | ${countBy(v, "MIXED_ROW")} | no |`)
  lines.push(`| COMPOUND_ROW — verdict from a multi-name row | ${countBy(v, "COMPOUND_ROW")} | no |`)
  lines.push("")
  for (const ch of PAYLOAD_CHANNELS) {
    lines.push(
      `The ${ch.label} channel is live in **${[...report.surfaces.values()].filter((s) => s.payload.has(ch.kind)).length} of ${report.langs.length}** analyzers.`,
    )
  }
  lines.push("")
  lines.push("## FALSE_NEGATIVE — the lies that block")
  lines.push("")
  if (fn.length === 0) {
    lines.push("None. Every \"not emitted\" cell in every table agrees with the analyzer source.")
  } else {
    lines.push("| Analyzer | Doc row | Source | Doc line | Claim cell |")
    lines.push("| --- | --- | --- | --- | --- |")
    for (const f of fn) {
      lines.push(
        `| ${f.lang} | \`${mdCell(f.subject)}\` | \`src/ast/real-${f.lang}-analyzer.ts\` | ${f.docLine} | ${mdCell(f.cell)} |`,
      )
    }
  }
  lines.push("")
  lines.push("## FALSE_POSITIVE — claims of a channel that is empty")
  lines.push("")
  if (fp.length === 0) {
    lines.push("None.")
  } else {
    lines.push("| Analyzer | Doc row | Source | Doc line | Claim cell |")
    lines.push("| --- | --- | --- | --- | --- |")
    for (const f of fp) {
      lines.push(
        `| ${f.lang} | \`${mdCell(f.subject)}\` | \`src/ast/real-${f.lang}-analyzer.ts\` | ${f.docLine} | ${mdCell(f.cell)} |`,
      )
    }
  }
  lines.push("")
  lines.push("## UNDOCUMENTED — a live channel the table never claims anything about")
  lines.push("")
  lines.push(
    "This is the population the gate MEASURES rather than blocks. Each row is one analyzer's silence, listed so the next doc lane can pick it up without re-running anything.",
  )
  lines.push("")
  if (und.length === 0) {
    lines.push("None.")
  } else {
    lines.push("| Analyzer | Live channel | Ontology table at |")
    lines.push("| --- | --- | --- |")
    for (const f of und) lines.push(`| ${f.lang} | \`${mdCell(f.subject)}\` | line ${f.docLine} |`)
  }
  lines.push("")
  lines.push("## MISSING_DOC")
  lines.push("")
  if (report.missingDocs.length === 0) {
    lines.push("None.")
  } else {
    lines.push("| Analyzer | Doc |")
    lines.push("| --- | --- |")
    for (const lang of report.missingDocs) {
      const alt = path.join("docs", "analyzers", `${lang}.md`)
      const note = fs.existsSync(path.join(REPO_ROOT, alt)) ? ` — content may live at \`${alt}\`` : ""
      lines.push(`| real-${lang}-analyzer.ts | no \`docs/analyzers/real-${lang}-analyzer.md\`${note} |`)
    }
  }
  lines.push("")
  lines.push("## Docs with no ontology claim table (nothing was comparable)")
  lines.push("")
  lines.push(report.noTable.length === 0 ? "None." : report.noTable.map((l) => `\`${l}\``).join(", "))
  lines.push("")
  if (report.multiTable.length > 0) {
    lines.push("## Docs with more than one ontology-shaped table (only the first is compared)")
    lines.push("")
    lines.push(report.multiTable.map((l) => `\`${l}\``).join(", "))
    lines.push("")
  }
  lines.push("## Informational rows excluded from comparison")
  lines.push("")
  const info = v.filter((x) => x.kind === "NON_ENGINE_KIND" || x.kind === "MIXED_ROW" || x.kind === "COMPOUND_ROW")
  if (info.length === 0) lines.push("None.")
  else {
    lines.push("| Analyzer | Row name | Why excluded | Doc line |")
    lines.push("| --- | --- | --- | --- |")
    for (const f of info) {
      lines.push(`| ${f.lang} | ${mdCell(f.subject)} | ${f.kind} — ${mdCell(f.detail)} | ${f.docLine} |`)
    }
  }
  lines.push("")
  lines.push("## Census — what each analyzer actually emits")
  lines.push("")
  lines.push("| Analyzer | Relationship kinds in code | Payload channels live | Claim table |")
  lines.push("| --- | --- | --- | --- |")
  for (const lang of report.langs) {
    const s = report.surfaces.get(lang)!
    const t = report.tables.get(lang)
    const claimTable = !t ? "absent" : t.rows.length === 0 ? "present, 0 rows" : `line ${t.line}, ${t.rows.length} rows`
    lines.push(
      `| ${lang} | \`${kindList(s.kinds)}\` | ${[...s.payload].map((k) => payloadLabel(k)).join(", ") || "—"} | ${claimTable} |`,
    )
  }
  lines.push("")
  return lines.join("\n")
}

function printFindings(verdicts: Verdict[]): void {
  const order: VerdictKind[] = ["FALSE_NEGATIVE", "FALSE_POSITIVE", "UNDOCUMENTED", "MISSING_DOC", "MIXED_ROW", "NON_ENGINE_KIND", "COMPOUND_ROW", "NO_CLAIM_TABLE"]
  for (const kind of order) {
    const group = verdicts.filter((x) => x.kind === kind)
    if (group.length === 0) continue
    for (const f of group) {
      const where = f.docLine > 0 ? `docs/analyzers/real-${f.lang}-analyzer.md:${f.docLine}` : `real-${f.lang}-analyzer`
      const cell = f.cell ? ` cell="${f.cell}"` : ""
      console.error(`${kind} [${f.lang}] ${f.subject}${cell}\n  ${where}\n  ${f.detail}`)
    }
  }
}

function main(): number {
  const argv = process.argv.slice(2)
  const rootIdx = argv.indexOf("--root")
  const root = rootIdx >= 0 && argv[rootIdx + 1] ? path.resolve(argv[rootIdx + 1]) : REPO_ROOT
  const noWrite = argv.includes("--no-write")
  const report = evaluate(root)
  const fn = countBy(report.verdicts, "FALSE_NEGATIVE")
  const fp = countBy(report.verdicts, "FALSE_POSITIVE")
  const und = countBy(report.verdicts, "UNDOCUMENTED")
  printFindings(report.verdicts)

  const registerPath = path.join(root, REGISTER_REL)
  if (!noWrite && fs.existsSync(path.dirname(registerPath))) {
    fs.writeFileSync(registerPath, renderRegister(report))
    console.error(`\nwrote ${REGISTER_REL}`)
  }

  const summary =
    `doc-truth-emissions: ${report.langs.length} analyzers, ` +
    `FALSE_NEGATIVE=${fn} FALSE_POSITIVE=${fp} UNDOCUMENTED=${und} ` +
    `MISSING_DOC=${countBy(report.verdicts, "MISSING_DOC")} ` +
    `NO_CLAIM_TABLE=${countBy(report.verdicts, "NO_CLAIM_TABLE")} ` +
    `-> ${fn + fp === 0 ? "PASS" : "FAIL"}`
  console.error(summary)
  return fn + fp === 0 ? 0 : 1
}

/**
 * Prove the gate can still fail.
 *
 * A gate that has been tuned until nothing trips is indistinguishable from a
 * codebase with no defects, so the battery here builds a throwaway tree and
 * asserts BOTH directions: a doc that denies a channel the analyzer uses must
 * produce FALSE_NEGATIVE and a non-zero exit, a doc that claims a channel the
 * analyzer does not use must produce FALSE_POSITIVE and a non-zero exit, and a
 * doc that matches the source must produce neither and exit 0. The two failing
 * cases are what give the passing case meaning; a run of this battery that
 * contains no failing case is itself a failure.
 */
export function selftest(): number {
  const cases: {
    name: string
    src: string
    doc: string
    expect: VerdictKind[]
    expectExit: number
  }[] = [
    {
      name: "imports row denies a live ImportInfo channel (the cpp/java lie)",
      src: [
        "const imports: ASTEngine.ImportInfo[] = []",
        "imports.push({ module: 'x' })",
        "relationships.push({ type: ASTEngine.RelationshipType.Calls })",
        "return { relationships, imports }",
      ].join("\n"),
      doc: tableDoc([
        ["calls", "✅", "`method_invocation` → callee", "0.7"],
        ["imports", "❌ **not emitted**", "`RelationshipType.Imports` is never referenced", "—"],
      ]),
      expect: ["FALSE_NEGATIVE"],
      expectExit: 1,
    },
    {
      name: "doc claims a kind the analyzer never emits",
      src: ["relationships.push({ type: ASTEngine.RelationshipType.Calls })"].join("\n"),
      doc: tableDoc([
        ["calls", "✅", "`m` → callee", "0.7"],
        ["uses", "✅", "field reads", "0.6"],
      ]),
      expect: ["FALSE_POSITIVE"],
      expectExit: 1,
    },
    {
      name: "claims are right and the import row names the payload channel — must PASS",
      src: [
        "const imports: ASTEngine.ImportInfo[] = []",
        "imports.push({ module: 'x' })",
        "relationships.push({ type: ASTEngine.RelationshipType.Calls })",
        "return { relationships, imports }",
      ].join("\n"),
      doc: tableDoc([
        ["calls", "✅", "`method_invocation` → callee", "0.7"],
        ["uses", "❌ (not emitted)", "the language has no separate uses pass", "—"],
        ["imports", "✅ carried as `ImportInfo[]` payload, not as an edge", "`import_declaration` → module", "—"],
      ]),
      expect: [],
      expectExit: 0,
    },
    {
      name: "an exports row satisfied by the ExportInfo[] payload alone must PASS",
      src: [
        "const exports: ASTEngine.ExportInfo[] = []",
        "exports.push({ name: 'Foo' })",
        "relationships.push({ type: ASTEngine.RelationshipType.Calls })",
        "return { relationships, exports }",
      ].join("\n"),
      doc: tableDoc([
        ["calls", "✅", "`method_invocation` → callee", "0.7"],
        ["exports", "✅", "public top-level symbols, as an `ExportInfo[]` payload", "—"],
      ]),
      expect: [],
      expectExit: 0,
    },
    {
      name: "an exports row denying a live ExportInfo[] payload is a FALSE_NEGATIVE (the go lie)",
      src: [
        "const exports: ASTEngine.ExportInfo[] = []",
        "exports.push({ name: 'Foo' })",
        "relationships.push({ type: ASTEngine.RelationshipType.Calls })",
        "return { relationships, exports }",
      ].join("\n"),
      doc: tableDoc([
        ["calls", "✅", "`method_invocation` → callee", "0.7"],
        ["exports", "❌ not emitted", "no module system in this language", "—"],
      ]),
      expect: ["FALSE_NEGATIVE"],
      expectExit: 1,
    },
    {
      name: "a RelationshipType named only in a COMMENT must not count as an emission",
      src: [
        "// this analyzer never emits overrides; see RelationshipType.Override",
        "relationships.push({ type: ASTEngine.RelationshipType.Calls })",
      ].join("\n"),
      doc: tableDoc([
        ["calls", "✅", "`m` → callee", "0.7"],
        ["overrides", "❌ (not emitted)", "no override keyword in this language", "—"],
      ]),
      expect: [],
      expectExit: 0,
    },
    {
      name: "a non-kind row (`depends`) is excluded, not graded as an emission claim",
      src: ["relationships.push({ type: ASTEngine.RelationshipType.Calls })"].join("\n"),
      doc: tableDoc([
        ["calls", "✅", "`m` → callee", "0.7"],
        ["depends", "❌ not a kind", "not a member of RelationshipType", "—"],
      ]),
      expect: ["NON_ENGINE_KIND"],
      expectExit: 0,
    },
    {
      name: "a mixed row (engine kind + non-kind in one cell) is excluded, not guessed",
      src: ["relationships.push({ type: ASTEngine.RelationshipType.Contains })"].join("\n"),
      doc: tableDoc([
        ["contains", "✅", "owner → member", "1.0"],
        ["extends / field_access", "❌ n/a", "no class heritage in this language", "—"],
      ]),
      expect: ["MIXED_ROW"],
      expectExit: 0,
    },
    {
      name: "an emitted kind with no row at all is UNDOCUMENTED, not fatal",
      src: ["relationships.push({ type: ASTEngine.RelationshipType.Contains })"].join("\n"),
      doc: tableDoc([["calls", "✅", "`m` → callee", "0.7"]]),
      expect: ["UNDOCUMENTED"],
      expectExit: 0,
    },
    {
      name: "claims the import channel that the analyzer does not have",
      src: ["relationships.push({ type: ASTEngine.RelationshipType.Contains })"].join("\n"),
      doc: tableDoc([
        ["contains", "✅", "owner → member", "1.0"],
        ["imports", "✅", "`import x`", "—"],
      ]),
      expect: ["FALSE_POSITIVE"],
      expectExit: 1,
    },
    {
      name: "a doc with no ontology table is reported, never silently skipped",
      src: ["relationships.push({ type: ASTEngine.RelationshipType.Contains })"].join("\n"),
      doc: "# Analyzer\n\n## Relationship ontology\n\nSome prose with no table at all.\n",
      expect: ["NO_CLAIM_TABLE"],
      expectExit: 0,
    },
    {
      name: "an analyzer with no doc is MISSING_DOC, not skipped",
      src: ["relationships.push({ type: ASTEngine.RelationshipType.Contains })"].join("\n"),
      doc: null as any,
      expect: ["MISSING_DOC"],
      expectExit: 0,
    },
  ]

  let bad = 0
  let tempRoot = ""
  try {
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i]
      tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `doc-truth-selftest-${i}-`))
      const srcDir = path.join(tempRoot, "src", "ast")
      const docDir = path.join(tempRoot, "docs", "analyzers")
      fs.mkdirSync(srcDir, { recursive: true })
      fs.mkdirSync(docDir, { recursive: true })
      fs.writeFileSync(path.join(srcDir, "real-selftest-analyzer.ts"), c.src + "\n")
      if (c.doc !== null) fs.writeFileSync(path.join(docDir, "real-selftest-analyzer.md"), c.doc)

      const report = evaluate(tempRoot)
      const got = new Set(report.verdicts.map((v) => v.kind))
      const missing = c.expect.filter((k) => !got.has(k))
      const exit = countBy(report.verdicts, "FALSE_NEGATIVE") + countBy(report.verdicts, "FALSE_POSITIVE") === 0 ? 0 : 1
      const ok = missing.length === 0 && exit === c.expectExit
      if (!ok) bad++
      console.log(
        `${ok ? "ok  " : "FAIL"} ${c.name}` +
          `\n     expected [${c.expect.join(", ") || "none"}] exit ${c.expectExit}; got [${[...got].join(", ") || "none"}] exit ${exit}` +
          (missing.length ? `\n     missing verdict(s): ${missing.join(", ")}` : ""),
      )
      fs.rmSync(tempRoot, { recursive: true, force: true })
      tempRoot = ""
    }
  } finally {
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true })
  }

  const failingCases = cases.filter((c) => c.expectExit !== 0).length
  if (failingCases === 0) {
    bad++
    console.log("FAIL self-test is vacuous: no case asserts that the gate FAILS, so a passing run proves nothing")
  }
  const positives = cases.filter((c) => c.expect.length > 0).length
  if (positives === 0) {
    bad++
    console.log("FAIL self-test is vacuous: no case asserts a verdict, so the detectors were never exercised")
  }
  console.log(
    bad === 0
      ? `\ndoc-truth-emissions selftest: ${cases.length} case(s) meet expectation`
      : `\ndoc-truth-emissions selftest: ${bad} case(s) failed`,
  )
  return bad === 0 ? 0 : 1
}

/** A minimal ontology table, so a selftest case is about the rule and not about prose. */
function tableDoc(rows: string[][]): string {
  return [
    "# selftest analyzer",
    "",
    "## Relationship ontology",
    "",
    "| Relationship type | Emitted? | How resolved | Confidence model |",
    "| --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r.join(" | ")} |`),
    "",
  ].join("\n")
}

if (process.argv[1]?.endsWith("verify-doc-truth-emissions.ts")) {
  if (process.argv.includes("--selftest")) process.exit(selftest())
  process.exit(main())
}
