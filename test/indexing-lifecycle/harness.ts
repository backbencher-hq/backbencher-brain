// test/indexing-lifecycle/harness.ts — shared harness for the indexing-lifecycle suite.
//
// Matches the repo's existing verification-script convention (script/verify-index.ts,
// script/m22/verify-r1-resume.ts, script/m43/verify-p1-index-lock.ts):
//   * a `check`/`negative` counter,
//   * one `  ok: <label>` / `FAIL: <label> — <detail>` line per assertion,
//   * `process.exit(1)` when anything failed.
//
// Determinism rules enforced here (the whole suite depends on them):
//   * every project gets its own `$BB_DATA_DIR`, so no test can see another's DB,
//   * every fixture file gets a FIXED mtime, so the indexer's mtime+size
//     incremental filter never depends on wall-clock resolution,
//   * "was this file re-parsed?" is answered by a SENTINEL written into
//     `brain_file.time_updated`, not by comparing timestamps around the run.

import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, existsSync,
  cpSync, copyFileSync, symlinkSync, readdirSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** Repo root (this file is test/indexing-lifecycle/harness.ts). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

// ─────────────────────────────────────────────────────────────────────────────
// Suite plumbing
// ─────────────────────────────────────────────────────────────────────────────

export interface Suite {
  readonly name: string
  section(title: string): void
  check(label: string, ok: boolean, detail?: string): void
  negative(label: string, ok: boolean, detail?: string): void
  readonly checks: number
  readonly passed: number
  readonly failed: number
  readonly negatives: number
  finish(): never
}

export function createSuite(name: string): Suite {
  let checks = 0
  let passed = 0
  let failed = 0
  let negatives = 0
  const t0 = Date.now()

  const suite: Suite = {
    name,
    get checks() { return checks },
    get passed() { return passed },
    get failed() { return failed },
    get negatives() { return negatives },
    section(title: string) {
      console.log(`\n── ${title}`)
    },
    check(label: string, ok: boolean, detail = "") {
      checks++
      if (ok) {
        passed++
        console.log(`  ok: ${label}`)
      } else {
        failed++
        console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
      }
    },
    negative(label: string, ok: boolean, detail = "") {
      negatives++
      suite.check(`${label} [negative]`, ok, detail)
    },
    finish() {
      const secs = ((Date.now() - t0) / 1000).toFixed(1)
      console.log(
        `\n${name}: ${suite.passed}/${suite.checks} passed, ${suite.failed} failed, ` +
        `${suite.negatives} negative cases (${secs}s)`,
      )
      if (suite.failed === 0) console.log(`${name}: ALL PASS`)
      else console.log(`${name}: ${suite.failed} FAILURE(S)`)
      process.exit(suite.failed === 0 ? 0 : 1)
    },
  }
  return suite
}

/** Wire a suite into an unhandled-error path so a crash still exits non-zero. */
export function guard(suite: Suite, run: () => Promise<void>): void {
  run().catch((e) => {
    console.error(`${suite.name}: CRASHED`, e)
    process.exit(1)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Isolation: one $BB_DATA_DIR per test file
// ─────────────────────────────────────────────────────────────────────────────

const createdDirs: string[] = []

/**
 * Point BB_DATA_DIR at a fresh temp dir for the lifetime of this process.
 * `bbDataDir()` reads the env var on every call (src/util/bb-data-dir.ts:10),
 * so setting it before the first DB access is enough. The WASM grammar cache
 * lives in os.tmpdir() (src/ast/engine.ts:680), NOT in the data dir, so an
 * isolated data dir costs no re-extraction.
 */
export function isolateDataDir(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `bb-idxlife-${tag}-`))
  createdDirs.push(dir)
  process.env.BB_DATA_DIR = dir
  // Hermetic embeddings: with no BB_EMBEDDING_* set and no config.json in the
  // isolated data dir, `resolveEmbeddingConfig` reports configured=false and the
  // indexer uses its local word-vector fallback (src/config/config.ts:39-56).
  // Scrubbed explicitly so an ambient developer key cannot make a test reach the
  // network — the suite must be runnable with no network at all.
  for (const k of ["BB_EMBEDDING_BASE_URL", "BB_EMBEDDING_API_KEY", "BB_EMBEDDING_MODEL", "BB_CONFIG_FILE"]) {
    delete process.env[k]
  }
  return dir
}

export function cleanupAll(): void {
  for (const d of createdDirs) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ }
  }
}
process.on("exit", cleanupAll)

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — small, self-contained, fixed mtime
// ─────────────────────────────────────────────────────────────────────────────

