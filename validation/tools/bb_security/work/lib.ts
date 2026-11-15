// Shared probe helpers for the bb_security audit. Not product code: this file
// exists so every measured claim in validation/tools/bb_security/ cites one
// reproducible command instead of a hand-copied observation.

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../../../src/util/project-id"

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const LANE = path.resolve(HERE, "..")
export const ROOT = path.resolve(LANE, "../../..")
export const DATA = path.join(LANE, "bbdata")
export const AUDIT = path.join(LANE, "audit")
export const TSX = path.join(ROOT, "node_modules", ".bin", "tsx")

export function ensureDirs(): void {
  for (const dir of [DATA, AUDIT, path.join(LANE, "work", "fixtures")]) mkdirSync(dir, { recursive: true })
}

export interface Fixture {
  name: string
  dir: string
  projectId: string
}

/** Create a source-tree fixture under work/fixtures (deterministic path, no tmpdir). */
export function makeFixture(name: string, files: Record<string, string>): Fixture {
  const dir = path.join(LANE, "work", "fixtures", name)
  rmSync(dir, { recursive: true, force: true })
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  mkdirSync(dir, { recursive: true })
  return { name, dir, projectId: getProjectId(dir) }
}

export function dataDirFor(name: string): string {
  return path.join(DATA, name)
}

export interface FileFingerprint {
  path: string
  exists: boolean
  size: number
  mtimeMs: number
  sha256: string | null
}

export function fingerprint(file: string, hashLimitBytes = 256 * 1024 * 1024): FileFingerprint {
  if (!existsSync(file)) return { path: file, exists: false, size: 0, mtimeMs: 0, sha256: null }
  const st = statSync(file)
  const sha256 = st.size <= hashLimitBytes ? createHash("sha256").update(readFileSync(file)).digest("hex") : null
  return { path: file, exists: true, size: st.size, mtimeMs: st.mtimeMs, sha256 }
}

/** Every sqlite file in one project's data dir (db, -wal, -shm). */
export function projectDbFiles(dataDir: string, projectId: string): string[] {
  const dir = path.join(dataDir, "projects", projectId)
  if (!existsSync(dir)) return [path.join(dir, "brain.db")]
  return readdirSync(dir).filter((f) => f.startsWith("brain.db")).map((f) => path.join(dir, f)).sort()
}

export function snapshotProjectDb(dataDir: string, projectId: string, hashLimitBytes?: number): FileFingerprint[] {
  return projectDbFiles(dataDir, projectId).map((f) => fingerprint(f, hashLimitBytes))
}

/** Summarise SQLite fleet activity for a project without opening it read-write. */
export function sqliteFileStats(dataDir: string, projectId: string) {
  const files = projectDbFiles(dataDir, projectId)
  const out: Record<string, { exists: boolean; size: number; mtime: string }> = {}
  for (const f of files) {
    const fp = fingerprint(f)
    out[path.basename(f)] = { exists: fp.exists, size: fp.size, mtime: new Date(fp.mtimeMs).toISOString() }
  }
  return out
}

export function changed(before: FileFingerprint[], after: FileFingerprint[], opts: { ignoreMtime?: boolean } = {}): string[] {
  const reasons: string[] = []
  const mapBefore = new Map(before.map((f) => [f.path, f]))
  for (const a of after) {
    const b = mapBefore.get(a.path)
    if (!b) { reasons.push(`${path.basename(a.path)}: appeared`); continue }
    if (b.exists !== a.exists) reasons.push(`${path.basename(a.path)}: exists ${b.exists}->${a.exists}`)
    if (b.size !== a.size) reasons.push(`${path.basename(a.path)}: size ${b.size}->${a.size}`)
    if (!opts.ignoreMtime && b.mtimeMs !== a.mtimeMs) reasons.push(`${path.basename(a.path)}: mtime ${new Date(b.mtimeMs).toISOString()}->${new Date(a.mtimeMs).toISOString()}`)
    if (b.sha256 && a.sha256 && b.sha256 !== a.sha256) reasons.push(`${path.basename(a.path)}: sha256 changed`)
  }
  return reasons
}

export function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex")
}

export interface McpCallResult {
  ok: boolean
  isError: boolean
  text: string
  structured: unknown
  durationMs: number
  stderr: string
  timedOut: boolean
}

/**
 * One real MCP stdio session over the SOURCE door:
 *   node_modules/.bin/tsx src/cli/index.ts mcp --dir <project>
 * `env` fully controls BB_DATA_DIR / BB_NO_AUTO_REFRESH so a read cannot fall
 * back to the shared index by accident.
 */
export async function mcpCall(projectDir: string, args: Record<string, unknown>, options: {
  dataDir: string
  autoRefresh?: boolean
  timeoutMs?: number
  tool?: string
  extraArgs?: Record<string, unknown>
}): Promise<McpCallResult> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
  const started = Date.now()
  const stderrChunks: string[] = []
  const env: Record<string, string> = {
    ...(Object.fromEntries(Object.entries(process.env).filter(([, v]) => typeof v === "string")) as Record<string, string>),
    BB_DATA_DIR: options.dataDir,
  }
  if (options.autoRefresh !== true) env.BB_NO_AUTO_REFRESH = "1"
  else delete env.BB_NO_AUTO_REFRESH
  const transport = new StdioClientTransport({
    command: TSX,
    args: [path.join(ROOT, "src", "cli", "index.ts"), "mcp", "--dir", projectDir],
    cwd: ROOT,
    env,
    stderr: "pipe",
  })
  const client = new Client({ name: "bb-security-audit", version: "1.0.0" })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; try { client.close() } catch {} }, options.timeoutMs ?? 30_000)
  try {
    transport.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(String(chunk)))
    await client.connect(transport)
    const result: any = await client.callTool({
      name: options.tool ?? "bb_security",
      arguments: { ...args, ...(options.extraArgs ?? {}) },
    })
    const text = (result?.content ?? []).map((c: any) => c?.text ?? "").join("\n")
    return { ok: true, isError: result?.isError === true, text, structured: result?.structuredContent ?? null, durationMs: Date.now() - started, stderr: stderrChunks.join(""), timedOut }
  } catch (error: any) {
    return { ok: false, isError: true, text: `CLIENT_ERROR: ${error?.message ?? String(error)}`.slice(0, 2000), structured: null, durationMs: Date.now() - started, stderr: stderrChunks.join(""), timedOut }
  } finally {
    clearTimeout(timer)
    try { await client.close() } catch {}
  }
}

/** Call the tool through the SOURCE CLI (`tsx src/cli/index.ts tool bb_security`). */
export function cliCall(projectDir: string, args: Record<string, unknown>, options: { dataDir: string; timeoutMs?: number }): { code: number; stdout: string; stderr: string; durationMs: number } {
  const started = Date.now()
  const res = spawnSync(TSX, [path.join(ROOT, "src", "cli", "index.ts"), "tool", "bb_security", "--dir", projectDir, "--args", JSON.stringify(args)], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 60_000,
    env: { ...process.env, BB_DATA_DIR: options.dataDir, BB_NO_AUTO_REFRESH: "1" },
  })
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "", durationMs: Date.now() - started }
}

export function writeEvidence(name: string, payload: unknown): string {
  const file = path.join(AUDIT, name)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(payload, null, 2) + "\n")
  return file
}

export function gitHead(): string {
  try {
    return String(spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout).trim()
  } catch {
    return "unknown"
  }
}
