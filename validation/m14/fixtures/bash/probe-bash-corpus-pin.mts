/**
 * CORPUS PIN — is the corpus in front of me the corpus the doc's numbers were taken on?
 *
 * ## Why this exists
 *
 * Limitation 14 says the right thing and checks nothing: "the census sample is
 * reproducible only against a pinned corpus". Nothing in the lane recorded WHICH
 * corpus, so the claim was unfalsifiable in both directions — a reader could not
 * tell a regression from a corpus that grew, and this lane repeatedly had to
 * argue the difference from prose.
 *
 * Measured, on 2026-10-04, in one session, with no analyzer change between the two
 * runs (`git log 17c6cfc0e..HEAD -- src/` is empty, and 17c6cfc0e IS the commit
 * the doc's whole-corpus column was measured at):
 *
 *   census --all   admitted 4,133   symbols 42,456   rels 178,464
 *   coverage gate   admitted 4,185
 *
 * A 52-file difference with an identical analyzer, in the same hour, on a corpus
 * six other agents are told to extend. The census had read the corpus before the
 * new clones landed. That is the whole failure mode limitation 14 names, caught
 * in the act, and it was caught by accident — two instruments disagreeing.
 *
 * So this file makes the pin CHECKABLE rather than stated:
 *
 *   setHash    sha256 over the sorted `repo/rel` list of every admitted file. Two
 *              runs agree on setHash iff they saw the same admitted FILE SET. It
 *              says nothing about content, and it is the number that decides
 *              whether a hash-ordered sample is the same sample.
 *   sampleHash sha256 over the first `--sample N` entries of that hash order. Two
 *              runs agree on sampleHash iff the census measured the same files,
 *              which is the stronger claim the doc's per-type columns need.
 *   contentHash sha256 over `repo/rel:size` for admitted files. Distinguishes
 *              "the corpus grew" from "a file I already had changed underneath
 *              me" — the two are different findings and a count cannot tell them.
 *
 * The corpus is a tree of `--depth 1` clones that other agents extend, so it is
 * NOT pinnable by revision. These hashes are the pin.
 *
 * ## What it does not do
 *
 * It does not parse anything and does not touch the analyzer, so it cannot detect
 * a wasm abort. The census prints its own fallback count for that, because a
 * census that cannot tell "the analyzer found nothing" from "the analyzer never
 * ran" cannot support a whole-corpus claim either.
 *
 * No regex: admission is the production router, the same call the census and the
 * coverage gate make, so a pin that disagreed with them would be measuring a
 * different corpus than the one being pinned.
 *
 *   npx tsx validation/m14/fixtures/bash/probe-bash-corpus-pin.mts
 *   npx tsx validation/m14/fixtures/bash/probe-bash-corpus-pin.mts --sample 400
 *   npx tsx validation/m14/fixtures/bash/probe-bash-corpus-pin.mts --expect <setHash>
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argValue = (flag: string): string | undefined => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const SAMPLE = Number(argValue("--sample") ?? "400")
const EXPECT = argValue("--expect")
const SIZE_CAP = 512 * 1024

interface Admitted {
  key: string
  size: number
  hash: string
}

const admitted: Admitted[] = []
let reposSeen = 0
let trackedTotal = 0
let oversized = 0
let unreadable = 0

for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  reposSeen++
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  trackedTotal += tracked.length
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let size: number
    try {
      size = statSync(abs).size
      if (size > SIZE_CAP) {
        oversized++
        continue
      }
    } catch {
      unreadable++
      continue
    }
    let text: string
    try {
      text = readFileSync(abs, "utf8")
    } catch {
      unreadable++
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    admitted.push({ key: `${e}/${rel}`, size, hash: createHash("sha256").update(text).digest("hex") })
  }
}

// The census's own order: ascending sha256 of `repo/rel`. Reproduced here rather
// than imported, because a pin that sorted differently would disagree with every
// sample column it is supposed to protect.
const byHash = (a: Admitted, b: Admitted): number => {
  const ha = createHash("sha256").update(a.key).digest("hex")
  const hb = createHash("sha256").update(b.key).digest("hex")
  return ha < hb ? -1 : ha > hb ? 1 : 0
}
admitted.sort(byHash)

const sha = (s: string): string => createHash("sha256").update(s).digest("hex")
const setHash = sha(admitted.map((a) => a.key).sort().join("\n"))
const contentHash = sha(admitted.map((a) => `${a.key}:${a.size}:${a.hash}`).sort().join("\n"))
const sample = admitted.slice(0, SAMPLE)
const sampleHash = sha(sample.map((a) => a.key).join("\n"))

console.log(`corpus root        : ${CR}`)
console.log(`repos (git)        : ${reposSeen}`)
console.log(`tracked files      : ${trackedTotal}`)
console.log(`skipped >512KB     : ${oversized}`)
console.log(`skipped unreadable : ${unreadable}`)
console.log(`admitted (bash)    : ${admitted.length}`)
console.log(`admitted repos     : ${new Set(admitted.map((a) => a.key.split("/")[0])).size}`)
console.log(`setHash            : ${setHash}`)
console.log(`contentHash        : ${contentHash}`)
console.log(`sampleHash (N=${String(SAMPLE)}) : ${sampleHash}`)
console.log("")
console.log("setHash agrees  => the same admitted FILE SET, so a hash-ordered sample of the same")
console.log("                 size is the same sample and per-type columns are comparable.")
console.log("contentHash agrees => the same bytes, so a difference in a count is the analyzer's.")
console.log("sampleHash agrees => this exact measurement compared the same files.")

if (EXPECT !== undefined) {
  const ok = EXPECT === setHash
  console.log("")
  console.log(`--expect ${EXPECT}`)
  console.log(ok ? "PIN MATCHES" : "PIN MISMATCH — the corpus is not the one those numbers were taken on")
  process.exit(ok ? 0 : 1)
}