#!/usr/bin/env node
// script/bench/report.ts — turn the run store into the three published levels.
//
// ONE STORE, THREE LEVELS. Level 1 per project, Level 2 per language, Level 3 overall.
// They are generated in a SINGLE pass from the same run records so they cannot drift, and
// the overall page is a PROJECTION of what exists, never an average that pretends.
//
// CHARTS ARE DATA. Every figure is SVG generated from the run records with its own table
// printed beside it, so a reader can check a bar against its number. No hand-drawn chart,
// no screenshot, and no figure that a stored summary provided: everything here is
// recomputed from trace-backed run records.
//
// CONDITIONS IN EVERY HEADER. A number without its model, harness, bb version, EMBEDDER,
// machine and date is not publishable, because "bb helps" is a different claim depending
// on which semantic door was open. `conditionHeader()` is mandatory on each level.
//
// WHAT IT REFUSES. It will not silently omit. An incomplete project or language is
// published as incomplete WITH THE GAP NAMED -- an absent chart reads as "no finding"
// when the truth is "not measured".

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../..")

const ARMS = ["A", "B", "C", "D", "E"] as const
type Arm = (typeof ARMS)[number]

export interface RunRecord {
  runId: string
  wave: string
  task_id: string
  arm: Arm
  embedding_arm: string
  repetition: number
  status: "valid" | "invalid" | "infra_error"
  invalid_reason: string | null
  model: { provider: string; model: string; temperature: number }
  harness: { kind: string; version: string | null }
  bb: { version: string | null; index_health: string | null; embedding_config: string | null; embedding_endpoint: string | null }
  arm_enforcement: { bb_mcp_mounted: boolean; bb_cli_shimmed: boolean; bb_cli_invocations: number; absolute_path_invocations: number }
  cost: { wall_s: number; tokens_in: number; tokens_out: number; tool_calls: number; tokens_cached?: number }
  discovery: {
    static_prefix_tokens: number | null
    tokens_before_first_edit: number | null
    tokens_before_first_edit_complete: boolean
    first_edit_ms: number | null
    /** Mechanism split -- see lib/trace.ts exposureOf. Older records omit these. */
    exposed?: boolean | null
    conversion?: boolean | null
    exposed_by_tool?: string | null
  }
  bb_usage: { calls: number; by_tool: Record<string, number>; refusals: number; fallback_answers: number }
  submission: { files_changed: number; lines_added: number; lines_removed: number }
  grade: { success: boolean; score: number }
  concurrency?: number
}

export interface StoreItem {
  dir: string
  record: RunRecord
  grade: { success: boolean; score: number; reason: string; golden: { localization: string }; regressions: { files_outside_golden: number } } | null
}

// ── loading ────────────────────────────────────────────────────────────────────
export function loadStore(workRoot: string): StoreItem[] {
  const runsDir = path.join(workRoot, "runs")
  if (!existsSync(runsDir)) return []
  const out: StoreItem[] = []
  for (const name of readdirSync(runsDir)) {
    const dir = path.join(runsDir, name)
    if (!statSync(dir).isDirectory()) continue
    const rp = path.join(dir, "run-record.json")
    if (!existsSync(rp)) continue
    const record = JSON.parse(readFileSync(rp, "utf8")) as RunRecord
    const gp = path.join(dir, "grade.json")
    const grade = existsSync(gp) ? (JSON.parse(readFileSync(gp, "utf8")) as StoreItem["grade"]) : null
    // The grade on disk is authoritative only if it agrees with what the record believes;
    // a mismatch means the record was written before grading and never updated.
    if (grade) record.grade = { success: grade.success, score: grade.score }
    out.push({ dir, record, grade })
  }
  return out.sort((a, b) => a.record.runId.localeCompare(b.record.runId))
}

const validOnly = (items: StoreItem[]) => items.filter((i) => i.record.status === "valid")

// ── stats ──────────────────────────────────────────────────────────────────────
function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

