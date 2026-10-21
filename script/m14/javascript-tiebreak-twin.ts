/**
 * JAVASCRIPT — THE OWN-FILE TIE-BREAK's PER-ROW MOVEMENT, measured by an INSTRUMENTED TWIN of the
 * shipping gate, and the C4 CHECK that the tie-break does not merge a claim into a resolution.
 *
 * ── WHY A TWIN, AND WHY IT IS NOT A RE-IMPLEMENTATION ───────────────────────────────────────────────
 * The tie-break (e1e2f7a19, `script/m14/incoming-rule.ts:2223`) is ONE branch inside the arbiter's
 * `classifyEdge`:
 *
 *     if (ownFileDeclares === true && isPlainIdentifier(tgt)) {
 *       return { outcome: "resolved", decls, kinds: kindText }
 *     }
 *
 * It fires ONLY in the `decls > 1` branch, and `ownFileDeclares` is the arbiter's ONLY input that
 * distinguishes it from the pre-tie-break behaviour. **SO THE MOVEMENT IS MEASURABLE EXACTLY, WITH
 * THE ARBITER'S OWN FUNCTION, BY CLASSIFYING EVERY ROW TWICE OVER THE SAME KEY SPACE:**
 *
 *     `pc`      — the shipping call, with the gate's computed `ownFileDeclares`  (the tie-break ON)
 *     `pcNoTie` — the SAME call with `ownFileDeclares` = `undefined`              (the tie-break OFF)
 *
 * Every other input is IDENTICAL: the same project key space, the same kind set, the same claim, the
 * same project facts, the same owner-channel verdict, the same qualified-name join, the same file.
 * **⇒ A ROW WHOSE OUTCOME DIFFERS BETWEEN THE TWO IS EXACTLY A ROW THE TIE-BREAK MOVED ✓✓ — PER ROW.**
 *
 * (The second use of `ownFileDeclares`, at `incoming-rule.ts:1787`, is the GENERIC EXTERNAL MARKER's
 * disposition on an ambiguous row. It is measured too, and it is the C4 check below.)
 *
 * ── THE C4 CHECK, WHICH IS THE PART THAT CAN ACTUALLY GO WRONG ──────────────────────────────────────
 * The charter: "External claims appear in their own columns and are NEVER merged into `resolved`."
 * The proposal that landed the tie-break argued that no claim can be merged into `resolved` by it,
 * because the arbiter's ORDER returns a row carrying an EXTERNAL claim (`:2062`) and a row carrying a
 * BINDING claim (`:1989`) BEFORE THE COUNT.
 *
 * **THAT ARGUMENT IS ABOUT THE `decls === 0` AND `decls === 1` BRANCHES. THE TIE-BREAK IS IN THE
 * `decls > 1` BRANCH, WHERE THE GENERIC EXTERNAL MARKER IS NOT DISPOSED BEFORE IT — the marker is
 * read AFTER the tie-break, inside `claimDispositionOnAmbiguous` (`incoming-rule.ts:2248`).** So a row
 * that is (a) ambiguous by declaration, (b) own-file-declared with a plain-identifier target, and
 * (c) carrying a GENERIC EXTERNAL MARKER, is RESOLVED by the tie-break and ITS CLAIM IS NEVER COUNTED
 * IN ANY CLAIM COLUMN.
 *
 * **This instrument COUNTS THOSE ROWS. It does not assert they exist.** If the count is 0 the cell's
 * `resolved` column carries no merged claim; if it is > 0, the cell's `resolved` column includes rows
 * whose claim was absorbed, and the cell must say so.
 *
 * ── THE FAITHFULNESS PROOF, WHICH IS NOT OPTIONAL ───────────────────────────────────────────────────
 * A twin is a different program, so its numbers are only the shipping gate's numbers if it produces
 * the SHIPPING GATE'S TABLE 1. The twin prints its own TABLE 1, and the caller compares it with the
 * shipping gate's TABLE 1 from the SAME population. If they agree, the twin's counter is a
 * measurement OF THE SHIPPING GATE. The comparison is recorded in the lane's page and is the twin's
 * falsifier: a disagreement voids the counter.
 *
 * ── WHAT IS WRITTEN ─────────────────────────────────────────────────────────────────────────────────
 * `validation/m14/fixtures/javascript/tiebreak-twin.patch` — the EXACT diff applied to the shipping
 * `script/m14/incoming-gate.ts` (the ARBITER IS COPIED BYTE-IDENTICALLY; only the gate is
 * instrumented), so the measurement is reproducible from a committed file.
 *
 *   bun run script/m14/javascript-tiebreak-twin.ts            # build the twin + write the patch
 *   bun run script/m14/javascript-tiebreak-twin.ts --run      # build + run the twin over the corpus
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const TWIN = path.join(ROOT, ".tmp-js-tiebreak")
const PATCH_OUT = path.join(ROOT, "validation/m14/fixtures/javascript/tiebreak-twin.patch")

// THE FILES THE TWIN NEEDS. The gate imports three siblings and three of the project's own modules.
const GATE = "script/m14/incoming-gate.ts"
const SIBLINGS = ["script/m14/incoming-rule.ts", "script/m14/empty-result-kind.ts", "script/m14/owner-channel.ts"]

// ── THE PATCH, AS AN EXACT STRING REPLACEMENT, SO THE .patch FILE IS A FUNCTION OF THE SOURCE ───────
// 1. THE COUNTERS. They are declared BEFORE the per-file loop, because the per-type FILE count is
//    filled there and the per-ROW count is filled in the per-edge loop further down.
const ANCHOR_COUNTERS = `  const pending: PendingEdge[] = []`
const INSERT_COUNTERS = `  // ── THE TWIN's INSTRUMENTATION (script/m14/javascript-tiebreak-twin.ts) ─────────────────────
  // The OWN-FILE TIE-BREAK's PER-ROW MOVEMENT, and the C4 check that it merges no claim.
  let tiebreakMoved = 0
  let tiebreakMovedCarryingClaim = 0
  const tiebreakByLabel = new Map<string, number>()
  const tiebreakPairs = new Map<string, number>()
  const tiebreakClaimKinds = new Map<string, number>()
  const tiebreakClaimDispositions = new Map<string, number>()
  // THE PER-TYPE FILE COUNT — the files in which a type fired at all.
  const twinTypeFiles = new Map<string, Set<string>>()
  const pending: PendingEdge[] = []`

// 2. THE SECOND CLASSIFICATION, PER ROW.
const ANCHOR_PC = `    const pc = classifyEdge(
      projectDecl.get(e.repo)!, projectKinds.get(e.repo)!, e.tgt, e.claim, facts, isContains, ownFileDeclares,
      ownerVerdict === undefined ? undefined : { outcome: ownerVerdict.outcome }, e.srcFile,
      qj, edgeRelFile(e.repo, e.srcFile),
    )`
const INSERT_PC = `    const pc = classifyEdge(
      projectDecl.get(e.repo)!, projectKinds.get(e.repo)!, e.tgt, e.claim, facts, isContains, ownFileDeclares,
      ownerVerdict === undefined ? undefined : { outcome: ownerVerdict.outcome }, e.srcFile,
      qj, edgeRelFile(e.repo, e.srcFile),
    )
    // ── THE TWIN's INSTRUMENTATION: THE SAME ROW, THE SAME KEY SPACE, THE TIE-BREAK OFF ────────────
    // The ONLY difference is \`ownFileDeclares\`, which is the arbiter's single input to the
    // tie-break (incoming-rule.ts:2223) — so a DIFFERENT OUTCOME is a MOVED ROW, per row.
    const pcNoTie = classifyEdge(
      projectDecl.get(e.repo)!, projectKinds.get(e.repo)!, e.tgt, e.claim, facts, isContains, undefined,
      ownerVerdict === undefined ? undefined : { outcome: ownerVerdict.outcome }, e.srcFile,
      qj, edgeRelFile(e.repo, e.srcFile),
    )
    if (pc.outcome !== pcNoTie.outcome) {
      tiebreakMoved++
      tiebreakByLabel.set(e.label, (tiebreakByLabel.get(e.label) ?? 0) + 1)
      const pair = \`\${pcNoTie.outcome}->\${pc.outcome}\`
      tiebreakPairs.set(pair, (tiebreakPairs.get(pair) ?? 0) + 1)
      // THE C4 CHECK: a row that carried a CLAIM and became \`resolved\` has had its claim ABSORBED.
      if (e.claim !== null) {
        tiebreakMovedCarryingClaim++
        const ck = e.claim.kind
        tiebreakClaimKinds.set(ck, (tiebreakClaimKinds.get(ck) ?? 0) + 1)
        const disp = pcNoTie.claimOnAmbiguous?.disposition ?? "(none)"
        tiebreakClaimDispositions.set(disp, (tiebreakClaimDispositions.get(disp) ?? 0) + 1)
      }
    }`

// 3. THE PER-TYPE FILE COUNT — the `_implemented_measured` block's `files` half, measured on the
//    SAME population as the cell, by the SAME instrument. (The `edges` half is TABLE 1's own column;
//    only the FILES half is not printed by the shipping gate, and the spec block needs both.)
const ANCHOR_PUSH = `      pending.push({ label, tgt, claim, owner, sig, repo: repoOf(f), srcFile: f, line: edgeLine, bindReason: edgeBindReason, reasonCode: edgeReasonCode })`
const INSERT_PUSH = `      if (!twinTypeFiles.has(label)) twinTypeFiles.set(label, new Set<string>())
      twinTypeFiles.get(label)!.add(f)
      pending.push({ label, tgt, claim, owner, sig, repo: repoOf(f), srcFile: f, line: edgeLine, bindReason: edgeBindReason, reasonCode: edgeReasonCode })`

// 4. THE DISCLOSURE, on stderr beside the owner channel's own.
const ANCHOR_PRINT = `  if (ownerRows > 0) {
    const reasons = [...ownerReasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => \`\${k} \${v}\`).join(" · ")`
const INSERT_PRINT = `  // ── THE TWIN's DISCLOSURE — the tie-break's per-row movement, and the C4 check ──────────────
  process.stderr.write(
    \`  TIE-BREAK (own-file, e1e2f7a19) PER-ROW MOVEMENT: \${tiebreakMoved} row(s) moved · \` +
    \`of which \${tiebreakMovedCarryingClaim} carried a CLAIM (C4: a claim merged into resolved) · \` +
    \`by label: \${JSON.stringify([...tiebreakByLabel.entries()].sort((a, b) => b[1] - a[1]))} · \` +
    \`outcome pairs: \${JSON.stringify([...tiebreakPairs.entries()].sort((a, b) => b[1] - a[1]))} · \` +
    \`claim kinds: \${JSON.stringify([...tiebreakClaimKinds.entries()].sort((a, b) => b[1] - a[1]))} · \` +
    \`pre-tie-break claim dispositions: \${JSON.stringify([...tiebreakClaimDispositions.entries()].sort((a, b) => b[1] - a[1]))}\\n\`,
  )
  process.stderr.write(
    \`  PER-TYPE FILES (the _implemented_measured files half, same population, same instrument): \` +
    \`\${JSON.stringify([...twinTypeFiles.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => [k, v.size]))}\\n\`,
  )
  if (ownerRows > 0) {
    const reasons = [...ownerReasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => \`\${k} \${v}\`).join(" · ")`

// ── BUILD ─────────────────────────────────────────────────────────────────────────────────────────────
async function build(): Promise<{ patch: string }> {
  if (existsSync(TWIN)) rmSync(TWIN, { recursive: true, force: true })
  mkdirSync(TWIN, { recursive: true })
  const origGate = readFileSync(path.join(ROOT, GATE), "utf8")
  let twinGate = origGate
  for (const [anchor, insert] of [
    [ANCHOR_COUNTERS, INSERT_COUNTERS],
    [ANCHOR_PC, INSERT_PC],
    [ANCHOR_PUSH, INSERT_PUSH],
    [ANCHOR_PRINT, INSERT_PRINT],
  ] as const) {
    const n = twinGate.split(anchor).length - 1
    if (n !== 1) {
      console.error(`TWIN BUILD FAILED: the anchor occurs ${n} time(s), expected exactly 1.\n--- anchor ---\n${anchor.slice(0, 200)}`)
      process.exit(3)
    }
    twinGate = twinGate.replace(anchor, insert)
  }
  // THE PATHS: the twin sits at the repository root's `.tmp-js-tiebreak/`, so `../../src/` becomes `../src/`.
  twinGate = twinGate.replaceAll('"../../src/ast/', '"../src/ast/')
  writeFileSync(path.join(TWIN, "incoming-gate.ts"), twinGate)
  for (const rel of SIBLINGS) {
    const src = readFileSync(path.join(ROOT, rel), "utf8")
    // The siblings import `../../src/ast/...` too.
    writeFileSync(path.join(TWIN, path.basename(rel)), src.replaceAll('"../../src/ast/', '"../src/ast/'))
  }
  // THE PATCH FILE — a unified diff of the gate, produced by `diff -u` so it applies with `patch -p1`.
  const { execFileSync } = await import("node:child_process")
  const before = path.join(TWIN, "incoming-gate.orig.ts")
  writeFileSync(before, origGate)
  let patch = ""
  try {
    patch = execFileSync("diff", ["-u", "--label", "a/script/m14/incoming-gate.ts", "--label", "b/script/m14/incoming-gate.ts", before, path.join(TWIN, "incoming-gate.ts")], { encoding: "utf8" })
  } catch (e: any) {
    patch = String(e.stdout ?? "")
  }
  mkdirSync(path.dirname(PATCH_OUT), { recursive: true })
  writeFileSync(PATCH_OUT, patch)
  console.log(`twin built at ${TWIN}`)
  console.log(`patch written to ${PATCH_OUT} (${patch.split("\n").length} lines)`)
  return { patch }
}

await build()

if (process.argv.includes("--run")) {
  const { spawnSync } = await import("node:child_process")
  const args = process.argv.slice(2).filter((a) => a !== "--run")
  const corpus = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
  console.log(`running the twin over ${corpus} …`)
  const r = spawnSync("bun", ["run", path.join(TWIN, "incoming-gate.ts"), "javascript", "js,mjs,cjs,jsx", "0", ...args], {
    cwd: ROOT,
    env: { ...process.env, BB_CORPUS_ROOT: corpus },
    stdio: "inherit",
  })
  process.exit(r.status ?? 1)
}
