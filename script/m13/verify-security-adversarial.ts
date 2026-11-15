// script/m13/verify-security-adversarial.ts — bb_security adversarial coverage (M72 lead contract).
//
// The Phase-1 (M72) answer is a LEAD GENERATOR: the default path indexes code,
// runs the per-language spec engine per symbol, persists leads into
// `brain_security_flow`, and renders them as `[grade] lead: …`. This file attacks
// that contract from both sides:
//
//   Positives — a SQL injection shape (TypeScript) and a command injection shape
//   (Python) must produce a stored lead and render as a lead, with the rule id and
//   evidence that make the pair traceable.
//
//   Negatives — a parameterized query (safe), a clean file, and a template-literal
//   XSS shape must produce NO lead. The parameterized case is the historical false
//   positive: the retired token detector could not tell a bound parameter from a
//   concatenation, and this gate used to accept that as a documented limitation.
//   The Phase-1 engine excludes it, so the negative is now STRICT.
//
//   The retired store — the default pipeline must not write `brain_taint_flow`
//   any more; its rows are rollback-only under BB_SECURITY_LEGACY=1. This file
//   asserts the default path leaves that table empty.
//
//   Lead-state — every stored row is tier=leads / state=lead, intra-symbol
//   (source_symbol_id === sink_symbol_id), and the answer never uses
//   `[critical]`/`confirmed`/`finding` vocabulary. Cross-language stitching is
//   retired: the schema has no cross-language column and each lead is attributed
//   to its own file.
//
//   Doors — the real CLI (source entry) and the real MCP stdio server, including
//   the false-clean guard (an unindexed project is refused, and a refused read
//   does not create an index).
//
//   Corpus — real repositories are indexed and the stored-lead invariants are
//   asserted on real data: every row's file exists, its language is a `leads`
//   tier, its rule id is non-empty, and the retired token table stays empty.
//
// Run: npx tsx script/m13/verify-security-adversarial.ts   (bun run … also works)
// Exit: non-zero if any assertion failed.

import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { securityTierFor } from "../../src/intelligence/security/rebuild/registry"
import { SECURITY_BANNER, checkSecurityAnswerContract, checkProjectWideSecurityAnswer } from "../m72/lib/security-answer-contract"
import { Harness } from "./harness"
import { resolveCorpusRoot } from "../lib/corpus-root.ts"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
// Self-contained data dir: never inherit a caller's HOME, which is read-only in
// sandboxes and is the live user index everywhere else.
if (!process.env.BB_DATA_DIR) process.env.BB_DATA_DIR = path.join(rootDir, "validation", "tools", "bb_security", "bbdata")
process.env.BB_NO_AUTO_REFRESH = "1"
// This is a DEFAULT-PATH verifier: the retired token engine must not run, so no
// inherited rollback switch may leak in from the caller.
delete process.env.BB_SECURITY_LEGACY

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined"
const tsxBin = path.join(rootDir, "node_modules", ".bin", "tsx")

/** Run the SOURCE CLI door through the runtime this gate is executing on. */
function runCli(args: string[], env: Record<string, string | undefined> = {}): { status: number; stdout: string; stderr: string } {
  const childEnv: Record<string, string | undefined> = { ...process.env, BB_NO_AUTO_REFRESH: "1", ...env }
  delete childEnv.BB_SECURITY_LEGACY
  const result = isBun
    ? spawnSync("bun", ["run", "src/cli/index.ts", ...args], { cwd: rootDir, encoding: "utf8", timeout: 180_000, env: childEnv })
    : spawnSync(tsxBin, ["src/cli/index.ts", ...args], { cwd: rootDir, encoding: "utf8", timeout: 180_000, env: childEnv })
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
}