/** 2020-01-01T00:00:00Z. Well in the past so a `Date.now()`-based column never collides. */
export const FIXED_MTIME = new Date("2020-01-01T00:00:00Z")
/** 2021-06-01T00:00:00Z — the "this file changed" timestamp. */
export const CHANGED_MTIME = new Date("2021-06-01T00:00:00Z")

export function setMtime(file: string, when: Date): void {
  utimesSync(file, when, when)
}

export interface Fixture {
  root: string
  /** Absolute paths of the .ts sources, in creation order. */
  files: string[]
  /** Absolute path of the project manifest (also indexed). */
  manifest: string
}

/**
 * A deterministic N-file TypeScript project. Every module declares three
 * uniquely-named symbols, so a snapshot diff can prove exactly which files were
 * re-parsed and whether the new content is what landed in the index.
 *
 *   src/mod<i>.ts   -> modFns<i>, modCls<i>, modConst<i>
 */
export function makeTsFixture(tag: string, n: number): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), `bb-idxlife-fixture-${tag}-`))
  mkdirSync(path.join(root, "src"), { recursive: true })
  const files: string[] = []
  for (let i = 0; i < n; i++) {
    const f = path.join(root, "src", `mod${i}.ts`)
    writeFileSync(f, moduleSource(i, "v1"))
    setMtime(f, FIXED_MTIME)
    files.push(f)
  }
  const manifest = path.join(root, "package.json")
  writeFileSync(manifest, JSON.stringify({ name: `fixture-${tag}`, version: "1.0.0" }, null, 2) + "\n")
  setMtime(manifest, FIXED_MTIME)
  return { root, files, manifest }
}

