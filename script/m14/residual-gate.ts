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
function runLane(lang: string): { rows: Array<{ type: string; edges: number; resolved: number; amb: number; ambKind: number; unres: number; extOK: number; extQ: number; extFAIL: number; bindOK: number; bindQ: number; bindFAIL: number; causeOK: number; causeFAIL: number }>; total: any } {
  const ext = { fsharp: "fs", zig: "zig", lua: "lua", julia: "jl", nim: "nim", php: "php", powershell: "ps1", r: "r", dart: "dart", sql: "sql", graphql: "graphql", protobuf: "proto", json: "json", yaml: "yaml,yml", css: "css", scss: "scss", hcl: "tf", make: "mk", toml: "toml", xml: "xml", markdown: "md", clean: "icl", bash: "sh" }[lang] ?? lang
  const out = execFileSync("npx", ["tsx", "script/m14/incoming-gate.ts", lang, ext, "0"], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] })
  const rows: any[] = []
  let total: any = null
  for (const line of out.split("\n")) {
    const t = line.trim()
    const parts = t.split(/\s+/)
    if (parts.length < 14) continue
    if (!TYPES.includes(parts[0]) && parts[0] !== "TOTAL") continue
    const nums = parts.slice(1).map((x) => Number(x.replace(/,/g, "")))
    if (nums.some((n) => !Number.isFinite(n))) continue
    const r = { type: parts[0], edges: nums[0], resolved: nums[1], amb: nums[2], ambKind: nums[3], unres: nums[4], extOK: nums[5], extQ: nums[6], extFAIL: nums[7], bindOK: nums[8], bindQ: nums[9], bindFAIL: nums[10], causeOK: nums[11], causeFAIL: nums[12] }
    if (parts[0] === "TOTAL") total = r; else rows.push(r)
  }
  return { rows, total }
}

const argv = process.argv.slice(2)
const JSON_MODE = argv.includes("--json")
const LANE = argv.includes("--lane") ? argv[argv.indexOf("--lane") + 1] : null

if (LANE) {
  const { rows, total } = runLane(LANE)
  if (JSON_MODE) { console.log(JSON.stringify({ gate: "residual-gate", lane: LANE, rows, total }, null, 2)); process.exit(0) }
  const w = (s: any, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
  console.log(`residual gate — ${LANE}, WHOLE admitted population, production scope\n`)
  console.log(`${w("type", 14)} ${w("edges", 9)} ${w("resolved", 9)} ${w("amb(decl)", 10)} ${w("unresolved", 11)} ${w("extFAIL", 8)} ${w("bindFAIL", 9)} ${w("causeFAIL", 10)} ${w("residual%", 10)}`)
  console.log("-".repeat(100))
  for (const r of [...rows].sort((a, b) => (b.amb + b.unres) - (a.amb + a.unres))) {
    if (r.edges === 0) continue
    const resid = r.amb + r.unres + r.extFAIL + r.bindFAIL + r.causeFAIL
    console.log(`${w(r.type, 14)} ${w(r.edges, 9)} ${w(r.resolved, 9)} ${w(r.amb, 10)} ${w(r.unres, 11)} ${w(r.extFAIL, 8)} ${w(r.bindFAIL, 9)} ${w(r.causeFAIL, 10)} ${w(((resid / r.edges) * 100).toFixed(1) + "%", 10)}`)
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
