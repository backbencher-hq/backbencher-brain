// script/m49/verify-r2-regex.ts — M49.R2: regex census truth gate.
//
// M12 built an AST-driven regex census and a verify gate, but two defects let
// it go vacuous (found 2026-09-08; the user's "scala/kotlin are full of regex
// asshole" suspicion was CORRECT):
//   1. The committed census claimed 0 usages while the analyzers carried 55.
//   2. The fast battery never ran the census gate, so "MISSING x55" went
//      unnoticed across whole review waves.
//
// M49 W7 correction (2026-09-12). The W5/W6 gate re-scanned the WORKING TREE,
// which conflated two very different situations and made a *global* gate red
// for another wave's in-flight work — blocking every family closure:
//
//   (a) the committed census does not describe HEAD  → a REAL defect;
//   (b) the working tree is dirty (someone else's uncommitted analyzers move
//       regex lines)                          → NOT this gate's business.
//
// The committed artifact must describe HEAD. So:
//
//   1. Census ↔ HEAD (FATAL): the census must match a scan of the COMMITTED
//      analyzer blobs exactly. This is the invariant that catches an artifact
//      derived from a dirty tree, and it holds regardless of who is mid-edit.
//   2. Register coverage (FATAL), keyed by FILE + SOURCE, not by line: "every
//      needs_review/replaceable regex in the committed analyzers must be
//      individually justified". Line numbers move on every wave (the register
//      went stale four waves running, each time with a "line shifted" note);
//      a regex's source string does not. Multiplicity is enforced, so N
//      entries are required for N same-source usages. Positions are still
//      REPORTED, and drift between a register line and its real HEAD line is
//      disclosed — but it is not the identity of the entry.
//   3. Shrink-only (FATAL): the review-class total may never grow vs baseline.
//   4. Working-tree drift (DISCLOSED, or fatal under --require-clean): the
//      difference between HEAD and the working tree, with entries that
//      introduce a regex SOURCE the census has never seen marked NEW, so an
//      uncommitted new regex can never hide behind "it's someone else's file".
//   5. Policy doc ↔ census (FATAL): reviews/regex-policy.md declares its
//      survivor count in a machine-readable line, asserted here. The document
//      is the human-facing "why each regex survives" record and it HAD drifted
//      (it said 22 while the census carried 26) because nothing read it.
//
// Run: bun script/m49/verify-r2-regex.ts [--require-clean]
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import {
  ROOT,
  analyzerDrift,
  diffScans,
  headPositionsOf,
  multiset,
  multisetDiff,
  pairKeyOfEntryKey,
  prettyKey,
  scanHeadAnalyzers,
  scanWorkingAnalyzers,
  sourceKey,
  type ScanEntry,
} from "../m12/census-truth"

const hasArg = (flag: string) => process.argv.includes(flag)
const argValue = (flag: string) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}
// Overridable so the gate's FATAL branches can be proven able to fail against
// deliberately-mutated artifacts (see the self-test record in
// reviews/regex-policy.md). Production runs use the committed paths.
const CENSUS = argValue("--census") ?? path.join(ROOT, "validation/m12/results/regex-census.json")
const REGISTER = argValue("--register") ?? path.join(ROOT, "validation/m49/regex-debt-register.json")
const requireClean = hasArg("--require-clean")

