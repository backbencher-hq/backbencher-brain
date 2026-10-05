// test/cli-surface/harness.ts — shared harness for the CLI-surface suite.
//
// Follows the repo's verification-script convention (script/verify-index.ts,
// script/m22/verify-r1-resume.ts): a `check`/`negative` counter, one
// `ok:` / `FAIL:` line per assertion, exit 1 when anything fails.
//
// Determinism rules this file enforces:
//   * every CLI invocation runs in a child process with its own $BB_DATA_DIR,
//     so nothing touches ~/.bb and no suite can see another's DB;
//   * embedding config is scrubbed from the child env, so no assertion can
//     reach the network (the product falls back to local word vectors);
//   * fixture files get a FIXED mtime;
//   * nothing is mocked. Every assertion is made against what the shipped
//     `bb` entry point actually prints.

import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync, readFileSync, readdirSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
export const CLI_ENTRY = path.join(REPO_ROOT, "src", "cli", "index.ts")
export const MAN_PAGE = path.join(REPO_ROOT, "docs", "man", "bb.1")
export const TSX_CLI = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs")

/** 2020-01-01Z — fixed, so nothing depends on clock resolution. */
export const FIXED_MTIME = new Date("2020-01-01T00:00:00Z")

// ─────────────────────────────────────────────────────────────────────────────
// Suite plumbing
// ─────────────────────────────────────────────────────────────────────────────

export interface Suite {
  readonly name: string
  section(title: string): void
  check(label: string, ok: boolean, detail?: string): void
  negative(label: string, ok: boolean, detail?: string): void
  note(text: string): void
  readonly checks: number
  readonly passed: number
  readonly failed: number
  readonly negatives: number
  finish(): never
}

export function createSuite(name: string): Suite {
  let checks = 0, passed = 0, failed = 0, negatives = 0
  const t0 = Date.now()
  const suite: Suite = {
    name,
    get checks() { return checks },
    get passed() { return passed },
    get failed() { return failed },
    get negatives() { return negatives },
    section(t) { console.log(`\n── ${t}`) },
    note(t) { console.log(`  note: ${t}`) },
    check(label, ok, detail = "") {
      checks++
      if (ok) { passed++; console.log(`  ok: ${label}`) }
      else { failed++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
    },
    negative(label, ok, detail = "") { negatives++; suite.check(`${label} [negative]`, ok, detail) },
    finish() {
      const secs = ((Date.now() - t0) / 1000).toFixed(1)
      console.log(
        `\n${name}: ${suite.passed}/${suite.checks} passed, ${suite.failed} failed, ` +
        `${suite.negatives} negative cases (${secs}s)`,
      )
      console.log(suite.failed === 0 ? `${name}: ALL PASS` : `${name}: ${suite.failed} FAILURE(S)`)
      process.exit(suite.failed === 0 ? 0 : 1)
    },
  }
  return suite
}

export function guard(suite: Suite, run: () => Promise<void>): void {
  run().catch((e) => {
    console.error(`${suite.name}: CRASHED`, e)
    process.exit(1)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Isolation + fixtures
// ─────────────────────────────────────────────────────────────────────────────

const created: string[] = []
let dataDir: string | null = null

process.on("exit", () => {
  for (const d of created) {
    for (let i = 0; i < 2; i++) {
      try { rmSync(d, { recursive: true, force: true }); break } catch { /* best effort */ }
    }
  }
})

/** A fresh $BB_DATA_DIR for this process and all its children. */
export function isolatedDataDir(tag: string): string {
  const d = mkdtempSync(path.join(tmpdir(), `bb-cli-${tag}-`))
  created.push(d)
  dataDir = d
  return d
}

export function dataDirPath(): string {
  if (!dataDir) throw new Error("isolatedDataDir() was not called")
  return dataDir
}

/**
 * A deterministic 3-module TypeScript project. `alpha<i>` is the symbol every
 * search assertion looks for; `beta<i>` is a constant so content/symbol modes
 * have something distinct to find.
 */
export function makeFixture(tag: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `bb-clifix-${tag}-`))
  created.push(root)
  mkdirSync(path.join(root, "src"), { recursive: true })
  for (let i = 0; i < 3; i++) {
    const f = path.join(root, "src", `m${i}.ts`)
    writeFileSync(
      f,
      `export function alpha${i}(x: number): number {\n  return x + ${i}\n}\n\n` +
      `export const beta${i} = "value-${i}"\n`,
    )
    utimesSync(f, FIXED_MTIME, FIXED_MTIME)
  }
  const pkg = path.join(root, "package.json")
  writeFileSync(pkg, `{\n  "name": "cli-surface-${tag}",\n  "version": "1.0.0"\n}\n`)
  utimesSync(pkg, FIXED_MTIME, FIXED_MTIME)
  return root
}

/** An empty directory, for the "no index here" paths. */
export function makeEmptyDir(tag: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `bb-clidir-${tag}-`))
  created.push(root)
  return root
}

