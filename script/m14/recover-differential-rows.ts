// script/m14/recover-differential-rows.ts — recover the floor rows a MERGE dropped.
//
// The incident this file exists for (2026-10-12):
//
//   `git log -S 'grails-core:xml' -- validation/m14/differential-baseline.json` returns NOTHING,
//   yet that row was written, measured and committed. The removal happened in a MERGE, and a
//   path-limited `-S` does not walk a merge commit's diff, so the deletion is invisible to the
//   tool everyone reaches for. The merge is 16075a5a1 ("merge(m48-recovery): 229 commits — the
//   co-agent's sql, kotlin, powershell, css, nim, vb, perl waves"): its first parent 7ab888b79
//   carries these nine rows and their nine sample-set hashes, its second parent carries neither,
//   and the merge kept the second parent's copy of the file. The same resolution deleted six
//   LANG_REPOS entries and five SECOND_CORPUS entries from script/m14/differential.ts (restored
//   there, with the same narrative, and guarded by validation/lane-protection/content-invariants.json).
//
// What the loss looked like from the outside: five lane gates (M14 sections E and F) sat red with
// "no baseline floor row", which reads as "the sweep hasn't run yet" — and the xml lane's own
// emitter asserted the opposite ("Sections E and F are CLOSED ... the row is PINNED"), with nothing
// comparing the two claims. The absence of a row was unattributable, which is the whole defect.
//
// The law this script follows: a recovered row is NEVER transcribed by hand. It is read out of the
// commit that recorded it (`git show <rev>:validation/m14/differential-baseline.json`), and the
// write carries provenance — where the row came from (`recoveredFrom`), which merge lost it
// (`lostAt`), and whether a later sweep on a box that HAS the corpus re-measured it
// (`reMeasuredAt`, stamped by differential.ts's mergeBaseline when it re-pins the key). A row this
// checkout cannot reproduce says so, in the file, next to the number.
//
// A recovered row is EVIDENCE, not a PIN: it is written to `recovered[key].row`, never to
// `counts[key]`. `counts` is what the regression gate scores and what sections E/F read as "the
// floor is closed" — and nine of these rows were measured by oracles that are NOT IN THIS TREE
// (merge 16075a5a1 dropped the `if (lang === "xml"|"hcl"|"make"|"nim"|"vb")` dispatch blocks and
// `derivePerlEdges` with the registrations), so a row in `counts` would be a guarantee backed by an
// instrument the tree cannot run. The `unmeasured` map carries the same facts as the CAUSE, so
// sections E/F read red WITH A REASON instead of red with nothing.
//
// Idempotent: a key that already has a pinned row is left exactly as it is (a sweep's fresh row is
// strictly better evidence than a recovered one, and re-running this must not undo it).
//
// Run: bun run script/m14/recover-differential-rows.ts [--dry-run]

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const ROOT = resolve(import.meta.dirname, "..", "..")
const BASELINE = join(ROOT, "validation", "m14", "differential-baseline.json")
const DRY = process.argv.includes("--dry-run")

/** The merge that resolved both files by taking the other parent's copy. */
const LOST_AT = "16075a5a1"

/**
 * key → the commit whose baseline still carries the row, newest first found in history. Each entry
 * was located by reading the file at the merge's parents and at the commits that touched either
 * claim (`script/m14/completeness-inventory.ts` sections E/F, `emit-xml-completeness.ts`,
 * `verify-perl-wave.ts`, `reviews/{hcl,make,perl}/master-review.md`), then taking the NEWEST
 * commit that still records it — so a later re-pin on either line wins over an older one.
 */
const RECOVERABLE: { key: string; rev: string; corpusOnBox: boolean; cause: string }[] = [
  {
    key: "consul:make",
    rev: "7ab888b79",
    corpusOnBox: false,
    cause: "make's 215-line oracle block is not in this tree (dropped by merge 16075a5a1), and the consul corpus is not checked out here",
  },
  {
    key: "grails-core:xml",
    rev: "7ab888b79",
    corpusOnBox: true,
    cause: "xml's 324-line oracle block is not in this tree: merge 16075a5a1 dropped it, and the lane had already withdrawn the claim it produced (c82067ea9 — the oracle resolved the XSD namespace for 1 of 62 elements and published `xsd:element` where the analyzer published `component-scan`; CHECK G replaced it). The corpus IS checked out, so a sweep reaches the lane and derives zero truth edges",
  },
  {
    key: "mojo:perl",
    rev: "7ab888b79",
    corpusOnBox: false,
    cause: "perl's oracle (derivePerlEdges + its dispatch block) is not in this tree (dropped by merge 16075a5a1), and the mojo corpus is not checked out here",
  },
  { key: "nim:nim", rev: "7ab888b79", corpusOnBox: false, cause: "nim's 12-line oracle block is not in this tree (dropped by merge 16075a5a1), and the nim corpus is not checked out here" },
  { key: "pixie:nim", rev: "7ab888b79", corpusOnBox: false, cause: "same dropped oracle block, and the pixie corpus is not checked out here" },
  {
    key: "plack:perl",
    rev: "7ab888b79",
    corpusOnBox: true,
    cause: "perl's oracle is not in this tree (dropped by merge 16075a5a1); the plack corpus IS checked out, but a probe of it derives zero truth edges",
  },
  {
    key: "tf-aws-components:hcl",
    rev: "bc3bc4de1",
    corpusOnBox: false,
    cause: "hcl's 128-line oracle block is not in this tree (dropped by merge 16075a5a1), and the tf-aws-components corpus is not checked out here",
  },
  {
    key: "terraform:hcl",
    rev: "bc3bc4de1",
    corpusOnBox: true,
    cause: "hcl's 128-line oracle block is not in this tree (dropped by merge 16075a5a1); the corpus IS checked out, so a sweep reaches the lane and derives zero truth edges",
  },
  {
    key: "tf-aws-components:make",
    rev: "7ab888b79",
    corpusOnBox: false,
    cause: "make's 215-line oracle block is not in this tree (dropped by merge 16075a5a1), and the tf-aws-components corpus is not checked out here",
  },
]

