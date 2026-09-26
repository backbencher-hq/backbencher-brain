// script/m12/verify-differential-freshness.ts — #893 acceptance item 3.
//
//   "a gate exists that fails when an M12 differential artifact's inputs have
//    moved, so a `1.000` cannot outlive the code it describes"
//
// The failure this closes, measured: `groovy-differential.json` recorded
// `precision 1.000 / FP 0` from bafcce7a onward, unchanged, while the analyzer
// changed 12 times underneath it — and `62239b9d`, whose subject is "commit
// regenerated milestone evidence at HEAD", committed that byte-identical
// content against a tree that measures 0.861. Nothing in the tree compared any
// of the 42 `*-differential.json` artifacts to the code they described, which
// is why it survived five commits.
//
// This gate is that comparison. Every artifact produced after
// `script/m12/differential-provenance.ts` landed carries an `inputs` block; this
// recomputes those inputs from the tree and fails when they moved.
//
// Statuses, and what each one means:
//
//   FRESH      inputs recorded and unchanged.
//   STALE      inputs recorded and moved — the artifact no longer describes
//              this tree. This is the failure the gate exists for, and it names
//              the path that moved, because "stale" without a file is a
//              riddle, not a finding.
//   UNPINNED   no `inputs` block: the artifact cannot be checked at all, which
//              is the state #893 was found in. Reported with a count and a
//              list, never silently passed. `--allow-unpinned` downgrades it to
//              a printed disclosure so the gate can be adopted family by
//              family while the remaining artifacts are re-emitted — the
//              disclosure is a list, not a number, so "38 unpinned" cannot be
//              read as "covered".
//
// Usage:
//   bun script/m12/verify-differential-freshness.ts
//   bun script/m12/verify-differential-freshness.ts --allow-unpinned
// SIBLING DRIFT is reported and is NOT fatal. The import closure reaches all 41
// analyzers through `engine.ts`, so before the lane-disjoint partition a single
// in-flight sibling analyzer held every pinned artifact red: measured at
// `c3468eb4`, **18 of 18** pinned artifacts reported STALE and 12 of those were
// stale ONLY over sibling files their own extraction cannot execute. A gate that
// is uniformly red carries no signal, and that is the W7 failure the regex census
// already ruled against ("committed truth is now the only fatal comparison;
// working-tree drift is printed in full and fatal only under --require-clean").
// Sibling movement is still printed, per lane, with the path — disclosed, not
// ignored. `--require-clean` promotes it to fatal for a ceremony that wants the
// whole tree quiescent.
//
// Usage:
//   bun script/m12/verify-differential-freshness.ts
//   bun script/m12/verify-differential-freshness.ts --allow-unpinned
//   bun script/m12/verify-differential-freshness.ts --lang groovy
//   bun script/m12/verify-differential-freshness.ts --require-clean
//   bun script/m12/verify-differential-freshness.ts --selftest
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { computeInputs, diffInputs, type FileFingerprint } from "./differential-provenance"
import { analyzerFileFor as aliasAwareAnalyzerFileFor } from "../m60/family-closure"

const ROOT = process.cwd()
const RESULTS = path.join(ROOT, "validation/m12/results")
const args = process.argv.slice(2)
const allowUnpinned = args.includes("--allow-unpinned")
const requireClean = args.includes("--require-clean")
const only = args.includes("--lang") ? String(args[args.indexOf("--lang") + 1]).split(",") : null

/**
 * The partition is a RULE, and a rule that cannot fail is decoration. Eight
 * assertions, each of which fails on a real regression:
 *
 *   1 a lane's OWN analyzer is a hard input (the partition cannot eat the file
 *     the artifact is actually about);
 *   2 a shared extraction module is a hard input (`engine.ts` is reachable by
 *     every lane and DOES change every lane);
 *   3 a sibling analyzer is NOT a hard input but IS recorded in `siblings`;
 *   4 the sibling set is non-empty (a partition that matches nothing is a no-op);
 *   5 no sibling leaked into the hard set;
 *   6 mutating a sibling's recorded fingerprint produces `siblingDrift` with
 *     `changed` EMPTY — the disclosure fires and the fatality does not;
 *   7 mutating the lane's OWN analyzer's recorded fingerprint produces
 *     `changed` — the gate can still go red for the reason it exists;
 *   8 a recorded file that no longer exists AND is not a sibling still reads as
 *     removed (the branch the partition could have broken).
 */
