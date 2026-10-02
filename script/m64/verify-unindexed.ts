// script/m64/verify-unindexed.ts — M64.C.
//
// The other direction of the index/disk difference. `freshness.missingFiles` is
// "in the index, gone from disk". Nothing reported "on disk, absent from the
// index" — the direction a developer actually hits when they create files and
// ask whether the index has them.
//
// The cheap implementation is `brain_index_status.total_files - indexed_files`,
// and it is a FALSE CLEAN: those are the last RUN's numbers, so a file created
// after the run is invisible to the subtraction and the answer reads "0
// unindexed". This gate exists to prove the answer is computed, not subtracted.
//
// The second thing it has to prove is that the walk uses the INDEXER's rules.
// A second copy of discovery in the health provider would report gitignored
// files, node_modules and binaries as unindexed — technically true, completely
// useless — and would start diverging the first time a rule was added to the
// indexer.
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Harness } from "../m13/harness"
import { getProjectId } from "../../src/util/project-id"
import { indexProjectParallel, discoverIndexableFiles } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { getUnifiedHealth, formatUnifiedHealth } from "../../src/intelligence/health/health-provider"

const harness = new Harness({
  issue: "M64",
  code: "H64c",
  tool: "bb_health",
  title: "bb_health completeness: files on disk that the index does not contain, computed with the indexer's own rules",
  layers: ["integration"],
  decisions: {
    computed: "the gap is computed by walking, never derived from the last run's total_files - indexed_files, which is a false clean",
    rules: "the walk is the indexer's own discoverIndexableFiles, extracted as an additive mode — not a second copy of discovery",
    optIn: "a stat per eligible file is a real cost, so it is opt-in and its absence is never reported as completeness",
    failure: "a failed walk reports UNKNOWN, never an empty gap",
  },
  limitations: [
    "The >5MB size skip and the shell-shebang gate are properties of the indexer's discovery; this gate proves they are SHARED by asserting a >5MB file is excluded, but does not re-derive the threshold.",
  ],
})

const clean = (root: string, pid: string) => {
  try { rmSync(path.dirname(BrainDatabase.getDbPath(pid as any)), { recursive: true, force: true }) } catch {}
  rmSync(root, { recursive: true, force: true })
}

// ══ 1. the gap is found, and is not derived from stale status numbers ══════
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-h64c-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  for (let i = 0; i < 5; i++) writeFileSync(path.join(root, "src", `f${i}.ts`), `export function fn${i}(): number { return ${i} }\n`)
  const pid = getProjectId(root)
  await indexProjectParallel(pid as any, root, {})
  try {
    // Baseline: nothing new, nothing unindexed.
    const before = await getUnifiedHealth(pid, root, { checkUnindexed: true })
    harness.check("a complete index reports zero unindexed files", before.unindexed?.unindexedCount === 0, `unindexedCount=${before.unindexed?.unindexedCount} (eligible=${before.unindexed?.eligibleOnDisk} indexed=${before.unindexed?.indexed})`)
    harness.check("the clean case still states the population it measured", /indexable file\(s\) on disk are in the index/.test(formatUnifiedHealth(before)), formatUnifiedHealth(before).split("\n").find((l) => l.startsWith("unindexed:"))?.slice(0, 130) ?? "absent")
    harness.check("and says what it excludes, so the number cannot be over-read", /excludes files the indexer skips by rule/.test(formatUnifiedHealth(before)), "")

    // THE case: create files after the index ran. This is invisible to
    // total_files - indexed_files, which is the whole point.
    for (let i = 0; i < 4; i++) writeFileSync(path.join(root, "src", `new${i}.ts`), `export function brandNew${i}(): number { return ${i} }\n`)
    const raw = await BrainDatabase.getRawInstance(pid as any)
    const statusBefore = raw.prepare("SELECT total_files, indexed_files FROM brain_index_status WHERE project_id=?").get(pid) as any
    const after = await getUnifiedHealth(pid, root, { checkUnindexed: true })
    const statusAfter = raw.prepare("SELECT total_files, indexed_files FROM brain_index_status WHERE project_id=?").get(pid) as any

    harness.check("files created after the index ran ARE reported as unindexed", after.unindexed?.unindexedCount === 4, `unindexedCount=${after.unindexed?.unindexedCount}, files=${JSON.stringify(after.unindexed?.unindexedFiles)}`)
    harness.check("and it names them", (after.unindexed?.unindexedFiles ?? []).every((p) => /^src\/new\d\.ts$/.test(p)), JSON.stringify(after.unindexed?.unindexedFiles))
    // The decisive assertion: the status numbers did NOT move, so the cheap
    // implementation would have reported a clean index.
    harness.check("the status row did NOT change, so a subtraction would have said '0 unindexed'", statusBefore?.total_files === statusAfter?.total_files && statusBefore?.indexed_files === statusAfter?.indexed_files, `total_files ${statusBefore?.total_files}->${statusAfter?.total_files}, indexed_files ${statusBefore?.indexed_files}->${statusAfter?.indexed_files} — the false clean this replaces`)
    const cheap = (statusAfter?.total_files ?? 0) - (statusAfter?.indexed_files ?? 0)
    harness.check("the cheap version would have been WRONG by exactly the new files", cheap === 0 && after.unindexed!.unindexedCount === 4, `total-indexed = ${cheap}; the computed answer is ${after.unindexed!.unindexedCount}`)

    harness.check("a warning names them and the fix", after.warnings.some((w) => w.code === "UNINDEXED_FILES" && /refresh=true/.test(w.message)), after.warnings.find((w) => w.code === "UNINDEXED_FILES")?.message?.slice(0, 150) ?? "missing")
    harness.check("the warning is a warning, not an error", after.warnings.find((w) => w.code === "UNINDEXED_FILES")?.severity === "warning", "unindexed files do not make the index unusable")
    harness.check("eligibleOnDisk grew by exactly the new files", after.unindexed!.eligibleOnDisk === before.unindexed!.eligibleOnDisk + 4, `${before.unindexed!.eligibleOnDisk} -> ${after.unindexed!.eligibleOnDisk}`)
    harness.check("indexed count did NOT grow (nothing was indexed)", after.unindexed!.indexed === before.unindexed!.indexed, `${before.unindexed!.indexed} -> ${after.unindexed!.indexed}`)

    // bb_index on the new paths closes the gap, which is what makes the number
    // a measurement rather than a complaint.
    await indexProjectParallel(pid as any, path.join(root, "src", "new0.ts"), { files: [path.join(root, "src", "new0.ts")] } as any)
    const partial = await getUnifiedHealth(pid, root, { checkUnindexed: true })
    harness.check("indexing one of them reduces the gap by exactly one", partial.unindexed!.unindexedCount === 3, `unindexedCount=${partial.unindexed!.unindexedCount} (was 4)`)
    await indexProjectParallel(pid as any, root, {})
    const closed = await getUnifiedHealth(pid, root, { checkUnindexed: true })
    harness.check("a full refresh closes it entirely", closed.unindexed!.unindexedCount === 0, `unindexedCount=${closed.unindexed!.unindexedCount}`)
  } finally { clean(root, pid) }
}

