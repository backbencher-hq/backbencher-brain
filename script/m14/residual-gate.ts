/**
 * RESIDUAL GATE — "n/n is not done". For every lane, what is NOT yet real?
 *
 * THE BAR THIS MEASURES, in the programme owner's words: "what matters is not just to implement the
 * applicable relationship types, but that they actually really extract real relationships of all
 * that type". A lane reading `n/n` on the coverage ratio can still be leaving edges unresolved,
 * ambiguous or wrong — so the completion question is not the ratio, it is this:
 *
 *   OUTGOING  every emitted edge of every applicable type resolves to exactly one real declaration,
 *             with zero unexplained edges;
 *   INCOMING  every edge resolves to exactly one declaration or carries an external claim the
 *             project VERIFIES, and every ambiguous/unresolved edge is attributed to a NAMED cause
 *             with a measured count.
 *
 * THE FOUR CLASSES THE `incoming-gate` TABLE ALREADY SEPARATES, and which this gate refuses to let
 * be merged — the numbers are exact and additive, so a total that does not add up is a defect:
 *
 *   resolved      good.
 *   amb(decl)     an edge whose target names N declarations in the project. NOT reducible by
 *                 emitting fewer edges; reducible only by targeting something unique.
 *   unresolved    the target names nothing in the project. Legitimate for stdlib/SDK names, but
 *                 only when something SAYS so (`ext?`, a declared cause) — otherwise it is an open
 *                 defect, not a limit.
 *   extFAIL       an external claim the project REFUTES. Counted AGAINST the lane; must be 0.
 *   bindFAIL      marked as a binding but spelled so it COULD name a declaration. Must be 0.
 *   causeFAIL     a declared cause whose own reason does not check out. Must be 0.
 *
 * WHAT IT DOES NOT DO: it does not fix anything and it does not judge whether a cause is
 * acceptable. It produces the WORKLIST — per lane, per type, the exact residual and the buckets it
 * falls into — so that "all of that type are true and real" can be tracked to zero instead of
 * asserted. A cause is closed by a commit that names it and carries a before/after over the SAME
 * population; this gate re-measures and the number moves or it does not.
 *
 * Usage:
 *   npx tsx script/m14/residual-gate.ts                 # every lane, from the refreshed log
 *   npx tsx script/m14/residual-gate.ts --lane <lang>    # one lane, live whole-population run
 *   npx tsx script/m14/residual-gate.ts --json
 */
import { readFileSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { execFileSync } from "node:child_process"

const HERE: string = (import.meta as any).dir ?? dirname(new URL(import.meta.url).pathname)
const ROOT = resolve(HERE, "..", "..")
const INCOMING_LOG = process.env.BB_BOARD_INCOMING ?? "validation/m14/results/incoming-laptop-b.current.log"

const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

/** The verdict line's own counters, which the log carries and the board already parses. */
type Summary = { lane: string; verdict: string | null; amb: number | null; unres: number | null; edges: number | null; extRefuted: number | null; extVerified: number | null; line: string }

function numBefore(toks: string[], word: string): number | null {
  const i = toks.findIndex((t) => t.split(/[^a-z]/i).filter(Boolean).join("").toLowerCase() === word)
  if (i <= 0) return null
  for (let j = i - 1; j >= 0; j--) {
    const digits = toks[j].replace(/[^0-9]/g, "")
    if (digits !== "" && /^[0-9,]+$/.test(toks[j].replace(/[^0-9,]/g, "")) === false) continue
    const n = Number(toks[j].replace(/[^0-9]/g, ""))
    if (Number.isFinite(n) && digits !== "") return n
  }
  return null
}
function parseLog(text: string): Summary[] {
  const out: Summary[] = []
  let label = ""
  for (const raw of text.split("\n")) {
    const t = raw.trim()
    if (t === "") continue
    if (t.startsWith("### ")) { label = t.slice(4).trim(); continue }
    if (!t.startsWith("VERDICT")) continue
    const em = t.indexOf("—")
    const head = em >= 0 ? t.slice(0, em) : t
    const tok = (em >= 0 ? t.slice(em + 1) : "").split(/\s+/).map((s) => s.replace(/[(),;]/g, ""))
    const num = (word: string): number | null => {
      const i = tok.findIndex((s) => s.toLowerCase().startsWith(word))
      if (i < 0) return null
      for (let j = i - 1; j >= 0 && j >= i - 3; j--) { const n = Number(tok[j].replace(/[^0-9]/g, "")); if (tok[j].replace(/[^0-9]/g, "") !== "") return n }
      return null
    }
    out.push({
      lane: label, verdict: head.includes("FAIL") ? "FAIL" : head.includes("PASS") ? "PASS" : null,
      amb: num("ambiguous"), unres: num("unresolved"), edges: num("edges"),
      extRefuted: num("REFUTED"), extVerified: num("verified"), line: t,
    })
  }
  return out
}

/** The full per-type table, for a live lane run. */
/**
 * THE GATE WHOSE OUTPUT THIS PARSES EXITS NON-ZERO ON PURPOSE — `incoming-gate.ts` exits 1 for
 * every lane that has residual, which is every lane. `execFileSync` therefore THROWS, and the
 * first version of this function lost the entire table to the exception: a measurement tool that
 * cannot read its instrument's output on a FAIL is useless, because FAIL is the state it exists to
 * analyse. The stdout is on the error object, so it is taken from there.
 */
/**
 * WHAT THE RUN ACTUALLY READ, as opposed to what this gate's header used to assert.
 *
 * The header said `WHOLE admitted population, production scope` UNCONDITIONALLY. But `incoming-gate.ts`
 * already discloses three facts that can make that sentence false, and this gate parsed none of them:
 *
 *   * `SAMPLE, NOT POPULATION: n of N files` — a stride sample truncates each project's symbol table
 *     too, so its project-scoped RESOLVED share is biased UP (a name whose collision lives in an
 *     unsampled file of the same repository reads unique).
 *   * `empty results: n file(s) returned NO symbols AND NO relationships` — a timed-out file
 *     (`engine.ts:1991`) contributes NOTHING, so the population is INCOMPLETE and every count
 *     describes evidence that is MISSING, not evidence that is wrong.
 *   * `degraded (regex fallback): n` — those rows are a DIFFERENT instrument's, already reported by
 *     the FALLBACK ROWS block, and they inflate the residual.
 *
 * A verdict is a claim about its population, and an unread file is not in it. This gate is the one
 * lanes are told to run, so the disclosure has to travel WITH the table rather than sit one layer
 * down in a log the lane may not read. Sixth instance of one family in this programme — a summary
 * that does not match its own columns; the fix each time is to make the label read the computation.
 */
type Population = {
  parsed: number | null; sampled: number | null; corpus: number | null; repos: number | null
  admittedExts: string | null
  failed: number | null; degraded: number | null
  emptyCount: number | null
  /** files that hold NO CONTENT AT ALL — the run missed nothing, the population is COMPLETE */
  emptyContentless: number | null
  /** files that hold CONTENT and returned nothing — a real HOLE in the population */
  emptyHoles: number | null
  /** the instrument printed the OLD unsplit line, so the kind of each file is UNKNOWN here */
  emptyLegacyUnsplit: boolean
  emptyFiles: Array<{ kind: "hole" | "contentless" | "unknown"; path: string }>
  sampleOf: number | null; sampleTotal: number | null
}

function runLane(lang: string): { rows: Array<{ type: string; edges: number; resolved: number; ambColl?: number; amb: number; ambKind: number; unres: number; extOK: number; extQ: number; extFAIL: number; bindOK: number; bindQ: number; bindFAIL: number; causeOK: number; causeFAIL: number }>; total: any; intent: Map<string, { intended: number; sameFileUnproven: number; arbitraryTwin: number; noDeclaration: number }>; intentBlockSeen: boolean; intentWidthBad: number; population: Population } {
  const ext = { fsharp: "fs,fsi,fsx", zig: "zig", lua: "lua", julia: "jl", nim: "nim,nims,nimble", php: "php", powershell: "ps1,psm1,psd1", r: "r", dart: "dart", sql: "sql", graphql: "graphql,gql", protobuf: "proto", json: "json,jsonc", yaml: "yaml,yml", css: "css,less", scss: "scss", hcl: "tf,hcl,tfvars,tofu", make: "mk,mak,makefile", toml: "toml", xml: "xml,xsd,dtd,svg,xsl,xslt,rng", markdown: "md,markdown", clean: "icl,dcl", bash: "sh,bash,zsh" }[lang] ?? lang
  let out = ""
  try {
    out = execFileSync("npx", ["tsx", "script/m14/incoming-gate.ts", lang, ext, "0"], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] })
  } catch (e: any) {
    out = typeof e?.stdout === "string" ? e.stdout : ""
    if (out === "") throw e
  }
  const rows: any[] = []
  let total: any = null
  /**
   * THE BINDING-INTENT BLOCK, parsed ADDITIVELY and never through TABLE 1's positional reader.
   *
   * `incoming-gate.ts` prints it as a separate 6-column table (`type edges intended
   * sameFileUnproven arbitraryTwin noDeclaration`) after TABLE 2, so reading it cannot shift TABLE 1
   * and TABLE 1 cannot shift it. That separation is deliberate: the last column inserted into a
   * positional reader without a width guard produced FOUR FALSE `extFAIL` COUNTS, and hcl-lane
   * declined to make this change for exactly that reason. The guard below is the condition of the
   * change: a row whose column count is not 6 is reported UNMEASURED for intent rather than
   * silently reinterpreted.
   */
  const intent = new Map<string, { intended: number; sameFileUnproven: number; arbitraryTwin: number; noDeclaration: number }>()
  let intentBlockSeen = false
  let intentWidthBad = 0
  {
    let inBlock = false
    for (const line of out.split("\n")) {
      const t = line.trim()
      if (t.startsWith("BINDING INTENT")) { inBlock = true; continue }
      if (!inBlock) continue
      if (t === "" || t.startsWith("intended =") || t.startsWith("(exact only") || t.startsWith("For every other") || t.startsWith("not wrong and not")) continue
      if (t.startsWith("type ")) continue
      const parts = t.split(/\s+/)
      if (parts.length === 0) continue
      // A CANDIDATE ROW is one whose first token is a relationship type. Anything else after the
      // block is prose or a later table, and the first version of this guard counted those as
      // width violations and threw away a block it had already parsed correctly. Police the rows,
      // not the file.
      if (!TYPES.includes(parts[0])) continue
      // A SINGLE TOKEN IS NOT A ROW — prose after the block lists type names on their own line
      // ("calls", "uses") as prose, and counting those as width violations made an honest
      // disclosure read like five malformed rows. A row has at least a type and an edge count.
      if (parts.length < 2) continue
      if (parts.length !== 6) { intentWidthBad++; continue }
      const nums = parts.slice(1).map((x) => Number(x.replace(/,/g, "")))
      if (nums.some((n) => !Number.isFinite(n))) continue
      intentBlockSeen = true
      intent.set(parts[0], { intended: nums[1], sameFileUnproven: nums[2], arbitraryTwin: nums[3], noDeclaration: nums[4] })
    }
  }
  // THE GUARD IS PER-ROW, NOT GLOBAL. A first version reset the whole block when ANY line failed
  // the width test — and prose AFTER the block mentions type names on their own line, so a
  // correctly parsed block was thrown away by unrelated text. A candidate row that does not have
  // exactly 6 columns is SKIPPED rather than misread, which is the whole requirement: the failure
  // mode this guards against is reinterpreting a shifted column, and a skipped row cannot do that.
  // `intentWidthBad` is kept as a disclosure, printed below when non-zero.
  for (const line of out.split("\n")) {
    const t = line.trim()
    const parts = t.split(/\s+/)
    if (parts.length < 15) continue
    if (!TYPES.includes(parts[0]) && parts[0] !== "TOTAL") continue
    // The gate's TABLE 1 carries no collision column, so it is read from the `resolvedAmongCollision`
  // line that `incoming-gate` prints per type; absent -> undefined, never zero-by-assumption.
  const nums = parts.slice(1).map((x) => Number(x.replace(/,/g, "")))
    if (nums.some((n) => !Number.isFinite(n))) continue
    const r = { type: parts[0], edges: nums[0], resolved: nums[1], ambColl: nums[2], amb: nums[3], ambKind: nums[4], unres: nums[5], extOK: nums[6], extQ: nums[7], extFAIL: nums[8], bindOK: nums[9], bindQ: nums[10], bindFAIL: nums[11], causeOK: nums[12], causeFAIL: nums[13] }
    if (parts[0] === "TOTAL") total = r; else rows.push(r)
  }
  // The disclosure lines are read from the SAME stdout the table came from, so the population and the
  // table cannot describe two different runs. Every field is nullable: an absent disclosure stays
  // `null` and is printed as UNSTATED rather than assumed to be zero — the failure this guards against
  // is a clean-looking zero standing in for a line the instrument never printed.
  const population: Population = (() => {
    const pop: Population = {
      parsed: null, sampled: null, corpus: null, repos: null, admittedExts: null,
      failed: null, degraded: null, emptyCount: null,
      emptyContentless: null, emptyHoles: null, emptyLegacyUnsplit: false, emptyFiles: [],
      sampleOf: null, sampleTotal: null,
    }
    const num = (s: string) => Number(s.replace(/,/g, ""))
    const lines = out.split("\n")
    let lastEmptyLine = -1
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim()
      let m = /^population: ([\d,]+) parsed of ([\d,]+) sampled \(corpus has ([\d,]+) \.([^\s]+) files across ([\d,]+) repos/.exec(t)
      if (m) { pop.parsed = num(m[1]); pop.sampled = num(m[2]); pop.corpus = num(m[3]); pop.repos = num(m[5]); continue }
      m = /^population: admitted extensions = (.+?) \((ONE spelling|both spellings)/.exec(t)
      if (m) { pop.admittedExts = `${m[1]} (${m[2].toLowerCase()})`; continue }
      m = /^parse failures: ([\d,]+)\s+degraded \(regex fallback\): ([\d,]+)/.exec(t)
      if (m) { pop.failed = num(m[1]); pop.degraded = num(m[2]); continue }
      // THE INSTRUMENT SPLITS THE COUNTER, SO THIS GATE READS ITS SPLIT RATHER THAN RE-DERIVING IT.
      // A first version of this block re-classified the files ITSELF by reading each one — two copies
      // of one classifier, which is the "one spelling, two places" hazard this programme keeps paying
      // for. It diverged IMMEDIATELY: `incoming-gate` prefixes each name with `HOLE  ` or `empty `,
      // so the copy here read `"empty /path"` as a PATH, failed to open it, and fell through to
      // "hole" — reporting three 0-byte files in clean-stdlib as a population hole while the
      // instrument one line above called them contentless. **The instrument that owns the data owns
      // the classification; this gate reads both counts and neither re-decides.** The old unsplit
      // line is still recognised, and recognised as UNKNOWN rather than guessed at.
      m = /^empty results: ([\d,]+) file\(s\) hold NO CONTENT AT ALL/.exec(t)
      if (m) { pop.emptyContentless = num(m[1]); lastEmptyLine = i; continue }
      m = /^empty results: ([\d,]+) file\(s\) hold CONTENT AND RETURNED NOTHING/.exec(t)
      if (m) { pop.emptyHoles = num(m[1]); lastEmptyLine = i; continue }
      m = /^empty results: ([\d,]+) file\(s\) returned NO symbols AND NO relationships/.exec(t)
      if (m) { pop.emptyCount = num(m[1]); pop.emptyLegacyUnsplit = true; lastEmptyLine = i; continue }
      m = /^SAMPLE, NOT POPULATION: ([\d,]+) of ([\d,]+) files/.exec(t)
      if (m) { pop.sampleOf = num(m[1]); pop.sampleTotal = num(m[2]); continue }
    }
    if (pop.emptyContentless !== null || pop.emptyHoles !== null) {
      pop.emptyCount = (pop.emptyContentless ?? 0) + (pop.emptyHoles ?? 0)
      if (lastEmptyLine >= 0) {
        for (let j = lastEmptyLine + 1; j < lines.length && j <= lastEmptyLine + 5; j++) {
          const fm = /^\s{4}(empty |\?\?\?\?\? )(.+)$/.exec(lines[j])
          if (!fm) break
          pop.emptyFiles.push({ kind: fm[1] === "empty " ? "contentless" : "unknown", path: fm[2].trim() })
        }
      }
    }
    return pop
  })()
  return { rows, total, intent, intentBlockSeen, intentWidthBad, population }
}

