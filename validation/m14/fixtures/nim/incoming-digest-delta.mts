/**
 * INCOMING A/B — the fleet-wide ambiguity row for this lane, at two analyzer digests.
 *
 * ## The question this exists to settle
 *
 * `validation/m14/measurements/incoming-whole.tsv` is the table the whole programme is
 * read against ("ZERO of 23 lanes have fully-resolving incoming"). Its `nim` row reads
 *
 *     lane   files  fired  amb     unres
 *     nim      600      8  12491   9424
 *
 * and `git log` puts that artifact at `a7a5debfc`, whose copy of
 * `src/ast/real-nim-analyzer.ts` is sha256 `9d9ee478e3295c28`. The committed blob is
 * `96ef87bb47f63eca`. Three analyzer generations separate the number in the fleet table
 * from the analyzer the fleet is being asked about:
 *
 *     9d9ee478  647a08e3   the tsv
 *     1475e53d  1f443af1   bare-`case` discriminator guard
 *     2426fdda  7a7ab080   module symbol + imports target normalisation
 *     deeab075  7b9189f2   66 externals marked
 *     96ef87bb  ba0bf7b6   THE COMMITTED BLOB
 *
 * Between the tsv's digest and the committed one this lane removed every regex, added a
 * module symbol, rewrote the `imports` target spelling, marked externals, and published
 * `qualifiedName` on methods. The tsv's `fired 8` is already wrong on its face — the
 * committed analyzer fires all ten on the same window (see `s30-ambiguity-classify.txt`,
 * which reports all ten with non-zero edge counts at this blob). So the row is not
 * merely stale, it is stale in a way that makes the lane look worse than it is, and the
 * difference has never been stated.
 *
 * Two numbers are NOT interchangeable and this file keeps them apart:
 *
 *   `ambiguousTargets`  PER-TARGET. A target NAME published under more than one KIND.
 *                       `script/m14/incoming-check.ts:107,134-146`.
 *   this lane's `ambiguousEdges`  PER-EDGE. A target name published more than once at
 *                       all. `ambiguity-classify.ts`, and the number the round brief's
 *                       three-way split partitions.
 *
 * The tsv's `amb` column is the sum of `ambiguousTargets`. This file reproduces that
 * sum on BOTH sides so the before/after is a statement about the analyzer and not about
 * a change of instrument, and it prints the per-edge figure beside it rather than
 * letting the two be compared.
 *
 * ## Why it shells out instead of importing
 *
 * `script/m14/incoming-check.ts` is shared machinery (§8) and is a CLI with no exports.
 * The digest has to change underneath it between the two passes, because `parseFile`
 * dispatches through the engine's analyzer registry, which is bound at import time —
 * both versions cannot be live in one process. So this is the same before → walk →
 * after → walk shape as `imports-edge-delta.mts`, and for the same reason: the ANALYZER
 * FILE is swapped between two complete passes, each swap digest-verified against the
 * source it was asked to write, with a `finally` that restores the tree and re-verifies.
 *
 * ## What it does NOT claim
 *
 * It does not claim the tsv was WRONG. It was a true reading of `9d9ee478`. It claims
 * the tsv's row is not a reading of the analyzer it is filed beside, which is a
 * different and smaller statement than being wrong, and is the one a reader of the
 * fleet table needs.
 *
 * READ-ONLY with respect to committed state and to the corpus: the analyzer file is
 * restored in `finally`, and the corpus is only read.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const HERE = (import.meta as any).dirname ?? "."
const REPO = path.resolve(HERE, "../../../..")
const ANALYZER_REL = "src/ast/real-nim-analyzer.ts"
const ANALYZER = path.join(REPO, ANALYZER_REL)
const SHARED = path.join(REPO, "script/m14/incoming-check.ts")
/**
 * TWO WINDOWS EXIST for "600 nim files" and they are not the same population. Getting
 * this wrong is what produced a wrong finding once, so the choice is a required argument
 * rather than a default nobody sees.
 *
 *   fleet   `find <corpus> -name '*.nim' | sort | head -600`. This is what
 *           `script/m14/diagnose-incoming.sh:35` walks and therefore what
 *           `validation/m14/measurements/incoming-whole.tsv` was built from. Set
 *           BB_NIM_WINDOW=fleet.
 *   lane    `validation/m14/measurements/nim/session13-file-list.txt`, the pinned list
 *           every artifact under `measurements/nim/` uses.
 *
 * MEASURED overlap: 62 of 600 files are common to the two, so they share 10.3% of their
 * files. Every edge count, symbol count and ambiguous/unresolved total differs between
 * them, and a comparison across windows is a comparison of two populations.
 */