// ══ 2. the walk uses the INDEXER's rules, not a second copy ═══════════════
// This is the property that makes the number usable. A health-side reimplementation
// of discovery would count every one of these as "unindexed", which is true and
// useless.
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-h64c-rules-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true })
  mkdirSync(path.join(root, "dist"), { recursive: true })
  writeFileSync(path.join(root, "src", "a.ts"), "export function a(): number { return 1 }\n")
  writeFileSync(path.join(root, "node_modules", "pkg", "index.js"), "module.exports = 1\n")
  writeFileSync(path.join(root, "dist", "bundle.js"), "console.log(1)\n")
  writeFileSync(path.join(root, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(path.join(root, "notes.txt"), "plain text\n")
  writeFileSync(path.join(root, ".gitignore"), "secret.ts\n")
  writeFileSync(path.join(root, "secret.ts"), "export const secret = 1\n")
  // A file large enough to hit the indexer's >5MB size skip.
  writeFileSync(path.join(root, "big.ts"), `export const big = "${"x".repeat(5 * 1024 * 1024)}"\n`)
  const pid = getProjectId(root)
  await indexProjectParallel(pid as any, root, {})
  try {
    const r = await getUnifiedHealth(pid, root, { checkUnindexed: true })
    const reported = r.unindexed!.unindexedFiles
    const count = (frag: string) => reported.filter((p) => p.includes(frag)).length
    harness.check("node_modules is NOT reported as unindexed", count("node_modules") === 0, reported.join(", "))
    harness.check("dist/ is NOT reported (the indexer's compiled-mode filter)", count("dist/") === 0, "")
    harness.check("a .png is NOT reported (no supported extension)", count("logo.png") === 0, "")
    harness.check("a .txt is NOT reported (no supported extension)", count("notes.txt") === 0, "")
    harness.check("a gitignored file is NOT reported (.gitignore is honoured)", count("secret.ts") === 0, "")
    harness.check("a >5MB file is NOT reported (the indexer's size skip)", count("big.ts") === 0, "")
    harness.check("the one real source file is accounted for as indexed, not unindexed", !reported.includes("src/a.ts"), reported.join(", "))
    harness.check("so the answer is a clean zero over a noisy tree", r.unindexed!.unindexedCount === 0, `unindexedCount=${r.unindexed!.unindexedCount} eligibleOnDisk=${r.unindexed!.eligibleOnDisk}`)

    // And the shared function is genuinely the same one the indexer walks with.
    const direct = await discoverIndexableFiles(root)
    const eligible = r.unindexed!.eligibleOnDisk
    harness.check("discoverIndexableFiles returns the same count the report measured", direct.length === eligible, `direct=${direct.length} report=${eligible}`)
    harness.check("and it contains the real source file", direct.some((p) => p.endsWith(path.join("src", "a.ts"))), "")

    // Adding a .bbignore must narrow the walk exactly as it narrows the indexer.
    writeFileSync(path.join(root, ".bbignore"), "src/a.ts\n")
    const narrowed = await getUnifiedHealth(pid, root, { checkUnindexed: true })
    harness.check(".bbignore narrows the walk (the indexer's own rule, honoured here)", narrowed.unindexed!.eligibleOnDisk === direct.length - 1, `${direct.length} -> ${narrowed.unindexed!.eligibleOnDisk}`)
    harness.check("and the now-excluded file is NOT reported as unindexed", !narrowed.unindexed!.unindexedFiles.some((p) => p === "src/a.ts"), narrowed.unindexed!.unindexedFiles.join(", "))
  } finally { clean(root, pid) }
}

// ══ 3. opt-in, and never a false clean when it did not run ══════════════════
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-h64c-optin-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  for (let i = 0; i < 3; i++) writeFileSync(path.join(root, "src", `f${i}.ts`), `export function fn${i}(): number { return ${i} }\n`)
  const pid = getProjectId(root)
  await indexProjectParallel(pid as any, root, {})
  try {
    writeFileSync(path.join(root, "src", "after.ts"), "export function after(): number { return 9 }\n")

    const off = await getUnifiedHealth(pid, root, {})
    harness.check("without the option, `unindexed` is NULL, not zero", off.unindexed === null, `unindexed=${JSON.stringify(off.unindexed)}`)
    harness.check("null is distinguishable from a measured zero", off.unindexed !== (await getUnifiedHealth(pid, root, { checkUnindexed: true })).unindexed, "a caller must be able to tell NOT CHECKED from CHECKED AND CLEAN")
    harness.negative("and the default output makes no completeness claim at all", !/^unindexed:/m.test(formatUnifiedHealth(off)), formatUnifiedHealth(off).split("\n").filter((l) => l.startsWith("unindexed:")).join("|") || "no unindexed line (correct: the walk was not run)")
    harness.negative("and no UNINDEXED_FILES warning is invented", !off.warnings.some((w) => w.code === "UNINDEXED_FILES"), `warnings=${JSON.stringify(off.warnings.map((w) => w.code))}`)

    // A walk that fails must be UNKNOWN, not an empty gap. The path is forced
    // to disappear mid-call by pointing at a directory that is removed, which is
    // the realistic shape of "the project moved under us".
    const gone = mkdtempSync(path.join(tmpdir(), "bb-h64c-vanish-"))
    mkdirSync(path.join(gone, "src"), { recursive: true })
    writeFileSync(path.join(gone, "src", "x.ts"), "export function x(): number { return 1 }\n")
    rmSync(gone, { recursive: true, force: true })
    const failed = await getUnifiedHealth(pid, gone, { checkUnindexed: true })
    harness.check("a failed walk yields null, never an empty result", failed.unindexed === null, `unindexed=${JSON.stringify(failed.unindexed)}`)
    harness.check("and raises UNINDEXED_SCAN_FAILED", failed.warnings.some((w) => w.code === "UNINDEXED_SCAN_FAILED"), failed.warnings.find((w) => w.code === "UNINDEXED_SCAN_FAILED")?.message?.slice(0, 120) ?? "missing")
    harness.check("whose message says completeness is UNKNOWN, not verified", /UNKNOWN|not a verified result/i.test(failed.warnings.find((w) => w.code === "UNINDEXED_SCAN_FAILED")?.message ?? ""), "")
    harness.negative("and the output does not print a clean 'unindexed: none'", !/unindexed: none/.test(formatUnifiedHealth(failed)), "an empty gap here would be the exact false clean this replaced")
    harness.check("it prints UNKNOWN instead", /unindexed: UNKNOWN/.test(formatUnifiedHealth(failed)), formatUnifiedHealth(failed).split("\n").find((l) => l.startsWith("unindexed:"))?.slice(0, 90) ?? "absent")

    // Read-only: the walk must not mutate the index. A health call that deleted
    // rows would make the question destructive.
    const raw = await BrainDatabase.getRawInstance(pid as any)
    const filesBefore = (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(pid) as any).c
    await getUnifiedHealth(pid, root, { checkUnindexed: true })
    const filesAfter = (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(pid) as any).c
    harness.check("the walk does NOT mutate the index", filesBefore === filesAfter, `brain_file ${filesBefore} -> ${filesAfter} — a read-only tool that pruned rows would be worse than the bug it fixed`)
  } finally { clean(root, pid) }
}

harness.emit()
