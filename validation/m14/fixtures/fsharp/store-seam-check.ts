/**
 * STORE-SEAM CHECK — is every relationship endpoint a key the STORE publishes?
 *
 * ## WHY THIS FILE EXISTS
 *
 * `validation/m14/fixtures/fsharp/edge-resolution-probe.ts` REPORTS resolution rates per
 * type. This file ASSERTS one invariant and exits non-zero when it is broken, and it is
 * deliberately a different question from the probe's:
 *
 *   the probe asks  — of the edges that came out, what fraction bind to a published symbol?
 *   this file asks  — is every endpoint a SPELLING this analyzer also publishes?
 *
 * The second is stricter, and it is the one that catches FS-P3-1. That defect emitted
 * `overrides Dog.Speak -> Animal.Speak` while publishing every owned symbol under the BARE
 * name, so the endpoint was a string the store did not hold: 0 of 63 `overrides` edges
 * matched, and `src/lsp/impact.ts` — which derives reverse edges by scanning outgoing edges
 * and matching targets — could not walk back to any of them. No per-type RATE reveals that,
 * because a rate is a fraction and this was a systematic mismatch on one type.
 *
 * ## THE TWO INVARIANTS
 *
 *   1. `metadata.fqn === ownerName + "." + name` for every symbol that HAS an owner, and NO
 *      `fqn` for a symbol with no owner. `pool-worker.ts:870` reads
 *      `s.qualifiedName || s.metadata?.fqn || (s.scope ? … : name)`, so this string is
 *      literally `brain_symbol.qualified_name` — which is what
 *      `brain_relationship.source_external` is JOINed against.
 *
 *   2. Every relationship SOURCE that contains a `.` is either a published `fqn`, a
 *      published `name`, or is recorded as UNRESOLVED-BY-SPELLING with an example. Invariant
 *      1 makes the second half of that tautological for `overrides`; the check still runs it
 *      because a future edge type could use a qualified endpoint this rule does not mint.
 *
 * ## WHY IT IS OWNER-AGNOSTIC
 *
 * The fixture `qualified-name-seam` pins LITERAL qualified names, which is what makes it
 * readable and what makes it name-dependent. This file pins the RULE, over the whole corpus
 * sample, so it cannot be satisfied by one fixture's spelling and does not depend on any name
 * in the corpus at all.
 *
 * ## AND WHY IT PROVES IT CAN FAIL
 *
 * `--self-test` re-runs both invariants against a DEGRADED COPY of its own result — with
 * every symbol's `qualifiedName` reduced to its bare `name`, which is the pre-FS-P3-1 state
 * and what the store actually held — and requires the bound count to MOVE. A verifier that
 * has never been seen to fail is decoration.
 *
 * The self-test earned its place immediately: it caught a bug in this file's FIRST version,
 * which incremented one counter for both "correct" and "absent" and therefore reported a
 * clean pass over a corpus where no symbol carried a qualified name at all. Stripping a
 * field did not move the number being compared, which is exactly the signature of a check
 * that counts the wrong thing, and it is why the three cases are counted separately now.
 *
 * ## INSTRUMENT DISCIPLINE
 *
 * No regex anywhere in this file. Corpus membership is `git ls-files` +
 * `detectLanguageFromPath`; symbols and edges come from production
 * `parseFile` (`src/ast/pool-worker.ts`), never `analyze()`. READ-ONLY: writes nothing.
 *
 * ## USAGE
 *
 *   npx tsx validation/m14/fixtures/fsharp/store-seam-check.ts [--files 400] [--self-test]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "fsharp"
const argv = process.argv.slice(2)
const SELF_TEST = argv.includes("--self-test")
const FILES_FLAG = argv.indexOf("--files")
const SAMPLE = FILES_FLAG >= 0 ? Number(argv[FILES_FLAG + 1]) || 400 : 400

// ---------------------------------------------------------------- corpus walk

type Repo = { name: string; dir: string }

function corpusRepos(): Repo[] {
  const out: Repo[] = []
  let entries: string[]
  try {
    entries = readdirSync(CR)
  } catch {
    return out
  }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    out.push({ name, dir })
  }
  return out
}

function trackedFiles(dir: string): string[] {
  try {
    const raw = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
    return raw.split("\0").filter(Boolean)
  } catch {
    return []
  }
}

/** Deterministic stride sample — the same construction `firing-check.ts` uses. */
function filesForLanguage(limit: number): { files: string[]; total: number } {
  const all: string[] = []
  for (const repo of corpusRepos()) {
    for (const rel of trackedFiles(repo.dir)) {
      if (detectLanguageFromPath(rel) !== LANG) continue
      all.push(path.join(repo.dir, rel))
    }
  }
  const total = all.length
  if (all.length <= limit) return { files: all.sort(), total }
  const stride = Math.max(1, Math.floor(all.length / limit))
  const picked: string[] = []
  for (let i = 0; i < all.length && picked.length < limit; i += stride) picked.push(all[i])
  return { files: picked.sort(), total }
}

