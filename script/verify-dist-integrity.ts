// script/verify-dist-integrity.ts — the packaged build's chunk graph (P2-7 gate).
//
// WHAT THIS PROVES — a tsup build splits the bundle into top-level hashed chunk
// files (`dist/chunk-XXXXXXXX.js`, `dist/database-HE6EE3VA.js`, …). Every
// relative `./<chunk>.js` reference emitted into ANY top-level dist file must
// resolve to a file this same build wrote. A build that emits a reference to a
// chunk it did not write (interrupted build, concurrent builds, a stale `dist/`,
// a chunk deleted by hand) produces a package that fails at RUNTIME with
// ERR_MODULE_NOT_FOUND in the middle of a phase — the exact
// `Cannot find module .../dist/database-HE6EE3VA.js` class a user hit on a repo
// build that was rebuilt under a running process.
//
// WHERE IT RUNS — `prepublishOnly` and `prepack` (a broken dist can never be
// packed), the `verify:dist` npm script, and the campaign's P2-7 gate. The gate
// exercises the detector against a deliberately CORRUPTED COPY of dist under
// `.tools/` (the real dist is never touched).
//
// USAGE
//   npx tsx script/verify-dist-integrity.ts [distDir]         # clean check; exit 1 on problems
//   npx tsx script/verify-dist-integrity.ts --json [distDir]  # machine-readable verdict
//   npx tsx script/verify-dist-integrity.ts --self-test       # prove the detector works:
//        copies the real dist to .tools/, corrupts the COPY three ways (dangling
//        chunk reference = the database-HE6EE3VA class, deleted packaged entry,
//        deleted-but-referenced chunk) and asserts each corruption is caught while
//        a clean copy passes. Exits 0 only when clean-passes + all three caught.
//
// ENFORCEMENT NOTE — this script reads `dist/` only; it never writes the real dist.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

export interface DistIntegrityResult {
  distDir: string
  files: number
  references: number
  missing: Array<{ file: string; missing: string }>
}

export interface DistIntegrityVerdict {
  ok: boolean
  distDir: string
  files: number
  references: number
  entryPath: string
  entryExists: boolean
  missing: Array<{ file: string; missing: string }>
  reasons: string[]
}

