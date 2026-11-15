// validation/m14/fixtures/elixir/el-marker-reachability.ts
//
// CAN THE ARBITER EXPRESS THE TOP CAUSE'S REASON? A RUN, not a reading.
//
// `ELIXIR-FIX.md` §3 rules the lane's 2,215-edge top cause NOT DOABLE, and the ruling rests on
// what the arbiter does with a claim on a COLON-PREFIXED owner. That is a property of
// `classifyEdge`/`externalClaimOf` (`script/m14/incoming-rule.ts`), so it is MEASURED here by
// calling those functions directly — the same code the gate calls — instead of quoting the prose
// beside them. Two POSITIVE CONTROLS are planted and must fire, or the instrument is broken:
//
//   * `baseBeyondRunScope: ":lists"` on `:lists.reverse`      MUST NOT be stated as a cause
//   * `baseBeyondRunScope: "Absinthe"` on `Absinthe.Phase`    MUST be stated as a cause
//
//   bun run validation/m14/fixtures/elixir/el-marker-reachability.ts
import { classifyEdge, externalClaimOf } from "../../../../script/m14/incoming-rule"

/** The key space of a project in which the four targets below are NOT declared. */
const decls = new Map<string, number>([["EEx.line", 1], ["EEx", 1]])
const kinds = new Map<string, Set<string>>([["EEx.line", new Set(["type"])], ["EEx", new Set(["module"])]])

type Case = { target: string; marker: Record<string, unknown>; note: string }
const CASES: Case[] = [
  // ── the controls ──────────────────────────────────────────────────────────────────────────
  { target: "Absinthe.Phase", marker: {}, note: "CONTROL — no marker: must be `unresolved`" },
  { target: "Absinthe.Phase", marker: { baseBeyondRunScope: "Absinthe" }, note: "CONTROL — dotted owner, cause spelled as the owner" },
  { target: ":lists.reverse", marker: { baseBeyondRunScope: ":lists" }, note: "TOP CAUSE — the owner as the arbiter computes it (`targetOwner` keeps the colon)" },
  { target: ":lists.reverse", marker: { baseBeyondRunScope: "lists" }, note: "TOP CAUSE — the owner with the colon stripped" },
  { target: ":lists.reverse", marker: { isExternal: true }, note: "TOP CAUSE — the generic external channel" },
  { target: ":lists.reverse", marker: { isExternalTarget: true }, note: "TOP CAUSE — the other generic external spelling" },
  { target: ":lists.reverse", marker: { isStdlib: true }, note: "TOP CAUSE — the stdlib channel other lanes use" },
  { target: ":code.del_path", marker: { isExternal: true }, note: "TOP CAUSE — `:code`, whose spelling coincides with Elixir `Code`" },
  // ── the second class, for contrast ────────────────────────────────────────────────────────
  { target: "Absinthe.Type", marker: { isExternal: true }, note: "STRIDE-HIDDEN dotted target, external channel" },
  { target: "gen_server", marker: { isExternal: true }, note: "OTP behaviour, BARE target, external channel" },
  { target: "indentation", marker: { isExternal: true }, note: "struct-field read, BARE target, external channel" },
  { target: "EEx.line", marker: { baseBeyondRunScope: "EEx" }, note: "CONTROL — a target the project DECLARES, marked with a cause" },
  { target: "EEx.line", marker: { baseBeyondRunScope: "EEx", isExternal: true }, note: "CONTROL — cause AND external (the conflicting pair)" },
]

console.log("MARKER REACHABILITY — what `classifyEdge` does with each claim on this lane's targets")
console.log("key space: EEx, EEx.line (so every target below names nothing here)\n")
let controls = 0
for (const c of CASES) {
  const claim = externalClaimOf({ metadata: c.marker })
  const r = classifyEdge(decls, kinds, c.target, claim, undefined, false, false)
  const claimText = claim === null ? "—" : claim.kind === "cause" ? `cause(base=${JSON.stringify((claim as any).base)}${(claim as any).conflict ? ",CONFLICT" : ""})` : claim.kind
  console.log(`  ${String(r.outcome).padEnd(18)} ${c.target.padEnd(20)} claim ${String(claimText).padEnd(34)} ${c.note}`)
  if (c.note.includes("CONTROL")) controls++
}
console.log(`\n  ${controls} control(s) printed. The top cause's rows are the finding: no marker in the`)
console.log(`  arbiter's vocabulary states a reason for a COLON-PREFIXED owner — \`targetOwner\` keeps the`)
console.log(`  colon, the cause check wants [A-Za-z_$][A-Za-z0-9_$]*, and the external check calls any`)
console.log(`  target containing ':' PATH-LIKE and returns unverified.`)