const harness = new Harness({
  issue: "M13.42",
  code: "Sec3",
  tool: "bb_security",
  title: "bb_security: adversarial lead contract (unit + integration + e2e + corpus)",
  layers: ["unit", "integration", "e2e", "corpus"],
  decisions: {
    positives: "SQLi (TypeScript) and CMDi (Python) shapes produce stored leads rendered as leads with rule ids",
    negatives: "parameterized SQL, clean code, and template-literal XSS produce NO lead (strict; the retired detector's blind spot is gone)",
    retiredStore: "the default pipeline writes no brain_taint_flow rows (rollback-only table)",
    leadState: "every stored row is tier=leads/state=lead and intra-symbol; no cross-language claim exists in schema or answer",
    transports: "CLI via the source entry + MCP StdioClientTransport; unindexed projects are refused",
    corpus: "rake (Ruby), graphql-js (TS), rebar3 (Erlang): stored-lead invariants on real data, pass AND fail recorded",
  },
  limitations: [
    "The Phase-1 engine is intra-symbol, so a source/sink pair split across functions (or inside an anonymous callback) is not a lead; the fixtures place the pair in one named function, which is the shape the engine claims.",
    "Corpus legs assert stored-lead INVARIANTS, not recall: a spec that does not cover a corpus's API can honestly produce zero leads, and that is recorded as a count, not a pass.",
  ],
})

function cleanup(dir: string, projectId?: string): void {
  try { rmSync(dir, { recursive: true, force: true }) } catch {}
  if (projectId) {
    try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
  }
}

async function indexFixture(files: Record<string, string>): Promise<{ root: string; projectId: string }> {
  const root = mkdtempSync(path.join(tmpdir(), "bb-sec-adv-"))
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, body)
  }
  const projectId = getProjectId(root)
  await indexProjectParallel(projectId, root, {})
  return { root, projectId }
}

const TAINTED_TS = [
  "import { Client } from 'pg'",
  "const client = new Client()",
  "export function findUser(req: any): unknown {",
  "  const name = req.query.name",
  "  const sql = 'SELECT * FROM users WHERE name = ' + name",
  "  return client.query(sql)",
  "}",
].join("\n")

/** First line of a rendered answer, for failure detail. */
function firstLine(text: string): string {
  return text.split("\n")[0] ?? ""
}

// ── 1. POSITIVE: SQL injection (TypeScript) ────────────────────────────────
{
  const { root, projectId } = await indexFixture({ "src/app.ts": TAINTED_TS })
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const leads = raw.prepare("SELECT vulnerability_type, severity, tier, state, rule_id, source_symbol_id, sink_symbol_id, sink_line, evidence FROM brain_security_flow WHERE project_id = ?").all(projectId) as any[]
    harness.check("POSITIVE: the SQLi shape produces a stored lead", leads.length === 1, `leads=${leads.length} ${JSON.stringify(leads.map((l) => l.rule_id))}`)
    harness.check("POSITIVE: the lead names the SQLi spec rule", leads[0]?.rule_id === "typescript.sql.query" && leads[0]?.vulnerability_type === "sql_injection", `rule=${leads[0]?.rule_id} type=${leads[0]?.vulnerability_type}`)
    harness.check("POSITIVE: the lead carries a lexical grade (high)", leads[0]?.severity === "high", `severity=${leads[0]?.severity}`)
    harness.check("POSITIVE: the lead is tier=leads / state=lead (never a finding)", leads[0]?.tier === "leads" && leads[0]?.state === "lead", `tier=${leads[0]?.tier} state=${leads[0]?.state}`)
    harness.check("POSITIVE: the lead is intra-symbol (source_symbol_id === sink_symbol_id, no stitching)", leads[0]?.source_symbol_id !== null && leads[0]?.source_symbol_id === leads[0]?.sink_symbol_id, `src=${leads[0]?.source_symbol_id} sink=${leads[0]?.sink_symbol_id}`)
    const evidence = JSON.parse(leads[0]?.evidence ?? "{}")
    harness.check("POSITIVE: the lead carries source, sink and reach evidence (traceable to a rule)", evidence?.ruleId === "typescript.sql.query" && typeof evidence?.sink?.line === "number" && Array.isArray(evidence?.reachPath) && evidence.reachPath.length > 0, JSON.stringify(evidence).slice(0, 240))

    // The retired token table must stay empty on the default path.
    let retired = -1
    try { retired = (raw.prepare("SELECT COUNT(*) c FROM brain_taint_flow WHERE project_id = ?").get(projectId) as { c: number }).c } catch {}
    harness.negative("POSITIVE: the default pipeline wrote no rows into the retired token table", retired === 0, `brain_taint_flow rows=${retired}`)
  } finally {
    cleanup(root, projectId)
  }
}