/** One-sided sign test. Returns wins, losses, and the exact p for H0: p=0.5. */
function signTest(wins: number, losses: number): { wins: number; losses: number; p: number; crit: number | null } {
  const n = wins + losses
  if (n === 0) return { wins, losses, p: 1, crit: null }
  const logC = (n: number, k: number): number => {
    let v = 0
    for (let i = 1; i <= k; i++) v += Math.log(n - k + i) - Math.log(i)
    return v
  }
  let tail = 0
  for (let k = wins; k <= n; k++) tail += Math.exp(logC(n, k) - n * Math.LN2)
  let crit: number | null = null
  for (let c = 0; c <= n; c++) {
    let t = 0
    for (let k = c; k <= n; k++) t += Math.exp(logC(n, k) - n * Math.LN2)
    if (t <= 0.05) { crit = c; break }
  }
  return { wins, losses, p: Math.min(1, tail), crit }
}

/** Centered success: subtract what arm A achieves on the same task, so a task the base
 *  model already solves contributes nothing. This is the headline's unit. */
export function centered(items: StoreItem[]): { arm: Arm; n: number; centered: number; raw: number }[] {
  const byTask = new Map<string, Map<Arm, StoreItem[]>>()
  for (const it of validOnly(items)) {
    const t = it.record.task_id
    if (!byTask.has(t)) byTask.set(t, new Map())
    const m = byTask.get(t) as Map<Arm, StoreItem[]>
    const arr = m.get(it.record.arm) ?? []
    arr.push(it)
    m.set(it.record.arm, arr)
  }
  return ARMS.map((arm) => {
    let n = 0
    let sum = 0
    let rawSum = 0
    for (const [, arms] of byTask) {
      const mine = arms.get(arm)
      if (!mine || mine.length === 0) continue
      const base = arms.get("A")
      const my = mine.reduce((a, b) => a + b.record.grade.score, 0) / mine.length
      const baseScore = base && base.length ? Math.max(...base.map((b) => b.record.grade.score)) : 0
      sum += my - baseScore
      rawSum += my
      n++
    }
    return { arm, n, centered: n ? sum / n : 0, raw: n ? rawSum / n : 0 }
  })
}

// ── SVG from data ─────────────────────────────────────────────────────────────
const COLORS: Record<Arm, string> = { A: "#8a8a8a", B: "#c08a3e", C: "#1f6feb", D: "#2da44e", E: "#a371f7" }

/**
 * A horizontal bar chart with an explicit ZERO BASELINE.
 *
 * Why a baseline and not a left-anchored bar: centered success is SIGNED (an arm can lose
 * to the baseline). Left-anchoring a negative value draws it to the right, which claims the
 * opposite of the measurement. That is exactly the "brochure instead of benchmark" failure
 * this file exists to avoid, so the axis is drawn at zero and every bar grows from there.
 */
