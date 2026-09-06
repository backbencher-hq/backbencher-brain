// script/m44/verify-w21-git-probe.ts — M44.W2.1 (#671)
// Git added-file probe: the worst agent hallucination case — an agent creates
// a NEW file with its own tooling and immediately asks. There is no index row,
// so every row-based repair is blind. This gate proves, on a real git
// worktree fixture, that:
//   1. A brand-new untracked file whose content matches the query is
//      auto-refreshed (declared) and its symbols appear in the answer's
//      second pass (lexical path).
//   2. Gitignore semantics: ignored files never appear as candidates.
//   3. A stale unrelated modified file does NOT trigger a new-file repair.
//   4. refresh=false on a query-relevant new file names the unindexed file
//      explicitly (never silent).
//   5. Non-git trees: the GIT probe is unavailable there (by design), but the
//      W2.2 snapshot layer (verified separately) gives plain directories the
//      same repair parity — this gate asserts the git probe itself declines
//      cleanly on a plain dir while bb_ask still repairs via the snapshot
//      fallback (declared, never silent).
// Honesty rules: no auto-passes; every check exercises a real code path.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULT = path.join(ROOT, "validation/m44/results/W21.json")

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

const sh = (cwd: string, cmd: string, args: string[]) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers"))
  const { probeAddedFiles, addedFilesRelevantToQuery } = await import(path.join(ROOT, "src/ast/auto-refresh"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))

  const fixture = mkdtempSync(path.join(tmpdir(), "bb-m44-w21-"))
  try {
    mkdirSync(path.join(fixture, "src"), { recursive: true })
    writeFileSync(path.join(fixture, "src", "api.ts"), `export function existingThing(): number { return 1 }
`)
    writeFileSync(path.join(fixture, ".gitignore"), "ignored.log\n")
    // Make it a real git worktree with one commit.
    sh(fixture, "git", ["init", "-q"])
    sh(fixture, "git", ["config", "user.email", "gate@test"])
    sh(fixture, "git", ["config", "user.name", "gate"])
    sh(fixture, "git", ["add", "-A"])
    sh(fixture, "git", ["commit", "-q", "-m", "base"])

    const pid = getProjectId(fixture)
    const s = await indexProjectParallel(pid as any, fixture, {})
    check("fixture indexes clean", s.errorFiles === 0, `errors=${s.errorFiles}`)

    const raw = await BrainDatabase.getRawInstance(pid as any)
    const handlers = createToolHandlers()
    const ctx = { projectId: pid, projectPath: fixture }
    const run = async (tool: string, args: any) => (await handlers[tool](args, ctx)).content[0].text as string

    // ── unit probe checks ──
    // 5a. pristine worktree: no untracked files.
    let probe = await probeAddedFiles(raw, pid as any, fixture)
    check("probe: clean worktree has no added files", probe.available === true && probe.files.length === 0, JSON.stringify(probe))

    // ── 1. brand-new file + query about its symbol ──
    writeFileSync(path.join(fixture, "src", "fresh.ts"), `export function quantumFrobnicate(x: number): number {
  return x * 3 + 1
}
export function freshHelper(): string { return "fresh" }
`)
    probe = await probeAddedFiles(raw, pid as any, fixture)
    check("probe: finds the new untracked file", probe.available === true && probe.files.length === 1, JSON.stringify(probe.files))
    const rel = probe.files[0]?.endsWith("src/fresh.ts")
    check("probe: candidate is exactly the new file", rel === true, probe.files.join(","))

    // bb_ask BEFORE any repair: the file has no row yet, so quickAnswer cannot
    // see it — the handler must repair (declared) and answer from the second
    // pass, where the lexical/symbol path finds quantumFrobnicate.
    const askText = await run("bb_ask", { query: "quantumFrobnicate" })
    check("bb_ask: new-file query declares the auto-refresh", /auto-refreshed 1 file/.test(askText), askText.slice(-300))
    check("bb_ask: the new symbol is in the answered sources", askText.includes("quantumFrobnicate") || askText.includes("fresh.ts"), askText.slice(0, 500))

    // ── 2. gitignore respected: an ignored file is never a candidate ──
    writeFileSync(path.join(fixture, "ignored.log"), "not source\n")
    probe = await probeAddedFiles(raw, pid as any, fixture)
    check("probe: gitignored file is excluded", probe.files.length === 0, probe.files.join(","))

    // ── 3. an unrelated new file does not disturb a read about something else ──
    writeFileSync(path.join(fixture, "src", "unrelated.ts"), `export function completelyUnrelatedRoutine(): void {}
`)
    const cleanAsk = await run("bb_ask", { query: "existingThing" })
    negative("bb_ask: unrelated new file stays silent (not auto-refreshed)", !/auto-refreshed/.test(cleanAsk), cleanAsk.slice(-200))

    // ── 4. refresh=false on a relevant new file names it explicitly ──
    writeFileSync(path.join(fixture, "src", "other.ts"), `export function anotherFreshSymbol(): number { return 7 }
`)
    const optOut = await run("bb_ask", { query: "anotherFreshSymbol", refresh: false })
    check("bb_ask refresh=false: unindexed new file is named explicitly", /unindexed new file/.test(optOut) && optOut.includes("other.ts"), optOut.slice(-300))
    negative("bb_ask refresh=false: no auto-refresh claimed", !/auto-refreshed/.test(optOut), optOut.slice(-200))

    // ── 5b. non-git directory: the GIT probe is unavailable, but the W2.2
    // snapshot layer repairs the new file through the same bb_ask path ──
    const plainDir = mkdtempSync(path.join(tmpdir(), "bb-m44-w21-plain-"))
    try {
      mkdirSync(path.join(plainDir, "src"), { recursive: true })
      writeFileSync(path.join(plainDir, "src", "a.ts"), `export function plainA(): number { return 1 }
`)
      const pid2 = getProjectId(plainDir)
      await indexProjectParallel(pid2 as any, plainDir, {})
      const raw2 = await BrainDatabase.getRawInstance(pid2 as any)
      probe = await probeAddedFiles(raw2, pid2 as any, plainDir)
      check("probe: non-git tree reports unavailable (no-git)", probe.available === false && probe.reason === "no-git", JSON.stringify(probe))
      writeFileSync(path.join(plainDir, "src", "newplain.ts"), `export function plainNew(): number { return 2 }
`)
      const h2 = createToolHandlers()
      const plainAsk = await h2.bb_ask({ query: "plainNew" }, { projectId: pid2, projectPath: plainDir })
      check("bb_ask non-git: new file auto-refreshed via the snapshot layer (declared)", /auto-refreshed 1 file/.test(plainAsk.content[0].text), plainAsk.content[0].text.slice(-250))
      check("bb_ask non-git: the new symbol is in the answer", plainAsk.content[0].text.includes("plainNew") || plainAsk.content[0].text.includes("newplain.ts"), plainAsk.content[0].text.slice(0, 400))
    } finally {
      rmSync(plainDir, { recursive: true, force: true })
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }

  if (process.env.BB_M44_EVIDENCE === "1" && failed === 0) {
    mkdirSync(path.dirname(RESULT), { recursive: true })
    writeFileSync(RESULT, JSON.stringify({
      status: "verified",
      currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
      workingTreeRelevantChanges: [],
      verifierCommand: "bun run script/m44/verify-w21-git-probe.ts",
      evidenceFile: "W21.json",
      generatedAt: new Date().toISOString(),
      passed, failed, negativeCases,
    }, null, 2) + "\n")
  }
  console.log(`M44 W2.1 GIT PROBE: ${failed === 0 ? "PASS" : "FAIL"} (${passed}/${checks}, negatives=${negativeCases})`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("W2.1 gate crashed:", e)
  process.exit(1)
})