// ─────────────────────────────────────────────────────────────────────────────
// Running the CLI
// ─────────────────────────────────────────────────────────────────────────────

export interface CliResult {
  code: number
  out: string
  err: string
  all: string
  signal: NodeJS.Signals | null
  timedOut: boolean
}

/** Commander's usage-error signatures. The matrix uses these as its discriminator. */
export const UNKNOWN_COMMAND = /unknown command '([^']+)'/
export const UNKNOWN_OPTION = /unknown option '(--?[^']+)'/
export const MISSING_ARG = /option '(--[^']+)' argument missing/
export const MISSING_POSITIONAL = /missing required argument '([^']+)'/

function childEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", BB_LOG_LEVEL: "error", ...extra }
  // Scrubbed unless the caller deliberately set them: the suite must never
  // reach the network, but the doctor checks need a configured provider to
  // prove a diagnostic actually stops reporting a missing one.
  for (const k of ["BB_EMBEDDING_BASE_URL", "BB_EMBEDDING_API_KEY", "BB_EMBEDDING_MODEL", "BB_CONFIG_FILE"]) {
    if (!(k in extra)) delete env[k]
  }
  if (dataDir) env.BB_DATA_DIR = dataDir
  return env
}

/**
 * Run the shipped CLI entry point in its own process.
 *
 * `src/cli/index.ts` IS the CLI's own "run me directly" entry (it self-execs via
 * `import.meta.main`), so this is the same code path `bin/bb` drives through
 * `runCli`. Nothing here stubs or mocks the product.
 */
export function bb(
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; input?: string; env?: NodeJS.ProcessEnv; entry?: string } = {},
): CliResult {
  const entry = opts.entry ?? CLI_ENTRY
  const r = spawnSync(process.execPath, [TSX_CLI, entry, ...args], {
    cwd: opts.cwd ?? REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: opts.timeoutMs ?? 240_000,
    input: opts.input ?? "",
    env: childEnv(opts.env),
  })
  const out = String(r.stdout ?? "")
  const err = String(r.stderr ?? "")
  return {
    code: r.status ?? -1,
    out,
    err,
    all: out + err,
    signal: (r.signal as NodeJS.Signals) ?? null,
    timedOut: r.signal === "SIGTERM" || r.signal === "SIGKILL",
  }
}

/** An MCP JSON-RPC `initialize` request, for driving `bb mcp`. */
export function mcpInitialize(id = 1): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "cli-surface-probe", version: "0" },
    },
  })
}

