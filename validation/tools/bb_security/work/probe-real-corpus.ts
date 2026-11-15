// Release-grade real-corpus proof for bb_security (Lead mandate).
//
// Indexes real repositories from /home/ishaq2321/bb_tests/repositories into an
// isolated BB_DATA_DIR and drives the REAL MCP stdio door (source entry:
// `tsx src/cli/index.ts mcp --dir <repo>`). Every response is recorded with its
// language census, taint-row census, the findings-vs-observations split, and
// the door round-trip latency.
//
// M72 (Phase 1): the persisted evidence is the spec engine's lead store
// (`brain_security_flow`); the retired token cross-product table
// (`brain_taint_flow`) is only counted to prove the new path does not write it.
//
// Adversarial cases run through the same door (M72 contract):
//   clean-negative        pure functions must produce no stored leads
//   parameterized-sql     a parameterized (safe) query must NOT be a SQL-injection lead
//   sqli-positive         a concatenated-SQL injection must be a lead with file:line,
//                         rendered with the demoted grade label (never `[critical]`)
//   unsupported-project   a project with only unsupported languages must answer
//                         "not scanned by bb_security", never a clean zero
//   unindexed-project     the door must refuse, not answer a false "clean"
//   staleness             a touched lead file produces [stale] and the answer is
//                         byte-identical with BB_NO_AUTO_REFRESH unset
import { appendFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import {
  AUDIT, LANE, ROOT, TSX, dataDirFor, ensureDirs, makeFixture, mcpCall, writeEvidence, gitHead,
} from "./lib"
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"

process.env.BB_NO_AUTO_REFRESH = "1"
ensureDirs()

const CORPUS = "/home/ishaq2321/bb_tests/repositories"

const REPOS = [
  { name: "graphql-js", sub: "src", family: "TypeScript", dir: path.join(CORPUS, "graphql-js", "src") },
  { name: "rake", sub: "lib", family: "Ruby", dir: path.join(CORPUS, "rake", "lib") },
  { name: "rebar3", sub: "apps", family: "Erlang", dir: path.join(CORPUS, "rebar3", "apps") },
  { name: "ansible", sub: "lib/ansible", family: "Python", dir: path.join(CORPUS, "ansible", "lib", "ansible") },
  { name: "sqlite", sub: "src", family: "C", dir: path.join(CORPUS, "sqlite", "src") },
]

function indexOne(dir: string, dataDir: string) {
  mkdirSync(dataDir, { recursive: true })
  const started = Date.now()
  const res = spawnSync(TSX, [path.join(ROOT, "validation/tools/bb_security/work/probe-index-one.ts"), dir, dataDir], {
    cwd: ROOT, encoding: "utf8", timeout: 1_800_000,
    env: { ...process.env, BB_DATA_DIR: dataDir, BB_NO_AUTO_REFRESH: "1" },
  })
  return { status: res.status, stderr: (res.stderr ?? "").slice(-1500), stdout: (res.stdout ?? "").slice(-500), durationMs: Date.now() - started }
}

function parseAnswer(text: string) {
  const lines = text.split("\n")
  const firstLine = lines[0] ?? ""
  const head = lines.find((line) => line.startsWith("security leads:")) ?? lines[1] ?? ""
  const tierLine = lines.find((line) => line.startsWith("tiers: ")) ?? null
  const censusLine =
    lines.find((line) => line.startsWith("[leads:")) ??
    lines.find((line) => line.startsWith("[recordRun:")) ??
    null
  const notScannedLine = lines.find((line) => line.startsWith("not scanned by bb_security")) ?? null
  const storedMatch = text.match(/security leads: (\d+) stored lead\(s\)/)
  const leadLines = lines.filter((line) => /^ {2}\[(exec|high|medium|low)\] lead: /.test(line))
  const leadRecords = leadLines.map((line) => ({
    grade: line.match(/^ {2}\[(exec|high|medium|low)\]/)?.[1] ?? null,
    label: line.match(/\] lead: (.+?) @ /)?.[1] ?? null,
    location: line.match(/ @ ([^\s]+) <- source:/)?.[1] ?? null,
    rule: line.match(/; rule=([^;]+)/)?.[1] ?? null,
    sourceLine: line.match(/<- source:([^;]+);/)?.[1] ?? null,
  }))
  const leadCountByLabel: Record<string, number> = {}
  for (const record of leadRecords) leadCountByLabel[String(record.label)] = (leadCountByLabel[String(record.label)] ?? 0) + 1
  return {
    firstLine,
    bannerPresent: firstLine.startsWith("⚠️  LEXICAL TOKEN CO-OCCURRENCE"),
    head,
    tierLine,
    censusLine,
    notScannedLine,
    storedLeads: storedMatch ? Number(storedMatch[1]) : null,
    emptyDeclared: text.includes("declared empty, not a clean result"),
    engineInitialized: !text.includes("engine not initialized"),
    leadLines,
    leadRecords,
    leadCountByLabel,
    staleMarkers: (text.match(/\[stale\]/g) ?? []).length,
    payloadBytes: Buffer.byteLength(text),
  }
}