/** The source body written for module `i`, generation `v`. */
export function moduleSource(i: number, v: string): string {
  const n = v === "v1" ? 1 : v === "v2" ? 2 : 3
  return (
    `export function modFns${i}(x: number): number {\n` +
    `  return x + ${i} * ${n}\n` +
    `}\n` +
    `\n` +
    `export class modCls${i} {\n` +
    `  private modField${i}: number = ${n}\n` +
    `  modMethod${i}(): number {\n` +
    `    return this.modField${i}\n` +
    `  }\n` +
    `}\n` +
    `\n` +
    `export const modConst${i} = ${n}\n` +
    `export function modGen${i}_${v}(): string {\n` +
    `  return "${v}"\n` +
    `}\n`
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Project id (mirrors src/cli/index.ts getProjectId)
// ─────────────────────────────────────────────────────────────────────────────

/** Realpath-resolved sha1 of the project root — same shape as the CLI's id. */
export async function projectIdFor(projectRoot: string): Promise<string> {
  const { getProjectId } = await import("../../src/cli/index")
  return getProjectId(projectRoot)
}

// ─────────────────────────────────────────────────────────────────────────────
// DB access + snapshots
// ─────────────────────────────────────────────────────────────────────────────

export async function rawDb(projectId: string): Promise<any> {
  const { BrainDatabase } = await import("../../src/brain/database")
  return BrainDatabase.getRawInstance(projectId)
}

export interface IndexSnapshot {
  files: string[]
  symbols: string[]
  relationships: string[]
  imports: string[]
}

/** project-root-relative path of an indexed absolute path. */
function relOf(projectRoot: string, p: string): string {
  return path.relative(projectRoot, p).split(path.sep).join("/")
}

/**
 * A canonical, timestamp-free view of an index. Everything is sorted and every
 * volatile column (time_created / time_updated / gravity_score / metadata) is
 * dropped, so two snapshots can be compared byte-for-byte. Symbol and
 * relationship ids are `<projectId>:<relPath>:<name>:<line>`; the projectId
 * prefix is stripped so two DIFFERENT fixture directories (a clean run and a
 * resumed run) can be compared.
 */
export async function snapshotIndex(projectId: string, projectRoot: string): Promise<IndexSnapshot> {
  const db = await rawDb(projectId)
  const strip = (id: string) => String(id).replace(new RegExp(`^${projectId}:`), "")

  const files = (db.prepare("SELECT path FROM brain_file WHERE project_id = ?").all(projectId) as any[])
    .map((r) => relOf(projectRoot, r.path))
    .sort()

  const symbols = (db
    .prepare(
      `SELECT id, name, qualified_name, symbol_type, line_start, line_end, visibility, file_id
       FROM brain_symbol WHERE project_id = ?`,
    )
    .all(projectId) as any[])
    .map((r) => `${strip(r.id)}|${r.name}|${r.qualified_name}|${r.symbol_type}|${r.line_start}|${r.line_end}|${r.visibility}`)
    .sort()

  const relationships = (db
    .prepare(
      `SELECT source_symbol_id, target_symbol_id, source_external, target_external, relationship_type
       FROM brain_relationship WHERE project_id = ?`,
    )
    .all(projectId) as any[])
    .map(
      (r) =>
        `${r.source_symbol_id ? strip(r.source_symbol_id) : `EXT:${r.source_external}`}` +
        ` -${r.relationship_type}-> ` +
        `${r.target_symbol_id ? strip(r.target_symbol_id) : `EXT:${r.target_external}`}`,
    )
    .sort()

  const imports = (db
    .prepare(
      `SELECT i.file_id, i.imported_name, i.import_path, i.import_type
       FROM brain_import i WHERE i.project_id = ?`,
    )
    .all(projectId) as any[])
    .map((r) => `${r.file_id}|${r.imported_name}|${r.import_path}|${r.import_type}`)
    .sort()

  return { files, symbols, relationships, imports }
}

/** Human-readable differences between two snapshots (empty array === identical). */
export function diffSnapshots(
  a: IndexSnapshot,
  b: IndexSnapshot,
  aLabel = "A",
  bLabel = "B",
): string[] {
  const out: string[] = []
  const cmp = (key: keyof IndexSnapshot) => {
    const as = new Set(a[key] as string[])
    const bs = new Set(b[key] as string[])
    const onlyA = [...as].filter((x) => !bs.has(x))
    const onlyB = [...bs].filter((x) => !as.has(x))
    if (onlyA.length) out.push(`${key} only in ${aLabel} (${onlyA.length}): ${onlyA.slice(0, 4).join(" ; ")}`)
    if (onlyB.length) out.push(`${key} only in ${bLabel} (${onlyB.length}): ${onlyB.slice(0, 4).join(" ; ")}`)
  }
  cmp("files")
  cmp("symbols")
  cmp("relationships")
  cmp("imports")
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// "Was this file re-parsed?" — the sentinel instrument
// ─────────────────────────────────────────────────────────────────────────────

/**
 * brain_file.time_updated is `Date.now()` at store time, so it cannot separate
 * "parsed during run A" from "parsed during run B" if the two runs land in the
 * same millisecond. Instead of watching the clock, the test marks the rows it
 * cares about with SENTINEL (1). Any row whose time_updated is no longer the
 * sentinel was rewritten by a later run — i.e. that file was re-parsed.
 */
export const SENTINEL = 1

export async function markFiles(
  projectId: string,
  absPaths: string[],
): Promise<{ marked: number; absent: string[] }> {
  const db = await rawDb(projectId)
  const absent: string[] = []
  let marked = 0
  for (const p of absPaths) {
    const r = db.prepare("SELECT id FROM brain_file WHERE project_id = ? AND path = ?").get(projectId, p)
    if (!r) { absent.push(p); continue }
    db.prepare("UPDATE brain_file SET time_updated = ? WHERE project_id = ? AND path = ?").run(SENTINEL, projectId, p)
    marked++
  }
  return { marked, absent }
}

/** Of the marked paths, the ones whose row was rewritten after the sentinel. */
export async function reparsedFiles(projectId: string, absPaths: string[]): Promise<string[]> {
  const db = await rawDb(projectId)
  const out: string[] = []
  for (const p of absPaths) {
    const r = db.prepare("SELECT time_updated FROM brain_file WHERE project_id = ? AND path = ?").get(projectId, p)
    if (!r) continue
    if (Number(r.time_updated) !== SENTINEL) out.push(p)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSTIC-ONLY shim: the broken brain_symbol INSERT
// ─────────────────────────────────────────────────────────────────────────────
//
// WHAT THIS IS FOR. On this branch `src/ast/parallel-indexer.ts:2163-2165`
// carries a merge leftover: the brain_symbol INSERT has TWO `VALUES` clauses.
// That is a SQLite syntax error, so `rawDb.prepare()` throws, `storeResults`
// swallows it in a try/catch, and EVERY symbol insert is silently lost — the
// index comes out with files and zero symbols. It is a launch blocker.
//
// This shim repairs that statement IN THE TEST PROCESS ONLY, at the sqlite
// driver's `prepare`, so the rest of the lifecycle suite still produces signal
// about resume / incremental / lock / fallback instead of every test failing at
// the same first assertion. It is OFF unless BB_TEST_INSERT_SYMBOL_REPAIR=1 and
// it never runs by default — the default run of this suite reports the product
// as it actually is.
//
// The repair keeps the VALUES group whose placeholder count equals the column
// count (31 columns, 31 bound values at parallel-indexer.ts:3033-3105) and
// refuses to touch anything else.

export const INSERT_SYMBOL_REPAIR_ACTIVE = process.env.BB_TEST_INSERT_SYMBOL_REPAIR === "1"
export const insertSymbolRepairs = { applied: 0 }

function repairDoubledValues(sql: string): string {
  if (!/INSERT\s+OR\s+REPLACE\s+INTO\s+brain_symbol/i.test(sql)) return sql
  const groups = [...sql.matchAll(/VALUES\s*\(([^)]*)\)/g)]
  if (groups.length !== 2) return sql
  const counts = groups.map((g) => (g[1].match(/\?/g) ?? []).length)
  if (counts[0] === counts[1]) return sql
  const colMatch = sql.slice(0, groups[0].index!).match(/\(([^()]*)\)\s*$/)
  if (!colMatch) return sql
  const columnCount = colMatch[1].split(",").filter((s) => s.trim().length > 0).length
  const keepIndex = counts[0] > counts[1] ? 0 : 1
  // Only repair when the kept group actually matches the column list. If it does
  // not, this is a different statement and the test must fail loudly instead.
  if (counts[keepIndex] !== columnCount) return sql
  const drop = groups[keepIndex === 0 ? 1 : 0]
  insertSymbolRepairs.applied++
  return sql.slice(0, drop.index!) + sql.slice(drop.index! + drop[0].length)
}

export async function installInsertSymbolRepair(): Promise<void> {
  if (!INSERT_SYMBOL_REPAIR_ACTIVE) return
  const { default: Database } = await import("better-sqlite3")
  const proto = (Database as any).prototype
  if (proto.__bbIdxLifeRepaired) return
  const original = proto.prepare
  proto.prepare = function patched(sql: string) {
    return original.call(this, repairDoubledValues(String(sql)))
  }
  proto.__bbIdxLifeRepaired = true
}

/** One-line banner so a run's mode is never ambiguous. */
export function printModeBanner(suite: Suite): void {
  const repair = INSERT_SYMBOL_REPAIR_ACTIVE
    ? "ON  (diagnostic mode — the brain_symbol INSERT defect at src/ast/parallel-indexer.ts:2165 is patched IN-PROCESS; results below do NOT describe the shipped product)"
    : "off (product as-is)"
  console.log(`mode: repair-shim=${repair}`)
  console.log(`BB_DATA_DIR=${process.env.BB_DATA_DIR ?? "(unset)"}`)
  void suite
}

/** Remove a temp fixture root. */
export function rmFixture(root: string): void {
  try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ }
}

export function hasPath(p: string): boolean {
  return existsSync(p)
}

// ─────────────────────────────────────────────────────────────────────────────
// Driving the real `bb` CLI in a child process
// ─────────────────────────────────────────────────────────────────────────────

export interface CliResult {
  code: number
  stdout: string
  stderr: string
  timedOut: boolean
}

/**
 * Spawn the shipped CLI surface in its own process, with cwd set to the fixture
 * so no `bb.json` from the repo can leak in. Uses the repo's own tsx, so it
 * needs no global toolchain.
 *
 * This exists because two of the launch-critical paths (`bb index --resume`'s
 * checkpoint detection and its refusal/lock messaging) live in the CLI, not in
 * the library entry point.
 *
 * The child runs a generated 3-line entry that installs the diagnostic shim (if
 * it is on) and then calls the same `runCli()` the shipped bin/bb calls. The
 * shim has to be installed in the CHILD too — see installInsertSymbolRepair().
 */
export async function spawnCli(
  args: string[],
  opts: { cwd: string; timeoutMs?: number; repairShim?: boolean },
): Promise<CliResult> {
  const { spawnSync } = await import("node:child_process")
  const { writeFileSync } = await import("node:fs")
  const tsxCli = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs")
  const harnessPath = fileURLToPath(import.meta.url)
  const cliPath = path.join(REPO_ROOT, "src", "cli", "index.ts")
  // `.mts` because the entry is written OUTSIDE the repo, where the repo's
  // package.json `"type": "module"` does not apply and tsx would otherwise
  // compile it as CommonJS and reject its top-level await.

  const withShim = opts.repairShim ?? INSERT_SYMBOL_REPAIR_ACTIVE
  const entryDir = process.env.BB_DATA_DIR && process.env.BB_DATA_DIR !== path.join(process.env.HOME ?? "", ".bb")
    ? process.env.BB_DATA_DIR
    : mkdtempSync(path.join(tmpdir(), "bb-idxlife-entry-"))
  if (!createdDirs.includes(entryDir)) createdDirs.push(entryDir)
  const entry = path.join(entryDir, `cli-entry-${Math.abs(hashString(args.join(" ")))}.mts`)
  writeFileSync(
    entry,
    [
      `import { installInsertSymbolRepair } from ${JSON.stringify(harnessPath)}`,
      withShim ? `await installInsertSymbolRepair()` : `// repair shim intentionally absent`,
      `const { runCli } = await import(${JSON.stringify(cliPath)})`,
      `await runCli(JSON.parse(process.env.BB_IDXLIFE_ARGS ?? "[]"))`,
      ``,
    ].join("\n"),
  )

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: "1",
    BB_IDXLIFE_ARGS: JSON.stringify(args),
  }
  // Keep the child offline for the same reason the parent is.
  for (const k of ["BB_EMBEDDING_BASE_URL", "BB_EMBEDDING_API_KEY", "BB_EMBEDDING_MODEL", "BB_CONFIG_FILE"]) {
    delete env[k]
  }
  const r = spawnSync(process.execPath, [tsxCli, entry], {
    cwd: opts.cwd,
    env,
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 300_000,
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    code: r.status ?? -1,
    stdout: String(r.stdout ?? ""),
    stderr: String(r.stderr ?? ""),
    timedOut: r.signal === "SIGTERM" || r.signal === "SIGKILL",
  }
}

/** Stable, non-cryptological hash — used only to name generated child entries. */
function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}

/**
 * Run `fn` with this process's stderr captured. The indexer reports store-layer
 * failures through its logger and swallows them, so "did the store complain?"
 * is only observable on the stream, never in the return value.
 */
export async function captureStderr<T>(fn: () => Promise<T>): Promise<{ result: T; stderr: string }> {
  const original = process.stderr.write.bind(process.stderr)
  let buf = ""
  process.stderr.write = ((chunk: any, ...rest: any[]) => {
    buf += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
    const cb = rest.find((r) => typeof r === "function")
    if (cb) cb()
    return true
  }) as typeof process.stderr.write
  const originalError = console.error
  console.error = (...args: any[]) => { buf += args.map(String).join(" ") + "\n" }
  try {
    const result = await fn()
    return { result, stderr: buf }
  } finally {
    process.stderr.write = original
    console.error = originalError
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Running arbitrary child scripts
// ─────────────────────────────────────────────────────────────────────────────

export interface RawChild {
  child: import("node:child_process").ChildProcess
  /** Everything the child has written to stdout so far. */
  output(): string
}

export interface SpawnRawOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Resolve once this marker appears on stdout. No timers involved. */
  marker?: string
  markerTimeoutMs?: number
}

/**
 * Write a child script into the isolated data dir and run it with the repo's
 * tsx. `marker` makes the "wait until the child has reached state X" step
 * deterministic — the child announces the state itself, so the test never
 * sleeps and never races the child.
 */
export async function spawnRaw(code: string, opts: SpawnRawOptions = {}): Promise<RawChild> {
  const { spawn } = await import("node:child_process")
  const { writeFileSync } = await import("node:fs")
  const dir = process.env.BB_DATA_DIR ?? mkdtempSync(path.join(tmpdir(), "bb-idxlife-raw-"))
  if (!createdDirs.includes(dir)) createdDirs.push(dir)
  const file = path.join(dir, `raw-${Math.abs(hashString(code))}.mts`)
  writeFileSync(file, code)
  const tsxCli = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs")
  const child = spawn(process.execPath, [tsxCli, file], {
    cwd: opts.cwd ?? dir,
    env: { ...process.env, NO_COLOR: "1", ...(opts.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
    // `tsx` does not run the script in the process you spawn: cli.mjs re-execs
    // node with its loader as a CHILD (verified: the pid the script prints is
    // the grandchild's). Killing only the spawned process therefore leaves the
    // script alive — which silently breaks every "kill the lock holder" test.
    // `detached` puts the whole tree in its own process group so killTree() can
    // take all of it down.
    detached: true,
  })
  let buf = ""
  child.stdout?.on("data", (d) => { buf += String(d) })
  child.stderr?.on("data", (d) => { buf += String(d) })
  const handle: RawChild = { child, output: () => buf }
  if (opts.marker) {
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`child never printed ${opts.marker}: ${buf.slice(-400)}`)), opts.markerTimeoutMs ?? 30_000)
      const poll = setInterval(() => {
        if (buf.includes(opts.marker!)) { clearInterval(poll); clearTimeout(deadline); resolve() }
      }, 10)
      child.on("exit", () => { clearInterval(poll); clearTimeout(deadline); resolve() })
    })
  }
  return handle
}

