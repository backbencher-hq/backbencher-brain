// M49.G6 — regex-artifact LINEAGE gate (census + debt register).
//
// Why this exists (found 2026-09-12, M49 W5).
//
// `validation/m12/results/regex-census.json` is a DERIVED artifact: a position
// index of every regex usage in `src/ast`. `script/m12/regex-census.ts` derives
// it from the WORKING TREE, so any run while an analyzer is uncommitted bakes
// that uncommitted position into the committed census. That had already
// happened: the census committed at HEAD recorded `real-cpp-analyzer.ts:727`
// and `real-rust-analyzer.ts:452/453` while the COMMITTED cpp/rust blobs carry
// those regexes at 382/405/406 — i.e. the committed index described a tree that
// no commit ever contained, and it had been that way for waves without anything
// noticing. The cost is not cosmetic: on a clean checkout every consumer of the
// census (R2's register comparison, the M12 census gate, the debt-total
// arithmetic) is reasoning about positions that do not exist in the code it is
// shipping.
//
// `script/m12/verify-regex-census.ts` cannot catch this: it re-scans the
// WORKING TREE and compares, so a tree that is dirty in the same way as the
// census colludes with it (both sides agree on a position that HEAD does not
// have). This gate closes that hole from the other side — it needs no parser
// and no re-scan, only the committed blobs:
//
//   1. every census entry must name a file that exists in HEAD;
//   2. its recorded `line` must exist in that HEAD blob;
//   3. that exact line must contain the entry's recorded regex `source`.
//
// M49 W7 extension: the DEBT REGISTER (`validation/m49/regex-debt-register.json`)
// is a derived artifact of the same kind — a position index handed from wave to
// wave — and it had the same failure: the in-flight cpp/rust/zig wave's register
// edit recorded the WORKING TREE's lines (709/727, 452/453) rather than the
// committed ones (364/382, 405/406). Position is no longer a row's *identity*
// (that is `file` + `source`, enforced by R2), but a recorded position that does
// not point at its own regex in the shipped code is still a false statement to
// the reader, so the register is anchored here by the same three rules.
//
// Run: bun script/m49/verify-census-lineage.ts [--census <path>] [--register <path>]
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")

const argValue = (flag: string) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? resolve(process.argv[i + 1]) : undefined
}
const CENSUS_PATH = argValue("--census") ?? join(ROOT, "validation", "m12", "results", "regex-census.json")
const REGISTER_PATH = argValue("--register") ?? join(ROOT, "validation", "m49", "regex-debt-register.json")

interface CensusEntry { file: string; line: number; column?: number; source: string; classification?: string }
interface RegisterRow { file: string; line: number; source?: string }

type LineLookup = (file: string) => string[] | null

/** The three anchoring rules, as a pure function so it can be self-tested. */
export function anchorViolations(rows: { file: string; line: number; source: string }[], linesOf: LineLookup): string[] {
  const violations: string[] = []
  const cache = new Map<string, string[] | null>()
  for (const row of rows) {
    const where = `${row.file}:${row.line}`
    if (!cache.has(row.file)) cache.set(row.file, linesOf(row.file))
    const lines = cache.get(row.file)
    if (!lines) { violations.push(`${where} names a file that is not in HEAD`); continue }
    if (!Number.isInteger(row.line) || row.line < 1 || row.line > lines.length) {
      violations.push(`${where} is outside its HEAD blob (${lines.length} lines)`)
      continue
    }
    if (!(lines[row.line - 1] ?? "").includes(row.source)) {
      violations.push(`${where} does not contain its recorded source ${row.source}`)
    }
  }
  return violations
}

