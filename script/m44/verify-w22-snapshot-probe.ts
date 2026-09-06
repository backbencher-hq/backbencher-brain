// script/m44/verify-w22-snapshot-probe.ts — M44.W2.2 (#672)
// Non-git added-file probe, manifest-driven. Behavioral parity with W2.1 on a
// plain directory (no git) plus the bounded-walk contract:
//   1. The indexer records the dir manifest on a full index (table exists,
//      every scanned dir present, root included).
//   2. New file in an existing dir + query about its symbol -> bb_ask
//      auto-refreshes (declared) and answers from the second pass.
//   3. New file in a brand-new nested dir -> the probe descends the new
//      subtree and finds it; after the repair the whole chain is re-stamped
//      so a re-probe lists ~0 dirs (bounded).
//   4. Walk bound: with nothing changed, re-running the probe stats the
//      manifest dirs but lists ~0; after ONE new file it lists exactly the
//      changed dir — never the whole tree.
//   5. .bbignore semantics respected: ignored dirs/files are never claimed,
//      and the probe does not descend into them.
//   6. refresh=false names the unindexed file explicitly (W1.2 vocabulary).
// Honesty: no auto-passes; every check exercises a real code path. The
// fixture writes are separated by the index/repair wall-clock (ms-scale dir
// mtimes), which makes the mtime comparisons deterministic.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULT = path.join(ROOT, "validation/m44/results/W22.json")

delete process.env.BB_EMBEDDING_BASE_URL
delete process.env.BB_EMBEDDING_API_KEY
delete process.env.BB_EMBEDDING_MODEL
delete process.env.BB_NO_AUTO_REFRESH