export async function waitForExit(child: import("node:child_process").ChildProcess, timeoutMs = 15_000): Promise<number | null> {
  return await new Promise((resolve) => {
    let done = false
    const finish = (c: number | null) => { if (!done) { done = true; resolve(c) } }
    child.on("exit", (c) => finish(c))
    setTimeout(() => finish(null), timeoutMs)
  })
}

/**
 * SIGKILL a spawned child's whole process tree and wait for the spawned process
 * itself to exit. Necessary because `tsx` re-execs (see spawnRaw's `detached`).
 *
 * `scriptPid` (the pid the child script printed) is preferred over the group
 * kill when you have it: killing ONLY the script leaves its `tsx` parent alive
 * to reap it, so no ZOMBIE is left behind. That matters here, because the
 * product's staleness probe (`pidIsAliveLocally`, src/ast/index-lock.ts:96-117)
 * detects zombies only through /proc, which does not exist on macOS — a
 * zombie orphan there reads as ALIVE and the lock is never reclaimed.
 */
export async function killTree(
  child: import("node:child_process").ChildProcess,
  signal: NodeJS.Signals = "SIGKILL",
  scriptPid?: number,
): Promise<void> {
  if (scriptPid != null) {
    try { process.kill(scriptPid, signal) } catch { /* already gone */ }
  } else {
    const pgid = child.pid
    if (pgid != null) {
      try { process.kill(-pgid, signal) } catch { try { child.kill(signal) } catch { /* already gone */ } }
    } else {
      try { child.kill(signal) } catch { /* already gone */ }
    }
  }
  await waitForExit(child)
}