// ── 2. NEGATIVE: parameterized SQL is NOT a lead (the old false positive) ──
{
  const { root, projectId } = await indexFixture({
    "src/safe.ts": [
      "import { Client } from 'pg'",
      "const client = new Client()",
      "export function findUser(req: any): unknown {",
      "  const name = req.query.name",
      "  return client.query('SELECT * FROM users WHERE name = $1', [name])",
      "}",
    ].join("\n"),
  })
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const leads = raw.prepare("SELECT id, rule_id FROM brain_security_flow WHERE project_id = ?").all(projectId) as any[]
    harness.negative("NEGATIVE: a parameterized query produces NO lead (strict — was the known false positive)", leads.length === 0, `leads=${leads.length} rules=${JSON.stringify(leads.map((l) => l.rule_id))}`)

    const handlers = createToolHandlers()
    const answer = (await handlers.bb_security!({}, { projectPath: root, projectId } as any)).content[0]!.text
    const safeContract = checkSecurityAnswerContract({ tier: "leads", language: "typescript", text: answer, expected: { leadLanguages: 1, unsupportedLanguages: [] } })
    harness.check("NEGATIVE: the safe query's answer satisfies the canonical lead contract", safeContract.ok, safeContract.failures.join("; ") || "clean")
    harness.check("NEGATIVE: the safe query's project declares an empty store, not a clean result", /security leads: 0 stored lead\(s\)/.test(answer) && /declared empty, not a clean result/.test(answer), answer.split("\n").find((l) => l.startsWith("security leads:")) ?? "missing head")
    // The banner itself contains the words "A VULNERABILITY FINDING"; the claim
    // being disproved is about the RESULT lines, so the scan starts below line 1.
    harness.negative("NEGATIVE: no result line describes the safe query as a finding or a vulnerability", answer.split("\n").slice(1).every((line) => !/\bfinding\b/i.test(line)) && !/[Vv]ulnerab(?:le|ility) (?:found|detected)/.test(answer), answer.split("\n").filter((line) => /finding|vulnerab/i.test(line)).join(" | ") || "clean")
  } finally {
    cleanup(root, projectId)
  }
}

// ── 3. NEGATIVE: clean code produces nothing ───────────────────────────────
{
  const { root, projectId } = await indexFixture({
    "src/clean.ts": "export function add(a: number, b: number): number { return a + b }\n",
  })
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const leads = raw.prepare("SELECT id FROM brain_security_flow WHERE project_id = ?").all(projectId) as any[]
    harness.negative("NEGATIVE: clean code produces no leads", leads.length === 0, `leads=${leads.length}`)
  } finally {
    cleanup(root, projectId)
  }
}