// ---------------------------------------------------------------- the check

type SeamRow = {
  symbols: number
  owned: number
  ownedCorrect: number
  ownedWrong: number
  ownedAbsent: number
  unownedQualified: number
  wrongExamples: string[]
  dottedSources: number
  dottedSourceUnbound: number
  unboundExamples: string[]
}

/**
 * Run both invariants over one `parseFile` result.
 *
 * It reads `qualifiedName`, NOT `metadata.fqn`, and the distinction is the whole point of
 * this file. `metadata.fqn` is what the ANALYZER mints; `pool-worker.ts:870` CONSUMES it
 * (`s.qualifiedName || s.metadata?.fqn || (s.scope ? … : name)`) into `qualifiedName`, and
 * the mapped symbol that leaves the worker does not re-expose it — measured on
 * `qualified-name-seam.fs`: the symbol carries `qualifiedName="Animal.Speak"` and no
 * `metadata.fqn`. `qualifiedName` is the string that becomes `brain_symbol.qualified_name`,
 * which is the column `brain_relationship.source_external` is JOINed against, so it is the
 * only field on which this question has a consumer.
 *
 * The analyzer-level field is pinned separately, by the `meta.fqn` rows in
 * `validation/m14/fixtures/fsharp/qualified-name-seam.expectation.json` — the fixture runner
 * calls `analyze()`, where `metadata` is still intact. Two layers, two checks, and each one
 * can fail while the other passes.
 */
function checkResult(r: any, fileLabel: string, row: SeamRow): void {
  const syms: any[] = Array.isArray(r?.symbols) ? r.symbols : []
  const fqns = new Set<string>()
  const names = new Set<string>()

  for (const s of syms) {
    row.symbols++
    const name = String(s?.name ?? "")
    const owner = String(s?.ownerName ?? "")
    const qn = s?.qualifiedName
    const qualified = qn === undefined || qn === null ? "" : String(qn)
    if (name.length > 0) names.add(name)
    if (qualified.length > 0) fqns.add(qualified)

    if (owner.length > 0) {
      row.owned++
      // The three cases are counted SEPARATELY. An earlier draft of this file incremented
      // the same counter for "correct" and for "absent", which made a run with NO qualified
      // names at all report a clean pass — and the --self-test below is what exposed it,
      // because stripping the field did not move the number it was comparing.
      if (qualified.length === 0) {
        row.ownedAbsent++
        if (row.wrongExamples.length < 5) row.wrongExamples.push(`${fileLabel}: ${name} owner=${owner} qualifiedName=ABSENT`)
      } else if (qualified === `${owner}.${name}`) {
        row.ownedCorrect++
      } else {
        row.ownedWrong++
        if (row.wrongExamples.length < 5) row.wrongExamples.push(`${fileLabel}: ${name} owner=${owner} qualifiedName=${qualified} (want ${owner}.${name})`)
      }
    } else if (qualified.length > 0 && qualified !== name) {
      // An UNOWNED symbol whose qualified name is not its own name is a fabricated owner
      // prefix: it would publish a scope the declaration does not have.
      row.unownedQualified++
      if (row.wrongExamples.length < 5) row.wrongExamples.push(`${fileLabel}: ${name} owner=NONE qualifiedName=${qualified} (an owner prefix that does not exist)`)
    }
  }

  for (const rel of Array.isArray(r?.relationships) ? r.relationships : []) {
    const src = String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? "")
    if (!src.includes(".")) continue
    row.dottedSources++
    if (fqns.has(src) || names.has(src)) continue
    row.dottedSourceUnbound++
    if (row.unboundExamples.length < 5) {
      row.unboundExamples.push(`${fileLabel}: ${String(rel?.type ?? "")} ${src}`)
    }
  }
}

function blankRow(): SeamRow {
  return {
    symbols: 0, owned: 0, ownedCorrect: 0, ownedWrong: 0, ownedAbsent: 0, unownedQualified: 0,
    wrongExamples: [], dottedSources: 0, dottedSourceUnbound: 0, unboundExamples: [],
  }
}

