// script/m59/verify-store-line-landing.ts — M59.O3
//
// Does the analyzer's call-site line now reach the DATABASE? Runs the REAL
// pipeline (worker pool, real analyzers, the fixed store) over a REAL corpus
// repo, then checks the landed values against the SOURCE — never against the
// index's own opinion of itself.
//
// Isolation: writes to a throwaway BB_DATA_DIR; the user's index is untouched.
// Before M59: every existing index measured 0 rows with line_number > 0.
//
// Tier A (necessary condition): for a row claiming line L on relationship
// target T, source line L must contain T's name as a token. Reported as
// "consistent" — never as "correct". A pass is not proof; a fail is proof of a
// wrong line.

import { readFileSync, existsSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const EMPTY = mkdtempSync(path.join(tmpdir(), "m59-data-"))
process.env.BB_DATA_DIR = EMPTY

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const TARGET_REPO = process.argv[2] ?? "$HOME/fixtures/repositories/cats-effect"

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * The left boundary, with the `$` sigil handled correctly — the SAME predicate
 * (and the same reasoning) as `script/m59/oracle-callsite.ts`, which measured it:
 *
 * Excluding `$` from the boundary class on BOTH sides made a `$`-introduced
 * name unmatchable. Live consequence in this probe before the fix: scala's
 * `s"$to.interruptibleMany"`, `s"$word, $name"` and `${Bracket…}($a)($b)` were
 * reported as INCONSISTENT lines when the name is written right there on the
 * claimed line. On the 2026-09-15 cats-effect run that alone accounted for a
 * large share of the 535 "failures" — an instrument that accuses correct work
 * cannot be used to judge the analyzer.
 *
 * What is NOT relaxed: the name must still sit on a word boundary of its own, so
 * `xv` never matches token `v` (asserted by the self-test below).
 *
 * Known, accepted weakening: `val a$b = 1` matches token `b`. It can only hide a
 * defect if an analyzer splits one written identifier in two, which none does.
 */
function boundaryRe(token: string): RegExp {
  return new RegExp(`(^|[^\\w])\\$?${escapeRe(token)}([^\\w]|$)`)
}

function tierAConsistent(lines: string[], line: number, token: string): boolean {
  if (!Number.isFinite(line) || line < 1 || line > lines.length) return false
  const src = lines[line - 1]
  const head = token.replace(/_+$/, "")
  const variants = token === head ? [token] : [token, head]
  return variants.some((v) => boundaryRe(v).test(src))
}

/**
 * Names Tier A is STRUCTURALLY UNABLE to check, kept out of both columns.
 *
 * The analyzers synthesise some node names (`constructor`, `anonymous_*`,
 * `given_N`) and mark unresolvable targets `?`; none is ever written in source,
 * so neither "consistent" nor "INCONSISTENT" is true of them. Counting them as
 * failures conflated "cannot check" with "checked and failed" — the tier
 * conflation this file's header forbids. Matching is by SHAPE only, so the
 * allowlist cannot smuggle a real name past the check.
 */
const SYNTHETIC_NAME = /^(constructor|anonymous_object|anonymous_[\w$]+|given_\d+|component\d+)$/
const UNKNOWN_TARGETS = new Set(["?", "<unknown>", "<anonymous>", ""])

function isCheckable(token: string | null, target: unknown): token is string {
  if (!token) return false
  if (SYNTHETIC_NAME.test(token)) return false
  // A token that is not a plausible single identifier cannot be looked for on a
  // source line at all. Measured case: scala's anonymous class bodies are
  // recorded as `anonymous_ScalaRandom(selectRandom) with SecureRandom` — a
  // description of a type, never written in source, so no line could satisfy it.
  // The oracle already applies this same shape filter to its callee token.
  if (!/^[\w$#:@.-]+$/.test(token)) return false
  if (typeof target === "string") {
    if (UNKNOWN_TARGETS.has(target)) return false
    if (/[{}\n;]/.test(target)) return false
  }
  return true
}

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

  const pid = getProjectId(TARGET_REPO) as any
  console.log(`repo: ${TARGET_REPO}`)
  console.log(`temp data dir: ${EMPTY}`)

  const t0 = Date.now()
  const stats = await indexProjectParallel(pid, TARGET_REPO, {})
  // The real field names (ParallelIndexingStats) are symbolsExtracted /
  // relationshipsFound / importsFound — the previous `stats.totalSymbols` and
  // `stats.totalRelationships` did not exist, so every run printed
  // "symbols=undefined rels=undefined" and the evidence file recorded no index
  // size at all.
  console.log(
    `indexed in ${Date.now() - t0}ms: files=${stats.totalFiles} symbols=${stats.symbolsExtracted} relationships=${stats.relationshipsFound} imports=${stats.importsFound} errors=${stats.errorFiles}`,
  )

  const raw = await BrainDatabase.getRawInstance(pid)
  const total = (raw.prepare("SELECT COUNT(*) c FROM brain_relationship").get() as any).c as number
  const withLine = (raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE line_number IS NOT NULL AND line_number > 0").get() as any).c as number
  const zero = (raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE line_number = 0").get() as any).c as number
  const nul = (raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE line_number IS NULL").get() as any).c as number

  console.log("\n=== DB after the fix (this is the whole point) ===")
  console.log(`  total relationships : ${total}`)
  console.log(`  line_number > 0     : ${withLine}`)
  console.log(`  line_number = 0     : ${zero}   <-- 0 means "unknown"; must never be written`)
  console.log(`  line_number NULL    : ${nul}`)
  console.log(`  db: ${BrainDatabase.getDbPath(pid)}`)

  console.log("\n=== by relationship_type (line_number > 0) ===")
  for (const r of raw.prepare("SELECT relationship_type rt, COUNT(*) n FROM brain_relationship WHERE line_number > 0 GROUP BY relationship_type ORDER BY n DESC").all() as any[]) {
    console.log(`  ${String(r.rt).padEnd(16)} ${r.n}`)
  }

  console.log("\n=== by source language (line_number > 0) ===")
  for (const r of raw.prepare(`SELECT f.language lang, COUNT(*) n FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id JOIN brain_file f ON f.id = s.file_id WHERE r.line_number > 0 GROUP BY f.language ORDER BY n DESC`).all() as any[]) {
    console.log(`  ${String(r.lang).padEnd(16)} ${r.n}`)
  }

  // ── The independent check: landed lines vs the SOURCE ─────────────────────
  //
  // The target NAME comes from `target_external`, or — for edges whose target
  // resolved to a symbol row — from that symbol's name. The previous version fell
  // back to the SOURCE symbol's name when the target was internal, which checked
  // the source's own name against the claimed line: a different claim entirely,
  // and it would have passed every row whose target happened to be unresolvable.
  const rows = raw.prepare(`
    SELECT r.id, r.relationship_type rt, r.line_number ln, r.target_external te,
           s.name sname, ts.name tname, f.relative_path path
    FROM brain_relationship r
    JOIN brain_symbol s ON s.id = r.source_symbol_id
    JOIN brain_file f ON f.id = s.file_id
    LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
    WHERE r.line_number > 0
  `).all() as any[]

  let consistent = 0
  let inconsistent = 0
  let notCheckable = 0
  let targetUnresolved = 0
  const failures: any[] = []
  const fileCache = new Map<string, string[]>()
  for (const r of rows) {
    const abs = path.join(TARGET_REPO, r.path)
    if (!existsSync(abs)) {
      targetUnresolved++
      continue
    }
    const rawName = String(r.te ?? r.tname ?? "")
    if (!rawName) {
      // No target name at all: no source line can be checked against it.
      targetUnresolved++
      continue
    }
    let lines = fileCache.get(abs)
    if (!lines) {
      lines = readFileSync(abs, "utf8").split("\n")
      fileCache.set(abs, lines)
    }
    const token = rawName.split(".").pop() ?? ""
    if (!isCheckable(token, rawName)) {
      notCheckable++
      continue
    }
    if (tierAConsistent(lines, r.ln, token)) consistent++
    else {
      inconsistent++
      if (failures.length < 25) {
        failures.push({ path: r.path, line: r.ln, target: r.te, sourceLine: (lines[r.ln - 1] ?? "").trim().slice(0, 90) })
      }
    }
  }

  console.log("\n=== landed lines checked against the SOURCE (Tier A) ===")
  console.log(`  consistent   : ${consistent}`)
  console.log(`  INCONSISTENT : ${inconsistent}`)
  console.log(`  notCheckable : ${notCheckable}   (synthesised names — never written in source)`)
  console.log(`  no target/file: ${targetUnresolved}`)
  for (const f of failures) console.log(`    WRONG ${f.path}:${f.line} target=${f.target} src="${f.sourceLine}"`)

  // ── SELF-TEST: the predicate must be able to fail, and must not accuse
  // correct work near a `$` sigil. A run that cannot fail proves nothing, so a
  // failing self-test fails the probe.
  const selfTest = {
    interpolationMatches: tierAConsistent([String.raw`      Patch.replaceTree(from, s"$to.interruptibleMany")`], 1, "to"),
    interpolationAfterWordCharMatches: tierAConsistent([String.raw`      s"esc: \u$hex"`], 1, "hex"),
    plainIdentifierMatches: tierAConsistent(["  val v = 1"], 1, "v"),
    subwordStillFails: !tierAConsistent(["  val xv = 1"], 1, "v"),
    suffixOfLongerWordFails: !tierAConsistent(["  val activeProfiles = 1"], 1, "Profiles"),
    wrongLineStillFails: !tierAConsistent(["  val v = 1", "  val w = 2"], 2, "v"),
    syntheticIsNotCheckable: !isCheckable("constructor", "constructor"),
  }
  const selfTestOk = Object.values(selfTest).every(Boolean)
  console.log(`\nboundary self-test: ${JSON.stringify(selfTest)}`)
  if (!selfTestOk) {
    console.error("FATAL: the Tier A predicate cannot fail — its verdicts are worthless")
    process.exit(1)
  }

  // ── #821: a stored 0 is not "unknown", it is a claim that the relationship
  // occurs on line 0, and every reader downstream believes its number. The
  // probe fails on any such row so the class cannot come back silently.
  if (zero > 0) {
    const offenders = raw.prepare(`
      SELECT r.relationship_type rt, f.language lang, COUNT(*) n
      FROM brain_relationship r
      LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
      LEFT JOIN brain_file f ON f.id = s.file_id
      WHERE r.line_number = 0 GROUP BY 1, 2 ORDER BY n DESC
    `).all() as any[]
    console.error(`FATAL (#821): ${zero} rows store line_number = 0 — "unknown" written as a number`)
    for (const o of offenders) console.error(`  ${o.lang} ${o.rt}: ${o.n}`)
    process.exit(1)
  }

  const outDir = path.join(ROOT, "validation/m59/results")
  const { mkdirSync, writeFileSync } = await import("node:fs")
  mkdirSync(outDir, { recursive: true })
  // M59 (#859 precedent, applied here too): this artifact names numbers, so it
  // must name the code that produced them. A non-zero `treeModifiedInputs`
  // means a WORKING-TREE measurement, not a commit's.
  const { execSync } = await import("node:child_process")
  const commit = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim()
  const treeModifiedInputs = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("?? ")).length
  writeFileSync(
    path.join(outDir, "store-line-landing.json"),
    JSON.stringify(
      {
        probe: "M59.O3",
        at: new Date().toISOString(),
        atCommit: commit,
        treeModifiedInputs,
        repo: TARGET_REPO,
        tempDataDir: EMPTY,
        indexStats: {
          files: stats.totalFiles,
          symbols: stats.symbolsExtracted,
          relationships: stats.relationshipsFound,
          imports: stats.importsFound,
          errorFiles: stats.errorFiles,
        },
        db: { total, withLine, zero, null: nul },
        byType: raw.prepare("SELECT relationship_type rt, COUNT(*) n FROM brain_relationship WHERE line_number > 0 GROUP BY relationship_type ORDER BY n DESC").all(),
        byLanguage: raw.prepare(`SELECT f.language lang, COUNT(*) n FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id JOIN brain_file f ON f.id = s.file_id WHERE r.line_number > 0 GROUP BY f.language ORDER BY n DESC`).all(),
        sourceCheck: { checked: rows.length, consistent, inconsistent, notCheckable, targetUnresolved, failures, boundarySelfTest: selfTest },
        before: "every pre-existing index on this machine: 0 rows with line_number > 0 (189,499 of 189,499 were 0)",
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
