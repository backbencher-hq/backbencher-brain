// script/m13/verify-security-handler.ts — bb_security handler, bounds and the M72 lead contract.
//
// Two layers:
//   1. THE LEAD-CONTRACT ANSWER — the Phase-1 (M72) live read is the default
//      path: the handler reads the spec-engine store (`brain_security_flow`),
//      not the retired token table. What this file pins, in the order an agent
//      reads the answer:
//        * line 1 is the honesty banner, line 2 is the registry's own tier
//          declaration (`formatSecurityTierDeclaration()`), line 3+ is the
//          per-project declaration (an unsupported language says "not scanned by
//          bb_security", never a clean zero);
//        * a stored lead renders as `[exec|high|medium|low] lead: <label> @
//          file:line <- source:<line>; rule=<rule>; symbol=<name>` — never as a
//          finding, never with `[critical]`, never with `confirmed` claims;
//        * an indexed project with no stored leads says "declared empty, not a
//          clean result", so absence of leads is not sold as absence of risk;
//        * pagination is declared: `showing N of TOTAL; offset; page size`, and
//          the last page says no more is available; offset past the end is an
//          empty PAGE, not an empty project;
//        * recordRun is the one write and persists the whole store census
//          (`N leads recorded`), while the history page is a capped page with its
//          true total declared.
//   2. HANDLER BEHAVIOUR — the declared bounds are exercised through the tool's
//      own handler and its real CLI door: the read-only guarantee (a dropped
//      healing index must STILL be missing, the database bytes unchanged), the
//      unindexed-project refusal at the library door, determinism, and manual
//      staleness.
//
// The retired (`BB_SECURITY_LEGACY=1`) token path is NOT asserted here: its
// answer is pinned by script/m15/verify-security-regressions.ts under the
// explicit rollback switch, and the default store/engine contract is pinned by
// this file + script/m20/verify-security-history.ts + script/m72/**.
//
// Run: npx tsx script/m13/verify-security-handler.ts   (bun run … also works)
// Exit: non-zero if any assertion failed.

import { existsSync, mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import type { ToolContext } from "../../src/mcp/tools/shared"
import { formatSecurityTierDeclaration } from "../../src/intelligence/security/rebuild/registry"
import { SECURITY_BANNER, checkSecurityAnswerContract, checkProjectWideSecurityAnswer } from "../m72/lib/security-answer-contract"
import { Harness } from "./harness"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
// Self-contained data dir: the suite must not depend on the caller exporting one
// (the shared HOME is read-only in sandboxes, where every fixture gate used to
// die on mkdir $HOME/.bb/projects before asserting anything).
if (!process.env.BB_DATA_DIR) process.env.BB_DATA_DIR = path.join(rootDir, "validation", "tools", "bb_security", "bbdata")
process.env.BB_NO_AUTO_REFRESH = "1"

const harness = new Harness({
  issue: "M13.41",
  code: "Sec2",
  tool: "bb_security",
  title: "bb_security: M72 lead-contract answer, declared bounds, and read-only reads",
  layers: ["unit", "integration", "e2e"],
  decisions: {
    leadContract: "answer = banner + registry tier line + per-project declaration + `[grade] lead:` lines + declared pagination",
    truthfulness: "unsupported languages say 'not scanned'; an indexed project with no leads says 'declared empty, not a clean result'",
    boundsExercised: "live page (limit/offset), past-end empty page, census-sized recordRun, declared history page cap",
    readOnlyRead: "a CLI read must not heal the database or move its bytes",
    retiredPath: "the old token engine's answer is exercised only under BB_SECURITY_LEGACY=1 by the m15 regression suite",
  },
  limitations: [
    "The Phase-1 engine is INTRA-SYMBOL: a source/sink pair inside an anonymous callback (a symbol the indexer does not store) is not attributed. Fixtures therefore put the pair in a named function body, which is the shape the engine claims.",
    "Real-repository precision/recall is not measured here; the m15 deep suite sizes the corpus and script/m72 owns the per-language engine gates.",
  ],
})

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined"
const tsxBin = path.join(rootDir, "node_modules", ".bin", "tsx")

/** The exact Phase-0 banner, from the ONE canonical contract module (script/m72/lib). */
const BANNER = SECURITY_BANNER

function deleteProject(projectId: string): void {
  try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
}

function sha256(file: string): string | null {
  try { return createHash("sha256").update(readFileSync(file)).digest("hex") } catch { return null }
}

function textOf(result: any): string {
  return (result?.content ?? []).map((c: any) => c?.text ?? "").join("\n")
}

function firstLine(text: string): string {
  return text.split("\n")[0] ?? ""
}

function lineAt(text: string, index: number): string {
  return text.split("\n")[index] ?? ""
}

/**
 * Index a fixture directory as a project under the DEFAULT pipeline (Phase-1).
 * The pool worker forks on the first index call in this process, so this suite
 * never exports BB_SECURITY_LEGACY: it is a default-path verifier.
 */
async function indexFixture(files: Record<string, string>): Promise<{ root: string; projectId: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), "bb-sec-handler-"))
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, body)
  }
  const projectId = getProjectId(dir)
  await indexProjectParallel(projectId, dir, {})
  return { root: dir, projectId }
}

