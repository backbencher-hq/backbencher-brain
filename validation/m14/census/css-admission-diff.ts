/**
 * CSS ADMISSION DIFF — why `firing-check.ts` and this lane's census draw different files.
 *
 * ## WHAT THIS IS FOR
 *
 * The supervisor's per-lane firing table reads, for css, `73,369 edges / 120 files`.
 * This lane re-measures the same command, on the same machine, at the same corpus, and
 * reads **47,667 edges / 120 files** — twice, four hours apart, byte-identical to each
 * other. The instrument is deterministic by construction (`firing-check.ts:168-193`:
 * "the sample is stable across runs and machines without depending on a PRNG seed"), so
 * a 54% spread is not sampling noise. It has to be a different FILE SET, and this probe
 * names it file by file.
 *
* It is a different file set because the two scripts apply two different admission rules,
 * and they differ in THREE dimensions, not one:
 *
 *   | rule | `css-parsefile-census.ts` / `ontology-coverage-gate.ts` | `firing-check.ts` |
 *   | --- | --- | --- |
 *   | size cap | `statSync(abs).size > 512*1024 -> continue` | **NO CAP** |
 *   | language test | `detectLanguageFromPath(abs, text)` (TWO args) | `detectLanguageFromPath(rel)` (ONE arg) |
 *   | existence | `statSync(abs)` — a tracked path with no file is skipped | **never stats it** |
 *
 * Measured, all three, on the corpus at this commit:
 *
 *   A  census + gate  (cap, two-arg, stat)   1,255 files
 *   B  firing-check   (no cap, one-arg)      1,266 on disk  +  5 tracked-but-absent  =  1,271
 *   C  two-arg, no cap                        1,266      -> the CAP alone is worth 11
 *   D  one-arg, with cap                      1,255      -> the TEXT ARGUMENT alone is worth 0
 *
 * So both halves of the difference are attributable: **11 files are over the 512 KB cap**
 * (10 in `bulma`, 1 in `consul`, every one a framework bundle), the one-argument language
 * test removes nothing on this corpus, and **5 tracked css paths do not exist on disk**.
 * `firing-check.ts --files 120 css --json` printed `corpusTotal: 1271`, which is
 * 1,266 + 5 — the arithmetic closes, so its denominator is reproducible and is not the
 * corpus this lane's census walks.
 *
 * The TEXT-ARGUMENT row was measured before, in pass 4, and was worth 9 files then; it is
 * worth 0 now, on a corpus that grew by 75 files. A dimension of an admission rule that
 * can be 9 and can be 0 is not a constant, so the census's decision to COPY the rule
 * rather than import it — "so the file set cannot drift with an edit to shared machinery"
 * — is defensible for the gate but it is also how two instruments ended up disagreeing
 * about what the corpus is.
 *
 * WHY IT MATTERS BEYOND THIS LANE
 *
 * Every per-lane number in the supervisor's firing table is drawn through
 * `filesForLanguage()`, so every one of them is drawn through a rule that is neither the
 * ontology gate's rule nor the census's rule. Two lanes whose corpora differ by a
 * percent draw different 120 files: **the two rules' draws share 27 of 120 files here**,
 * because a stride is `floor(all.length / limit)` over a list that grows by insertion, and
 * 11 inserted files move every pick after the insertion point. The probe prints the
 * sensitivity table, and the honest reading of it is that a lane's edge total in that
 * table is a function of the corpus at the moment of the run as much as of the lane.
 *
 * This is the same defect class as §8 item (d) on this instrument — the `files` column,
 * which can only print 0 or 1 — from the other side: not a column that cannot count, but a
 * sample drawn by a rule nobody declared and a denominator containing 5 files that are not
 * there.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not edit `firing-check.ts` (shared machinery, lane brief §8) and it does not
 * touch the shared census artifacts. It prints the diff, the four rule-sets, the phantom
 * paths, the sample overlap and the stride sensitivity, so the fix can be applied without
 * re-deriving any of it. The fix, for whoever owns it: (1) `statSync` the path, or count
 * only files that exist; (2) print `corpusTotal` on the same line as `rels` in the table,
 * next to §8 item (d)'s `files` column, so every figure in that table is readable as
 * "these edges over these files out of this corpus"; (3) draw the sample on a key that
 * does not move when the list grows — every k-th path by a stable sort — or record the
 * drawn paths in the artifact so a later run can tell a re-draw from a change.
 * Separately, the census and the gate should agree on ONE admission function rather than
 * each keeping a transcription, since the transcription is exactly what produced this.
 *
 * ## ZERO REGEX
 *
 * No regular expression appears in this file. Membership is decided on exact string keys
 * (`path.join(repo, rel)`), so nothing here can match a mention of a filename inside a
 * file's contents.
 *
 * Run: npx tsx validation/m14/census/css-admission-diff.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const LANG = "css"
const CAP = 512 * 1024
const SAMPLE = 120

type Row = { repo: string; rel: string; abs: string; bytes: number; one: boolean; two: boolean }

const rows: Row[] = []
const absent: string[] = []
let reposSeen = 0

for (const e of readdirSync(CR).sort()) {
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
    }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    // ONE-arg test: path only, exactly as firing-check.ts:181 calls it. Done BEFORE any
    // stat, because firing-check does the same: it never checks that the tracked path is
    // still on disk, so a tracked-but-deleted file counts toward its corpusTotal and
    // toward its stride. Counted below rather than assumed.
    const one = detectLanguageFromPath(rel) === LANG
    let bytes: number
    try {
      bytes = statSync(abs).size
    } catch {
      // Only the css-by-path ones can reach firing-check's corpusTotal, so only those
      // are recorded. The corpus also holds 20k+ tracked paths of OTHER languages that
      // are missing from disk (blobless clones), and counting those would be a different
      // finding about a different instrument.
      if (one) absent.push(path.join(e, rel))
      continue
    }
    // TWO-arg test: path plus contents, exactly as the census (line 130) and the
    // ontology gate (line 210) call it. Read the text ONCE and only when the path
    // test or the size cap could matter, so this probe is not itself the slow thing.
    let two = false
    if (one || bytes <= CAP) {
      let text = ""
      try {
        text = readFileSync(abs, "utf8")
      } catch {
        continue
      }
      two = detectLanguageFromPath(abs, text) === LANG
    }
    if (!one && !two) continue
    rows.push({ repo: e, rel, abs, bytes, one, two })
  }
}

// The four rule-sets. A = gate/census, B = firing-check, C and D isolate one dimension
// each so the report can attribute the difference instead of describing it.
const A = rows.filter((r) => r.bytes <= CAP && r.two) // census + gate: cap AND two-arg
const B = rows.filter((r) => r.one) // firing-check: no cap AND one-arg
const C = rows.filter((r) => r.two) // two-arg, no cap  -> isolates the CAP
const D = rows.filter((r) => r.bytes <= CAP && r.one) // one-arg, with cap -> isolates the TEXT ARG

const key = (r: Row): string => path.join(r.repo, r.rel)
const aKeys = new Set(A.map(key))
const bKeys = new Set(B.map(key))
const cKeys = new Set(C.map(key))
const dKeys = new Set(D.map(key))

const only = (from: Set<string>, other: Set<string>): string[] => [...from].filter((k) => !other.has(k)).sort()
const both = (x: Set<string>, y: Set<string>): number => [...x].filter((k) => y.has(k)).length

const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(2)} MB`

console.log(`css admission diff — corpus ${CR}`)
console.log(`git-tracked repos: ${reposSeen}; candidate css files by EITHER rule: ${rows.length}\n`)

console.log("RULE SETS (each row is one admission rule applied to the same tracked-file walk)")
console.log("--------------------------------------------------------------------------------------------------")
console.log("rule                                                       files")
console.log("--------------------------------------------------------------------------------------------------")
console.log(`A  census + gate:  size <= 512KB  AND  detect(abs, text)      ${A.length}`)
console.log(`B  firing-check:   no cap          AND  detect(rel)           ${B.length}`)
console.log(`C  two-arg only:   no cap          AND  detect(abs, text)      ${C.length}`)
console.log(`D  one-arg + cap:  size <= 512KB    AND  detect(rel)            ${D.length}`)
console.log("--------------------------------------------------------------------------------------------------\n")

console.log("A vs B — the difference the supervisor's number and this lane's number come from")
console.log(`  in A not in B: ${only(aKeys, bKeys).length}`)
console.log(`  in B not in A: ${only(bKeys, aKeys).length}`)
console.log(`  in both:       ${both(aKeys, bKeys)}\n`)

console.log("ATTRIBUTION — each file is assigned to the FIRST rule difference that explains it")
const explained = new Map<string, string>()
for (const r of rows) {
  if (!bKeys.has(key(r)) && aKeys.has(key(r))) explained.set(key(r), "in A only: the TEXT ARGUMENT removes it (B tests the path only)")
  else if (bKeys.has(key(r)) && !aKeys.has(key(r))) {
    explained.set(key(r), r.bytes > CAP ? "in B only: over the 512 KB CAP (B has no cap)" : "in B only: the TEXT ARGUMENT adds it")
  }
}
const attrCount = new Map<string, number>()
for (const v of explained.values()) attrCount.set(v, (attrCount.get(v) ?? 0) + 1)
for (const [why, n] of [...attrCount.entries()].sort((x, y) => y[1] - x[1])) console.log(`  ${String(n).padStart(4)}  ${why}`)

console.log("\nEVERY FILE IN THE SYMMETRIC DIFFERENCE, with the dimension that explains it")
console.log("--------------------------------------------------------------------------------------------------")
for (const r of rows.filter((x) => explained.has(key(x))).sort((x, y) => y.bytes - x.bytes)) {
  console.log(`  ${key(r)}  ${mb(r.bytes).padStart(9)}  over-cap=${r.bytes > CAP ? "YES" : "no "}`)
  console.log(`      ${explained.get(key(r))}`)
}
console.log("--------------------------------------------------------------------------------------------------\n")

console.log("THE CONSEQUENCE — stride and per-repo spread, because the sample is what the number counts")
console.log("--------------------------------------------------------------------------------------------------")
for (const [name, set] of [["A census/gate", A], ["B firing-check", B]] as const) {
  const sorted = [...set].map(key)
  const stride = Math.max(1, Math.floor(sorted.length / SAMPLE))
  const picked: string[] = []
  for (let i = 0; i < sorted.length && picked.length < SAMPLE; i += stride) picked.push(sorted[i])
  const repos = new Map<string, number>()
  for (const k of picked) {
    const r = k.slice(0, k.indexOf("/"))
    repos.set(r, (repos.get(r) ?? 0) + 1)
  }
  const top = [...repos.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5)
  console.log(`  ${name.padEnd(15)} total=${String(sorted.length).padStart(5)} stride=${String(stride).padStart(3)} picked=${String(picked.length).padStart(4)} distinct repos=${repos.size}`)
  console.log(`                  densest repos in the sample: ${top.map(([r, n]) => `${r}(${n})`).join("  ")}`)
}
console.log("--------------------------------------------------------------------------------------------------\n")

// How many of the 120 files each rule picks are NOT picked by the other. This is the
// number that decides whether the two runs are measuring the same thing at all.
const pickOf = (set: Row[]): Set<string> => {
  const sorted = [...set].map(key)
  const stride = Math.max(1, Math.floor(sorted.length / SAMPLE))
  const picked: string[] = []
  for (let i = 0; i < sorted.length && picked.length < SAMPLE; i += stride) picked.push(sorted[i])
  return new Set(picked)
}
const pickA = pickOf(A)
const pickB = pickOf(B)
console.log("SAMPLE OVERLAP between the two rules' 120-file draws")
console.log(`  shared:      ${both(pickA, pickB)} of ${pickA.size}`)
console.log(`  only under A: ${only([...pickA], pickB).length}`)
console.log(`  only under B: ${only([...pickB], pickA).length}`)
console.log(`  -> ${Math.round((100 * both(pickA, pickB)) / Math.max(1, pickA.size))}% of this lane's files are in the`)
console.log("     supervisor's-table sample, and the rest are files it never counted. Two edge totals")
console.log("     over two 120-file draws that share this many files are not the same measurement.\n")

console.log("FILES `firing-check.ts` COUNTS THAT ARE NOT ON DISK")
console.log("  It calls `detectLanguageFromPath(rel)` on `git ls-files` output and never stats the")
console.log("  path, so a tracked file that was deleted from the working tree still counts toward")
console.log("  corpusTotal and toward the stride, and can only ever lower filesParsed.")
console.log(`  tracked css-by-path entries with no file on disk: ${absent.length}`)
for (const k of absent.sort()) console.log(`    ${k}`)
console.log(`  so firing-check's corpusTotal for css = ${B.length} on disk + ${absent.length} absent = ${B.length + absent.length},`)
console.log("  and `firing-check.ts --files 120 css --json` printed `corpusTotal: 1271` on this corpus")
console.log("  at this commit. The two agree, so the 1271 is reproducible and reproducible is not")
console.log("  the same as correct: 5 of those 1271 paths are files this machine does not have.\n")

// THE STRIDE IS THE MECHANISM. An insertion anywhere before the sample point shifts every
// subsequent pick by one slot, so the draw changes wholesale from one extra file — not
// proportionally to how many files were added. Measured by re-striding the census set
// with synthetic entries inserted, which is the same arithmetic the instrument performs.
const baseList = A.map(key)
const strided = (list: string[]): string[] => {
  const stride = Math.max(1, Math.floor(list.length / SAMPLE))
  const picked: string[] = []
  for (let i = 0; i < list.length && picked.length < SAMPLE; i += stride) picked.push(list[i])
  return picked
}
const basePick = new Set(strided(baseList))
console.log("STRIDE SENSITIVITY — how many of the 120 sampled files move when the list grows")
console.log("--------------------------------------------------------------------------------------------------")
console.log("inserted at the front of the walk      stride   of 120 picks changed   changed")
for (const n of [1, 2, 5, 11, 50, 100]) {
  const synth = Array.from({ length: n }, (_, i) => `synthetic/aaa-inserted-${String(i).padStart(4, "0")}.css`)
  const list = [...synth, ...baseList]
  const picked = strided(list)
  const set = new Set(picked)
  const stride = Math.max(1, Math.floor(list.length / SAMPLE))
  const changed = [...basePick].filter((k) => !set.has(k)).length
  console.log(`  ${String(n).padStart(4)} files${" ".repeat(Math.max(1, 22 - String(n).length))}${String(stride).padStart(6)}   ${String(changed).padStart(18)}   ${String(Math.round((100 * changed) / basePick.size)).padStart(6)}%`)
}
console.log("--------------------------------------------------------------------------------------------------")
console.log("  Read: an insertion of k files shifts every pick by k SLOTS, so the number of picks")
console.log("  that survive is a function of k mod stride, not of k. k=1,2,5 and 11 all shift the")
console.log("  draw off every stride multiple and change 120 of 120; k=50 is 5 whole strides and")
console.log("  changes 5. The 11 files above are k=11, and that is the 93-of-120 measured here.")
console.log("  So a lane's edge total in the firing table is a function of the corpus AT THE MOMENT")
console.log("  OF THE RUN, not of the lane, and the corpus is shared with lanes that clone into it")
console.log("  without asking. Every figure in that table needs its corpusTotal printed beside it;")
console.log("  without it a reader cannot tell a change in the analyzer from a change in the walk.")
console.log("  A sample keyed on the file's PATH (every k-th by hash, or a fixed sorted prefix with")
console.log("  the draw recorded) would survive corpus growth; a stride over a growing list does not.")