function headBlobLines(file: string): string[] | null {
  for (const candidate of [`src/ast/${file}`, file]) {
    try {
      const out = execFileSync("git", ["show", `HEAD:${candidate}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      return out.split("\n")
    } catch { /* try the next candidate path shape */ }
  }
  return null
}

let passed = 0
let failed = 0
const failures: string[] = []
function check(label: string, condition: boolean): void {
  if (condition) passed++
  else { failed++; failures.push(label) }
}

/**
 * Emit the three anchoring rules PER ROW rather than as one aggregate.
 * Granularity is the point: a gate whose check COUNT can quietly fall is a gate
 * whose coverage can quietly fall, so every row reports its own two rules and a
 * dataset that loses rows loses checks with it.
 */
function anchorAll(
  prefix: string,
  rows: { file: string; line: number; source: string }[],
  linesOf: LineLookup,
): string[] {
  const violations: string[] = []
  const cache = new Map<string, string[] | null>()
  for (const row of rows) {
    const where = `${prefix} ${row.file}:${row.line}`
    if (!cache.has(row.file)) cache.set(row.file, linesOf(row.file))
    const lines = cache.get(row.file)
    if (!lines) {
      check(`${where} names a file present in HEAD`, false)
      violations.push(where)
      continue
    }
    const inRange = Number.isInteger(row.line) && row.line >= 1 && row.line <= lines.length
    check(`${where} is inside its HEAD blob (${lines.length} lines)`, inRange)
    if (!inRange) { violations.push(where); continue }
    const contains = (lines[row.line - 1] ?? "").includes(row.source)
    check(`${where} line contains its recorded source ${row.source}`, contains)
    if (!contains) violations.push(where)
  }
  return violations
}

function main(): void {
  // ── Census ────────────────────────────────────────────────────────────────
  if (!existsSync(CENSUS_PATH)) throw new Error(`census not found: ${CENSUS_PATH}`)
  const census = JSON.parse(readFileSync(CENSUS_PATH, "utf8")) as { perFile?: { file: string; usages: CensusEntry[] }[] }
  const entries = (census.perFile ?? []).flatMap((f) => f.usages ?? [])
  check("census has entries to anchor", entries.length > 0)
  const censusViolations = anchorAll("census", entries, headBlobLines)
  check(`census is anchored to committed blobs (${entries.length} entries, ${new Set(entries.map((e) => e.file)).size} files)`,
    censusViolations.length === 0)

  // ── Debt register ─────────────────────────────────────────────────────────
  const register = existsSync(REGISTER_PATH)
    ? (JSON.parse(readFileSync(REGISTER_PATH, "utf8")) as { entries?: RegisterRow[] })
    : { entries: [] }
  const rows = (register.entries ?? []).filter((r) => typeof r.source === "string") as { file: string; line: number; source: string }[]
  check("register has sourced rows to anchor", rows.length > 0)
  const registerViolations = anchorAll("register", rows, headBlobLines)
  check(`register is anchored to committed blobs (${rows.length} rows, ${new Set(rows.map((r) => r.file)).size} files)`,
    registerViolations.length === 0)

  // ── Self-tests: the anchor function must convict AND clear ────────────────
  const fixtureLines: LineLookup = (file) => (file === "real-x-analyzer.ts" ? ["line one", "  const parts = text.split(/::|\\s+/)", "tail"] : null)
  const badLine = anchorViolations([{ file: "real-x-analyzer.ts", line: 1, source: "/::|\\s+/" }], fixtureLines)
  check("a row whose line does not contain its source is convicted", badLine.length === 1 && badLine[0].includes("does not contain"))
  const badFile = anchorViolations([{ file: "real-missing-analyzer.ts", line: 1, source: "/x/" }], fixtureLines)
  check("a row naming a file absent from HEAD is convicted", badFile.length === 1 && badFile[0].includes("not in HEAD"))
  const badRange = anchorViolations([{ file: "real-x-analyzer.ts", line: 9, source: "/x/" }], fixtureLines)
  check("a row pointing past EOF is convicted", badRange.length === 1 && badRange[0].includes("outside its HEAD blob"))
  const good = anchorViolations([{ file: "real-x-analyzer.ts", line: 2, source: "/::|\\s+/" }], fixtureLines)
  check("a correctly anchored row is cleared", good.length === 0)

  console.log(failed === 0
    ? `M49.G6: ${passed} passed, 0 failed — the census (${entries.length} entries) and the debt register (${rows.length} rows) are anchored to committed blobs`
    : `M49.G6: ${passed} passed, ${failed} failed — an artifact is NOT anchored to HEAD (it was derived from a dirty tree). First failures:\n  ${failures.slice(0, 6).join("\n  ")}`)
  if (failed > 0) process.exit(1)
}

main()