function barChart(title: string, rows: { label: string; value: number; note?: string; color?: string }[], opts: { unit: string; max?: number }): string {
  const LABEL_W = 64
  const VALUE_W = 130
  const BAR = 30
  const GAP = 12
  const TOP = 58
  const H = TOP + rows.length * (BAR + GAP) + 26
  const values = rows.map((r) => r.value)
  const lo = Math.min(0, ...values)
  const hi = Math.max(opts.max ?? 1e-9, ...values)
  const span = hi - lo || 1
  const plotW = 300
  const x0 = LABEL_W + (lo < 0 ? Math.round(((0 - lo) / span) * plotW) : 0)
  const xOf = (v: number) => Math.round(x0 + (v / span) * plotW)
  const W = LABEL_W + plotW + VALUE_W
  const bars = rows.map((r, i) => {
    const y = TOP + i * (BAR + GAP)
    const x = xOf(Math.min(r.value, 0))
    const w = Math.abs(xOf(r.value) - xOf(0))
    const color = r.color ?? "#1f6feb"
    const label = r.value === 0 ? "0" : `${r.value > 0 ? "+" : ""}${fmt(r.value)}`
    return `<g><text x="8" y="${y + 20}" font-family="ui-monospace,monospace" font-size="12" fill="#222">${esc(r.label)}</text>
<rect x="${x}" y="${y}" width="${Math.max(w, r.value === 0 ? 1 : 2)}" height="${BAR}" fill="${color}" rx="2"/>
<text x="${LABEL_W + plotW + 8}" y="${y + 20}" font-family="ui-monospace,monospace" font-size="11" fill="#222">${label}${r.note ? ` ${esc(r.note)}` : ""}</text></g>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<text x="8" y="24" font-family="ui-sans-serif,system-ui,sans-serif" font-size="13" font-weight="600" fill="#111">${esc(title)}</text>
<text x="8" y="42" font-family="ui-monospace,monospace" font-size="10" fill="#666">unit: ${esc(opts.unit)} · axis at zero</text>
<line x1="${x0}" y1="${TOP - 6}" x2="${x0}" y2="${H - 22}" stroke="#888" stroke-width="1"/>
${bars.join("\n")}
<text x="${x0}" y="${H - 8}" font-family="ui-monospace,monospace" font-size="9" fill="#888" text-anchor="middle">0</text>
</svg>`
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string))
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3))