function selftest(): never {
  const checks: { name: string; ok: boolean; detail: string }[] = []
  const push = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })

  const inputs = computeInputs(ROOT, "css")
  // `aliasAwareAnalyzerFileFor` is already repo-relative ("src/ast/real-…").
  // Prefixing it again is the mistake this file's own header warns about, and
  // the first run of this selftest made exactly that mistake — which is why a
  // selftest that can fail is worth more than a comment saying so.
  const own = aliasAwareAnalyzerFileFor("css")
  push("own analyzer is a hard input", own in inputs.files, `${own} in hard set: ${own in inputs.files}`)
  push("shared extraction module is a hard input", "src/ast/engine.ts" in inputs.files, `engine.ts in hard set: ${"src/ast/engine.ts" in inputs.files}`)

  const sibs = Object.keys(inputs.siblings ?? {})
  const foreign = sibs.find((p) => p !== own) ?? ""
  push("a sibling is not a hard input", foreign !== "" && !(foreign in inputs.files), `${foreign || "<none found>"}: hard=${foreign !== "" && foreign in inputs.files} sibling=${foreign !== ""}`)
  push("sibling set is non-empty", sibs.length > 0, `${sibs.length} siblings recorded`)
  push("no sibling leaked into the hard set", !sibs.some((p) => p in inputs.files), `overlap: ${sibs.filter((p) => p in inputs.files).join(",") || "none"}`)

  if (foreign) {
    const recorded: Record<string, FileFingerprint> = { ...inputs.files, [foreign]: { sha256: "0".repeat(64), bytes: 1 } }
    const d = diffInputs(ROOT, recorded, "css")
    push("sibling mutation discloses without going fatal", d.siblingDrift.includes(foreign) && d.changed.length === 0, `siblingDrift=${d.siblingDrift.includes(foreign)} changed=${JSON.stringify(d.changed)}`)
  }
  {
    const recorded: Record<string, FileFingerprint> = { ...inputs.files, [own]: { sha256: "0".repeat(64), bytes: 1 } }
    const d = diffInputs(ROOT, recorded, "css")
    push("own-analyzer mutation still goes fatal", d.changed.includes(own), `changed=${JSON.stringify(d.changed)}`)
  }
  {
    const recorded: Record<string, FileFingerprint> = { ...inputs.files, "src/ast/__deleted__.ts": { sha256: "0".repeat(64), bytes: 1 } }
    const d = diffInputs(ROOT, recorded, "css")
    push("a genuinely removed input still reads as removed", d.removed.includes("src/ast/__deleted__.ts"), `removed=${JSON.stringify(d.removed)}`)
  }

  const failed = checks.filter((c) => !c.ok)
  for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}  (${c.detail})`)
  console.log(failed.length === 0 ? `\nSELFTEST PASS (${checks.length} assertions)` : `\nSELFTEST FAIL (${failed.length}/${checks.length})`)
  process.exit(failed.length === 0 ? 0 : 1)
}

if (args.includes("--selftest")) selftest()

type Artifact = {
  lang: string
  file: string
  inputs?: { files?: Record<string, FileFingerprint>; parser?: { path: string; sha256: string } | null }
  metrics?: Record<string, unknown>
}

const artifacts: Artifact[] = []
for (const f of readdirSync(RESULTS).sort()) {
  if (!f.endsWith("-differential.json")) continue
  const lang = f.slice(0, -"-differential.json".length)
  if (only && !only.includes(lang)) continue
  const doc = JSON.parse(readFileSync(path.join(RESULTS, f), "utf8")) as Artifact
  artifacts.push({ ...doc, lang, file: f })
}

if (artifacts.length === 0) {
  console.error(only ? `no differential artifact for: ${only.join(",")}` : "no differential artifacts found")
  process.exit(1)
}

const stale: { lang: string; changed: string[]; added: string[]; removed: string[] }[] = []
const unpinned: string[] = []
const parserDrift: string[] = []
const siblingDrift: { lang: string; files: string[] }[] = []
let fresh = 0

for (const a of artifacts) {
  const recorded = a.inputs?.files
  if (!recorded || Object.keys(recorded).length === 0) {
    unpinned.push(a.lang)
    continue
  }
  const diff = diffInputs(ROOT, recorded, a.lang)
  if (diff.siblingDrift.length) siblingDrift.push({ lang: a.lang, files: diff.siblingDrift })
  if (diff.changed.length || diff.added.length || diff.removed.length) {
    stale.push({ lang: a.lang, ...diff })
    continue
  }
  fresh++
  const rec = a.inputs?.parser
  const now = diff.current.parser
  if (rec && now && rec.sha256 !== now.sha256) parserDrift.push(a.lang)
}

console.log(`=== M12 differential freshness (${artifacts.length} artifact(s) checked) ===`)
console.log(`FRESH     ${fresh}`)
console.log(`STALE     ${stale.length}`)
console.log(`UNPINNED  ${unpinned.length}${allowUnpinned ? "  (allowed by --allow-unpinned, disclosed below)" : ""}`)
if (siblingDrift.length) {
  console.log(`SIBLING   ${siblingDrift.length} lane(s) saw a lane-disjoint sibling move (disclosed, not fatal${requireClean ? " EXCEPT under --require-clean" : ""})`)
}

for (const s of stale) {
  let m = "n/a"
  try {
    const doc = JSON.parse(readFileSync(path.join(RESULTS, `${s.lang}-differential.json`), "utf8"))
    m = `precision=${doc?.passing?.metrics?.precision}`
  } catch {}
  console.log(`\n  STALE ${s.lang} — recorded ${m}`)
  for (const p of s.changed) console.log(`    changed  ${p}`)
  for (const p of s.added) console.log(`    added    ${p}`)
  for (const p of s.removed) console.log(`    removed  ${p}`)
  console.log(`    re-emit: bun script/m12/verify-analyzer.ts ${s.lang}`)
}

if (unpinned.length) {
  console.log(`\n  UNPINNED (no inputs block — cannot be checked, NOT covered):`)
  for (const l of unpinned) console.log(`    ${l}`)
  console.log(`    re-emit each with: bun script/m12/verify-analyzer.ts <lang>`)
}

if (siblingDrift.length) {
  // Real, visible, and not fatal for a lane that cannot execute the file. The
  // path is printed because a disclosure without a path is a rumour.
  console.log(`\n  SIBLING DRIFT (a per-language analyzer of ANOTHER language moved; disclosed per lane):`)
  for (const s of siblingDrift) {
    console.log(`    ${s.lang}:`)
    for (const p of s.files) console.log(`      ${p}`)
  }
  if (requireClean) {
    console.log(`\nFAIL: --require-clean promotes sibling drift to fatal (${siblingDrift.length} lane(s))`)
    process.exitCode = 1
  }
}

if (parserDrift.length) {
  // Informational by construction: the wasm is not byte-reproducible, so a
  // rebuild of unchanged grammar source changes this hash without changing
  // behaviour. Printed so the reader knows which parser the numbers came from.
  console.log(`\n  parser artifact differs from the recorded one (informational, not a failure):`)
  for (const l of parserDrift) console.log(`    ${l}`)
}

const failed = stale.length > 0 || (unpinned.length > 0 && !allowUnpinned)
if (failed) {
  if (process.exitCode !== 1) console.log(`\nFAIL: ${stale.length} stale, ${unpinned.length} unpinned`)
  process.exitCode = 1
} else if (process.exitCode !== 1) {
  console.log(`\nPASS: every pinned artifact describes this tree${unpinned.length ? ` (${unpinned.length} unpinned and disclosed)` : ""}${siblingDrift.length ? ` (${siblingDrift.length} lane(s) with disclosed sibling drift)` : ""}`)
}