// ── 4. Lead-state contract: no `confirmed`/`mitigated` claim, no critical grade ──
{
  // Two languages, two leads, one project. Cross-symbol stitching is retired, so
  // each lead must be attributed to its own file/symbol and the schema must have
  // no cross-language flag at all.
  const { root, projectId } = await indexFixture({
    "src/front.ts": TAINTED_TS,
    "src/back.py": [
      "import os",
      "def run():",
      "    cmd = os.environ.get('CMD')",
      "    os.system('ls ' + cmd)",
    ].join("\n"),
  })
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const leads = raw.prepare("SELECT id, file_id, rule_id, severity, tier, state, source_symbol_id, sink_symbol_id FROM brain_security_flow WHERE project_id = ? ORDER BY rule_id").all(projectId) as any[]
    const files = new Map<string, any>((raw.prepare("SELECT id, relative_path FROM brain_file WHERE project_id = ?").all(projectId) as any[]).map((f) => [f.id, f]))
    harness.check("lead-state: both language leads are stored", leads.length === 2, `leads=${leads.length} rules=${JSON.stringify(leads.map((l) => l.rule_id))}`)
    harness.check("lead-state: every lead is tier=leads and state=lead", leads.every((l) => l.tier === "leads" && l.state === "lead"), JSON.stringify(leads.map((l) => `${l.tier}/${l.state}`)))
    harness.negative("lead-state: no stored row claims a mitigated state (not emitted in Phase 1)", leads.every((l) => l.state !== "mitigated"), JSON.stringify([...new Set(leads.map((l) => l.state))]))
    harness.check("lead-state: each lead is attributed to its own file (no cross-language adjacency)", new Set(leads.map((l) => l.file_id)).size === 2 && leads.every((l) => files.has(l.file_id)), JSON.stringify(leads.map((l) => files.get(l.file_id)?.relative_path)))
    harness.negative("lead-state: no stored lead spans two symbols (intra-symbol only)", leads.every((l) => l.source_symbol_id !== null && l.source_symbol_id === l.sink_symbol_id), JSON.stringify(leads.map((l) => `${l.source_symbol_id}|${l.sink_symbol_id}`)))
    // The retired "cross-language" claim is gone from the store contract too: the
    // M72 table has no cross-language column (only the old token table did).
    const rawSchema = raw.prepare("SELECT name FROM pragma_table_info('brain_security_flow')").all() as Array<{ name: string }>
    harness.negative("lead-state: the M72 store has no cross-language column", !rawSchema.some((c) => /cross/i.test(c.name)), rawSchema.map((c) => c.name).join(","))

    const handlers = createToolHandlers()
    const answer = (await handlers.bb_security!({}, { projectPath: root, projectId } as any)).content[0]!.text
    harness.check("lead-state: the answer renders both leads with lead labels and grades", (answer.match(/\] lead: /g) ?? []).length === 2 && /^ {2}\[(?:exec|high|medium|low)\] lead: command injection/m.test(answer) && /^ {2}\[(?:exec|high|medium|low)\] lead: sql injection/m.test(answer), answer.split("\n").filter((l) => /\] lead:/.test(l)).join(" | "))
    const mixedContract = checkProjectWideSecurityAnswer({ text: answer, expected: { leadLanguages: 2, unsupportedLanguages: [] } })
    harness.check("lead-state: the answer satisfies the canonical project-wide lead contract", mixedContract.ok, mixedContract.failures.join("; ") || "clean")
    harness.negative("lead-state: the answer never prints [critical]", !/\[critical\]/.test(answer), firstLine(answer))
    harness.negative("lead-state: the answer makes no `confirmed` claim", !/\bconfirmed\b/i.test(answer), answer.split("\n").find((l) => /confirmed/i.test(l)) ?? "clean")
    harness.negative("lead-state: the answer makes no cross-language claim", !/cross[- ]language/i.test(answer), answer.split("\n").find((l) => /cross/i.test(l)) ?? "clean")
  } finally {
    cleanup(root, projectId)
  }
}

// ── 5. POSITIVE: command injection (Python), intra-symbol ──────────────────
{
  const { root, projectId } = await indexFixture({
    "src/runner.py": [
      "import os",
      "def run():",
      "    cmd = os.environ.get('CMD')",
      "    os.system('ls ' + cmd)",
    ].join("\n"),
  })
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const leads = raw.prepare("SELECT rule_id, vulnerability_type, severity FROM brain_security_flow WHERE project_id = ?").all(projectId) as any[]
    harness.check("POSITIVE: the Python CMDi shape produces a lead", leads.length === 1 && leads[0]?.vulnerability_type === "command_injection", JSON.stringify(leads))
    harness.check("POSITIVE: the Python lead names the os-shell spec rule", leads[0]?.rule_id === "python.cmd.os_shell", `rule=${leads[0]?.rule_id}`)
  } finally {
    cleanup(root, projectId)
  }
}

// ── 6. NEGATIVE: template-literal XSS is not overclaimed ──────────────────
{
  // The spec masks template literals as strings, so an interpolation inside one is
  // invisible to the matcher by contract (declared in specs/typescript.ts). No lead
  // is the honest result; the gate records that this shape is a declared lexical
  // limit, not a pass to build a capability claim on.
  const { root, projectId } = await indexFixture({
    "src/view.ts": [
      "export function renderPage(userInput: string): string {",
      "  return `<div>${userInput}</div>`",
      "}",
    ].join("\n"),
  })
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const leads = raw.prepare("SELECT rule_id FROM brain_security_flow WHERE project_id = ?").all(projectId) as any[]
    harness.negative("NEGATIVE: template-literal XSS is not overclaimed as a lead (declared lexical limit)", leads.length === 0, `leads=${leads.length} ${JSON.stringify(leads.map((l) => l.rule_id))}`)
  } finally {
    cleanup(root, projectId)
  }
}