const WINDOW = process.env.BB_NIM_WINDOW ?? "fleet"
const LIST_REL = WINDOW === "lane"
  ? "validation/m14/measurements/nim/session13-file-list.txt"
  : "validation/m14/measurements/nim/s30-fleet-window-file-list.txt"
const LIST = path.join(REPO, LIST_REL)

const OUT_JSON = process.argv[2]
const OUT_TXT = process.argv[3]

/** The BEFORE side is a git REF, never the working tree, so a comparison cannot be
 *  defeated by a tree that has already moved. `BB_NIM_EXPECT` is asserted on every run
 *  and reported whether or not it matches, because a reader who cannot see which two
 *  blobs were compared cannot use either number. */
const BEFORE_REF = process.env.BB_NIM_BEFORE ?? "647a08e3c8e882451b26d4726a6643a6e0aa2f0d"
/** PREFIX, not a full digest, and compared as a PREFIX. An earlier cut of this file
 *  defaulted it to a 16-char value and compared it with `===` against a 64-char digest,
 *  so it printed MISMATCH on a pair that matched and the reader could not tell the two
 *  cases apart. The default is the same 16 chars the doc has quoted for that blob
 *  throughout, so the line is checkable by eye. */
const EXPECTED_BEFORE = process.env.BB_NIM_EXPECT ?? "9d9ee478e3295c28"

const sha = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex")