/**
 * The pre-FS-P3-1 state, at the layer this file reads: the store held the BARE name for
 * every owned symbol, because nothing minted a qualified one. That is not a hypothetical
 * degradation — it is what `pool-worker.ts:870`'s own fallback yields when the analyzer sets
 * none of `qualifiedName`, `metadata.fqn` and `scope`, which is exactly what this analyzer
 * did before the fix.
 */
function stripQualifiedName(r: any): any {
  return {
    ...r,
    symbols: (r?.symbols ?? []).map((s: any) => ({ ...s, qualifiedName: String(s?.name ?? "") })),
  }
}

async function measure(files: string[], transform: (r: any) => any): Promise<SeamRow> {
  const row = blankRow()
  for (const file of files) {
    let r: any
    try {
      r = await parseFile(file, path.dirname(file))
    } catch {
      continue
    }
    if (!r) continue
    checkResult(transform(r), path.relative(CR, file), row)
  }
  return row
}

function report(title: string, row: SeamRow): void {
  console.log(`\n== ${title} ==`)
  console.log(`  symbols                                ${row.symbols}`)
  console.log(`  owned (ownerName non-empty)            ${row.owned}`)
  console.log(`    qualifiedName === owner.name         ${row.ownedCorrect}`)
  console.log(`    qualifiedName WRONG                  ${row.ownedWrong}`)
  console.log(`    qualifiedName ABSENT                 ${row.ownedAbsent}`)
  console.log(`  unowned but qualified to something else${row.unownedQualified > 0 ? ` ${row.unownedQualified}` : ""}`)
  console.log(`  dotted relationship sources            ${row.dottedSources}`)
  console.log(`    unbound in this file                 ${row.dottedSourceUnbound}`)
  for (const e of row.wrongExamples) console.log(`      ! ${e}`)
  for (const e of row.unboundExamples) console.log(`      ? ${e}`)
}

async function main(): Promise<void> {
  const { files, total } = filesForLanguage(SAMPLE)
  console.log(`store-seam check — fsharp, production parseFile, ${files.length}-file stride sample of ${total}`)
  console.log(`corpus: ${CR}`)

  const good = await measure(files, (r) => r)
  report("LIVE", good)

  const bad = await measure(files, stripQualifiedName)
  if (SELF_TEST) report("SELF-TEST — same corpus, every symbol reduced to its bare name (the pre-FS-P3-1 state)", bad)

  // ---------------------------------------------------------------- verdict
  const failures: string[] = []
  if (good.ownedWrong > 0) failures.push(`${good.ownedWrong} owned symbol(s) carry a qualifiedName that is not owner.name`)
  if (good.ownedAbsent > 0) failures.push(`${good.ownedAbsent} owned symbol(s) carry NO qualifiedName — the pre-FS-P3-1 state, where the store holds a bare name and every dotted endpoint misses`)
  if (good.unownedQualified > 0) failures.push(`${good.unownedQualified} symbol(s) with NO owner carry a qualified name — a fabricated owner prefix`)
  if (good.owned === 0) failures.push("no owned symbols in the sample, so invariant 1 was never exercised — an empty result over a non-empty corpus is a failed check, not a pass")
  if (good.dottedSources === 0) failures.push("no dotted relationship sources in the sample, so invariant 2 was never exercised")

  console.log("")
  if (SELF_TEST) {
    // The self-test is meaningful only if degrading the field actually breaks the check.
    if (bad.ownedCorrect >= good.ownedCorrect) {
      console.log("SELF-TEST FAILED: reducing every symbol to its bare name did not reduce the correctly-bound count, so this check cannot detect the defect it exists for.")
      process.exitCode = 1
    } else {
      console.log(
        `SELF-TEST OK: reducing every symbol to its bare name unbound ` +
          `${bad.dottedSourceUnbound - good.dottedSourceUnbound} dotted source(s) that bind live ` +
          `(${good.dottedSourceUnbound} -> ${bad.dottedSourceUnbound} unbound), so the check detects FS-P3-1.`,
      )
    }
  }

  if (failures.length === 0) {
    console.log(`SEAM HOLDS: ${good.ownedCorrect} of ${good.owned} owned symbols publish owner.name; 0 wrong, 0 absent, 0 fabricated.`)
    console.log(`             ${good.dottedSources - good.dottedSourceUnbound} of ${good.dottedSources} dotted relationship sources bind to a published key.`)
  } else {
    for (const f of failures) console.log(`SEAM BROKEN: ${f}`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})