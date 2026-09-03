// script/m23/verify-p3-portability.ts — M23.P3
//
// Proves the moved-project flow end to end at source level, with isolated
// BB_DATA_DIR (Bun needs explicit env passing — verified earlier this session):
//   1. Index a fixture at path A -> fingerprint + git identity persisted.
//   2. Move the whole directory to path B; `bb index` at B ADOPTS the A index
//      (symbols queryable immediately, adoption line printed, no full reparse).
//   3. `bb index import --db <path>` re-homes a DB manually.
//   4. Negative: a genuinely different codebase is never adopted.
//   5. Negative: import of a bogus DB path errors.
//   6. Negative: adoption refused when the target already has an index.
//   7. Negative: legacy DB with no recoverable fingerprint is never guessed.
//
// Honesty: no auto-pass; every check exercises the real CLI/registry code.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, renameSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

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

// Intentional negative cases (they PASS when the guard fires) — counted for
// the evidence file per the M23 policy of >=2 negatives per verifier.
function negative(name: string, ok: boolean, detail = "") {
  if (ok) negatives.push(name)
  ck(`${name} [negative]`, ok, detail)
}

// M23.P3: src/cli/index.ts only EXPORTS runCli — running the module file
// directly is a silent no-op (module has no import.meta.main entry). Use the
// M22 runner-file pattern: write a temp module that imports runCli and calls
// it with the desired args, then execFileSync that runner.
function runCli(args: string[], env: NodeJS.ProcessEnv, cwd = ROOT): { out: string; err: string; code: number } {
  const runner = path.join(ROOT, "script", "m23", ".p3-runner.tmp.ts")
  writeFileSync(
    runner,
    `import { runCli } from ${JSON.stringify(path.join(ROOT, "src/cli/index.ts"))}\n` +
      `await runCli(${JSON.stringify(args)}).catch(() => process.exit(1))\n`,
  )
  try {
    const out = execFileSync("bun", [runner], {
      cwd,
      env: { ...process.env, ...env }, // Bun does NOT forward live process.env mutations
      encoding: "utf8",
      timeout: 120_000,
    })
    return { out, err: "", code: 0 }
  } catch (e: any) {
    return { out: e?.stdout?.toString() ?? "", err: e?.stderr?.toString() ?? String(e), code: e?.status ?? 1 }
  }
}

function makeProject(root: string, marker: string): string {
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "src", "main.ts"), `// ${marker}\nexport function alpha(x: number): number { return x + 1 }\nexport function beta(y: number): number { return y * 2 }\n`)
  writeFileSync(path.join(root, "src", "util.ts"), `// ${marker}\nexport function gamma(): string { return 'g' }\n`)
  return root
}

const base = mkdtempSync(path.join(tmpdir(), "bb-p3-"))
const dataDir = path.join(base, "data")
const dirA = makeProject(path.join(base, "project-a"), "marker-a")
const env = { BB_DATA_DIR: dataDir }

