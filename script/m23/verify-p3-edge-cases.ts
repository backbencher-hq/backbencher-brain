// script/m23/verify-p3-edge-cases.ts — M23.P3 edge-case gate.
//
// Permanent regression gate for the bug classes found during the post-closure
// deep review. Every check exercises real code; no auto-pass.
//
// Covered bug classes:
//   S1: import from a non-40-hex parent dir (backup copy) must still rewrite
//       project_id rows (id derived from row contents, not dir name).
//   S2: brain_file.path rewrite must cover ALL rows, not a 500-row sample.
//   S3: fingerprint walk must match discovery's leading-slash skip semantics
//       (top-level dist/, build/, node_modules/ excluded from fingerprint).
//   E1: import of a garbage (non-SQLite) file is refused cleanly AND does not
//       poison the DB handle cache ("Cannot use a closed database").

import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, existsSync, renameSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation", "m23", "results")
mkdirSync(RESULTS, { recursive: true })

let checks = 0, passed = 0, failed = 0
const negatives: string[] = []
function ck(name: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else { failed++; negatives.push(name) }
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`)
}
function negative(name: string, ok: boolean, detail = "") {
  if (ok) negatives.push(name)
  ck(`${name} [negative]`, ok, detail)
}

const base = mkdtempSync(path.join(tmpdir(), "bb-p3-edge-"))
const dataDir = path.join(base, "data")
process.env.BB_DATA_DIR = dataDir

const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))
const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
const { importDbFile, adoptProject } = await import(path.join(ROOT, "src/ast/project-registry"))
const { computeCheckoutFingerprint, readStoredFingerprint } = await import(path.join(ROOT, "src/ast/fingerprint"))

function makeProject(root: string, marker: string) {
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "src", "main.ts"), `// ${marker}\nexport function alpha(x: number): number { return x + 1 }\n`)
  writeFileSync(path.join(root, "src", "util.ts"), `// ${marker}\nexport function beta(y: number): number { return y * 2 }\n`)
}