// ── 7. e2e: CLI ────────────────────────────────────────────────────────────
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-sec-cli-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "src", "app.ts"), TAINTED_TS)
  const projectId = getProjectId(root)
  try {
    await indexProjectParallel(projectId, root, {})

    const cli = runCli(["tool", "bb_security", "--dir", root, "--args", JSON.stringify({})])
    harness.check("CLI: the source door answers with the banner first", cli.status === 0 && cli.stdout.split("\n")[0] === SECURITY_BANNER, `exit=${cli.status} stderr=${cli.stderr.slice(0, 160)}`)
    const cliContract = checkSecurityAnswerContract({ tier: "leads", language: "typescript", text: cli.stdout, expected: { leadLanguages: 1, unsupportedLanguages: [] } })
    harness.check("CLI: the answer satisfies the canonical M72 lead contract", cliContract.ok, cliContract.failures.join("; ") || "clean")
    harness.check("CLI: the answer declares the tiers and the stored-lead census", /tiers: 0 scan \/ 36 leads \/ 17 unsupported/.test(cli.stdout) && /security leads: 1 stored lead\(s\)/.test(cli.stdout), cli.stdout.split("\n").filter((l) => /tiers:|security leads:/.test(l)).join(" | ").slice(0, 300))
    harness.check("CLI: the lead is rendered as a lead with its rule", /\[high\] lead: sql injection @ src\/app\.ts:\d+ <- source:\d+; rule=typescript\.sql\.query/.test(cli.stdout), cli.stdout.split("\n").find((l) => /\] lead:/.test(l)) ?? "missing lead line")

    // recordRun → history through the real CLI, then read the JSON page.
    const recorded = runCli(["tool", "bb_security", "--dir", root, "--args", JSON.stringify({ recordRun: true })])
    const recordedContract = checkSecurityAnswerContract({ tier: "leads", language: "typescript", text: recorded.stdout, expected: { leadLanguages: 1, unsupportedLanguages: [] } })
    harness.check("CLI: the recordRun answer satisfies the canonical M72 lead contract", recordedContract.ok, recordedContract.failures.join("; ") || "clean")
    harness.check("CLI: recordRun states the recorded lead count", recorded.status === 0 && /^1 leads recorded$/m.test(recorded.stdout), recorded.stdout.split("\n").find((l) => /leads recorded/.test(l)) ?? "missing count")
    const hist = runCli(["tool", "bb_security", "--dir", root, "--args", JSON.stringify({ history: true, limit: 5 })])
    let parsed: any = {}
    try { parsed = JSON.parse(hist.stdout.trim()) } catch {}
    harness.check("CLI: history returns the persisted lead", hist.status === 0 && parsed.findingsTotal === 1 && parsed.findings?.[0]?.engine === "m72-security-spec", JSON.stringify({ total: parsed.findingsTotal, engine: parsed.findings?.[0]?.engine }))
    harness.negative("CLI: history persists no retired-engine finding", (parsed.findings ?? []).every((f: any) => f.engine === "m72-security-spec") && !(parsed.runs ?? []).some((r: any) => /taint@intelligence/.test(String(r.engineVersion))), JSON.stringify((parsed.runs ?? []).map((r: any) => r.engineVersion)))

    // FALSE-CLEAN GUARD: a project with no index must be refused, and the read
    // must not create an index.
    const unindexed = mkdtempSync(path.join(tmpdir(), "bb-sec-cli-unindexed-"))
    mkdirSync(path.join(unindexed, "src"), { recursive: true })
    writeFileSync(path.join(unindexed, "src", "only.ts"), "export const only = 1\n")
    const unindexedProjectId = getProjectId(unindexed)
    const unindexedDb = BrainDatabase.getDbPath(unindexedProjectId)
    const refused = runCli(["tool", "bb_security", "--dir", unindexed, "--args", JSON.stringify({})])
    harness.check("CLI: an unindexed project is refused by name", refused.status !== 0 && /No index found|no index found/.test(refused.stdout + refused.stderr), `exit=${refused.status} out=${(refused.stdout + refused.stderr).slice(0, 240)}`)
    harness.negative("CLI: a refused read does not create an index", !existsSync(unindexedDb), `created ${unindexedDb}`)
    cleanup(unindexed)
    rmSync(path.dirname(unindexedDb), { recursive: true, force: true })
  } finally {
    cleanup(root, projectId)
  }
}