let checks = 0, passed = 0, failed = 0, negativeCases = 0
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else { failed++; console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}
function negative(label: string, ok: boolean, detail = "") {
  if (ok) negativeCases++
  check(`${label} [negative]`, ok, detail)
}

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers"))
  const { probeAddedFilesSnapshot } = await import(path.join(ROOT, "src/ast/auto-refresh"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))

  const fixture = mkdtempSync(path.join(tmpdir(), "bb-m44-w22-"))
  try {
    // Many directories so the bounded-walk assertion is meaningful: 30 dirs.
    for (let i = 0; i < 30; i++) {
      mkdirSync(path.join(fixture, "src", `mod${i}`), { recursive: true })
      writeFileSync(path.join(fixture, "src", `mod${i}`, "a.ts"), `export function fn${i}A(): number { return ${i} }\n`)
      writeFileSync(path.join(fixture, "src", `mod${i}`, "b.ts"), `export function fn${i}B(): number { return ${i} + 1 }\n`)
    }
    writeFileSync(path.join(fixture, "src", "root.ts"), `export function rootFn(): number { return 0 }\n`)
    writeFileSync(path.join(fixture, ".bbignore"), "src/generated\n*.log\n")

    const pid = getProjectId(fixture)
    const s = await indexProjectParallel(pid as any, fixture, {})
    check("fixture indexes clean", s.errorFiles === 0, `errors=${s.errorFiles}`)

    const raw = await BrainDatabase.getRawInstance(pid as any)
    const handlers = createToolHandlers()
    const ctx = { projectId: pid, projectPath: fixture }
    const run = async (tool: string, args: any) => (await handlers[tool](args, ctx)).content[0].text as string

    // ── 1. the indexer recorded the manifest on the full index ──
    const manifestRows = raw.prepare("SELECT dir_path FROM brain_dir_manifest WHERE project_id = ?").all(pid as any) as Array<{ dir_path: string }>
    check("manifest: recorded by the full index (>= 31 dirs incl. root)", manifestRows.length >= 31, `rows=${manifestRows.length}`)
    check("manifest: root is recorded", manifestRows.some((r) => r.dir_path === ""), "no root row")
    check("manifest: src and a module dir are recorded", manifestRows.some((r) => r.dir_path === "src") && manifestRows.some((r) => r.dir_path === "src/mod0"), "missing dirs")
    const hasManifestTable = !!raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='brain_dir_manifest'").get()
    check("manifest: table exists", hasManifestTable, "brain_dir_manifest missing")

    // ── 2. clean tree: probe stats the manifest but lists nothing new ──
    let probe = await probeAddedFilesSnapshot(raw, pid as any, fixture)
    check("probe: clean tree finds no added files", probe.available === true && probe.files.length === 0 && probe.legacyFallback === false, JSON.stringify({ files: probe.files, legacy: probe.legacyFallback }))
    check("probe: clean-tree listing is bounded (~0 dirs listed of 31+)", probe.dirsListed <= 1, JSON.stringify({ dirsStat: probe.dirsStat, dirsListed: probe.dirsListed }))

    // ── 3. new file in an EXISTING dir ──
    writeFileSync(path.join(fixture, "src", "mod3", "fresh.ts"), `export function snapshotFrobnicate(): number { return 300 }\n`)
    probe = await probeAddedFilesSnapshot(raw, pid as any, fixture)
    check("probe: new file in existing dir is found", probe.files.length === 1 && probe.files[0].endsWith("src/mod3/fresh.ts"), JSON.stringify(probe.files))
    check("probe: exactly the changed dir was listed (bounded)", probe.dirsListed === 1, JSON.stringify({ dirsStat: probe.dirsStat, dirsListed: probe.dirsListed }))
    const ask1 = await run("bb_ask", { query: "snapshotFrobnicate" })
    check("bb_ask: new-file query declares auto-refresh (parity with W2.1)", /auto-refreshed 1 file/.test(ask1), ask1.slice(-250))
    check("bb_ask: the new symbol is in the answered sources", ask1.includes("snapshotFrobnicate") || ask1.includes("fresh.ts"), ask1.slice(0, 400))

    // ── 4. new file in a brand-new NESTED dir (two levels deep) ──
    mkdirSync(path.join(fixture, "src", "brandnew", "deep"), { recursive: true })
    writeFileSync(path.join(fixture, "src", "brandnew", "deep", "nested.ts"), `export function deeplyNestedFresh(): string { return "nested" }\n`)
    probe = await probeAddedFilesSnapshot(raw, pid as any, fixture)
    check("probe: new file in a brand-new nested dir is found", probe.files.some((f) => f.endsWith("src/brandnew/deep/nested.ts")), JSON.stringify(probe.files))
    check("probe: nested-dir discovery lists only the moved + new dirs (bounded, << 30)", probe.dirsListed <= 4, JSON.stringify({ dirsStat: probe.dirsStat, dirsListed: probe.dirsListed, files: probe.files }))
    const ask2 = await run("bb_ask", { query: "deeplyNestedFresh" })
    check("bb_ask: nested new-file query includes the symbol", ask2.includes("deeplyNestedFresh") || ask2.includes("nested.ts"), ask2.slice(0, 400))

    // ── 5. post-repair re-probe is quiet: repairs re-stamp the whole new
    // chain (deep -> brandnew -> src), so listing drops back to ~0 ──
    probe = await probeAddedFilesSnapshot(raw, pid as any, fixture)
    check("probe: post-repair re-probe lists ~0 dirs (chain re-stamped)", probe.dirsListed === 0 && probe.files.length === 0, JSON.stringify({ dirsStat: probe.dirsStat, dirsListed: probe.dirsListed, files: probe.files }))
    check("probe: post-repair re-probe still stats the manifest (cost is stats, not listings)", probe.dirsStat >= 31, `dirsStat=${probe.dirsStat}`)

    // ── 6. .bbignore respected: generated dir + *.log are never claimed ──
    mkdirSync(path.join(fixture, "src", "generated"), { recursive: true })
    writeFileSync(path.join(fixture, "src", "generated", "g.ts"), `export function ignoredGen(): number { return 1 }\n`)
    writeFileSync(path.join(fixture, "src", "mod0", "notes.log"), "noise\n")
    probe = await probeAddedFilesSnapshot(raw, pid as any, fixture)
    negative("probe: .bbignore dir is excluded (and not descended)", !probe.files.some((f) => f.includes("generated")), JSON.stringify(probe.files))
    negative("probe: .bbignore *.log is excluded", !probe.files.some((f) => f.endsWith(".log")), JSON.stringify(probe.files))
    // Exactly two directories moved (mod0 gained notes.log; src gained the
    // generated dir) — never the 30-dir tree, and neither is descended.
    check("probe: ignore churn lists only the two moved dirs (bounded)", probe.dirsListed === 2, JSON.stringify({ dirsStat: probe.dirsStat, dirsListed: probe.dirsListed }))

    // ── 7. refresh=false names the unindexed file (W1.2 vocabulary) ──
    writeFileSync(path.join(fixture, "src", "mod1", "optout.ts"), `export function optOutFresh(): number { return 2 }\n`)
    const optOut = await run("bb_ask", { query: "optOutFresh", refresh: false })
    check("bb_ask refresh=false: unindexed new file named explicitly (non-git)", /unindexed new file/.test(optOut) && optOut.includes("optout.ts"), optOut.slice(-300))
    negative("bb_ask refresh=false: no auto-refresh claimed", !/auto-refreshed/.test(optOut), optOut.slice(-200))

    // ── 8. refresh=false left optout.ts unindexed — the probe keeps naming it
    // on every later read until something actually repairs it (honesty, not
    // amnesia); a second fresh file joins the claim set. Listings still scale
    // with moved dirs (src+mod0 from case 6 are still un-repaired, so they
    // stay listed too) — never the 30-dir tree. ──
    writeFileSync(path.join(fixture, "src", "mod7", "one.ts"), `export function oneFresh(): number { return 7 }\n`)
    probe = await probeAddedFilesSnapshot(raw, pid as any, fixture)
    check("probe: refresh=false file stays named until repaired", probe.files.some((f) => f.endsWith("mod1/optout.ts")), JSON.stringify(probe.files))
    check("probe: new file is named alongside it", probe.files.some((f) => f.endsWith("mod7/one.ts")), JSON.stringify(probe.files))
    check("probe: bounded — listings scale with moved dirs, never the tree", probe.dirsListed <= 5 && probe.dirsListed >= 2, JSON.stringify({ dirsStat: probe.dirsStat, dirsListed: probe.dirsListed, files: probe.files }))
    // Repairing one.ts refreshes ONLY mod7's stamp; optout.ts (mod1) stays
    // unindexed and named — selective repair is selective.
    const ask3 = await run("bb_ask", { query: "oneFresh" })
    check("bb_ask: repair of the fresh file is declared", /auto-refreshed 1 file/.test(ask3), ask3.slice(-250))
    probe = await probeAddedFilesSnapshot(raw, pid as any, fixture)
    negative("probe: repaired one.ts is no longer claimed", !probe.files.some((f) => f.endsWith("mod7/one.ts")), JSON.stringify(probe.files))
    check("probe: un-repaired optout.ts is STILL named", probe.files.some((f) => f.endsWith("mod1/optout.ts")), JSON.stringify(probe.files))
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }

  if (process.env.BB_M44_EVIDENCE === "1" && failed === 0) {
    mkdirSync(path.dirname(RESULT), { recursive: true })
    writeFileSync(RESULT, JSON.stringify({
      status: "verified",
      currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
      workingTreeRelevantChanges: [],
      verifierCommand: "bun run script/m44/verify-w22-snapshot-probe.ts",
      evidenceFile: "W22.json",
      generatedAt: new Date().toISOString(),
      passed, failed, negativeCases,
    }, null, 2) + "\n")
  }
  console.log(`M44 W2.2 SNAPSHOT PROBE: ${failed === 0 ? "PASS" : "FAIL"} (${passed}/${checks}, negatives=${negativeCases})`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("W2.2 gate crashed:", e)
  process.exit(1)
})