try {
  // ── S1: import from a backup folder (non-40-hex parent) ─────────────────
  const proj = path.join(base, "proj")
  makeProject(proj, "s1")
  const pid0 = getProjectId(proj)
  await indexProjectParallel(pid0, proj, { onProgress: () => {}, skipPostProcessing: true })
  const srcDb = BrainDatabase.getDbPath(pid0)

  const backupDb = path.join(base, "backups", "my-backup-copy.db")
  mkdirSync(path.dirname(backupDb), { recursive: true })
  copyFileSync(srcDb, backupDb)

  const moved = path.join(base, "moved-proj")
  renameSync(proj, moved)
  const pid1 = getProjectId(moved)
  const r1 = importDbFile(backupDb, pid1, moved)
  if (r1.adopted) {
    const raw = BrainDatabase.openByPath(BrainDatabase.getDbPath(pid1), { readonly: true })
    const total = (raw.prepare("SELECT COUNT(*) c FROM brain_file").get() as any).c
    const ours = (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id = ?").get(pid1) as any).c
    raw.close()
    ck("S1: backup-copy import rewrites project_id rows", total > 0 && ours === total, `files=${total} rows-with-new-id=${ours}`)
  } else {
    ck("S1: backup-copy import rewrites project_id rows", false, `import refused: ${r1.reason}`)
  }
  ck("S1: source backup file survives import", existsSync(backupDb))

  // Second negative: re-importing into an already-occupied target is refused.
  const rDup = importDbFile(backupDb, pid1, moved)
  negative("S1: re-import into occupied target refused", !rDup.adopted && /already has an index/.test(rDup.reason ?? ""), rDup.reason ?? "")

  // ── S2: >500 files, first 500 under one subdir, rest outside ────────────
  const big = path.join(base, "big-proj")
  mkdirSync(path.join(big, "aaa"), { recursive: true })
  mkdirSync(path.join(big, "zzz"), { recursive: true })
  for (let i = 0; i < 600; i++) writeFileSync(path.join(big, "aaa", `f${String(i).padStart(4, "0")}.ts`), `export const a${i} = ${i}\n`)
  for (let i = 0; i < 100; i++) writeFileSync(path.join(big, "zzz", `g${String(i).padStart(4, "0")}.ts`), `export const g${i} = ${i}\n`)
  writeFileSync(path.join(big, "top.ts"), "export const top = 1\n")
  const pidBig = getProjectId(big)
  await indexProjectParallel(pidBig, big, { onProgress: () => {}, skipPostProcessing: true })
  const bigMoved = path.join(base, "big-proj-moved")
  renameSync(big, bigMoved)
  const pidBig2 = getProjectId(bigMoved)
  const r2 = adoptProject(pidBig, pidBig2, bigMoved)
  if (r2.adopted) {
    const raw = BrainDatabase.openByPath(BrainDatabase.getDbPath(pidBig2), { readonly: true })
    const rows = raw.prepare("SELECT path FROM brain_file").all() as any[]
    const bad = rows.filter((r) => !String(r.path).startsWith(bigMoved))
    raw.close()
    ck("S2: all brain_file.path rewritten after move (701 rows)", rows.length === 701 && bad.length === 0, `${rows.length} rows, ${bad.length} stale`)
  } else {
    ck("S2: all brain_file.path rewritten after move (701 rows)", false, `adopt refused: ${r2.reason}`)
  }

  // ── S3: top-level dist/ excluded from fingerprint (discovery parity) ────
  const distProj = path.join(base, "dist-proj")
  mkdirSync(path.join(distProj, "src"), { recursive: true })
  mkdirSync(path.join(distProj, "dist"), { recursive: true })
  writeFileSync(path.join(distProj, "src", "app.ts"), "export const app = 1\n")
  writeFileSync(path.join(distProj, "dist", "bundle.js"), "var app=1;\n")
  const cf = await computeCheckoutFingerprint(distProj)
  ck("S3: top-level dist/ excluded from fingerprint", cf.fileCount === 1, `fileCount=${cf.fileCount} (expected 1)`)

  // ── E1: garbage (non-SQLite) import refused cleanly, cache not poisoned ─
  const garbage = path.join(base, "garbage.db")
  writeFileSync(garbage, Buffer.from("this is definitely not a sqlite database file, just text.", "utf8"))
  const victimId = getProjectId(path.join(base, "victim"))
  const rG = importDbFile(garbage, victimId, base)
  negative("E1: garbage import refused", !rG.adopted && /not a brain DB/.test(rG.reason ?? ""), rG.reason ?? "")
  // The refusal must not poison the handle cache: a subsequent legit import
  // from the same directory tree must still work.
  const proj2 = path.join(base, "proj2")
  makeProject(proj2, "e1b")
  const pid2 = getProjectId(proj2)
  await indexProjectParallel(pid2, proj2, { onProgress: () => {}, skipPostProcessing: true })
  const moved2 = path.join(base, "proj2-moved")
  renameSync(proj2, moved2)
  const rAfter = importDbFile(BrainDatabase.getDbPath(pid2), getProjectId(moved2), moved2)
  ck("E1: legit import works after garbage refusal (cache intact)", rAfter.adopted, rAfter.reason ?? "")

  // ── E2: fingerprint changes when the file set changes (stale detection) ─
  const stale = path.join(base, "stale-proj")
  makeProject(stale, "e2")
  const pidStale = getProjectId(stale)
  await indexProjectParallel(pidStale, stale, { onProgress: () => {}, skipPostProcessing: true })
  const rawStale = BrainDatabase.openByPath(BrainDatabase.getDbPath(pidStale), { readonly: true })
  const stored = readStoredFingerprint(rawStale, pidStale)
  rawStale.close()
  writeFileSync(path.join(stale, "src", "newfile.ts"), "export const fresh = true\n")
  const cfStale = await computeCheckoutFingerprint(stale)
  ck("E2: fingerprint changes when file set changes", !!stored && cfStale.fingerprint !== stored, `old=${stored?.slice(0, 8)} new=${cfStale.fingerprint.slice(0, 8)}`)
} finally {
  try { rmSync(base, { recursive: true, force: true }) } catch {}
}

// Self-audit: no auto-pass in this file
const { readFileSync } = await import("node:fs")
const self = readFileSync(new URL(import.meta.url).pathname, "utf8")
ck("no auto-pass assertions in verifier", !/ck\([^)]*,\s*true\s*\)/.test(self), "self-audit")

const { execFileSync } = await import("node:child_process")
const evidence = {
  issue: "M23.P3-edge",
  status: failed === 0 && negatives.length >= 2 ? "verified" : "failed",
  passed,
  failed,
  negativeCases: negatives.length,
  command: "bun script/m23/verify-p3-edge-cases.ts",
  evidenceFile: "validation/m23/results/P3-edge.json",
  currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
  timestamp: new Date().toISOString(),
}
writeFileSync(path.join(RESULTS, "P3-edge.json"), JSON.stringify(evidence, null, 2) + "\n")
console.log(`\n${failed === 0 ? "VERIFIED" : "FAILED"}: ${passed}/${checks} checks, ${negatives.length} negatives`)
process.exit(failed === 0 ? 0 : 1)

import { writeFileSync } from "node:fs"