const files = readFileSync(LIST, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
const listSha = sha(readFileSync(LIST))

const TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const

const writeSrc = (src: string, expectSha: string, label: string): void => {
  writeFileSync(ANALYZER, src)
  const got = sha(readFileSync(ANALYZER))
  if (got !== expectSha) {
    throw new Error(`${label}: wrote digest ${got.slice(0, 16)} but expected ${expectSha.slice(0, 16)}`)
  }
}

type Pass = {
  sha: string
  files: number
  symbols: number
  degraded: number
  fired: number
  ambiguousTargets: number
  unresolvedTargets: number
  perType: Record<string, { edges: number; targetsDistinct: number; ambiguousTargets: number; unresolvedTargets: number }>
  childExit: number
  stderrBytes: number
}

const runChild = (label: string): Pass => {
  const digest = sha(readFileSync(ANALYZER))
  const args = ["tsx", "script/m14/incoming-check.ts", "--json", "nim", ...files]
  let stdout = ""
  let stderr = ""
  let code = 0
  try {
    stdout = execFileSync("npx", args, {
      cwd: REPO, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (e: any) {
    stdout = String(e?.stdout ?? "")
    stderr = String(e?.stderr ?? "")
    code = typeof e?.status === "number" ? e.status : -1
    if (!stdout.trim()) throw new Error(`${label}: child produced no stdout, exit ${code}\n${stderr.slice(0, 800)}`)
  }
  const d = JSON.parse(stdout)
  const perType: Pass["perType"] = {}
  for (const t of TYPES) {
    const v = d.perType?.[t]
    perType[t] = {
      edges: Number(v?.edges ?? 0),
      targetsDistinct: Number(v?.targetsDistinct ?? 0),
      ambiguousTargets: Number(v?.ambiguousTargets ?? 0),
      unresolvedTargets: Number(v?.unresolvedTargets ?? 0),
    }
  }
  const pass: Pass = {
    sha: digest,
    files: Number(d.files ?? 0),
    symbols: Number(d.symbols ?? 0),
    degraded: Number(d.degraded ?? 0),
    fired: TYPES.filter((t) => d.perType?.[t]?.fired).length,
    ambiguousTargets: TYPES.reduce((a, t) => a + perType[t].ambiguousTargets, 0),
    unresolvedTargets: TYPES.reduce((a, t) => a + perType[t].unresolvedTargets, 0),
    perType, childExit: code, stderrBytes: stderr.length,
  }
  if (sha(readFileSync(ANALYZER)) !== digest) {
    throw new Error(`${label}: analyzer file changed DURING the child walk`)
  }
  return pass
}

const original = readFileSync(ANALYZER, "utf8")
const originalSha = sha(original)
let beforeSrc: string
try {
  beforeSrc = execFileSync("git", ["show", `${BEFORE_REF}:${ANALYZER_REL}`], { cwd: REPO, encoding: "utf8" })
} catch (e: any) {
  console.error(`cannot read ${BEFORE_REF}:${ANALYZER_REL} — ${e?.message ?? e}`)
  process.exit(2)
}
const beforeSha = sha(beforeSrc)
const beforeMatchesExpectation = beforeSha.startsWith(EXPECTED_BEFORE)

const lines: string[] = []
const say = (s = ""): void => { lines.push(s); console.log(s) }

let before: Pass | undefined
let after: Pass | undefined
try {
  writeSrc(beforeSrc, beforeSha, "BEFORE")
  before = runChild("BEFORE")
  writeSrc(original, originalSha, "AFTER")
  after = runChild("AFTER")
} finally {
  writeFileSync(ANALYZER, original)
  const restored = sha(readFileSync(ANALYZER))
  if (restored !== originalSha) throw new Error(`RESTORE FAILED: ${restored.slice(0, 16)} != ${originalSha.slice(0, 16)}`)
}

if (!before || !after) { console.error("a pass did not complete; nothing written"); process.exit(1) }

const delta = (n: number, m: number): string => {
  const d = m - n
  const pct = n === 0 ? (m === 0 ? "0.0%" : "n/a (0 -> nonzero)") : `${d >= 0 ? "+" : ""}${((d / n) * 100).toFixed(1)}%`
  return `${d >= 0 ? "+" : ""}${d}  ${pct}`
}

say(`nim incoming A/B — window "${WINDOW}", same ${files.length} files, list ${LIST_REL} sha256 ${listSha.slice(0, 16)}`)
say(`  BEFORE  git ref ${BEFORE_REF.slice(0, 12)}  analyzer ${before.sha.slice(0, 16)}  (BB_NIM_EXPECT ${EXPECTED_BEFORE} as a PREFIX — ${beforeMatchesExpectation ? "MATCH" : "MISMATCH, the compared pair is NOT the one named"})`)
say(`  AFTER   HEAD blob  analyzer ${after.sha.slice(0, 16)}`)
say(`  instrument script/m14/incoming-check.ts ${sha(readFileSync(SHARED)).slice(0, 16)} (shared, byte-identical to the tsv commit a7a5debfc)`)
say(`  child exit ${before.childExit}/${after.childExit}  stderr bytes ${before.stderrBytes}/${after.stderrBytes}  analyzer re-verified unchanged on both sides`)
say()
say(`             ${"BEFORE".padEnd(28)}${"AFTER".padEnd(28)}DELTA`)
const row = (label: string, b: number, a: number): void => {
  say(`  ${label.padEnd(12)}${String(b).padEnd(28)}${String(a).padEnd(28)}${delta(b, a)}`)
}
row("files", before.files, after.files)
row("symbols", before.symbols, after.symbols)
row("degraded", before.degraded, after.degraded)
row("fired", before.fired, after.fired)
row("ambiguousTgt", before.ambiguousTargets, after.ambiguousTargets)
row("unresolvedTgt", before.unresolvedTargets, after.unresolvedTargets)
say()
say("PER TYPE — ambiguousTargets (the tsv's definition, PER TARGET NAME published under >1 kind)")
say(`  ${"type".padEnd(14)}${"BEFORE amb".padEnd(12)}${"AFTER amb".padEnd(12)}${"BEFORE edges".padEnd(15)}${"AFTER edges".padEnd(14)}delta(amb)`)
for (const t of TYPES) {
  const b = before.perType[t], a = after.perType[t]
  say(`  ${t.padEnd(14)}${String(b.ambiguousTargets).padEnd(12)}${String(a.ambiguousTargets).padEnd(12)}${String(b.edges).padEnd(15)}${String(a.edges).padEnd(14)}${delta(b.ambiguousTargets, a.ambiguousTargets)}`)
}
say()
say("PER TYPE — unresolvedTargets")
for (const t of TYPES) {
  const b = before.perType[t], a = after.perType[t]
  if (b.unresolvedTargets === 0 && a.unresolvedTargets === 0) continue
  say(`  ${t.padEnd(14)}${String(b.unresolvedTargets).padEnd(12)}${String(a.unresolvedTargets).padEnd(12)}${delta(b.unresolvedTargets, a.unresolvedTargets)}`)
}
say()
say("THE FLEET ROW, restated at the committed blob:")
say(`  incoming-whole.tsv says   nim ${before.files} ${before.fired} ${before.ambiguousTargets} ${before.unresolvedTargets}   (at ${before.sha.slice(0, 16)})`)
say(`  this run says             nim ${after.files} ${after.fired} ${after.ambiguousTargets} ${after.unresolvedTargets}   (at ${after.sha.slice(0, 16)})`)

if (OUT_TXT) writeFileSync(OUT_TXT, lines.join("\n") + "\n")
if (OUT_JSON) {
  writeFileSync(OUT_JSON, JSON.stringify({
    fileList: LIST_REL, fileListSha256: listSha, files: files.length,
    instrument: "script/m14/incoming-check.ts", instrumentSha256: sha(readFileSync(SHARED)),
    beforeRef: BEFORE_REF, expectedBeforeSha256: EXPECTED_BEFORE,
    beforeMatchesExpectation, before, after,
    fleetRow: { lane: "nim", files: before.files, fired: before.fired, amb: before.ambiguousTargets, unres: before.unresolvedTargets },
  }, null, 2) + "\n")
}