let checks = 0, passed = 0, failed = 0, negatives = 0
function check(name: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`) }
}
function negative(name: string, ok: boolean, detail = "") { negatives++; check(`${name} [negative]`, ok, detail) }

interface Entry extends ScanEntry { line: number; source: string; classification: string }
interface Census { totalRegexUsages: number; perFile: { file: string; count: number; usages: Entry[] }[] }

const REVIEW_CLASSES = new Set(["needs_review", "replaceable"])

async function main() {
  const census: Census = JSON.parse(readFileSync(CENSUS, "utf8"))
  const committed = census.perFile.flatMap((f) => f.usages)

  // ── 1. Census ↔ HEAD (the standard of truth) ──────────────────────────────
  const head = await scanHeadAnalyzers()
  const { missing, stale } = diffScans(committed, head)

  check("census has regex entries to verify", committed.length > 0,
    `census lists ${committed.length} usages`)

  check("census freshness vs HEAD: no MISSING entries", missing.length === 0,
    missing.length ? `${missing.length} unrecorded in census, first: ${missing.slice(0, 3).join(" | ")}` : "")

  check("census freshness vs HEAD: no STALE entries", stale.length === 0,
    stale.length ? `${stale.length} not present in HEAD, first: ${stale.slice(0, 3).join(" | ")}` : "")

  negative("a stale census cannot claim zero while HEAD carries usages",
    !(census.totalRegexUsages === 0 && head.length > 0),
    `census says ${census.totalRegexUsages}, HEAD scan says ${head.length}`)

  // ── 2. Register coverage, keyed by file + source ──────────────────────────
  const reviewEntries = committed.filter((e) => REVIEW_CLASSES.has(e.classification))
  const registeredEntries: { file: string; line: number; source: string }[] = []
  let register: { baselineTotal: number; entries: { file: string; line: number; source?: string; note?: string }[] } = {
    baselineTotal: -1,
    entries: [],
  }
  if (existsSync(REGISTER)) register = JSON.parse(readFileSync(REGISTER, "utf8"))
  for (const e of register.entries) {
    if (typeof e.source === "string") registeredEntries.push({ file: e.file, line: e.line, source: e.source })
  }
  const sourcelessRows = register.entries.filter((e) => typeof e.source !== "string")

  const coverage = multisetDiff(multiset(reviewEntries), multiset(registeredEntries))

  check("debt register rows all carry the regex source they identify", sourcelessRows.length === 0,
    sourcelessRows.length ? `${sourcelessRows.length} row(s) without a source, first: ${sourcelessRows.slice(0, 3).map((e) => `${e.file}:${e.line}`).join(", ")}` : "")

  check("every needs_review/replaceable entry is in the debt register (by file+source)",
    coverage.missing.length === 0,
    coverage.missing.length
      ? `${coverage.missing.length} unjustified, first: ${coverage.missing.slice(0, 4).map((m) => `${prettyKey(m.key)} (${m.available}/${m.required})`).join(" | ")}`
      : "")

  check("register has no ghost rows (by file+source)", coverage.extra.length === 0,
    coverage.extra.length
      ? `${coverage.extra.length} ghost, first: ${coverage.extra.slice(0, 3).map((m) => `${prettyKey(m.key)} (${m.available}/${m.required})`).join(" | ")}`
      : "")

  // Self-tests: the comparison must be able to convict both directions, and
  // must not confuse a shifted position with a new regex.
  const synthetic = multisetDiff(
    multiset([{ file: "a.ts", source: "/x/" }, { file: "a.ts", source: "/y/" }]),
    multiset([{ file: "a.ts", source: "/x/" }]),
  )
  negative("a register missing one required source is reported unjustified",
    synthetic.missing.length === 1 && synthetic.missing[0].key.startsWith("a.ts") && synthetic.missing[0].required === 1,
    JSON.stringify(synthetic.missing))
  const syntheticGhost = multisetDiff(
    multiset([{ file: "a.ts", source: "/x/" }]),
    multiset([{ file: "a.ts", source: "/x/" }, { file: "a.ts", source: "/z/" }]),
  )
  negative("a register carrying a source the census never justified is reported as a ghost",
    syntheticGhost.extra.length === 1 && syntheticGhost.extra[0].key.includes("/z/"),
    JSON.stringify(syntheticGhost.extra))
  const syntheticDup = multisetDiff(
    multiset([{ file: "a.ts", source: "/x/" }, { file: "a.ts", source: "/x/" }]),
    multiset([{ file: "a.ts", source: "/x/" }]),
  )
  negative("two same-source usages require two register rows (multiplicity is enforced)",
    syntheticDup.missing.length === 1 && syntheticDup.missing[0].required === 2 && syntheticDup.missing[0].available === 1,
    JSON.stringify(syntheticDup.missing))

  // ── 3. Shrink-only ────────────────────────────────────────────────────────
  if (register.baselineTotal >= 0) {
    check("review-class regex total is monotonically non-increasing",
      reviewEntries.length <= register.baselineTotal,
      `baseline ${register.baselineTotal} -> now ${reviewEntries.length}`)
  } else {
    check("debt register baseline established", register.baselineTotal === -1,
      "no baseline recorded yet")
  }

  // ── 3b. Policy document ↔ census ─────────────────────────────────────────
  // The policy file is the human-facing record of WHY each regex survives.
  // It used to carry prose counts nothing maintained, and did drift (it said
  // 22 survivors while the census carried 26). It now declares its count in a
  // machine-readable line that this gate asserts, so the document cannot
  // describe a regex set that no longer exists.
  const POLICY = argValue("--policy") ?? path.join(ROOT, "reviews/regex-policy.md")
  const DECLARED = "Declared survivor count:"
  // Char-scan, not regex (this file's own policy): first digit run after the label.
  const declaredCountIn = (text: string): number | null => {
    const label = text.split("\n").find((l) => l.includes(DECLARED))
    if (label === undefined) return null
    const after = label.slice(label.indexOf(DECLARED) + DECLARED.length)
    let digits = ""
    for (let i = 0; i < after.length; i++) {
      const c = after[i]
      if (c >= "0" && c <= "9") digits += c
      else if (digits.length > 0) break
    }
    return digits.length > 0 ? Number(digits) : null
  }
  const policyText = existsSync(POLICY) ? readFileSync(POLICY, "utf8") : ""
  const declaredCount = declaredCountIn(policyText)

  check("policy doc declares a survivor count", declaredCount !== null,
    declaredCount === null ? `${POLICY} carries no "${DECLARED}" line` : "")

  check("policy doc's declared count matches the census",
    declaredCount !== null && declaredCount === census.totalRegexUsages,
    `policy declares ${declaredCount ?? "nothing"}, census carries ${census.totalRegexUsages}`)

  check("policy doc's declared count matches HEAD's live scan",
    declaredCount !== null && declaredCount === head.length,
    `policy declares ${declaredCount ?? "nothing"}, HEAD scan finds ${head.length}`)

  negative("a policy count that disagrees with the census is convictable",
    declaredCountIn(`> ${DECLARED} 999`) === 999 && 999 !== census.totalRegexUsages,
    "synthetic disagreement was not parsed as a disagreement")

  // ── 4. Working-tree drift (disclosed; fatal only under --require-clean) ────
  const work = await scanWorkingAnalyzers()
  const drift = await analyzerDrift(head, work)

  // A drift key is NEW when its (file, source) pair is not represented in
  // HEAD at all; a key whose pair IS present is a pure line shift.
  const headPairKeys = new Set(head.map(sourceKey))
  const isNewSource = (key: string) => !headPairKeys.has(pairKeyOfEntryKey(key))
  const genuinelyNew = drift.added.filter(isNewSource)

  // The report is COMPLETE — no truncation. A disclosure that elides the tail
  // is how an uncommitted regex hides, so every drifted entry is named.
  const driftLines: string[] = []
  if (!drift.clean) {
    driftLines.push(`working tree differs from HEAD in ${drift.dirtyFiles.length} analyzer(s): ${drift.dirtyFiles.join(", ")}`)
    if (drift.added.length) driftLines.push(`  +${drift.added.length} entr(y/ies) only in the working tree: ${drift.added.join(" | ")}`)
    if (drift.removed.length) driftLines.push(`  -${drift.removed.length} entr(y/ies) only in HEAD: ${drift.removed.join(" | ")}`)
    if (genuinelyNew.length) driftLines.push(`  NEW regex source(s) awaiting registration at commit: ${genuinelyNew.join(" | ")}`)
  }

  // Disclosure presence: when the tree is dirty the report MUST be non-empty.
  check("working-tree drift is disclosed whenever the tree differs from HEAD",
    drift.clean || driftLines.length > 0,
    drift.clean ? "tree matches HEAD" : "drift report was empty while files differ")

  // Nothing may be elided: every working-tree-only entry must be named in full.
  const undisclosed = drift.added.filter((k) => !driftLines.some((l) => l.includes(k)))
  check("every working-tree-only entry is named in the drift report",
    undisclosed.length === 0,
    undisclosed.length ? `${undisclosed.length} elided, first: ${undisclosed.slice(0, 3).join(" | ")}` : "")

  // Self-tests for the shift-vs-new discriminator, using the SAME predicate
  // the report uses.
  const shiftedHeadEntry = head[0]
  const shiftedKey = shiftedHeadEntry
    ? `${shiftedHeadEntry.file}:${shiftedHeadEntry.line + 500}:${shiftedHeadEntry.source}`
    : ""
  negative("a pure line shift is NOT reported as a new regex source",
    shiftedKey.length > 0 && !isNewSource(shiftedKey),
    `shifted key ${shiftedKey} classified new=${isNewSource(shiftedKey)}`)
  negative("an uncommitted regex source absent from HEAD is reported as NEW",
    isNewSource("real-zzz-analyzer.ts:1:/(?<never>seen)/"),
    "synthetic unseen source was not flagged NEW")

  if (requireClean) {
    check("--require-clean: working tree matches HEAD",
      drift.clean && drift.added.length === 0 && drift.removed.length === 0,
      driftLines.join(" / "))
  }

  // ── Position advisories (reported, never fatal) ───────────────────────────
  const stalePositions = register.entries
    .filter((e) => typeof e.source === "string")
    .map((e) => {
      const real = headPositionsOf(head, e.file, e.source as string)
      return { row: `${e.file}:${e.line}`, real }
    })
    .filter((x) => x.real.length > 0 && !x.real.includes(Number(x.row.split(":").pop())))

  console.log(`regex census: ${committed.length} committed / ${head.length} HEAD / ${work.length} working | review-class: ${reviewEntries.length} (baseline ${register.baselineTotal >= 0 ? register.baselineTotal : "n/a"}) | policy doc declares ${declaredCount ?? "nothing"}`)
  if (stalePositions.length) {
    console.log(`advisory: ${stalePositions.length} register row(s) carry a stale line number (identity is file+source; HEAD positions shown) — first: ${stalePositions.slice(0, 3).map((s) => `${s.row} -> ${s.real.join("/")}`).join(", ")}`)
  }
  for (const line of driftLines) console.log(`drift: ${line}`)
  console.log(`M49.R2: ${passed}/${checks} checks passed, ${negatives} negative(s) exercised${requireClean ? " (--require-clean)" : ""}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => { console.error(e); process.exit(1) })
