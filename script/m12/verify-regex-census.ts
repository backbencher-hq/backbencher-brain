// M12 regex census regression gate.
//
// Machine-checks the committed census (validation/m12/results/regex-census.json)
// against the analyzer source:
//   1. The census must describe the COMMITTED analyzer blobs exactly (no
//      MISSING, no STALE). This is now HEAD-anchored — see the M49 W7 note.
//   2. Every census entry is classified and located (no unclassified entries,
//      no missing line/file).
//   3. In --strict mode, fails on any entry classified `needs_review` or
//      `replaceable` that carries no justification. The justification ledger is
//      the M49 debt register, which identifies entries by (file, source): the
//      census's own `justification` field is generator output and is empty by
//      construction, so reading only that field made --strict permanently red
//      for a debt that IS justified. Strict mode therefore accepts either.
//   4. The working tree is a DISCLOSED preview: any entry that exists only in
//      the working tree (or only in HEAD) is listed, with uncommitted sources
//      the census has never seen marked PENDING. Never fatal unless
//      --require-clean is passed.
//
// M49 W7 correction (2026-09-12). This gate used to re-scan the WORKING TREE
// and call any disagreement a failure. That conflated two different things:
// the census not describing HEAD (a real defect — it was dirty-derived once),
// and *other agents'* uncommitted analyzers moving regex lines (not this
// gate's business, but it turned a global gate red and blocked family
// closures). Both this gate and M49.R2 now share
// `script/m12/census-truth.ts`: committed truth is fatal, drift is disclosed.
//
// Run: bun script/m12/verify-regex-census.ts [--strict] [--require-clean] [--census <path>]
import { readFileSync, existsSync } from "node:fs"
import {
  ROOT,
  analyzerDrift,
  diffScans,
  pairKeyOfEntryKey,
  scanHeadAnalyzers,
  scanWorkingAnalyzers,
  sourceKey,
  type ScanEntry,
} from "./census-truth"

const hasArg = (flag: string) => process.argv.includes(flag)
const argValue = (flag: string) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}
const CENSUS = argValue("--census") ?? `${ROOT}/validation/m12/results/regex-census.json`
const strict = hasArg("--strict")
const requireClean = hasArg("--require-clean")

interface CensusEntry extends ScanEntry {
  line: number
  column: number
  source: string
  operation: string
  receiver: string
  receiverCategory: string
  classification: string
  justification: string
}

async function main() {
  const census = JSON.parse(readFileSync(CENSUS, "utf8")) as {
    totalRegexUsages: number
    perFile: { file: string; count: number; usages: CensusEntry[] }[]
  }
  const entries = census.perFile.flatMap((f) => f.usages)

  // 1. Committed truth: the census must equal a scan of the COMMITTED blobs.
  const head = await scanHeadAnalyzers()
  const { missing: missingFromCensus, stale: staleInCensus } = diffScans(entries, head)

  const unclassified = entries.filter((e) => !e.classification || e.classification === "" || e.classification === "unclassified")
  const mislocated = entries.filter((e) => !e.file || !e.line)

  // Justification lives in the M49 debt register (by file + source).
  const registerPath = `${ROOT}/validation/m49/regex-debt-register.json`
  const registerKeys = new Set<string>()
  if (existsSync(registerPath)) {
    const register = JSON.parse(readFileSync(registerPath, "utf8")) as { entries?: { file: string; source?: string }[] }
    for (const row of register.entries ?? []) {
      if (typeof row.source === "string") registerKeys.add(sourceKey({ file: row.file, source: row.source }))
    }
  }
  const isJustified = (e: CensusEntry) => Boolean(e.justification?.trim()) || registerKeys.has(sourceKey(e))
  const unjustified = strict
    ? entries.filter((e) => (e.classification === "replaceable" || e.classification === "needs_review") && !isJustified(e))
    : []

  // 2. Working-tree preview (disclosed, not fatal unless --require-clean).
  const work = await scanWorkingAnalyzers()
  const drift = await analyzerDrift(head, work)
  const headSourceKeys = new Set(head.map(sourceKey))

  const ok =
    missingFromCensus.length === 0 &&
    staleInCensus.length === 0 &&
    unclassified.length === 0 &&
    mislocated.length === 0 &&
    unjustified.length === 0 &&
    (!requireClean || (drift.clean && drift.added.length === 0 && drift.removed.length === 0))

  console.log(`census entries: ${entries.length} | HEAD scan: ${head.length} | working-tree scan: ${work.length}`)
  console.log(`missing from census: ${missingFromCensus.length}`)
  console.log(`stale in census: ${staleInCensus.length}`)
  console.log(`unclassified: ${unclassified.length}`)
  console.log(`mislocated: ${mislocated.length}`)
  if (strict) console.log(`unjustified (strict): ${unjustified.length}`)
  if (!drift.clean) {
    console.log(`working-tree drift (disclosed, not fatal unless --require-clean): ${drift.dirtyFiles.length} analyzer(s): ${drift.dirtyFiles.join(", ")}`)
    for (const k of drift.added) console.log(`  ${headSourceKeys.has(pairKeyOfEntryKey(k)) ? "SHIFTED" : "PENDING"} ${k}`)
    for (const k of drift.removed) console.log(`  ABSENT-IN-WORKTREE ${k}`)
  }
  if (requireClean) console.log(`--require-clean: drift entries = ${drift.added.length} added / ${drift.removed.length} removed`)

  // A truncated failure list is a SILENT one. This gate reported
  // "missing from census: 18" and then printed 15 of them, so a reader counting
  // the rows saw 15 and a reader trusting the header saw 18 — and the 3 in
  // between belonged to no lane in either accounting. That is the same failure
  // the honesty contract calls out as "silence is guilt": a check that hides part
  // of its own output cannot be used to decide what to fix.
  //
  // Everything is printed. A long list is a nuisance; a short one is a lie.
  const CAP = Number(process.env.BB_REGEX_LIST_CAP ?? 0) // 0 = no cap
  const show = <T,>(xs: T[], label: (x: T) => string): void => {
    const shown = CAP > 0 ? xs.slice(0, CAP) : xs
    for (const x of shown) console.log(label(x))
    if (shown.length < xs.length) {
      console.log(`… and ${xs.length - shown.length} more ${label(xs[0]).split(" ")[0]} row(s) hidden by BB_REGEX_LIST_CAP=${CAP}`)
    }
  }
  show(missingFromCensus, (k) => `MISSING ${k}`)
  show(staleInCensus, (k) => `STALE ${k}`)
  show(unclassified, (e) => `UNCLASSIFIED ${e.file}:${e.line} ${e.source.slice(0, 50)}`)
  show(unjustified, (e) => `UNJUSTIFIED ${e.file}:${e.line} [${e.classification}] ${e.source.slice(0, 50)}`)

  if (!ok) {
    console.error(`regex census gate ${strict ? "(strict) " : ""}FAILED`)
    process.exitCode = 1
  } else {
    console.log(`regex census gate ${strict ? "(strict) " : ""}PASSED`)
  }
}

main().catch((e) => {
  console.error("verify-regex-census failed:", e)
  process.exit(1)
})