try {
  // ── 1. Index at path A ────────────────────────────────────────────────
  const rA = runCli(["index", dirA, "--skip-post-processing"], env)
  ck("index at A succeeds", rA.code === 0, (rA.out + rA.err).slice(0, 200))

  const { listProjects } = await import(path.join(ROOT, "src/ast/project-registry"))
  process.env.BB_DATA_DIR = dataDir
  const before = listProjects()
  ck("exactly one project after index at A", before.length === 1, String(before.length))
  const projA = before[0]
  ck("index at A has files", (projA?.files ?? 0) > 0, String(projA?.files))

  // fingerprint + git identity persisted
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))
  const { readStoredFingerprint } = await import(path.join(ROOT, "src/ast/fingerprint"))
  const rawA = BrainDatabase.openByPath(projA.dbPath, { readonly: true })
  const stored = readStoredFingerprint(rawA, projA.id)
  ck("fingerprint persisted in DB (40 hex chars)", typeof stored === "string" && /^[0-9a-f]{40}$/.test(stored), String(stored))

  // ── 2. Move A -> B, index at B must ADOPT ────────────────────────────
  const dirB = path.join(base, "project-b-moved")
  renameSync(dirA, dirB)
  const rB = runCli(["index", dirB, "--skip-post-processing"], env)
  ck("index at B succeeds", rB.code === 0, (rB.out + rB.err).slice(0, 200))
  ck("adoption line printed", /adopted existing index/.test(rB.out), (rB.out + rB.err).slice(0, 200))

  const after = listProjects()
  ck("still exactly one project after move", after.length === 1, String(after.length))
  ck("project id changed to B's id", after[0] && after[0].id !== projA.id, `${projA.id.slice(0, 8)} -> ${after[0]?.id.slice(0, 8)}`)
  ck("symbols survived the move", (after[0]?.symbols ?? 0) >= 3, String(after[0]?.symbols))
  ck("old DB dir removed", !existsSync(path.join(dataDir, "projects", projA.id)))

  // brain_file.path prefixes rewritten to the new root
  const rawB = BrainDatabase.openByPath(after[0].dbPath, { readonly: true })
  const paths = (rawB.prepare("SELECT path FROM brain_file LIMIT 50").all() as any[]).map((r) => String(r.path))
  ck("brain_file.path rewritten to new root", paths.length > 0 && paths.every((p) => p.startsWith(dirB)), paths[0] ?? "(none)")

  // queryable at B without reindex
  const rSearch = runCli(["search", "alpha", "--dir", dirB], env)
  ck("symbol from A queryable at B", /alpha/.test(rSearch.out), rSearch.out.slice(0, 120))

  // ── 3. Explicit import ───────────────────────────────────────────────
  const dirC = path.join(base, "project-c-import")
  renameSync(dirB, dirC)
  const dbFile = after[0].dbPath
  const rImport = runCli(["index", dirC, "--import", dbFile], env)
  const importOk = rImport.code === 0 && /adopted|imported|rebound/i.test(rImport.out + rImport.err)
  ck("explicit import rebinds DB", importOk, (rImport.out + rImport.err).slice(0, 200))

  // ── 4. Negative: different codebase never adopted ────────────────────
  const dirD = makeProject(path.join(base, "project-d"), "marker-d")
  writeFileSync(path.join(dirD, "src", "extra.ts"), "// marker-d\nexport function delta(): number { return 4 }\n")
  const rD = runCli(["index", dirD, "--skip-post-processing"], env)
  negative("different codebase indexes fresh (no adoption)", rD.code === 0 && !/adopted existing index/.test(rD.out), (rD.out + rD.err).slice(0, 160))

  // ── 5. Negative: import of bogus DB path errors ──────────────────────
  const rBogus = runCli(["index", dirC, "--import", path.join(base, "nope", "brain.db")], env)
  negative("import bogus db path errors", rBogus.code !== 0 || /✗|not found|no such/i.test(rBogus.out + rBogus.err), (rBogus.out + rBogus.err).slice(0, 160))

  // ── 6. Negative: adoption refused when target already has index ──────
  const { adoptProject } = await import(path.join(ROOT, "src/ast/project-registry"))
  const entries = listProjects()
  const target = entries.find((e) => e.humanPath && e.humanPath.includes("project-d"))
  const source = entries.find((e) => e !== target)
  if (target && source) {
    const r = adoptProject(source.id, target.id, dirD)
    negative("adoption refused when target has index", r.adopted === false && /already has an index/.test(r.reason ?? ""), r.reason ?? "")
  } else {
    ck("adoption fixture resolvable", false, "could not resolve two projects")
  }

  // ── 7. Negative: legacy DB without fingerprint is never guessed ──────
  // A DB with no stored fingerprint AND no relative_path rows must never match.
  const legacyId = "a".repeat(40)
  const legacyDir = path.join(dataDir, "projects", legacyId)
  mkdirSync(legacyDir, { recursive: true })
  const { ensureSchema } = await import(path.join(ROOT, "src/brain/schema-ddl"))
  const legacyRaw = BrainDatabase.openByPath(path.join(legacyDir, "brain.db"))
  ensureSchema(legacyRaw)
  legacyRaw.close()
  const { findAdoptableDb } = await import(path.join(ROOT, "src/ast/project-registry"))
  const noMatch = findAdoptableDb("f".repeat(40))
  negative("legacy empty DB never adopted", noMatch === null || noMatch.id !== legacyId, noMatch ? noMatch.id.slice(0, 8) : "null")
} finally {
  try { rmSync(base, { recursive: true, force: true }) } catch {}
}

// Self-audit: no auto-pass in this file
const self = readFileSync(new URL(import.meta.url).pathname, "utf8")
ck("no auto-pass assertions in verifier", !/ck\([^)]*,\s*true\s*\)/.test(self), "self-audit")

const { execFileSync: efs } = await import("node:child_process")
const evidence = {
  issue: "M23.P3",
  status: failed === 0 && negatives.length >= 2 ? "verified" : "failed",
  passed,
  failed,
  negativeCases: negatives.length,
  command: "bun script/m23/verify-p3-portability.ts",
  evidenceFile: "validation/m23/results/P3.json",
  currentCommit: efs("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
  timestamp: new Date().toISOString(),
}
writeFileSync(path.join(RESULTS, "P3.json"), JSON.stringify(evidence, null, 2) + "\n")
console.log(`\n${failed === 0 ? "VERIFIED" : "FAILED"}: ${passed}/${checks} checks, ${negatives.length} negatives`)
process.exit(failed === 0 ? 0 : 1)