// ─────────────────────────────────────────────────────────────────────────────
// Shadow repo with tsx REMOVED — the only faithful way to exercise the
// "tsx is unavailable" fallback (resolvePoolWorkerFork, parallel-indexer.ts:1208)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `resolvePoolWorkerFork()` decides "tsx is unavailable" from exactly three
 * facts about the running module: it is NOT under dist/, process.execPath is
 * node, and NEITHER <repoRoot>/node_modules/.bin/tsx NOR `tsx` on PATH exists.
 * None of those can be changed for an in-repo test without mutating shared
 * state (node_modules/.bin/tsx is one file shared by every worktree), so the
 * fallback is exercised from a shadow copy of `src/` that has a node_modules
 * with every package EXCEPT `.bin`, and a PATH with no tsx on it.
 *
 * Returns the shadow root. Read-only w.r.t. the repo: `wasm/` and `grammars/`
 * are symlinked, node_modules entries are symlinked, and only src/, tsconfig
 * and package.json are copied.
 */
export function buildShadowRepoWithoutTsx(): string {
  const shadow = mkdtempSync(path.join(tmpdir(), "bb-idxlife-shadow-"))
  createdDirs.push(shadow)
  cpSync(path.join(REPO_ROOT, "src"), path.join(shadow, "src"), { recursive: true })
  for (const f of ["package.json", "tsconfig.json"]) {
    copyFileSync(path.join(REPO_ROOT, f), path.join(shadow, f))
  }
  for (const d of ["wasm", "grammars"]) {
    try { symlinkSync(path.join(REPO_ROOT, d), path.join(shadow, d), "dir") } catch { /* optional */ }
  }
  const nm = path.join(shadow, "node_modules")
  mkdirSync(nm)
  for (const entry of readdirSync(path.join(REPO_ROOT, "node_modules"))) {
    if (entry === ".bin" || entry === ".cache") continue
    try { symlinkSync(path.join(REPO_ROOT, "node_modules", entry), path.join(nm, entry)) } catch { /* ignore */ }
  }
  return shadow
}

/** A PATH with no tsx anywhere on it (npx puts node_modules/.bin on PATH). */
export const TSX_FREE_PATH = "/usr/bin:/bin"