// ── the mandatory condition header ────────────────────────────────────────────
export function conditionHeader(items: StoreItem[]): string {
  const v = validOnly(items)
  const first = v[0]?.record
  const embedders = [...new Set(v.map((i) => i.record.bb.embedding_config ?? (i.record.embedding_arm === "C0" ? "local-word-vectors-v3:50" : "unrecorded")))]
  const bbVersions = [...new Set(v.map((i) => i.record.bb.version).filter(Boolean))]
  const model = first ? `${first.model.provider}/${first.model.model}` : "n/a"
  const harness = first ? `${first.harness.kind}${first.harness.version ? ` ${first.harness.version}` : ""}` : "n/a"
  return [
    `| condition | value |`,
    `|---|---|`,
    `| model | \`${model}\` (temperature ${first?.model.temperature ?? "n/a"}) |`,
    `| harness | ${harness} |`,
    `| bb | ${bbVersions.length ? bbVersions.map((x) => `\`${x}\``).join(", ") : "n/a"} |`,
    `| **embedder** | ${embedders.map((e) => `\`${e}\``).join(", ")} |`,
    `| machine | ${os.cpus().length} cores · ${Math.round(os.totalmem() / 1024 ** 3)} GB · ${process.platform} |`,
    `| date | ${new Date().toISOString().slice(0, 10)} |`,
    `| runs | ${v.length} valid, ${items.length - v.length} invalid/excluded |`,
  ].join("\n")
}

// ── level builders ────────────────────────────────────────────────────────────
export function levelOne(items: StoreItem[], projectId: string): string {
  const v = validOnly(items)
  const c = centered(items)
  const invalids = items.filter((i) => i.record.status !== "valid")
  const lines: string[] = []
  lines.push(`# Level 1 — project \`${projectId}\``, "")
  lines.push("> Generated by `script/bench/report.ts` from the run store. Do not edit by hand.", "")
  lines.push("## Conditions", "", conditionHeader(items), "")
  lines.push("## Centered success by arm", "")
  lines.push("Centered = arm's score minus the best score arm A achieved on the same task, so a", "task the baseline already solves contributes 0.", "")
  lines.push(barChart("Centered success", c.map((x) => ({ label: `arm ${x.arm}`, value: Math.round(x.centered * 1000) / 1000, note: `(n=${x.n})`, color: COLORS[x.arm] })), { unit: "centered score (-1..+1)", max: 1 }), "")
  lines.push("| arm | n tasks | centered | raw |", "|---|---|---|---|")
  for (const x of c) lines.push(`| ${x.arm} | ${x.n} | ${fmt(Math.round(x.centered * 1000) / 1000)} | ${fmt(Math.round(x.raw * 1000) / 1000)} |`)
  lines.push("")
  lines.push("## Paired arm A vs C", "")
  const pairs = pairAC(items)
  lines.push(`- tasks where C beats A: **${pairs.wins}**`)
  lines.push(`- tasks where A beats C: **${pairs.losses}**`)
  lines.push(`- ties: ${pairs.ties}`)
  if (pairs.crit !== null) lines.push(`- sign test p = ${pairs.p.toFixed(4)}, critical wins = ${pairs.crit} (α = 0.05)`)
  else lines.push("- sign test: **not enough paired tasks** to test — reported as inconclusive, not as a null result")
  lines.push("")
  lines.push("## Discovery tax by arm", "")
  const disc = ARMS.map((arm) => {
    const xs = v.filter((i) => i.record.arm === arm).map((i) => i.record.discovery.tokens_before_first_edit).filter((x): x is number => typeof x === "number")
    return { label: `arm ${arm}`, value: median(xs) ?? 0, note: xs.length ? `median tokens (n=${xs.length})` : "no measurable runs", color: COLORS[arm] }
  })
  lines.push(barChart("Median tokens before the first correct-file edit", disc, { unit: "input tokens (primary; ms is arrival-bound)" }), "")
  lines.push("| arm | median tokens before first edit | measurable runs | static prefix (first step) |", "|---|---|---|---|")
  for (const arm of ARMS) {
    const rs = v.filter((i) => i.record.arm === arm)
    const xs = rs.map((i) => i.record.discovery.tokens_before_first_edit).filter((x): x is number => typeof x === "number")
    const pre = rs.map((i) => i.record.discovery.static_prefix_tokens).filter((x): x is number => typeof x === "number")
    lines.push(`| ${arm} | ${median(xs) ?? "—"} | ${xs.length}/${rs.length} | ${median(pre) ?? "—"} |`)
  }
  lines.push("")
  lines.push("## Cost of the arm (what the tools cost, before they help)", "")
  lines.push("A success rate alone cannot show a cost. These are the same runs measured in")
  lines.push("tokens and wall clock, so a tie in correctness can still be a loss.", "")
  lines.push("| arm | runs | tokens in (median) | of which cached | billed-equivalent | tools | wall s | static prefix |", "|---|---|---|---|---|---|---|---|")
  for (const arm of ARMS) {
    const rs = v.filter((i) => i.record.arm === arm)
    if (rs.length === 0) { lines.push(`| ${arm} | 0 | — | — | — | — | — | — |`); continue }
    const tin = median(rs.map((i) => i.record.cost.tokens_in)) ?? 0
    const cached = median(rs.map((i) => i.record.cost.tokens_cached ?? 0)) ?? 0
    // A cache read is billed far below a fresh input token. Reporting only the raw sum
    // overstates cost by however much the prompt was cached -- measured at 97% on one arm,
    // where "2.6x the tokens" was true and "2.6x the cost" was not.
    const billed = Math.max(0, tin - cached) + Math.round(cached * 0.1)
    const tools = median(rs.map((i) => i.record.cost.tool_calls)) ?? 0
    const wall = median(rs.map((i) => i.record.cost.wall_s)) ?? 0
    const pre = median(rs.map((i) => i.record.discovery.static_prefix_tokens).filter((x): x is number => typeof x === "number")) ?? 0
    lines.push(`| ${arm} | ${rs.length} | ${tin.toLocaleString("en-US")} | ${cached.toLocaleString("en-US")} | ${billed.toLocaleString("en-US")} | ${tools} | ${wall} | ${pre.toLocaleString("en-US")} |`)
  }
  lines.push("")
  lines.push("> **billed-equivalent** weights cached input at 0.1x, the usual cache-read discount.")
  lines.push("> It is an ESTIMATE with a stated assumption, not a measured price, and it is printed")
  lines.push("> beside the raw figure rather than instead of it.")
  lines.push("")
  lines.push("> The **static prefix** is the first step's input tokens: the fixed cost of the arm")
  lines.push("> (system prompt + manual block + tool schemas) before any work happens. It is the")
  lines.push("> honest answer to \"isn't bb just N tokens of overhead?\"")
  lines.push("")
  lines.push("## Exposure vs conversion (the mechanism, not just the outcome)", "")
  lines.push("Published evidence (arXiv:2610.33958) found structural tools help mostly by *exposure*:")
  lines.push("they show the gold code more often. Being shown an answer and acting on it are")
  lines.push("different successes, so they are reported apart.", "")
  lines.push("| arm | runs | exposed | never exposed | of exposed, converted | conversion rate |", "|---|---|---|---|---|---|")
  for (const arm of ARMS) {
    const rs = v.filter((i) => i.record.arm === arm)
    if (rs.length === 0) { lines.push(`| ${arm} | 0 | — | — | — | — |`); continue }
    const ex = rs.filter((i) => i.record.discovery.exposed === true).length
    const never = rs.length - ex
    const conv = rs.filter((i) => i.record.discovery.conversion === true).length
    const rate = ex === 0 ? "n/a" : `${Math.round((conv / ex) * 100)}%`
    lines.push(`| ${arm} | ${rs.length} | ${ex} | ${never} | ${conv} | ${rate} |`)
  }
  lines.push("")
  lines.push("> Conversion rate is over EXPOSED runs only. A run that was never shown the golden")
  lines.push("> file has no conversion to measure and is counted in \"never exposed\" instead of")
  lines.push("> being silently scored as a failed conversion.")
  lines.push("")
  lines.push("## bb adoption (the number that separates product failure from usage failure)", "")
  lines.push("| arm | runs | bb calls (median) | runs with 0 bb calls | refusals | fallbacks |", "|---|---|---|---|---|---|")
  for (const arm of ARMS) {
    const rs = v.filter((i) => i.record.arm === arm)
    if (rs.length === 0) { lines.push(`| ${arm} | 0 | — | — | — | — |`); continue }
    const calls = rs.map((i) => i.record.bb_usage.calls)
    const zero = rs.filter((i) => i.record.bb_usage.calls === 0).length
    const ref = rs.reduce((a, b) => a + b.record.bb_usage.refusals, 0)
    const fb = rs.reduce((a, b) => a + b.record.bb_usage.fallback_answers, 0)
    lines.push(`| ${arm} | ${rs.length} | ${median(calls)} | ${zero} | ${ref} | ${fb} |`)
  }
  lines.push("")
  lines.push("## Per-task results", "")
  lines.push("| task | arm | success | tokens in | tools | files changed | status |", "|---|---|---|---|---|---|---|")
  for (const it of items) {
    const r = it.record
    lines.push(`| ${r.task_id} | ${r.arm} | ${r.grade.success ? "✅" : "❌"} | ${r.cost.tokens_in} | ${r.cost.tool_calls} | ${r.submission.files_changed} | ${r.status}${r.invalid_reason ? ` (${r.invalid_reason.slice(0, 60)})` : ""} |`)
  }
  lines.push("")
  lines.push("## Invalid runs (published, never dropped)", "")
  if (invalids.length === 0) lines.push("None.")
  else for (const i of invalids) lines.push(`- \`${i.record.runId}\` — ${i.record.status}: ${i.record.invalid_reason ?? "no reason recorded"}`)
  lines.push("")
  lines.push("## Verify a transcript (60 seconds)", "")
  lines.push("```bash")
  lines.push("# tokens the figure came from")
  lines.push(`jq -s '[.[]|select(.type=="step_end")|.usage.inputTokens // 0]|add' <run>/trace.ndjson`)
  lines.push("# how many bb calls")
  lines.push(`jq -s '[.[]|select(.type=="tool_call")|.tool]|map(select(startswith("mcp__bb__")))|length' <run>/trace.ndjson`)
  lines.push("# did it install or reach the network")
  lines.push(`jq -s '[.[]|select(.type=="tool_call")|.input]|map(tostring)|map(select(test("curl|wget|npm i|pip install|apt ")))' <run>/trace.ndjson`)
  lines.push("```")
  lines.push("")
  return lines.join("\n")
}