async function corpusCensus(dataDir: string, projectId: string) {
  process.env.BB_DATA_DIR = dataDir
  const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
  const languages = (raw.prepare("SELECT language, COUNT(*) c FROM brain_file WHERE project_id=? GROUP BY language ORDER BY c DESC").all(projectId) as Array<{ language: string | null; c: number }>).map((r) => ({ language: r.language, files: r.c }))
  const securityFlows = (() => {
    try {
      const total = Number((raw.prepare("SELECT COUNT(*) c FROM brain_security_flow WHERE project_id=?").get(projectId) as any).c)
      const byVulnerability = Object.fromEntries(
        (raw.prepare("SELECT vulnerability_type, COUNT(*) c FROM brain_security_flow WHERE project_id=? GROUP BY vulnerability_type ORDER BY c DESC").all(projectId) as Array<{ vulnerability_type: string; c: number }>)
          .map((row) => [row.vulnerability_type, Number(row.c)]),
      )
      const bySeverity = Object.fromEntries(
        (raw.prepare("SELECT severity, COUNT(*) c FROM brain_security_flow WHERE project_id=? GROUP BY severity ORDER BY c DESC").all(projectId) as Array<{ severity: string; c: number }>)
          .map((row) => [row.severity, Number(row.c)]),
      )
      const byState = Object.fromEntries(
        (raw.prepare("SELECT state, COUNT(*) c FROM brain_security_flow WHERE project_id=? GROUP BY state").all(projectId) as Array<{ state: string; c: number }>)
          .map((row) => [row.state, Number(row.c)]),
      )
      return { table: "brain_security_flow", initialized: true, total, byVulnerability, bySeverity, byState }
    } catch (error) {
      return { table: "brain_security_flow", initialized: false, total: null, byVulnerability: {}, bySeverity: {}, byState: {}, note: String(error instanceof Error ? error.message : error).slice(0, 200) }
    }
  })()
  const retiredTaintFlows = (() => {
    try {
      return { table: "brain_taint_flow", rows: Number((raw.prepare("SELECT COUNT(*) c FROM brain_taint_flow WHERE project_id=?").get(projectId) as any).c) }
    } catch {
      return { table: "brain_taint_flow", rows: null, note: "table absent — retired path never wrote it" }
    }
  })()
  const counts = {
    files: (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(projectId) as any).c,
    symbols: (raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(projectId) as any).c,
    relationships: (raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE project_id=?").get(projectId) as any).c,
    securityFlows,
    retiredTaintFlows,
  }
  const dbPath = BrainDatabase.getDbPath(projectId)
  return { languages, counts, dbPath, dbBytes: (() => { try { return statSync(dbPath).size } catch { return null } })() }
}

async function adversarialCases() {
  const cases: any[] = []

  // clean-negative: no stored lead, and the answer declares the empty store —
  // never a bare clean result.
  {
    const fixture = makeFixture("adv-clean", { "src/clean.ts": "export function add(a: number, b: number): number { return a + b }\n" })
    const dataDir = dataDirFor("adv-clean")
    rmSync(path.join(dataDir, "projects"), { recursive: true, force: true })
    const indexed = indexOne(fixture.dir, dataDir)
    const call = await mcpCall(fixture.dir, {}, { dataDir })
    const parsed = parseAnswer(call.text)
    cases.push({
      id: "clean-negative",
      requirement: "clean code produces no stored leads and the empty store is declared, not presented as a clean scan",
      index: indexed.status,
      isError: call.isError,
      parsed,
      pass: !call.isError && parsed.storedLeads === 0 && parsed.emptyDeclared === true && parsed.leadLines.length === 0,
      text: call.text.slice(0, 1500),
    })
    rmSync(dataDir, { recursive: true, force: true })
  }

  // parameterized-sql-negative: the M72 flow engine excludes a parameterized
  // (safe) query. This case must PASS — it is the defect the old token
  // cross-product recorded as a critical SQL injection (KNOWN-GAP in
  // script/m72/verify-security-phase0.ts until this evidence was regenerated).
  {
    const fixture = makeFixture("adv-parameterized", {
      "src/safe.ts": [
        "import { Client } from 'pg'",
        "const client = new Client()",
        "export function safe(req: any): unknown {",
        "  const q = req.query.q",
        "  return client.query('SELECT * FROM t WHERE name = $1', [q])",
        "}",
      ].join("\n"),
    })
    const dataDir = dataDirFor("adv-parameterized")
    rmSync(path.join(dataDir, "projects"), { recursive: true, force: true })
    const indexed = indexOne(fixture.dir, dataDir)
    const call = await mcpCall(fixture.dir, {}, { dataDir })
    const parsed = parseAnswer(call.text)
    const sqlLeadLines = parsed.leadLines.filter((line: string) => /sql injection/i.test(line))
    cases.push({
      id: "parameterized-sql-negative",
      requirement: "a parameterized (safe) sink is not an injection: no SQL-injection lead is reported for the $1-bound query",
      index: indexed.status,
      isError: call.isError,
      parsed,
      sqlInjectionLeads: sqlLeadLines.length,
      pass: !call.isError && parsed.storedLeads === 0 && sqlLeadLines.length === 0,
      note: "M72 Phase 1: deterministic/parameterized exclusions are specified in the TypeScript spec (`typescript.sql.binding`); the old token cross-product could not distinguish this case.",
      text: call.text.slice(0, 1500),
    })
    rmSync(dataDir, { recursive: true, force: true })
  }

  // sqli-positive: a concatenated SQL injection is a lead with file:line and the
  // demoted grade label — never a `[critical]` confirmed finding.
  {
    const fixture = makeFixture("adv-sqli", {
      "src/vuln.ts": [
        "import { Client } from 'pg'",
        "const client = new Client()",
        "export function search(req: any): unknown {",
        "  const q = req.query.q",
        "  return client.query(\"SELECT * FROM t WHERE name = '\" + q + \"'\")",
        "}",
      ].join("\n"),
    })
    const dataDir = dataDirFor("adv-sqli")
    rmSync(path.join(dataDir, "projects"), { recursive: true, force: true })
    const indexed = indexOne(fixture.dir, dataDir)
    const call = await mcpCall(fixture.dir, {}, { dataDir })
    const parsed = parseAnswer(call.text)
    const leadLine = parsed.leadLines.find((line: string) => /src\/vuln\.ts:\d+/.test(line) && /sql injection/i.test(line))
    cases.push({
      id: "sqli-positive",
      requirement: "a concatenated SQL injection is reported as a lead with a demoted grade, file:line and rule evidence — never as a confirmed [critical] finding",
      index: indexed.status,
      isError: call.isError,
      parsed,
      pass:
        !call.isError &&
        Boolean(leadLine) &&
        /\[(exec|high|medium|low)\] lead:/.test(leadLine ?? "") &&
        !(leadLine ?? "").includes("[critical]") &&
        !(leadLine ?? "").includes("confirmed"),
      text: call.text.slice(0, 1500),
    })
    rmSync(dataDir, { recursive: true, force: true })
  }

  // unsupported-project: a project whose only indexed language has no executable
  // source model must answer "not scanned by bb_security" — a clean zero is not
  // an answer.
  {
    const fixture = makeFixture("adv-unsupported", {
      "README.md": "# fixture\n\nPlain prose; no executable source model.\n",
      "cfg.yaml": "name: fixture\nrows:\n  - id: 1\n",
    })
    const dataDir = dataDirFor("adv-unsupported")
    rmSync(path.join(dataDir, "projects"), { recursive: true, force: true })
    const indexed = indexOne(fixture.dir, dataDir)
    const call = await mcpCall(fixture.dir, {}, { dataDir })
    const parsed = parseAnswer(call.text)
    const declaredLanguages = parsed.notScannedLine ? parsed.notScannedLine.replace(/^[^:]+:/, "") : ""
    cases.push({
      id: "unsupported-project-not-scanned",
      requirement: "a project containing only unsupported languages answers 'not scanned by bb_security' with the language ids; a clean zero would be a lie",
      index: indexed.status,
      isError: call.isError,
      parsed,
      pass:
        !call.isError &&
        Boolean(parsed.notScannedLine) &&
        /markdown/.test(declaredLanguages) &&
        /yaml/.test(declaredLanguages) &&
        parsed.leadLines.length === 0,
      text: call.text.slice(0, 1500),
    })
    rmSync(dataDir, { recursive: true, force: true })
  }

  // unindexed-project: the door must refuse
  {
    const fixture = makeFixture("adv-unindexed", { "src/only.ts": "export const x = 1\n" })
    const dataDir = dataDirFor("adv-unindexed")
    rmSync(dataDir, { recursive: true, force: true })
    mkdirSync(dataDir, { recursive: true })
    const call = await mcpCall(fixture.dir, {}, { dataDir })
    cases.push({
      id: "unindexed-project-refusal",
      requirement: "an unindexed project is refused with a named error, not answered as a clean project",
      isError: call.isError,
      pass: call.ok && call.isError === true && /No index found/.test(call.text),
      text: call.text.slice(0, 800),
    })
    rmSync(dataDir, { recursive: true, force: true })
  }

  // staleness: a touched lead file produces the [stale] marker, and the answer
  // is identical whether or not auto-refresh is allowed (this tool never refreshes).
  {
    const fixture = makeFixture("adv-stale", {
      "src/stale.ts": [
        "import { Client } from 'pg'",
        "const client = new Client()",
        "export function search(req: any): unknown {",
        "  const q = req.query.q",
        "  return client.query(\"SELECT * FROM t WHERE name = '\" + q + \"'\")",
        "}",
      ].join("\n"),
    })
    const dataDir = dataDirFor("adv-stale")
    rmSync(path.join(dataDir, "projects"), { recursive: true, force: true })
    const indexed = indexOne(fixture.dir, dataDir)
    const clean = await mcpCall(fixture.dir, {}, { dataDir })
    appendFileSync(path.join(fixture.dir, "src/stale.ts"), "\n// touched after indexing\n")
    const staleDisabled = await mcpCall(fixture.dir, {}, { dataDir, autoRefresh: false })
    const staleAllowed = await mcpCall(fixture.dir, {}, { dataDir, autoRefresh: true })
    const parsed = parseAnswer(staleDisabled.text)
    cases.push({
      id: "staleness-marker",
      requirement: "a touched lead file marks the lead [stale]; the answer is identical whether or not auto-refresh is allowed, because this tool never refreshes",
      index: indexed.status,
      isError: staleDisabled.isError,
      staleMarkers: parsed.staleMarkers,
      cleanLeadCount: parseAnswer(clean.text).storedLeads,
      identicalWithAutoRefresh: staleDisabled.text === staleAllowed.text,
      pass: !staleDisabled.isError && parsed.staleMarkers >= 1 && staleDisabled.text === staleAllowed.text,
      cleanAnswerBeforeTouch: clean.text.slice(0, 800),
      text: staleDisabled.text.slice(0, 1500),
    })
    rmSync(dataDir, { recursive: true, force: true })
  }

  return cases
}

async function main() {
  const out: any = {
    schemaVersion: 2,
    tool: "bb_security",
    kind: "real-corpus-and-adversarial",
    codeState: "M72 Phase 1 — spec engine leads persisted in brain_security_flow; legacy token cross-product retired (BB_SECURITY_LEGACY unset)",
    engine: {
      source: "src/intelligence/security/rebuild/{specs,matcher,flow,engine}.ts",
      store: "brain_security_flow",
      retiredStore: "brain_taint_flow (counted only to prove it is not written by the default path)",
      tierBaseline: "0 scan / 36 leads / 17 unsupported (registry.ts)",
      answerContract: "banner + registry tier line + per-project language declaration; leads carry the demoted grade label and never the word `confirmed`",
    },
    generatedAt: new Date().toISOString(),
    currentCommit: gitHead(),
    corpusRoot: CORPUS,
    door: "MCP stdio over the SOURCE entry: tsx src/cli/index.ts mcp --dir <project>",
    commands: {
      run: "BB_DATA_DIR=<per-corpus dir> BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_security/work/probe-real-corpus.ts",
      index: "tsx validation/tools/bb_security/work/probe-index-one.ts <dir> <dataDir>",
    },
    languages: [],
    corpora: [],
    adversarial: [],
  }

  // Adversarial cases first: they are the contract probes and fail fast.
  out.adversarial = await adversarialCases()
  for (const c of out.adversarial) console.log(`adversarial ${c.id}: pass=${c.pass}`)

  for (const repo of REPOS) {
    const dataDir = path.join(LANE, "bbdata", `corpus-${repo.name}`)
    mkdirSync(dataDir, { recursive: true })
    const existingDb = path.join(dataDir, "projects", getProjectId(repo.dir), "brain.db")
    const reused = existsSync(existingDb)
    const indexed = reused ? { status: 0, stderr: "", stdout: "", durationMs: 0, reusedExistingIndex: true } : indexOne(repo.dir, dataDir)
    console.log(`${repo.name}: ${reused ? "reusing" : "indexing"} ${repo.dir}`)
    let census: any = null
    let call: any = null
    let parsed: any = null
    let determinism = null
    if (indexed.status === 0) {
      process.env.BB_DATA_DIR = dataDir
      const projectId = getProjectId(repo.dir)
      census = await corpusCensus(dataDir, projectId)
      call = await mcpCall(repo.dir, {}, { dataDir, timeoutMs: 600_000 })
      parsed = parseAnswer(call.text)
      const again = await mcpCall(repo.dir, {}, { dataDir, timeoutMs: 600_000 })
      determinism = { identical: again.text === call.text, firstBytes: Buffer.byteLength(call.text), secondBytes: Buffer.byteLength(again.text) }
    }
    if (census?.languages) for (const l of census.languages) out.languages.push({ corpus: repo.name, family: repo.family, language: l.language, files: l.files })
    out.corpora.push({
      name: repo.name,
      subpath: repo.sub,
      family: repo.family,
      path: repo.dir,
      isolatedDataDir: dataDir,
      index: indexed,
      census,
      answer: call ? {
        ok: call.ok, isError: call.isError, durationMs: call.durationMs, payloadBytes: Buffer.byteLength(call.text),
        parsed,
        text: call.text.slice(0, 4000),
        elapsedSinceIndexMs: indexed.durationMs,
      } : null,
      determinism,
    })
    console.log(
      `${repo.name} (${repo.family}): index=${indexed.status} securityLeads=${census?.counts?.securityFlows?.total ?? "?"} retiredTaintRows=${census?.counts?.retiredTaintFlows?.rows ?? "absent"} answerLeads=${parsed?.storedLeads ?? "?"} door=${call?.durationMs ?? "?"}ms`,
    )
  }

  const file = path.join(LANE, "REAL-CORPUS.json")
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n")
  console.log(file)
}
await main()