// ── 8. e2e: MCP stdio ──────────────────────────────────────────────────────
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-sec-mcp-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "src", "runner.py"), [
    "import os",
    "def run():",
    "    cmd = os.environ.get('CMD')",
    "    os.system('ls ' + cmd)",
  ].join("\n"))
  const projectId = getProjectId(root)
  try {
    await indexProjectParallel(projectId, root, {})
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
    // The child must inherit the fixture's data dir: the MCP server resolves the
    // index from BB_DATA_DIR, and without it the fixture project is invisible and
    // the leg fails on the server's (correct) "No index found" refusal.
    const serverCommand = isBun ? "bun" : tsxBin
    const serverArgs = isBun ? ["run", "src/cli/index.ts", "mcp", "--dir", root] : ["src/cli/index.ts", "mcp", "--dir", root]
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) if (typeof value === "string") env[key] = value
    delete env.BB_SECURITY_LEGACY
    env.BB_NO_AUTO_REFRESH = "1"
    const transport = new StdioClientTransport({ command: serverCommand, args: serverArgs, cwd: rootDir, env, stderr: "pipe" })
    const client = new Client({ name: "verify-sec3", version: "1.0.0" })
    try {
      await client.connect(transport)
      const r: any = await client.callTool({ name: "bb_security", arguments: {} })
      const text = (r?.content ?? []).map((c: any) => c.text ?? "").join("\n")
      harness.check("MCP: the tool answers with the banner and tier declaration", !r?.isError && text.split("\n")[0] === SECURITY_BANNER && /tiers: 0 scan \/ 36 leads \/ 17 unsupported/.test(text), text.slice(0, 200))
      const mcpContract = checkSecurityAnswerContract({ tier: "leads", language: "python", text, expected: { leadLanguages: 1, unsupportedLanguages: [] } })
      harness.check("MCP: the answer satisfies the canonical M72 lead contract", mcpContract.ok, mcpContract.failures.join("; ") || "clean")
      harness.check("MCP: the stored lead is rendered with the lead vocabulary", /security leads: 1 stored lead\(s\)/.test(text) && /\[exec\] lead: command injection/.test(text), text.split("\n").find((l) => /\] lead:/.test(l)) ?? "missing lead line")
    } finally {
      try { await client.close() } catch {}
    }
  } catch (e) {
    harness.check("MCP bb_security e2e session", false, e instanceof Error ? e.message : String(e))
  } finally {
    cleanup(root, projectId)
  }
}

// ── 9. Corpus sampling: stored-lead invariants on real repositories ────────
// Was: the literal foreign corpus root "/home/ishaq2321/bb_tests/repositories" — see script/lib/corpus-root.ts.
const REPO_ROOT = resolveCorpusRoot(process.cwd()) ?? "REPO_ROOT_UNRESOLVED"
// graphql-js 17.x checkpoint has no top-level src/: the only real TypeScript on
// this revision lives under website/pages (docs tooling). Point the corpus at
// actual TS so the scan exercises a genuine TypeScript corpus.
const SAMPLE: Array<[string, string, string]> = [
  ["rake", "lib/rake", "Ruby"],
  ["graphql-js", "website/pages", "TypeScript"],
  ["rebar3", "apps", "Erlang"],
]
const corpusLeadCounts: Record<string, number> = {}

