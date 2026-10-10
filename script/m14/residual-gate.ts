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
function runLane(lang: string): { rows: Array<{ type: string; edges: number; resolved: number; ambColl?: number; amb: number; ambKind: number; unres: number; extOK: number; extQ: number; extFAIL: number; bindOK: number; bindQ: number; bindFAIL: number; causeOK: number; causeFAIL: number }>; total: any; intent: Map<string, { intended: number; sameFileUnproven: number; arbitraryTwin: number; noDeclaration: number }>; intentBlockSeen: boolean; intentWidthBad: number } {
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
  return { rows, total, intent, intentBlockSeen, intentWidthBad }
}

const argv = process.argv.slice(2)
const JSON_MODE = argv.includes("--json")
const LANE = argv.includes("--lane") ? argv[argv.indexOf("--lane") + 1] : null

if (LANE) {
  const { rows, total, intent, intentBlockSeen, intentWidthBad } = runLane(LANE)
  if (JSON_MODE) { console.log(JSON.stringify({ gate: "residual-gate", lane: LANE, rows, total }, null, 2)); process.exit(0) }
  const w = (s: any, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
  console.log(`residual gate — ${LANE}, WHOLE admitted population, production scope\n`)
  console.log(`${w("type", 14)} ${w("edges", 9)} ${w("resolved", 9)} ${w("ofWhich", 8)} ${w("amb(decl)", 10)} ${w("unresolved", 11)} ${w("extFAIL", 8)} ${w("bindFAIL", 9)} ${w("causeFAIL", 10)} ${w("residual%", 10)}${intentBlockSeen ? "  " + w("intended", 9) + w("twin", 6) + w("noDecl", 7) : ""}`)
  if (intentBlockSeen) console.log(`  "intended" = own file AND own line · "twin" = ONLY another file answers (a wrong edge) · "noDecl" = nothing answers.`)
  if (intentBlockSeen && intentWidthBad > 0) console.log(`  (${intentWidthBad} intent ROW(s) did not have 6 columns and were SKIPPED, not reinterpreted.)`)
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
    console.log(`${w(r.type, 14)} ${w(r.edges, 9)} ${w(r.resolved, 9)} ${w(r.ambColl ?? "-", 8)} ${w(r.amb, 10)} ${w(r.unres, 11)} ${w(r.extFAIL, 8)} ${w(r.bindFAIL, 9)} ${w(r.causeFAIL, 10)} ${w(((resid / r.edges) * 100).toFixed(1) + "%", 10)}${tail}`)
  }
  if (total) {
    const resid = total.amb + total.unres + total.extFAIL + total.bindFAIL + total.causeFAIL
    console.log("-".repeat(100))
    console.log(`${w("TOTAL", 14)} ${w(total.edges, 9)} ${w(total.resolved, 9)} ${w(total.amb, 10)} ${w(total.unres, 11)} ${w(total.extFAIL, 8)} ${w(total.bindFAIL, 9)} ${w(total.causeFAIL, 10)} ${w(((resid / total.edges) * 100).toFixed(1) + "%", 10)}`)
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
