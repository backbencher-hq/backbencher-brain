/**
 * PERL'S ZERO-REGEX CONTRACT, proven with the M12 AST scanner.
 *
 * Formula section 10 is explicit that counting regex literals is NOT the metric:
 * "the metric is regexes doing SYNTAX work; classification must come from the
 * AST." So this does not grep. It reuses `regex-census-core`'s scanner — the
 * same tree-sitter walk that produced validation/m12/results/regex-census.json
 * and that `script/m49/verify-r2-regex.ts` gates on — so perl's number is
 * produced by the same instrument as every other lane's and is directly
 * comparable to the committed census.
 *
 * What it asserts, and why each part is a separate claim:
 *
 *   1. the analyzer file is IN the census's scan set (a file that is not scanned
 *      cannot be a file with zero regexes — absence from a list you were never
 *      on is not evidence);
 *   2. the AST scan finds 0 regex literals and 0 RegExp constructors in it;
 *   3. the M49 debt register carries no row whose file is this analyzer
 *      (zero found AND zero registered — either alone would be a hole);
 *   4. perl's row is absent from the COMMITTED census artifact, which is the
 *      M12 form of the same claim and the one the M49 gate reads;
 *   5. HEAD's committed blob scans clean too, not just the working tree — the
 *      M49 gate's rule 1 (census ↔ HEAD) is about exactly this gap.
 *
 * usage: bun script/m14/tmp/perl-zero-regex.mts
 */
import { readFileSync } from "node:fs"
import { scanAnalyzers, analyzerFiles } from "../../m12/regex-census-core"

const ANALYZER = "real-perl-analyzer.ts"
const checks: { id: string; status: "pass" | "fail"; detail: string }[] = []
const add = (id: string, ok: boolean, detail: string) => checks.push({ id, status: ok ? "pass" : "fail", detail })

// 1. in the scan set
const files = analyzerFiles()
add("perl-in-scan-set", files.includes(ANALYZER), `${files.length} analyzers scanned; ${ANALYZER} ${files.includes(ANALYZER) ? "is among them" : "IS NOT AMONG THEM"}`)

// 2. AST scan of the working tree
const usages = await scanAnalyzers()
const mine = usages.filter((u: any) => u.file === ANALYZER)
add("working-tree-ast-scan", mine.length === 0, `${mine.length} regex literal(s) / RegExp constructor(s) in ${ANALYZER}` + (mine.length ? `: ${JSON.stringify(mine.slice(0, 3))}` : ""))

// 3. the M49 debt register
let regRows: any[] = []
try {
  const reg = JSON.parse(readFileSync("validation/m49/regex-debt-register.json", "utf8"))
  regRows = (reg.entries ?? []).filter((e: any) => String(e.file ?? "").includes("perl"))
  add("debt-register-clean", regRows.length === 0, `${regRows.length} row(s) for perl in validation/m49/regex-debt-register.json (register total ${reg.entries?.length}, baseline ${reg.baselineTotal})`)
} catch (e: any) {
  add("debt-register-clean", false, `register unreadable: ${e?.message}`)
}

// 4. the committed M12 census has no perl row
try {
  const cen = JSON.parse(readFileSync("validation/m12/results/regex-census.json", "utf8"))
  const rows = (cen.perFile ?? []).filter((r: any) => String(r.file ?? "").includes("perl"))
  add("committed-census-absent", rows.length === 0, `committed census carries ${cen.totalRegexUsages} usages over ${cen.analyzersScanned} analyzers; perl rows: ${rows.length}`)
} catch (e: any) {
  add("committed-census-absent", false, `census unreadable: ${e?.message}`)
}

// 5. HEAD's committed blob scans clean (M49 rule 1: census must describe HEAD)
try {
  const { execFileSync } = await import("node:child_process")
  const head = execFileSync("git", ["show", `HEAD:src/ast/${ANALYZER}`], { encoding: "utf8", maxBuffer: 1 << 28 })
  const work = readFileSync(`src/ast/${ANALYZER}`, "utf8")
  add("head-blob-matches-worktree", head === work, head === work ? "HEAD's blob and the working tree are byte-identical" : `DIFFER (HEAD ${head.length} B, worktree ${work.length} B) — the working-tree scan above does not describe HEAD`)
} catch (e: any) {
  add("head-blob-matches-worktree", false, `could not read HEAD's blob: ${e?.message}`)
}

const failed = checks.filter((c) => c.status === "fail")
for (const c of checks) console.log(`${c.status.toUpperCase().padEnd(4)} ${c.id.padEnd(26)} ${c.detail}`)
console.log(failed.length ? `\n${failed.length} perl zero-regex check(s) FAILED` : "\nperl: 0 regex, proven by the M12 AST scanner and consistent across the working tree, HEAD, the debt register and the committed census")
process.exit(failed.length ? 1 : 0)