const argv = process.argv.slice(2)
const JSON_MODE = argv.includes("--json")
const LANE = argv.includes("--lane") ? argv[argv.indexOf("--lane") + 1] : null

if (LANE) {
  const { rows, total, intent, intentBlockSeen, intentWidthBad, population } = runLane(LANE)
  if (JSON_MODE) { console.log(JSON.stringify({ gate: "residual-gate", lane: LANE, rows, total, population }, null, 2)); process.exit(0) }
  const w = (s: any, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
  // THE HEADER READS THE RUN, IT DOES NOT ASSERT OVER IT. It used to say `WHOLE admitted population,
  // production scope` no matter what came back — so a stride sample, a degraded fallback or a file
  // that contributed nothing all printed the same confident sentence. Each condition below is one of
  // those three, and the sentence changes with it.
  //
  // AND A FILE THAT IS EMPTY IS NOT A FILE THAT TIMED OUT. `emptyResults` is ONE counter over two
  // populations that mean OPPOSITE things: a 0-byte (or whitespace-only) file has NO CONTENT TO
  // EXTRACT — the run missed nothing and the population is COMPLETE — while a file WITH CONTENT that
  // returned nothing is a HOLE in it (`engine.ts:1991` returns `{symbols: [], relationships: []}` on a
  // timeout, so the file contributes NO EDGES and is invisible by construction).
  //
  // THE CLASSIFICATION IS THE INSTRUMENT'S, NOT THIS GATE'S. A first version of this block re-read
  // each file here and decided the kind itself — **two copies of one classifier, and they diverged
  // immediately**: `incoming-gate` prefixes each name with `HOLE  ` or `empty `, so the copy here read
  // `"empty /path"` as a PATH, failed to open it, fell through to "hole", and reported three 0-byte
  // files in clean-stdlib as a population hole while the instrument one line above called them
  // contentless. `incoming-gate` owns the data, so it owns the classification; this gate reads its two
  // counts and re-decides NOTHING. The old unsplit line is still recognised, and recognised as UNKNOWN
  // rather than guessed at — a count that classifies more than it read is how a disclosure becomes a
  // claim.
  const isSample = population.sampleOf !== null && population.sampleTotal !== null && population.sampleOf < population.sampleTotal
  const empty = population.emptyCount ?? 0
  const deg = population.degraded ?? 0
  const holes = population.emptyHoles ?? 0
  const contentless = population.emptyContentless ?? 0
  const namedShown = population.emptyFiles.length
  const scope = isSample
    ? `SAMPLE — ${population.sampleOf} of ${population.sampleTotal} admitted files. NOT the whole population, and a stride sample truncates each project's symbol table too, so its project-scoped RESOLVED share is biased UP.`
    : (holes > 0 || deg > 0)
      // NO BACKTICKS INSIDE THIS TEMPLATE LITERAL. The first version of this line had two — around
      // `# empty` and around `engine.ts:1991` — which CLOSED the template, re-opened it, and left
      // `tsx` unable to load the module at all (TransformError at 293:286). **Every lane's residual
      // measurement was blocked by it**, and `npx tsc --noEmit` reported NOTHING, so it passed
      // typecheck and failed only at runtime.
      //
      // THIS IS THE SECOND TIME I HAVE MADE THIS EXACT MISTAKE IN THIS PROGRAMME: the first was
      // backticks inside a SQL comment in a template literal in `parallel-indexer.ts`. Quoting inside
      // a quoted string is a hazard this file cannot afford, because this file is the instrument
      // every lane runs.
      //
      // AND THE REASON IT REACHED THE FLEET IS WORTH MORE THAN THE TYPO: **`tsc --noEmit` does not
      // cover `script/`**, so nothing in this repository's type gate can see a syntax error in the
      // instruments. A lane importing it is the first thing that finds out.
      ? `WHOLE admitted population — ${holes} file(s) hold CONTENT and returned nothing and ${deg} were degraded. WHETHER THAT IS A HOLE IS NOT DECIDED HERE: this counter cannot separate a parse failure from content that cannot declare anything. julia-lane's three were all BENIGN ('# empty' stubs and a comments-only file, no declaring node); graphql-lane's 45 are attributed to 'engine.ts:1991' timeouts. Read the files.`
      : population.emptyLegacyUnsplit
        ? `WHOLE admitted population; ${empty} file(s) returned nothing and the instrument did NOT split them by content, so their kind is UNKNOWN — a 0-byte file leaves the population COMPLETE, a timed-out one puts a HOLE in it, and this run cannot tell you which.`
        : population.parsed === null
          ? `WHOLE admitted population (the population line was NOT PRINTED by the instrument — scope UNSTATED, not assumed clean)`
          : `WHOLE admitted population, production scope`
  console.log(`residual gate — ${LANE}\nscope: ${scope}\n`)
  {
    const bits: string[] = []
    if (population.parsed !== null && population.sampled !== null) bits.push(`${population.parsed} parsed of ${population.sampled} sampled`)
    if (population.corpus !== null) bits.push(`corpus ${population.corpus} files across ${population.repos} repos`)
    if (population.admittedExts) bits.push(`admitted ${population.admittedExts}`)
    if (population.failed !== null) bits.push(`parse failures ${population.failed}`)
    if (population.degraded !== null) bits.push(`degraded (regex fallback) ${population.degraded}`)
    bits.push(`files returning NO symbols AND NO relationships: ${population.emptyCount === null ? "UNSTATED" : empty}`)
    console.log(`POPULATION — ${bits.join(" · ")}`)
    if (contentless > 0) console.log(
      `  ${contentless} of them hold NO CONTENT AT ALL (0 bytes or whitespace): the run missed nothing,\n` +
      `  the population is COMPLETE, and these are NOT a defect.`)
    // NOT ASSERTED AS A HOLE — see the module docstring and julia-lane's measurement (three benign
    // files) against graphql-lane's 45 (attributed to `engine.ts:1991` timeouts). BOTH readings occur
    // in this fleet, so the counter is genuinely undecidable and asserting either way is the defect.
    if (holes > 0) console.log(
      `  ${holes} hold CONTENT AND RETURNED NOTHING. THIS COUNTER CANNOT TELL a parse failure from\n` +
      `  content that cannot declare anything: it is NOT a hole by declaration, and it is NOT clean\n` +
      `  either. Read the files before either verdict travels with these numbers.`)
    for (const f of population.emptyFiles) console.log(
      `    ${f.kind === "contentless" ? "empty " : "????? "}${f.path}`)
    if (!population.emptyLegacyUnsplit && population.emptyCount !== null && namedShown < population.emptyCount) console.log(
      `  (${population.emptyCount - namedShown} further file(s) are COUNTED BUT NOT NAMED — the instrument names\n` +
      `   only its first five, so their kind is unclassified and must NOT be reported as either.)`)
    if (holes > 0) console.log(
      `  ^ a file with content that contributed NOTHING is a timed-out/failed parse (engine.ts:1991), so\n` +
      `    the population above is INCOMPLETE: every count in this table describes evidence that is\n` +
      `    MISSING, not evidence that is wrong, and NO lane's residual may be quoted from this run\n` +
      `    without that sentence.`)
    console.log()
  }
  console.log(`${w("type", 14)} ${w("edges", 9)} ${w("resolved", 9)} ${w("ofWhich", 8)} ${w("amb(decl)", 10)} ${w("unresolved", 11)} ${w("extOK", 8)} ${w("ext?", 6)} ${w("extFAIL", 8)} ${w("bindFAIL", 9)} ${w("causeFAIL", 10)} ${w("residual%", 10)}${intentBlockSeen ? "  " + w("intended", 9) + w("twin", 6) + w("noDecl", 7) : ""}`)
  // THE LABEL MUST NOT ASSERT MORE THAN THE CLASSIFIER ESTABLISHES. This legend said
  // `"twin" = ONLY another file answers (a wrong edge)` — which is true only for the types the
  // analyzer writes on the target symbol's own line. `classifyIntent` (incoming-gate.ts:433-445) is a
  // NAME test that does not read claims: `declarations of the target NAME in the project; if none in
  // the edge's own file -> arbitraryTwin`. For `contains`/`exports` a foreign answer IS a defect by
  // construction. For `references`/`extends` it is what a CROSS-DOCUMENT REFERENCE IS — the target
  // lives in another document, so no declaration in the edge's own file is the expected state, not an
  // anomaly. r-lane found this: 236 sampled xml twins, EVERY ONE already carrying `isExternalTarget`
  // (builtin 233, external 3), **in-document 0**, and no spelling change reaches any of them
  // (declaration ceiling 0, referenced ceiling 0). The function's own docstring is weaker than the
  // header was — it says the class is "exactly when the store's `s.id` tie-break picks a foreign
  // declaration", a RISK, not proven wrongness. Third time tonight a column's label outran its
  // computation; the fix is the label, not the arithmetic.
  if (intentBlockSeen) console.log(`  "intended" = own file AND own line · "twin" = ONLY another file answers · "noDecl" = nothing answers.`)
  // The type list is named literally rather than imported: this gate SPAWNS `incoming-gate.ts` as a
  // subprocess and shares no module state with it, so an imported constant would be a second copy that
  // could silently drift from the one the classifier actually uses. If `LINE_IS_TARGET_LINE` changes
  // there, this line must change with it — which is the same "one spelling, two places" hazard the
  // whole handoff warns about, made visible instead of hidden behind an import.
  if (intentBlockSeen) console.log(`  "twin" is a WRONG EDGE only for contains/exports (the types whose edges the analyzer writes on the target symbol's own line); for other types a foreign declaration is what a cross-document reference IS — a RISK, not proven wrongness.`)
  if (intentBlockSeen && intentWidthBad > 0) console.log(`  (${intentWidthBad} intent ROW(s) did not have 6 columns and were SKIPPED, not reinterpreted.)`)
  // THE CLOSURE CHECK, and it exists because a reader could not close this table. r-lane measured
  // powershell at `edges 180,915` against `resolved 57,471 + amb 43,879 + unresolved 52,649 =
  // 153,999` — a gap of 26,916 that NO PRINTED COLUMN ACCOUNTED FOR, and the same gap appears on xml
  // (3,077). The missing term is the external and binding disposition (`extOK`, `ext?`) that the
  // parser already READ and the table never PRINTED, so the identity the programme relies on —
  // "every edge lands in exactly one bucket" — was unverifiable from the output.
  //
  // Fifth instance of one family: a table that does not show its own closure. The lesson is the same
  // every time, and the goal statement puts it plainly — *no unknown, unexplained, ambiguous or wrong
  // edges may remain*. An edge in no printed bucket is an unknown edge.
  {
    const disp = (r: any) => (r.resolved + r.amb + r.unres + r.extOK + r.extQ + r.extFAIL + r.bindOK + r.bindQ + r.bindFAIL + r.causeOK + r.causeFAIL)
    const gapRow = (label: string, r: any, edges: number) => {
      const d = disp(r)
      const gap = edges - d
      if (gap === 0) return `${w(label, 14)} CLOSED — every edge in one printed bucket (${edges})`
      return `${w(label, 14)} ** ${gap} edge(s) UNACCOUNTED ** — ${edges} edges vs ${d} dispositioned` +
        ` (resolved ${r.resolved} · amb ${r.amb} · unres ${r.unres} · extOK ${r.extOK} · ext? ${r.extQ} · extFAIL ${r.extFAIL} · bindFAIL ${r.bindFAIL} · causeFAIL ${r.causeFAIL})`
    }
    console.log()
    console.log("CLOSURE — every edge must land in exactly one printed bucket (the goal: NO unknown edges):")
    for (const r of rows) { if (r.edges > 0) console.log("  " + gapRow(r.type, r, r.edges)) }
    if (total) console.log("  " + gapRow("TOTAL", total, total.edges))
  }
  console.log(`  "ofWhich" = resolved edges on a name with MORE THAN ONE declaration in the project — an`)
  console.log(`  UPPER BOUND on arbitrary bindings, not a count of them: both resolvers prefer the edge's own`)
  console.log(`  FILE second, so a collision the own file settles uniquely is determinate. Only the store can`)
  console.log(`  split it (the indexer measures 37,318 of 49,729 such picks as WRONG). 0 = no colliding name.`)
  console.log("-".repeat(112))
  for (const r of [...rows].sort((a, b) => (b.amb + b.unres) - (a.amb + a.unres))) {
    if (r.edges === 0) continue
    const resid = r.amb + r.unres + r.extFAIL + r.bindFAIL + r.causeFAIL
    const it = intent.get(r.type)
    const tail = intentBlockSeen ? "  " + w(it ? it.intended : "-", 9) + w(it ? it.arbitraryTwin : "-", 6) + w(it ? it.noDeclaration : "-", 7) : ""
    console.log(`${w(r.type, 14)} ${w(r.edges, 9)} ${w(r.resolved, 9)} ${w(r.ambColl ?? "-", 8)} ${w(r.amb, 10)} ${w(r.unres, 11)} ${w(r.extOK, 8)} ${w(r.extQ, 6)} ${w(r.extFAIL, 8)} ${w(r.bindFAIL, 9)} ${w(r.causeFAIL, 10)} ${w(((resid / r.edges) * 100).toFixed(1) + "%", 10)}${tail}`)
  }
  if (total) {
    const resid = total.amb + total.unres + total.extFAIL + total.bindFAIL + total.causeFAIL
    console.log("-".repeat(100))
    // `ofWhich` WAS OMITTED HERE while the header and every PER-TYPE row carried it, so the TOTAL's
    // values sat one column to the left from `amb(decl)` onward — for css that printed `ofWhich 180`
    // and `amb 80` when the truth is `ofWhich 0` (every type) and `amb 180` (all `references`). Found
    // while verifying css's completion package, whose `collRes 0 per type` claim the shifted TOTAL
    // appeared to contradict. **Fourth instance of one family** in this programme — a summary that does
    // not match its own columns: `ofWhich` before it was labelled an upper bound, `amb` before
    // `contains` was classified by its real resolver, the intent legend before it was scoped to
    // contains/exports, the incoming gate's TOTAL before `05bf9953d`, and now this one.
    //
    // The lesson is the same every time: **a summary is a claim and needs the same evidence as a
    // number.** A per-type table that is right does not make its TOTAL right.
    console.log(`${w("TOTAL", 14)} ${w(total.edges, 9)} ${w(total.resolved, 9)} ${w(total.ambColl ?? 0, 8)} ${w(total.amb, 10)} ${w(total.unres, 11)} ${w(total.extOK ?? 0, 8)} ${w(total.extQ ?? 0, 6)} ${w(total.extFAIL, 8)} ${w(total.bindFAIL, 9)} ${w(total.causeFAIL, 10)} ${w(((resid / total.edges) * 100).toFixed(1) + "%", 10)}`)
    console.log(`\nresolved ${((total.resolved / total.edges) * 100).toFixed(1)}%   residual ${resid} of ${total.edges}   ` +
      `extFAIL ${total.extFAIL}${total.extFAIL > 0 ? " (MUST BE 0)" : ""}  bindFAIL ${total.bindFAIL}${total.bindFAIL > 0 ? " (MUST BE 0)" : ""}  causeFAIL ${total.causeFAIL}${total.causeFAIL > 0 ? " (MUST BE 0)" : ""}`)
  }
  process.exit(0)
}

// ── fleet mode: the log's own counters, which is what the board reads
if (!existsSync(resolve(ROOT, INCOMING_LOG))) { console.error(`FATAL: no incoming log at ${INCOMING_LOG}`); process.exit(2) }
const sums = parseLog(readFileSync(resolve(ROOT, INCOMING_LOG), "utf8"))
if (JSON_MODE) { console.log(JSON.stringify({ gate: "residual-gate", source: INCOMING_LOG, lanes: sums }, null, 2)); process.exit(0) }
const w = (s: any, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
console.log(`residual gate — ${sums.length} lanes, from ${INCOMING_LOG}`)
console.log(`THE BAR: every emitted edge REAL, every ambiguity/unresolved attributed to a NAMED cause. extRefuted must be 0.\n`)
console.log(`${w("lane", 12)} ${w("edges", 11)} ${w("amb", 10)} ${w("unresolved", 11)} ${w("residual%", 10)} ${w("extRefuted", 11)} verdict`)
console.log("-".repeat(78))
const scored = sums.map((s) => {
  const resid = (s.amb ?? 0) + (s.unres ?? 0)
  const pct = s.edges ? (resid / s.edges) * 100 : null
  return { ...s, resid, pct }
}).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))
for (const s of scored) {
  console.log(`${w(s.lane, 12)} ${w(s.edges ?? "?", 11)} ${w(s.amb ?? "?", 10)} ${w(s.unres ?? "?", 11)} ${w(s.pct === null ? "?" : s.pct.toFixed(1) + "%", 10)} ${w(s.extRefuted ?? 0, 11)} ${s.verdict ?? "?"}`)
}
const refuted = scored.filter((s) => (s.extRefuted ?? 0) > 0)
const passing = scored.filter((s) => s.verdict === "PASS")
console.log()
console.log(`PASS ${passing.length}/${scored.length}   lanes with REFUTED external claims ${refuted.length}   ` +
  `mean residual ${(scored.reduce((a, s) => a + (s.pct ?? 0), 0) / scored.length).toFixed(1)}%`)
if (refuted.length) console.log(`REFUTED CLAIMS (each is a false statement the graph makes): ${refuted.map((s) => `${s.lane} ${s.extRefuted}`).join(" · ")}`)
console.log(`\nA lane is DONE at residual 0 with 0 refuted. Nothing here is a target to report — it is the worklist.`)
process.exit(refuted.length > 0 ? 1 : 0)