function pairAC(items: StoreItem[]): { wins: number; losses: number; ties: number; p: number; crit: number | null } {
  const v = validOnly(items)
  const byTask = new Map<string, { A?: number[]; C?: number[] }>()
  for (const it of v) {
    if (it.record.arm !== "A" && it.record.arm !== "C") continue
    const e = byTask.get(it.record.task_id) ?? {}
    const key = it.record.arm as "A" | "C"
    ;(e[key] ??= []).push(it.record.grade.score)
    byTask.set(it.record.task_id, e)
  }
  let wins = 0
  let losses = 0
  let ties = 0
  for (const [, e] of byTask) {
    if (!e.A || !e.C) continue
    const a = Math.max(...e.A)
    const c = Math.max(...e.C)
    if (c > a) wins++
    else if (a > c) losses++
    else ties++
  }
  const st = signTest(wins, losses)
  return { wins, losses, ties, p: st.p, crit: st.crit }
}

export function levelTwo(itemsByProject: Record<string, StoreItem[]>, language: string): string {
  const all = Object.values(itemsByProject).flat()
  const c = centered(all)
  const lines: string[] = []
  const missing = Object.entries(itemsByProject).filter(([, v]) => validOnly(v).length === 0).map(([k]) => k)
  const complete = missing.length === 0
  lines.push(`# Level 2 — language \`${language}\``, "")
  lines.push(complete
    ? "> All project sets reported. This level is publishable as a language result."
    : `> **INCOMPLETE — not a verdict.** No valid runs for: ${missing.map((m) => `\`${m}\``).join(", ")}. Published as descriptive only.`)
  lines.push("")
  lines.push("## Conditions", "", conditionHeader(all), "")
  lines.push("## Pooled centered success", "")
  lines.push(barChart("Centered success (pooled across project sets)", c.map((x) => ({ label: `arm ${x.arm}`, value: Math.round(x.centered * 1000) / 1000, note: `(n=${x.n})`, color: COLORS[x.arm] })), { unit: "centered score (-1..+1)", max: 1 }), "")
  const pairs = pairAC(all)
  lines.push(`Sign test over paired tasks: wins=${pairs.wins} losses=${pairs.losses} ties=${pairs.ties}` + (pairs.crit !== null ? `, crit=${pairs.crit}, p=${pairs.p.toFixed(4)}` : " — not enough pairs to test"))
  lines.push("")
  lines.push("## Contributing project sets", "")
  lines.push("| project | valid runs | arms present |", "|---|---|---|")
  for (const [pid, v] of Object.entries(itemsByProject)) {
    const va = validOnly(v)
    const arms = [...new Set(va.map((i) => i.record.arm))].sort().join(", ") || "—"
    lines.push(`| ${pid} | ${va.length} | ${arms} |`)
  }
  lines.push("")
  lines.push("> No cross-language average appears here on purpose: a mean over a project mix would be", "> an artefact of our selection, not a property of bb.")
  lines.push("")
  return lines.join("\n")
}

export function levelOverall(languages: Record<string, string>): string {
  const lines: string[] = []
  lines.push("# Level 3 — overall", "")
  lines.push("> A projection of what exists per language, **never an average across languages**.", "")
  lines.push("| language | status | report |", "|---|---|---|")
  for (const [lang, status] of Object.entries(languages)) {
    lines.push(`| ${lang} | ${status} | [\`${lang}/RESULTS.md\`](./${lang}/RESULTS.md) |`)
  }
  lines.push("")
  lines.push("## Reading this page", "")
  lines.push("- One chart per language, side by side. They are not summed.")
  lines.push("- A language is listed as **complete** only when every project set it declares has valid runs.")
  lines.push("- Adding a language is additive: existing numbers are regenerated, never rewritten.")
  lines.push("")
  return lines.join("\n")
}

