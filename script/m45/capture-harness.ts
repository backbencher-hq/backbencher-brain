// script/m45/capture-harness.ts — M45.C1 (issue #709), shared core.
//
// The module both the C1 verifier and the D1 film tooling consume. A video
// is a claim; this module makes the claim checkable by turning a capture
// into (a) a reproducible corpus+index state and (b) a sidecar manifest
// matching the G1-declared schema. The real-VS-Code pixel capture lives in
// the verifier/driver scripts that import this core — the editor leg is
// machine-gated there (Xvfb + code + VSIX availability are checked, never
// assumed).
//
// One-library rule (M26 lineage): every M45 capture path consumes THIS
// module; per-leg re-implementations of index hashing / manifest writing
// are banned.
//
// Run: imported by script/m45/verify-capture-harness.ts and the D1 driver.

import { createHash } from "node:crypto"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)

export const M45_CORPUS_REL = "test/fixtures/m45-demo/src"
export const M45_EDITOR = "vscode"
export const M45_MIN_CODE = "1.85.0" // extension engines: ^1.85.0

export interface IndexedCorpus {
  dataDir: string
  dbPath: string
  projectId: string
  indexHash: string
  stats: { files: number; symbols: number; relationships: number }
  commit: string
}

/** Fresh index of the committed corpus into a controlled data dir. */
export function indexCorpus(ro: { root: string; dataDir: string; corpusAbs?: string }): IndexedCorpus {
  const corpusAbs = ro.corpusAbs ?? path.join(ro.root, M45_CORPUS_REL)
  if (!existsSync(corpusAbs)) throw new Error(`capture-harness: corpus missing at ${corpusAbs}`)
  const bbBin = path.join(ro.root, "bin", "bb")
  mkdirSync(ro.dataDir, { recursive: true })
  const res = spawnSync(process.execPath, [bbBin, "index", corpusAbs], {
    cwd: ro.root,
    env: { ...process.env, BB_DATA_DIR: ro.dataDir },
    encoding: "utf8",
    timeout: 180_000,
  })
  if (res.status !== 0) {
    throw new Error(`capture-harness: bb index failed (exit ${res.status}): ${(res.stderr || res.stdout || "").slice(0, 500)}`)
  }
  const projects = readdirSync(ro.dataDir + "/projects")
  if (projects.length !== 1) throw new Error(`capture-harness: expected exactly 1 project, got ${projects.length}`)
  const projectId = projects[0]!
  const dbPath = path.join(ro.dataDir, "projects", projectId, "brain.db")
  if (!existsSync(dbPath)) throw new Error(`capture-harness: brain.db missing for ${projectId}`)

  // Index hash = sha256 over the corpus source files + project id. A fresh
  // re-index on the same committed corpus must reproduce it byte-for-byte.
  const files = collectFiles(corpusAbs)
  const h = createHash("sha256")
  for (const f of files) h.update(path.relative(corpusAbs, f)).update("\0").update(readFileSync(f)).update("\0")
  h.update(projectId)
  const indexHash = h.digest("hex")

  const commit = gitHead(ro.root)
  return { dataDir: ro.dataDir, dbPath, projectId, indexHash, commit, stats: { files: files.length, symbols: 0, relationships: 0 } }
}

/** Live index stats straight from the freshly built brain.db. */
export function readDbStats(dbPath: string): { symbols: number; relationships: number; files: number } {
  // House pattern (M29.R5): createRequire + bare specifier — tsx resolves
  // node_modules. The C1 gate requires the real DB, never a fabricated fixture.
  const Database = require("better-sqlite3")
  const db = new Database(dbPath, { readonly: true })
  try {
    const symbols = (db.prepare("SELECT COUNT(*) AS c FROM brain_symbol").get() as { c: number }).c
    const relationships = (db.prepare("SELECT COUNT(*) AS c FROM brain_relationship").get() as { c: number }).c
    const files = (db.prepare("SELECT COUNT(*) AS c FROM brain_file").get() as { c: number }).c
    return { symbols, relationships, files }
  } finally {
    db.close()
  }
}

export interface CaptureManifestInput {
  bbVersion: string
  editor: "vscode"
  editorVersion: string
  vsixSha256: string
  corpusCommit: string
  corpusPath: string
  indexHash: string
  captureDate: string
  tools: Record<string, string>
}

export const MANIFEST_SCHEMA_VERSION = 1
export const MANIFEST_REQUIRED_KEYS = [
  "schemaVersion",
  "bbVersion",
  "editor",
  "editorVersion",
  "vsixSha256",
  "corpusCommit",
  "corpusPath",
  "indexHash",
  "captureDate",
  "tools",
] as const

/** Write a sidecar manifest that the G1 schema + the C1 verifier can check. */
export function writeCaptureManifest(outDir: string, input: CaptureManifestInput, fileName = "capture-manifest.json"): string {
  // fileName is optional so scenario runs (money) don't clobber the committed
  // hero manifest — the C1 checker keeps expecting the default name.
  const manifest = { schemaVersion: MANIFEST_SCHEMA_VERSION, ...input }
  const p = path.join(outDir, fileName)
  writeFileSync(p, JSON.stringify(manifest, null, 2) + "\n")
  return p
}

export function gitHead(root: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

export function sha256File(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex")
}

function collectFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectFiles(p))
    else out.push(p)
  }
  return out.sort()
}

export function toolVersions(): Record<string, string> {
  const v: Record<string, string> = {}
  for (const tool of ["ffmpeg", "Xvfb", "xdotool"]) {
    try {
      const r = spawnSync(tool, ["-version"], { encoding: "utf8", timeout: 10_000 })
      v[tool] = (r.stdout || "").split("\n")[0] || (r.error ? String(r.error.message) : "unknown")
    } catch (e) {
      v[tool] = `unavailable (${String(e).slice(0, 80)})`
    }
  }
  return v
}

export function corpusFileStat(): { path: string; files: number; bytes: number } {
  const corpusAbs = path.join(process.cwd(), M45_CORPUS_REL)
  const files = collectFiles(corpusAbs)
  const bytes = files.reduce((n, f) => n + statSync(f).size, 0)
  return { path: corpusAbs, files: files.length, bytes }
}