/** Lanes whose oracle block the merge dropped but which never had a row of their own. */
const DECLARED_NO_ROW: { key: string; cause: string }[] = [
  { key: "P3D-Legacy:vb", cause: "vb's 543-line oracle block is not in this tree (dropped by merge 16075a5a1), and the P3D-Legacy corpus is not checked out here" },
]

function baselineAt(rev: string): { counts: Record<string, any>; hashes: Record<string, string> } {
  const text = execFileSync("git", ["show", `${rev}:validation/m14/differential-baseline.json`], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  const parsed = JSON.parse(text)
  return { counts: parsed.counts ?? parsed, hashes: parsed.hashes ?? {} }
}

function main(): number {
  if (!existsSync(BASELINE)) {
    console.error(`recover-differential-rows: no baseline at ${BASELINE}`)
    return 1
  }
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"))
  baseline.counts ??= {}
  baseline.hashes ??= {}
  baseline.recovered ??= {}
  baseline.unmeasured ??= {}
  const restored: string[] = []
  const pinnedElsewhere: string[] = []
  const notFound: string[] = []

  for (const { key, rev, corpusOnBox, cause } of RECOVERABLE) {
    // A row that is PINNED — by a sweep, on a box that can produce it — is the stronger fact and is
    // left completely alone (a first sweep after the oracles are restored will pin these keys for
    // real, and this script must not fight it).
    if (baseline.counts[key]) {
      pinnedElsewhere.push(key)
      continue
    }
    let source: { counts: Record<string, any>; hashes: Record<string, string> }
    try {
      source = baselineAt(rev)
    } catch {
      notFound.push(`${key} (cannot read ${rev})`)
      continue
    }
    const row = source.counts[key]
    if (!row) {
      notFound.push(`${key} (absent at ${rev})`)
      continue
    }
    const hash = source.hashes[key]
    baseline.recovered[key] = {
      recoveredFrom: rev,
      lostAt: LOST_AT,
      // The measurement itself, as recorded: EVIDENCE about a past run, deliberately not a pin.
      row,
      sampleSetHash: hash ?? null,
      reMeasuredAt: null,
      note: "row recovered from the recorded sweep at the named commit, as EVIDENCE; the merge above kept the other parent's copy of this file. It is not a pin: differential.ts's mergeBaseline replaces this entry when a sweep re-measures the key",
    }
    // The cause, in the same shape the sweep writes: what a reader of a red section E/F needs.
    baseline.unmeasured[key] = {
      repo: key.split(":")[0],
      language: key.split(":")[1],
      reason: `${cause} — the row recovered from ${rev} is retained as evidence, not as a floor`,
      corpusOnBox,
      recoveredRow: true,
      at: rev,
    }
    restored.push(`${key} <- ${rev} (hash ${hash ?? "none"})`)
  }

  for (const { key, cause } of DECLARED_NO_ROW) {
    if (!baseline.unmeasured[key]) {
      baseline.unmeasured[key] = { repo: key.split(":")[0], language: key.split(":")[1], reason: cause, at: LOST_AT }
    }
  }

  if (!DRY) writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + "\n")
  console.log(`recover-differential-rows: ${restored.length} row(s) recorded as evidence + cause${DRY ? " (dry run, nothing written)" : ""}`)
  for (const r of restored) console.log(`  recorded  ${r}`)
  for (const k of pinnedElsewhere) console.log(`  PINNED    ${k} (a row exists; left exactly as it is)`)
  for (const k of notFound) console.error(`  MISSING   ${k}`)
  return notFound.length === 0 ? 0 : 1
}

if (import.meta.main) {
  process.exit(main())
}