/** Every relative `./<chunk>.js` reference must resolve inside the same dist dir. */
export function verifyDistDir(distDir: string): DistIntegrityResult {
  const result: DistIntegrityResult = { distDir, files: 0, references: 0, missing: [] }
  if (!existsSync(distDir)) {
    result.missing.push({ file: distDir, missing: "dist directory does not exist" })
    return result
  }
  const files = readdirSync(distDir).filter((name) => name.endsWith(".js"))
  result.files = files.length
  const present = new Set(files)
  const relativeModule = /["']\.\/([A-Za-z0-9_.-]+\.js)["']/g
  for (const file of files) {
    const source = readFileSync(path.join(distDir, file), "utf8")
    for (const match of source.matchAll(relativeModule)) {
      result.references++
      const target = match[1]!
      if (!present.has(target)) result.missing.push({ file, missing: target })
    }
  }
  return result
}

/** Full verdict: chunk graph + the packaged entry that must exist. */
export function checkDistTree(distDir: string): DistIntegrityVerdict {
  const result = verifyDistDir(distDir)
  const entryPath = path.join(distDir, "cli", "index.js")
  const entryExists = existsSync(entryPath)
  const reasons: string[] = []
  if (!existsSync(distDir)) reasons.push(`dist directory does not exist: ${distDir}`)
  if (result.missing.length > 0) reasons.push(`${result.missing.length} dangling chunk reference(s)`)
  if (!entryExists) reasons.push(`packaged entry missing: ${entryPath}`)
  return {
    ok: reasons.length === 0,
    distDir,
    files: result.files,
    references: result.references,
    entryPath,
    entryExists,
    missing: result.missing,
    reasons,
  }
}

function reportVerdict(verdict: DistIntegrityVerdict): void {
  console.log(
    `dist integrity: ${verdict.files} JS chunk(s), ${verdict.references} relative reference(s) in ${verdict.distDir}`,
  )
  if (!verdict.entryExists) console.error(`  ✗ entry missing: ${verdict.entryPath}`)
  if (verdict.missing.length > 0) {
    console.error(`  ✗ ${verdict.missing.length} broken reference(s) — the packaged build cannot load every chunk:`)
    for (const row of verdict.missing.slice(0, 30)) console.error(`      ${row.file} -> ${row.missing}`)
    if (verdict.missing.length > 30) console.error(`      … ${verdict.missing.length - 30} more`)
  }
  if (verdict.ok) console.log("  ✓ every relative chunk reference resolves; entry exists")
}

// ── self-test: prove the detector actually catches the stale-chunk class ────────
// A detector nobody has ever seen fail is not evidence. This corrupts a COPY of
// the real dist under .tools/ (the real dist is never touched) in the three ways
// a broken build manifests, and asserts each corruption is caught — plus a clean
// control that must pass.
export interface SelfTestCheck {
  label: string
  ok: boolean
  detail: string
}

function firstReferencedChunk(distDir: string): string | null {
  for (const file of readdirSync(distDir).filter((name) => name.endsWith(".js"))) {
    const source = readFileSync(path.join(distDir, file), "utf8")
    for (const match of source.matchAll(/["']\.\/([A-Za-z0-9_.-]+\.js)["']/g)) {
      if (match[1] !== file) return match[1]!
    }
  }
  return null
}

export function selfTestDistIntegrity(realDist: string): { ok: boolean; checks: SelfTestCheck[] } {
  const checks: SelfTestCheck[] = []
  const root = path.join(process.cwd(), ".tools", "verify-dist-integrity-selftest")
  rmSync(root, { recursive: true, force: true })
  const copy = path.join(root, "dist")
  try {
    cpSync(realDist, copy, { recursive: true })
    const clean = checkDistTree(copy)
    checks.push({ label: "control: an exact copy of dist passes", ok: clean.ok, detail: clean.reasons.join("; ") || "clean" })

    // corruption 1: a file references a chunk that does not exist — the
    // `database-HE6EE3VA.js` class (stale reference to a previous build's chunk).
    const victim = readdirSync(copy).find((name) => name.endsWith(".js"))
    if (!victim) {
      checks.push({ label: "corruption 1: dangling chunk reference", ok: false, detail: "no dist chunk to corrupt" })
    } else {
      const victimPath = path.join(copy, victim)
      writeFileSync(victimPath, readFileSync(victimPath, "utf8") + '\nimport "./database-HE6EE3VA.js"\n')
      const corrupt = checkDistTree(copy)
      checks.push({
        label: "corruption 1: dangling chunk reference (database-HE6EE3VA class) detected",
        ok: !corrupt.ok && corrupt.missing.some((m) => m.missing === "database-HE6EE3VA.js"),
        detail: corrupt.reasons.join("; ") + " :: " + JSON.stringify(corrupt.missing.slice(0, 2)),
      })
      cpSync(path.join(realDist, victim), victimPath) // restore for the next corruption
    }

    // corruption 2: the packaged entry is missing.
    const entry = path.join(copy, "cli", "index.js")
    if (existsSync(entry)) {
      rmSync(entry)
      const corrupt = checkDistTree(copy)
      checks.push({ label: "corruption 2: missing packaged entry detected", ok: !corrupt.ok && !corrupt.entryExists, detail: corrupt.reasons.join("; ") })
      cpSync(path.join(realDist, "cli", "index.js"), entry)
    } else {
      checks.push({ label: "corruption 2: missing packaged entry detected", ok: false, detail: "real dist has no cli/index.js" })
    }

    // corruption 3: a chunk that other files reference is deleted (mixed-build
    // failure: files written by build N+1, chunk directory from build N).
    const referencedChunk = firstReferencedChunk(copy)
    if (referencedChunk) {
      rmSync(path.join(copy, referencedChunk), { force: true })
      const corrupt = checkDistTree(copy)
      checks.push({
        label: "corruption 3: deleted-but-referenced chunk detected",
        ok: !corrupt.ok && corrupt.missing.some((m) => m.missing === referencedChunk),
        detail: `deleted ${referencedChunk} :: ${corrupt.reasons.join("; ")}`,
      })
    } else {
      checks.push({ label: "corruption 3: deleted-but-referenced chunk detected", ok: false, detail: "no referenced top-level chunk found to delete" })
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  return { ok: checks.every((check) => check.ok), checks }
}

function main(): void {
  const argv = process.argv.slice(2)
  const selfTestMode = argv.includes("--self-test")
  const jsonMode = argv.includes("--json")
  const positional = argv.filter((arg) => !arg.startsWith("--"))
  const distDir = path.resolve(positional[0] ?? "dist")

  if (selfTestMode) {
    if (!existsSync(distDir)) {
      console.error(`self-test: real dist not found: ${distDir} (run: npm run build)`)
      process.exit(1)
    }
    const outcome = selfTestDistIntegrity(distDir)
    if (jsonMode) console.log(JSON.stringify({ mode: "self-test", realDist: distDir, ...outcome }, null, 2))
    else {
      console.log(`dist-integrity self-test against a copy of ${distDir}`)
      for (const entry of outcome.checks) console.log(`  ${entry.ok ? "✓" : "✗"} ${entry.label}${entry.ok ? "" : ` — ${entry.detail}`}`)
      console.log(outcome.ok ? "  ✓ detector proven: clean copy passes, all corruptions caught" : "  ✗ self-test FAILED")
    }
    process.exit(outcome.ok ? 0 : 1)
  }

  const verdict = checkDistTree(distDir)
  if (jsonMode) {
    console.log(JSON.stringify({ mode: "check", ...verdict }, null, 2))
    process.exit(verdict.ok ? 0 : 1)
  }
  reportVerdict(verdict)
  process.exit(verdict.ok ? 0 : 1)
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href : false
if (isMain) main()

// Kept for callers that want a cheap stat without re-walking the directory.
export function distFileCount(distDir: string): number {
  if (!existsSync(distDir)) return 0
  return readdirSync(distDir).filter((name) => statSync(path.join(distDir, name)).isFile()).length
}