/** A named-function fixture: the engine is intra-symbol, so the pair must live in one stored symbol. */
const TAINTED_TS = [
  "import { Client } from 'pg'",
  "const client = new Client()",
  "export function handleRequest(req: any): unknown {",
  "  const userInput = req.query.name",
  "  const sql = 'SELECT * FROM users WHERE name = ' + userInput",
  "  return client.query(sql)",
  "}",
  "export function safeHandler(u: string): unknown {",
  "  return client.query('SELECT * FROM users WHERE name = $1', [u])",
  "}",
  "export function pure(a: number, b: number): number { return a + b }",
].join("\n")

/** Seed deterministic rows into the M72 store so page/bounds arithmetic is exact. */
function seedStoredLeads(
  raw: any,
  projectId: string,
  fileId: string,
  symbolId: string | null,
  count: number,
  options: { vulnerability?: string; severity?: string; tier?: string; startLine?: number } = {},
): void {
  raw.prepare("DELETE FROM brain_security_flow WHERE project_id = ?").run(projectId)
  const insert = raw.prepare(
    `INSERT OR REPLACE INTO brain_security_flow
      (id, project_id, file_id, source_symbol_id, sink_symbol_id, vulnerability_type, severity,
       state, tier, rule_id, source_line, sink_line, evidence, time_created, time_updated)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const now = Date.now()
  const vulnerability = options.vulnerability ?? "sql_injection"
  const severity = options.severity ?? "high"
  const tier = options.tier ?? "leads"
  const startLine = options.startLine ?? 1
  for (let i = 0; i < count; i++) {
    const sinkLine = startLine + i
    insert.run(
      `sec:${projectId}:${fileId}:probe.rule:${String(i).padStart(6, "0")}:${sinkLine}`,
      projectId,
      fileId,
      symbolId,
      symbolId,
      vulnerability,
      severity,
      "lead",
      tier,
      "probe.rule",
      startLine,
      sinkLine,
      JSON.stringify({
        ruleId: "probe.rule",
        vulnerability,
        severity,
        source: { line: startLine, byteStart: 0, byteEnd: 1 },
        sink: { line: sinkLine, byteStart: i, byteEnd: i + 1 },
        reachPath: ["probe.source", "probe.assign"],
      }),
      now,
      now,
    )
  }
}

// ── 1. THE LEAD-CONTRACT ANSWER from the real Phase-1 pipeline ──────────────
// Indexing a named function that concatenates request data into a query must
// produce ONE stored lead: the new engine excludes the parameterized sibling, so
// the fixture also proves the strict negative end to end (not just unit-level).
{
  const { root: dir, projectId } = await indexFixture({ "src/app.ts": TAINTED_TS })
  try {
    const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
    const stored = raw.prepare("SELECT id, vulnerability_type, severity, state, tier, rule_id, sink_line FROM brain_security_flow WHERE project_id = ?").all(projectId) as any[]
    harness.check("lead-contract: the default pipeline persisted the tainted symbol's lead", stored.length === 1, `stored=${stored.length} ${JSON.stringify(stored)}`)
    harness.check("lead-contract: the stored lead is the SQLi rule at the concatenated sink", stored[0]?.vulnerability_type === "sql_injection" && stored[0]?.rule_id === "typescript.sql.query", `type=${stored[0]?.vulnerability_type} rule=${stored[0]?.rule_id}`)
    harness.check("lead-contract: the stored row is tier=leads / state=lead (never a finding claim)", stored[0]?.tier === "leads" && stored[0]?.state === "lead", `tier=${stored[0]?.tier} state=${stored[0]?.state}`)
    harness.negative("lead-contract: the parameterized sibling produced no second lead", stored.length === 1, `stored=${stored.length} — a parameterized sink must not become a lead`)

    const handlers = createToolHandlers()
    const ctx = { projectPath: dir, projectId } as ToolContext
    const answer = textOf(await handlers.bb_security!({}, ctx))
    const lines = answer.split("\n")

    // The three declarations, in order, before any result.
    harness.check("lead-contract: line 1 is the honesty banner", lines[0] === BANNER, JSON.stringify(lines[0]?.slice(0, 120)))
    harness.check("lead-contract: line 2 is the registry's tier declaration (printed, not hand-typed)", lines[1] === formatSecurityTierDeclaration(), JSON.stringify(lines[1]?.slice(0, 160)))
    harness.check("lead-contract: the project's leads-tier declaration is present", /^leads tier: \d+ language\(s\) present; lexical output only$/.test(lineAt(answer, 2)), JSON.stringify(lineAt(answer, 2)))
    harness.negative("lead-contract: no unsupported-language line is printed for a TypeScript-only project", !/not scanned by bb_security/.test(answer), firstLine(answer))

    // The head and the one lead line.
    harness.check("lead-contract: the head reports the stored-lead census", /^security leads: 1 stored lead\(s\)$/m.test(answer), answer.split("\n").find((l) => l.startsWith("security leads:")) ?? "missing head")
    const leadLine = lines.find((line) => /\] lead:/.test(line)) ?? ""
    harness.check("lead-contract: a lead renders with a demoted grade and the lead label", /^ {2}\[(?:exec|high|medium|low|unknown)\] lead: sql injection @ src\/app\.ts:\d+ <- source:\d+; rule=typescript\.sql\.query; symbol=handleRequest/.test(leadLine), JSON.stringify(leadLine))
    harness.check("lead-contract: the lead line carries its rule id (traceable to a spec rule)", /rule=typescript\.sql\.query/.test(leadLine), JSON.stringify(leadLine))
    harness.check("lead-contract: the lead line carries the reach path evidence", /\[reach: [^\]]+\]/.test(leadLine), JSON.stringify(leadLine))
    // The canonical Phase-0 predicate (script/m72/lib/security-answer-contract.ts):
    // banner + registry tier line verbatim + the leads-tier declaration + no
    // [critical]/un-negated `confirmed` + lead-line vocabulary. Referenced, not
    // re-implemented, so this gate and the matrix gate cannot drift apart.
    const contract = checkSecurityAnswerContract({ tier: "leads", language: "typescript", text: answer, expected: { leadLanguages: 1, unsupportedLanguages: [] } })
    harness.check("lead-contract: the answer satisfies the canonical M72 lead contract", contract.ok, contract.failures.join("; ") || "clean")
    // The declared page, and the exact arithmetic around it.
    harness.check("lead-contract: the page is declared (showing/of/offset/page size/tier)", /^\[leads: showing 1 of 1; offset 0; page size 50; tier=leads\]$/m.test(answer), answer.split("\n").find((l) => l.startsWith("[leads:")) ?? "missing page line")
    harness.negative("lead-contract: a complete page does not advertise more", !/more available — pass offset to page/.test(answer), answer.split("\n").find((l) => l.startsWith("[leads:")) ?? "")

    // Determinism of the rendered answer.
    const again = textOf(await handlers.bb_security!({}, ctx))
    harness.check("lead-contract: two identical calls render identical text", again === answer, "handler output is not deterministic")

    // Invalid arguments are refused at the handler (the schema cannot express them).
    const rejects = async (label: string, args: Record<string, unknown>, fragment: RegExp) => {
      let message = ""
      try { await handlers.bb_security!(args, ctx) } catch (error: any) { message = String(error?.message ?? error) }
      harness.check(label, fragment.test(message), message.slice(0, 180) || "no error thrown")
    }
    await rejects("lead-contract: limit 0 is refused (positive integer)", { limit: 0 }, /positive integer/)
    await rejects("lead-contract: a fractional limit is refused", { limit: 2.5 }, /positive integer/)
    await rejects("lead-contract: a negative offset is refused", { offset: -1 }, /non-negative integer/)
    await rejects("lead-contract: offset does not apply to the history page", { history: true, offset: 1 }, /offset does not apply to the history page/)
    await rejects("lead-contract: history and recordRun are different answers", { history: true, recordRun: true }, /different answers/)
  } finally {
    deleteProject(projectId)
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── 2. Per-project declaration: an unsupported language is NOT a clean zero ──
{
  const { root: dir, projectId } = await indexFixture({
    "src/app.ts": "export const only = 1\n",
    "docs/notes.json": JSON.stringify({ note: "data" }),
    "README.md": "# prose\n",
  })
  try {
    const handlers = createToolHandlers()
    const answer = textOf(await handlers.bb_security!({}, { projectPath: dir, projectId } as ToolContext))
    harness.check(
      "declaration: the unsupported languages are named as not scanned, with a registry reason",
      /^not scanned by bb_security \(no executable source model\): (?:json, markdown|markdown, json) — (?:data format|prose); /m.test(answer),
      answer.split("\n").find((l) => l.startsWith("not scanned")) ?? "missing declaration",
    )
    harness.check("declaration: the leads-tier languages are still counted separately", /^leads tier: 1 language\(s\) present; lexical output only$/m.test(answer), answer.split("\n").find((l) => l.startsWith("leads tier:")) ?? "missing leads tier")
    const projectContract = checkProjectWideSecurityAnswer({ text: answer, expected: { leadLanguages: 1, unsupportedLanguages: ["json", "markdown"] } })
    harness.check("declaration: the multi-language project satisfies the canonical project-wide contract", projectContract.ok, projectContract.failures.join("; ") || "clean")
    harness.check("declaration: an indexed project with no leads declares the store empty", /security leads: 0 stored lead\(s\)/.test(answer), answer.split("\n").find((l) => l.startsWith("security leads:")) ?? "")
    harness.check("declaration: an empty store is NOT presented as a clean result", /declared empty, not a clean result/.test(answer), answer.split("\n").find((l) => l.startsWith("security leads:")) ?? "")
    harness.negative("declaration: no stale 'taint flow(s) indexed' legacy census is printed on the default path", !/\[scan:/.test(answer), answer.split("\n").find((l) => l.startsWith("[scan:")) ?? "clean")
  } finally {
    deleteProject(projectId)
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── 3. Heuristic honesty (the retired detector and the reference doc) ───────
{
  const taintAnalyzerSrc = readFileSync(path.join(rootDir, "src", "ast", "taint-analyzer.ts"), "utf8")
  const hasPatterns = taintAnalyzerSrc.includes(".test(") || taintAnalyzerSrc.includes("new RegExp")
  harness.check("honesty: the retired token detector is pattern matching (fact)", hasPatterns, hasPatterns ? "pattern matches detected" : "no pattern matching")
  const secDoc = readFileSync(path.join(rootDir, "docs", "BB_SECURITY.md"), "utf8")
  harness.check("honesty: docs/BB_SECURITY.md acknowledges indexer heuristics", secDoc.includes("indexer heuristics"), "missing heuristic acknowledgment")
  harness.check("honesty: docs/BB_SECURITY.md does not claim AST data-flow proof", !secDoc.includes("AST-based taint") && !secDoc.includes("pure AST"), "claims AST where it should not")
  harness.negative("honesty: no doc claims taint detection is a pure-AST proof", !secDoc.includes("pure AST taint"), "pure-AST claim found")
  // The answer's own contract must be documented, not just implemented.
  harness.check("honesty: docs/BB_SECURITY.md states the Phase-0 answer contract (banner + tiers)", /LEXICAL TOKEN CO-OCCURRENCE/.test(secDoc) && /0 scan \/ 36 leads \/ 17 unsupported/.test(secDoc), "answer contract missing from the reference doc")
}

// ── 4. Handler + CLI read path: a read does not write ─────────────────────
{
  const { root: dir, projectId } = await indexFixture({ "src/app.ts": TAINTED_TS })
  const dbPath = BrainDatabase.getDbPath(projectId)
  try {
    // Remove a healing index: a read-write open recreates it (ensureHealthIndexes),
    // a read-only open cannot. The dropped object makes the read path falsifiable.
    const healIndex = "brain_symbol_project_idx"
    const rw = await BrainDatabase.getRawInstance(projectId)
    rw.exec(`DROP INDEX IF EXISTS ${healIndex}`)
    const indexBefore = rw.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(healIndex)
    rw.close()

    const cliRead = (args: Record<string, unknown>) => {
      const cliArgs = ["tool", "bb_security", "--dir", dir, "--args", JSON.stringify(args)]
      const result = isBun
        ? spawnSync("bun", ["run", "src/cli/index.ts", ...cliArgs], { cwd: rootDir, encoding: "utf8", timeout: 180_000, env: { ...process.env, BB_NO_AUTO_REFRESH: "1" } })
        : spawnSync(tsxBin, ["src/cli/index.ts", ...cliArgs], { cwd: rootDir, encoding: "utf8", timeout: 180_000, env: { ...process.env, BB_NO_AUTO_REFRESH: "1" } })
      return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
    }

    // The default path is what the CLI door must answer: the lead contract, not
    // the retired census.
    const before = sha256(dbPath)
    const cli = cliRead({})
    const after = sha256(dbPath)
    const beforeHistory = sha256(dbPath)
    const cliHistory = cliRead({ history: true, limit: 5 })
    const afterHistory = sha256(dbPath)

    harness.check("read-path: the CLI findings read succeeds", cli.status === 0 && firstLine(cli.stdout) === BANNER, `exit=${cli.status} first=${JSON.stringify(firstLine(cli.stdout).slice(0, 120))} stderr=${cli.stderr.slice(0, 120)}`)
    harness.check("read-path: the CLI read renders the live phase-1 leads", /security leads: \d+ stored lead\(s\)/.test(cli.stdout) && /\[high\] lead: sql injection/.test(cli.stdout), cli.stdout.split("\n").filter((l) => /lead/.test(l)).slice(0, 2).join(" | "))
    const cliContract = checkSecurityAnswerContract({ tier: "leads", language: "typescript", text: cli.stdout, expected: { leadLanguages: 1, unsupportedLanguages: [] } })
    harness.check("read-path: the CLI answer satisfies the canonical M72 lead contract", cliContract.ok, cliContract.failures.join("; ") || "clean")
    harness.check("read-path: the CLI history read succeeds", cliHistory.status === 0 && cliHistory.stdout.trim().startsWith("{"), `exit=${cliHistory.status} stderr=${cliHistory.stderr.slice(0, 120)}`)
    harness.negative("read-path: the database file is byte-identical after a read", before !== null && before === after, `before=${before?.slice(0, 12)} after=${after?.slice(0, 12)}`)
    harness.negative("read-path: the database file is byte-identical after a history read", beforeHistory !== null && beforeHistory === afterHistory, `before=${beforeHistory?.slice(0, 12)} after=${afterHistory?.slice(0, 12)}`)

    const verify = await BrainDatabase.getRawInstance(projectId, { readonly: true })
    const indexAfter = verify.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(healIndex)
    harness.negative("read-path: the dropped healing index is STILL missing after a read", !indexBefore && !indexAfter, `before=${JSON.stringify(indexBefore)} after=${JSON.stringify(indexAfter)}`)
  } finally {
    deleteProject(projectId)
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── 5. Declared bounds: lead page, census recordRun, capped history page, staleness ──
{
  const { root: dir, projectId } = await indexFixture({
    "src/base.ts": "export function base(): number { return 1 }\n",
  })
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const fileRow = raw.prepare("SELECT id, relative_path FROM brain_file WHERE project_id = ? LIMIT 1").get(projectId) as { id: string; relative_path: string }
    const symbolRow = raw.prepare("SELECT id FROM brain_symbol WHERE project_id = ? LIMIT 1").get(projectId) as { id: string } | undefined
    const TOTAL = 510
    seedStoredLeads(raw, projectId, fileRow.id, symbolRow?.id ?? null, TOTAL)

    const handlers = createToolHandlers()
    const ctx = { projectPath: dir, projectId } as ToolContext
    const live = textOf(await handlers.bb_security!({}, ctx))
    const renderedLead = (text: string) => (text.match(/^ {2}\[(?:exec|high|medium|low|unknown)\] lead:/gm) ?? []).length
    const liveContract = checkSecurityAnswerContract({ tier: "leads", language: "typescript", text: live, expected: { leadLanguages: 1, unsupportedLanguages: [] } })
    harness.check("bounds: the live page satisfies the canonical M72 lead contract", liveContract.ok, liveContract.failures.join("; ") || "clean")

    harness.check("bounds: the live read renders exactly the default page (50)", renderedLead(live) === 50, `lines=${renderedLead(live)}`)
    harness.check("bounds: the head reports the full stored census, not the page", /^security leads: 510 stored lead\(s\)$/m.test(live), live.split("\n").find((l) => l.startsWith("security leads:")) ?? "missing head")
    harness.check("bounds: the page line declares shown/total/offset/page-size/tier", /^\[leads: showing 50 of 510; offset 0; page size 50; tier=leads; more available — pass offset to page\]$/m.test(live), live.split("\n").find((l) => l.startsWith("[leads:")) ?? "missing page line")

    // limit is clamped to the documented maximum (200), not silently ignored.
    const clamped = textOf(await handlers.bb_security!({ limit: 1000 }, ctx))
    harness.check("bounds: a limit above the maximum is clamped to 200 and declared", /^\[leads: showing 200 of 510; offset 0; page size 200; tier=leads; more available — pass offset to page\]$/m.test(clamped), clamped.split("\n").find((l) => l.startsWith("[leads:")) ?? "missing page line")
    harness.check("bounds: the clamped page renders 200 lead lines", renderedLead(clamped) === 200, `lines=${renderedLead(clamped)}`)

    // Last page: no more available.
    const last = textOf(await handlers.bb_security!({ limit: 10, offset: 505 }, ctx))
    harness.check("bounds: a request inside the last page is honoured exactly", /^\[leads: showing 5 of 510; offset 505; page size 10; tier=leads\]$/m.test(last), last.split("\n").find((l) => l.startsWith("[leads:")) ?? "missing page line")
    harness.negative("bounds: the last page does not advertise more", !/more available/.test(last), last.split("\n").find((l) => l.startsWith("[leads:")) ?? "")

    // Past the end: an empty PAGE, not an empty project.
    const past = textOf(await handlers.bb_security!({ limit: 10, offset: 600 }, ctx))
    harness.check("bounds: an offset past the end declares the empty page", /^\[leads: showing 0 of 510; offset 600; page size 10; tier=leads\]$/m.test(past), past.split("\n").find((l) => l.startsWith("[leads:")) ?? "missing page line")
    harness.check("bounds: the empty page still reports the project census", /^security leads: 510 stored lead\(s\)$/m.test(past), past.split("\n").find((l) => l.startsWith("security leads:")) ?? "missing head")
    harness.negative("bounds: the empty page is not presented as an empty project", !/none stored for this project/.test(past), firstLine(past))

    // recordRun persists the WHOLE store census (not the 50-line page).
    const recorded = textOf(await handlers.bb_security!({ recordRun: true }, ctx))
    harness.check("bounds: recordRun states the whole store census was recorded", /^510 leads recorded$/m.test(recorded), recorded.split("\n").find((l) => l.includes("leads recorded")) ?? "missing recorded line")
    harness.check("bounds: recordRun declares the persisted count and the preview window", /^\[recordRun: 510 lead\(s\) persisted; preview shows 20\]$/m.test(recorded), recorded.split("\n").find((l) => l.startsWith("[recordRun:")) ?? "missing recordRun census")
    harness.check("bounds: recordRun reports a recorded run id", /^recorded run: \S+$/m.test(recorded), recorded.split("\n").find((l) => l.startsWith("recorded run:")) ?? "missing run id")
    const recordedContract = checkSecurityAnswerContract({ tier: "leads", language: "typescript", text: recorded, expected: { leadLanguages: 1, unsupportedLanguages: [] } })
    harness.check("bounds: the recordRun answer satisfies the canonical M72 lead contract", recordedContract.ok, recordedContract.failures.join("; ") || "clean")

    // History is a PAGE with its true total declared.
    const historyText = textOf(await handlers.bb_security!({ history: true }, ctx))
    const history = JSON.parse(historyText)
    harness.check("bounds: history declares its rendered page and true total", history.findingsShown === 200 && history.findingsTotal === 510 && history.findingsTruncated === 310, JSON.stringify({ shown: history.findingsShown, total: history.findingsTotal, truncated: history.findingsTruncated }))
    harness.check("bounds: the history census names the page", history.census?.findingsTotal === 510 && history.census?.findingsShown === 200 && history.census?.findingsBeyondCap === 310, JSON.stringify(history.census))
    harness.check("bounds: the history page is a page of the same persisted set", history.findings.length === 200 && history.runs.length === 1 && history.runs[0].findingCount === 510, JSON.stringify({ findings: history.findings.length, runs: history.runs.map((r: any) => r.findingCount) }))
    harness.check("bounds: persisted rows name the M72 engine (not the retired taint engine)", history.findings[0]?.engine === "m72-security-spec", `engine=${history.findings[0]?.engine}`)
    harness.check("bounds: persisted rows carry lead evidence, not a taint_flow claim", (history.findings[0]?.evidence ?? []).some((e: any) => e?.kind === "security_lead") && !(history.findings[0]?.evidence ?? []).some((e: any) => e?.kind === "taint_flow"), JSON.stringify(history.findings[0]?.evidence))
    harness.check("bounds: persisted rows carry the lead limitation", (history.findings[0]?.limitations ?? []).some((l: string) => /lexical lead: not a dataflow proof/i.test(l)), JSON.stringify(history.findings[0]?.limitations))

    // Drift guard: the handler reads history through its own read-only query (the
    // shared reader opens the database for writing, which a read may not do), so
    // the page must still agree with the recorder's own reader on the same rows.
    {
      const { getAnalysisHistory } = await import("../../src/intelligence/analysis/run-history")
      const oracle = await getAnalysisHistory(projectId, "security", 20)
      const handlerRunIds = (history.runs ?? []).map((r: any) => r.id).sort()
      const oracleRunIds = oracle.runs.map((r) => r.id).sort()
      harness.check("history: the read-only page lists the same runs as the shared reader", JSON.stringify(handlerRunIds) === JSON.stringify(oracleRunIds), `handler=${handlerRunIds.length} oracle=${oracleRunIds.length}`)
      const identity = (rows: any[]) => JSON.stringify(rows.map((f) => `${f.fingerprint}|${f.state}|${f.severity}|${f.confidence}`).sort())
      harness.check("history: the read-only page is the shared reader's ordered prefix", identity(history.findings ?? []) === identity(oracle.findings.slice(0, 200)), `handler=${(history.findings ?? []).length} oraclePrefix=${Math.min(oracle.findings.length, 200)}`)
    }
    harness.negative("bounds: no observation state is persisted (leads only)", (history.findings ?? []).every((f: any) => f.state !== "source_only" && f.state !== "unresolved"), JSON.stringify([...new Set((history.findings ?? []).map((f: any) => f.state))]))

    // Staleness is manual and declared: the file changed after indexing, so the
    // rendered leads carry [stale] and the footer names the manual repair.
    appendFileSync(path.join(dir, "src", "base.ts"), "\n// edited after indexing\n")
    const stale = textOf(await handlers.bb_security!({ limit: 5 }, ctx))
    harness.check("bounds: a lead whose file changed after indexing carries [stale]", /^ {2}\[(?:exec|high|medium|low|unknown)\] lead: .*\[stale\]$/m.test(stale), stale.split("\n").find((l) => /\] lead:/.test(l)) ?? "no lead line")
    harness.check("bounds: the staleness footer names the manual repair", /1 stale, 0 missing of 1 referenced file\(s\) — manual repair: run: bb index --changed/.test(stale), stale.split("\n").find((l) => /stale.*manual repair/.test(l)) ?? "missing footer")
    harness.negative("bounds: staleness is not claimed as auto-repaired", !/refresh=(?:true|false)/.test(stale), stale.split("\n").find((l) => /refresh=/.test(l)) ?? "clean")
  } finally {
    deleteProject(projectId)
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── 6. Library door: an unindexed project is refused, not answered ────────
{
  const dir = mkdtempSync(path.join(tmpdir(), "bb-sec-library-"))
  const projectId = getProjectId(dir)
  mkdirSync(path.join(dir, "src"), { recursive: true })
  writeFileSync(path.join(dir, "src", "only.ts"), "export const only = 1\n")
  const dbPath = BrainDatabase.getDbPath(projectId)
  const handlers = createToolHandlers()
  let thrown = ""
  try {
    await handlers.bb_security!({}, { projectPath: dir, projectId } as ToolContext)
  } catch (error: any) {
    thrown = String(error?.message ?? error)
  }
  harness.check("library-door: an unindexed project is refused by name", /no index found/i.test(thrown), thrown.slice(0, 240))
  harness.negative("library-door: the refused call did not create an index", !existsSync(dbPath), `created ${dbPath}`)
  rmSync(dir, { recursive: true, force: true })
  rmSync(path.dirname(dbPath), { recursive: true, force: true })
}

harness.emit()