/** Parse the newline-delimited JSON an MCP stdio server writes. */
export function parseJsonRpcLines(text: string): any[] {
  const out: any[] = []
  for (const line of text.split("\n")) {
    const t = line.trim()
    if (!t.startsWith("{")) continue
    try { out.push(JSON.parse(t)) } catch { /* not a frame */ }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Help parsing (commander's output layout)
// ─────────────────────────────────────────────────────────────────────────────

export interface HelpEntry {
  /** e.g. `index [options] [dir]` or `--dir <dir>` / `-v, --version`. */
  spec: string
  description: string
  /** Every literal flag token in the spec, long and short. */
  flags: string[]
  /** The first token — the command name for a command entry. */
  name: string
}

/**
 * Parse one commander help block into its sections. Entries are the lines at
 * indent 2; deeper-indented lines are their wrapped description.
 */
export function parseHelp(text: string): Record<string, HelpEntry[]> {
  const sections: Record<string, HelpEntry[]> = {}
  let current: HelpEntry[] | null = null
  let pending: HelpEntry | null = null
  for (const raw of text.split("\n")) {
    const header = /^([A-Z][A-Za-z ]*):\s*$/.exec(raw)
    if (header) {
      current = sections[header[1]] ?? []
      sections[header[1]] = current
      pending = null
      continue
    }
    if (!current) continue
    if (!raw.trim()) { pending = null; continue }
    const indent = raw.length - raw.replace(/^ +/, "").length
    if (indent === 2) {
      // `spec` then 2+ spaces then `description`; commander pads to a column.
      const m = /^ {2}(\S.*?)(?: {2,}(\S.*))?$/.exec(raw)
      if (!m) { pending = null; continue }
      const spec = m[1].trim()
      const description = (m[2] ?? "").trim()
      const flags = spec.match(/(?:^|[\s,])--?[A-Za-z][A-Za-z0-9-]*/g)?.map((f) => f.trim()) ?? []
      pending = { spec, description, flags, name: spec.split(/\s+/)[0] }
      current.push(pending)
    } else if (pending && indent > 2) {
      // A wrapped continuation line belongs to the previous entry.
      pending.description = [pending.description, raw.trim()].filter(Boolean).join(" ")
    }
  }
  return sections
}

/** The command list from `bb --help`. */
export function commandsFrom(rootHelp: string): HelpEntry[] {
  return parseHelp(rootHelp).Commands ?? []
}

/** The option list from `bb help <cmd>`. */
export function optionsFrom(cmdHelp: string): HelpEntry[] {
  return parseHelp(cmdHelp).Options ?? []
}

// ─────────────────────────────────────────────────────────────────────────────
// Source-surface parsing (help must not be able to hide a flag)
// ─────────────────────────────────────────────────────────────────────────────

export interface SourceSurface {
  commands: string[]
  /** "<parent> <sub>" for each subcommand registered on a parent. */
  subcommands: string[]
  /** per command: the literal long flags registered in source */
  options: Record<string, string[]>
  globalOptions: string[]
}

/**
 * Read the command/flag surface straight out of the source. Help output is
 * generated FROM this, so comparing the two is what makes "help lists
 * everything" a real check rather than a tautology: a flag registered but
 * hidden, or shown but unregistered, both fail.
 *
 * Subcommands matter here. The file registers them on an alias —
 * `const setupCmd = program.command("setup")` then `setupCmd.command("show")` —
 * so a naive `.command("...")` scan reports `show` as a top-level command that
 * `bb --help` never lists.
 */
export function sourceSurface(): SourceSurface {
  const src = readFileSync(CLI_ENTRY, "utf8")

  // `const <alias> = program` followed by `.command("<name>")`
  const aliases = new Map<string, string>()
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*program\s*\n?\s*\.command\("([a-z0-9-]+)"/g)) {
    aliases.set(m[1], m[2])
  }

  const commands: string[] = []
  const subcommands: string[] = []
  for (const m of src.matchAll(/(\w+)?\s*\.command\("([a-z0-9-]+)"/g)) {
    const receiver = m[1]
    const name = m[2]
    if (receiver && aliases.has(receiver)) subcommands.push(`${aliases.get(receiver)} ${name}`)
    else if (receiver === "program" || receiver === undefined) {
      if (name !== "setup") commands.push(name)
      else commands.push(name)
    }
  }

  const options: Record<string, string[]> = {}
  const globalOptions: string[] = []
  let current: string | null = null
  const tokens = [...src.matchAll(/\.command\("([a-z0-9-]+)"|\.option\("(--?[A-Za-z0-9-]+)/g)]
  for (const t of tokens) {
    if (t[1] !== undefined) {
      current = t[1]
      options[current] ??= []
    } else if (t[2] !== undefined) {
      if (current) options[current].push(t[2])
      else globalOptions.push(t[2])
    }
  }
  return { commands, subcommands, options, globalOptions }
}

// ─────────────────────────────────────────────────────────────────────────────
// Man page parsing
// ─────────────────────────────────────────────────────────────────────────────

export interface ManPage {
  raw: string
  /** `.SH` section name -> body text. */
  sections: Record<string, string>
  /**
   * One entry per `.TP` in COMMANDS, in order. `key` is `name`, `name sub` or
   * `name sub --flag` — duplicates preserved, because a duplicated command
   * entry is itself a man-page defect this suite looks for.
   */
  entries: Array<{ key: string; name: string; sub?: string; flag?: string; prose: string }>
  /** Distinct command names documented in COMMANDS. */
  documentedCommands: string[]
}

/** roff escapes a literal `-` as `\-`; unescape before substring matching. */
export function unRoff(s: string): string {
  return s.replace(/\\-/g, "-").replace(/\\&/g, "").replace(/\\f[BIRP]/g, "")
}

export function parseManPage(): ManPage {
  const raw = readFileSync(MAN_PAGE, "utf8")
  const sections: Record<string, string> = {}
  let name: string | null = null
  let buf: string[] = []
  const flush = () => { if (name) sections[name] = buf.join("\n") }
  for (const line of raw.split("\n")) {
    const h = /^\.SH\s+(\S+)/.exec(line)
    if (h) { flush(); name = h[1]; buf = []; continue }
    if (name) buf.push(line)
  }
  flush()

  // COMMANDS is a run of `.TP` blocks. Only the FIRST `.B`/`.BI` line after a
  // `.TP` is the entry's synopsis — every later `.B` inside the block is prose
  // (`doctor --fix`, `--remove <id>`, `-v`, ...), and treating those as entries
  // is what makes a naive parser report `--force` as a command.
  const entries: ManPage["entries"] = []
  const lines = (sections.COMMANDS ?? "").split("\n")
  let i = 0
  while (i < lines.length) {
    if (lines[i].trim() !== ".TP") { i++; continue }
    const specLine = lines.slice(i + 1).find((l) => /^\.B[IB]?\s/.test(l.trim()))
    const specAt = lines.findIndex((l, idx) => idx > i && /^\.B[IB]?\s/.test(l.trim()))
    if (specAt === -1) { i++; continue }
    const spec = unRoff(lines[specAt].trim().replace(/^\.B[IB]?\s*/, "").trim())
    // prose runs until the next `.TP`
    let j = specAt + 1
    const proseLines: string[] = []
    while (j < lines.length && lines[j].trim() !== ".TP") { proseLines.push(lines[j]); j++ }
    const prose = unRoff(proseLines.join(" ")).replace(/\s+/g, " ").trim()
    const tokens = spec.split(/\s+/).filter((t) => !/^["']/.test(t))
    const cmdName = /^[a-z][a-z0-9-]*$/.test(tokens[0] ?? "") ? tokens[0] : null
    if (cmdName) {
      const rest = tokens.slice(1)
      const flag = rest.find((t) => /^-/.test(t))
      const sub = rest.find((t) => !/^-/.test(t) && !/["']/.test(t))
      const key = [cmdName, sub, flag].filter(Boolean).join(" ")
      entries.push({ key, name: cmdName, sub, flag, prose })
    }
    void specLine
    i = j
  }
  const documentedCommands = [...new Set(entries.map((e) => e.name))]
  return { raw, sections, entries, documentedCommands }
}

/** Is `token` mentioned anywhere in the man page's prose? */
export function manMentions(man: ManPage, token: string): boolean {
  return man.raw.includes(token) || unRoff(man.raw).includes(token)
}

// ─────────────────────────────────────────────────────────────────────────────
// Misc
// ─────────────────────────────────────────────────────────────────────────────

export function pkgJson(): any {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"))
}

export function repoFileExists(rel: string): boolean {
  return existsSync(path.join(REPO_ROOT, rel))
}

/** Count a table in a project's brain.db — the ground truth `bb stats` claims. */
export interface DbCounts {
  projectId: string
  files: number
  symbols: number
  relationships: number
  embeddings: number
}

export async function dbCounts(projectRoot: string): Promise<DbCounts> {
  const { BrainDatabase } = await import(path.join(REPO_ROOT, "src/brain/database.ts"))
  const { getProjectId } = await import(path.join(REPO_ROOT, "src/cli/index.ts"))
  if (!dataDir) throw new Error("isolatedDataDir() was not called")
  process.env.BB_DATA_DIR = dataDir
  const pid = getProjectId(projectRoot)
  const db = await BrainDatabase.getRawInstance(pid)
  const scoped = (table: string) =>
    (db.prepare("SELECT COUNT(*) c FROM " + table + " WHERE project_id = ?").get(pid) as any)?.c ?? 0
  return {
    projectId: pid,
    files: scoped("brain_file"),
    symbols: scoped("brain_symbol"),
    relationships: scoped("brain_relationship"),
    embeddings: (db.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding").get() as any)?.c ?? 0,
  }
}

/** Recursive listing of the data dir, for proving a "read-only" command wrote nothing. */
export function dataDirListing(): string[] {
  const out: string[] = []
  const walk = (dir: string, depth = 0) => {
    if (depth > 6 || !existsSync(dir)) return
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name)
      out.push(`${path.relative(dataDirPath(), p)}${e.isDirectory() ? "/" : ""}`)
      if (e.isDirectory()) walk(p, depth + 1)
    }
  }
  walk(dataDirPath())
  return out
}

/** Parse the `files N | symbols N | …` line `bb stats` prints. */
export function parseStatsLine(out: string): Record<string, number> | null {
  const m = /files\s+(\d+)\s*\|\s*symbols\s+(\d+)\s*\|\s*relationships\s+(\d+)\s*\|\s*embeddings\s+(\d+)/.exec(out)
  if (!m) return null
  return { files: Number(m[1]), symbols: Number(m[2]), relationships: Number(m[3]), embeddings: Number(m[4]) }
}