for (const [repo, subPath, family] of SAMPLE) {
  const indexRoot = path.join(REPO_ROOT, repo, subPath)
  if (!existsSync(indexRoot)) {
    harness.check(`corpus ${repo}/${subPath} (${family}): present`, false, `${indexRoot} missing`)
    continue
  }
  const pid = getProjectId(indexRoot)
  try {
    await indexProjectParallel(pid, indexRoot, {})
    const raw = await BrainDatabase.getRawInstance(pid)
    const tag = `${repo}/${subPath} (${family})`
    const leads = raw.prepare("SELECT id, file_id, rule_id, tier, state, source_symbol_id, sink_symbol_id FROM brain_security_flow WHERE project_id = ?").all(pid) as any[]
    corpusLeadCounts[tag] = leads.length
    const files = new Map<string, any>((raw.prepare("SELECT id, relative_path, language FROM brain_file WHERE project_id = ?").all(pid) as any[]).map((f) => [f.id, f]))

    harness.check(`corpus ${tag}: the scan completed and stored only lead rows`, leads.every((l) => l.tier === "leads" && l.state === "lead"), `leads=${leads.length} tiers=${JSON.stringify([...new Set(leads.map((l) => l.tier))])}`)
    harness.check(`corpus ${tag}: every stored lead names a spec rule`, leads.every((l) => typeof l.rule_id === "string" && l.rule_id.includes(".")), `badRule=${leads.filter((l) => !(typeof l.rule_id === "string" && l.rule_id.includes("."))).length}`)
    harness.check(`corpus ${tag}: every stored lead resolves to an indexed file`, leads.every((l) => files.has(l.file_id)), `unresolved=${leads.filter((l) => !files.has(l.file_id)).length}`)
    harness.check(`corpus ${tag}: every stored lead's file exists on disk`, leads.every((l) => existsSync(path.join(indexRoot, files.get(l.file_id)?.relative_path ?? ""))), `missing=${leads.filter((l) => !existsSync(path.join(indexRoot, files.get(l.file_id)?.relative_path ?? ""))).length}`)
    harness.check(`corpus ${tag}: every stored lead belongs to a leads-tier language`, leads.every((l) => securityTierFor(String(files.get(l.file_id)?.language ?? "")) === "leads"), JSON.stringify([...new Set(leads.map((l) => files.get(l.file_id)?.language))]))
    harness.negative(`corpus ${tag}: no stored lead claims a mitigated state`, leads.every((l) => l.state !== "mitigated"), JSON.stringify([...new Set(leads.map((l) => l.state))]))
    harness.negative(`corpus ${tag}: no cross-symbol lead is stored (intra-symbol only)`, leads.every((l) => l.source_symbol_id !== null && l.source_symbol_id === l.sink_symbol_id), `cross=${leads.filter((l) => l.source_symbol_id !== l.sink_symbol_id).length}`)
    // The retired token table must not be written on the default path, including
    // on a big real repo.
    let retired = -1
    try { retired = (raw.prepare("SELECT COUNT(*) c FROM brain_taint_flow WHERE project_id = ?").get(pid) as { c: number }).c } catch {}
    harness.negative(`corpus ${tag}: the retired token table stayed empty`, retired === 0, `brain_taint_flow rows=${retired}`)

    // The answer door on a real repo: declared banner + tier + page.
    const answer = (await createToolHandlers().bb_security!({}, { projectPath: indexRoot, projectId: pid } as any)).content[0]!.text
    harness.check(`corpus ${tag}: the answer declares banner + tiers + stored census`, /LEXICAL TOKEN CO-OCCURRENCE/.test(answer) && /tiers: 0 scan \/ 36 leads/.test(answer) && /security leads: \d+ stored lead\(s\)/.test(answer), answer.split("\n").slice(0, 4).join(" | ").slice(0, 300))
    harness.negative(`corpus ${tag}: the answer carries no [critical]`, !/\[critical\]/.test(answer), answer.slice(0, 200))
    console.log(`    [corpus] ${tag}: leads=${leads.length} files=${files.size}`)
  } catch (e) {
    harness.check(`corpus ${repo}/${subPath} (${family}): corpus session`, false, e instanceof Error ? e.message : String(e))
  } finally {
    try { rmSync(path.dirname(BrainDatabase.getDbPath(pid)), { recursive: true, force: true }) } catch {}
  }
}
// Recorded, not asserted as a pass: a spec that does not cover a corpus's API can
// honestly produce zero leads, and the counts above are the evidence for that.
console.log(`  corpus lead counts: ${JSON.stringify(corpusLeadCounts)}`)

harness.emit()