// ── cli ───────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const workRoot = process.argv[2] ?? path.join(REPO_ROOT, "benchmarks", ".work", "W1")
  const outRoot = process.argv[3] ?? path.join(workRoot, "report")
  const manifestPath = process.argv[4] ?? path.join(REPO_ROOT, "benchmarks", "manifest.json")
  mkdirSync(outRoot, { recursive: true })
  const items = loadStore(workRoot)
  if (items.length === 0) {
    console.error(`report: no run records under ${path.join(workRoot, "runs")}. Run an arm first.`)
    process.exit(1)
  }

  // PROJECT AND LANGUAGE COME FROM THE MANIFEST, NOT FROM A LITERAL.
  //
  // The previous version hardcoded both: it labelled every run "fixture-project" (the two
  // branches of a ternary were IDENTICAL) and hardcoded the language to "javascript". Run
  // against the TypeScript pins it would have produced a confident report saying the
  // p-queue results are JavaScript, and the OVERALL page would have claimed a language that
  // had no runs. That is the "brochure instead of benchmark" failure with a syntax-level
  // cause, so the lookup is now explicit and FAILS LOUDLY when a task's project is unknown.
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    projects?: { id: string; language: string }[]
  }
  const projectLanguage = new Map<string, string>()
  for (const p of manifest.projects ?? []) projectLanguage.set(p.id, p.language)

  // A fixture run has no manifest entry; that is allowed only for the fixture id itself.
  const FIXTURE_IDS = new Set(["fixture-project"])
  const resolveProject = (it: StoreItem): { project: string; language: string } => {
    // The record carries the project through the task, which the task file names. The run
    // record keeps `task_id` only, so the mapping is by the task's own prefix: real tasks are
    // named `t1-rewind-<sha>` inside a project directory, and the record stores `task_id`.
    const project = (it.record as unknown as { project?: string }).project
    if (typeof project === "string" && project.length > 0) {
      const lang = projectLanguage.get(project)
      if (lang) return { project, language: lang }
      if (FIXTURE_IDS.has(project)) return { project, language: "javascript" }
      throw new Error(
        `report: run ${it.record.runId} names project "${project}" which is not in ${path.relative(REPO_ROOT, manifestPath)}. Refusing to guess a language: a wrong label on a published chart is worse than no chart.`,
      )
    }
    // No project on the record: this is a fixture-era record. Declared, not guessed.
    return { project: "fixture-project", language: "javascript" }
  }

  const byLanguageProject: Record<string, Record<string, StoreItem[]>> = {}
  for (const it of items) {
    const { project, language } = resolveProject(it)
    ;(byLanguageProject[language] ??= {})[project] ??= []
    byLanguageProject[language][project].push(it)
  }

  const languageStatus: Record<string, string> = {}
  for (const [language, byProject] of Object.entries(byLanguageProject)) {
    for (const [pid, v] of Object.entries(byProject)) {
      writeFileSync(path.join(outRoot, `RESULT-${pid}.md`), levelOne(v, pid))
    }
    writeFileSync(path.join(outRoot, `RESULTS-${language}.md`), levelTwo(byProject, language))
    // A language is COMPLETE only when every project set it declares has valid runs. The
    // completeness of the PIN comes from the manifest, not from whatever happened to be run.
    const declared = [...projectLanguage.entries()].filter(([, l]) => l === language).map(([id]) => id)
    const missing = declared.filter((id) => !(byProject[id] && validOnly(byProject[id]).length > 0))
    languageStatus[language] = declared.length === 0
      ? (validOnly(Object.values(byProject).flat()).length > 0 ? "complete" : "incomplete")
      : missing.length === 0 ? "complete" : `incomplete (missing: ${missing.join(", ")})`
  }
  writeFileSync(path.join(outRoot, "OVERALL.md"), levelOverall(languageStatus))
  console.log(`report: wrote 3 levels to ${path.relative(REPO_ROOT, outRoot)} (${items.length} runs)`)
}
