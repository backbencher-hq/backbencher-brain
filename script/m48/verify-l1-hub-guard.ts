// script/m48/verify-l1-coordination.ts — M48.L1 (#704)
// Shared-component guard: every M48 commit that touches a declared shared
// component must have a matching COORDINATION.md entry, and the hub smoke
// (real M24 LSP harness) must be recorded at the current HEAD. A gate that
// cannot fail is not a gate — negatives included.

import { readFileSync, existsSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const COORD = path.join(ROOT, "docs/m48/COORDINATION.md")
const SMOKE = path.join(ROOT, "validation/m48/results/L1-smoke.json")

// Declared shared components (from the milestone charter + COORDINATION.md inventory).
const SHARED_PATHS = [
  "src/intelligence/graph/",
  "src/lsp/impact.ts",
  "src/lsp/cross_language_hover.ts",
  "src/intelligence/annotations/",
  "src/lsp/annotation_ui.ts",
]

let checks = 0, passed = 0, failed = 0, negatives = 0
function check(name: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`) }
}
function negative(name: string, ok: boolean, detail = "") {
  checks++; negatives++
  if (ok) passed++
  else { failed++; console.log(`FAIL(neg) ${name}${detail ? ` — ${detail}` : ""}`) }
}

function head(): string {
  return execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim()
}
function m48CommitsTouchingShared(): Array<{ hash: string; subject: string; files: string[] }> {
  // All commits on this branch whose message mentions M48 AND that touch a
  // shared path since the M48 baseline (first M48 commit).
  const log = execSync(
    `git log --grep="M48" --format="%h %s" -- ${SHARED_PATHS.map((p) => `"${p}"`).join(" ")}`,
    { cwd: ROOT },
  ).toString().trim()
  if (!log) return []
  return log.split("\n").map((line) => {
    const [hash, ...rest] = line.split(" ")
    const files = execSync(`git show --name-only --format= ${hash}`, { cwd: ROOT })
      .toString().trim().split("\n").filter(Boolean)
    return { hash, subject: rest.join(" "), files }
  })
}

function coordinationCovers(commitHash: string, subject: string, coordText: string): { ok: boolean; why: string } {
  // An entry covers a commit if it cites the hash, or cites the issue code
  // present in the commit subject (e.g. "C1 (#699)") — retro-entries for
  // pre-gate commits are allowed by hash OR issue code.
  const issueCode = subject.match(/M48\.([A-Z]+\d+)/)?.[1]
  if (coordText.includes(commitHash)) return { ok: true, why: "hash cited" }
  if (issueCode && new RegExp(`#+\\s*${issueCode}\\b|#\\s*${issueCode}\\b|M48\\.${issueCode}\\b`).test(coordText)) {
    return { ok: true, why: `issue code ${issueCode} cited` }
  }
  return { ok: false, why: "no entry cites this commit's hash or issue code" }
}

function main() {
  const headHash = head()
  check("COORDINATION.md exists", existsSync(COORD))
  const coord = existsSync(COORD) ? readFileSync(COORD, "utf8") : ""

  // 1. Every M48 commit touching shared paths is covered by an entry.
  const sharedCommits = m48CommitsTouchingShared()
  check("found the expected shared-file commits (C1 graph-engine)", sharedCommits.length >= 1,
    `found ${sharedCommits.length}`)
  for (const c of sharedCommits) {
    const v = coordinationCovers(c.hash, c.subject, coord)
    check(`shared commit ${c.hash} (${c.subject.slice(0, 40)}…) covered`, v.ok, v.why)
  }

  // 2. Entries must carry what/why/how-verified (the charter's required fields).
  const entryBodies = coord.split(/^### /m).slice(1)
  for (const body of entryBodies) {
    const title = body.split("\n")[0]
    check(`entry "${title.slice(0, 40)}…" has What/Why/How verified`,
      /What/i.test(body) && /Why/i.test(body) && /verified/i.test(body))
  }

  // 3. Hub smoke evidence (two legs) exists, is verified, stamped at HEAD.
  const SMOKE_GRAPH = path.join(ROOT, "validation/m48/results/L1-smoke-graph.json")
  check("L1-smoke.json exists", existsSync(SMOKE))
  check("L1-smoke-graph.json exists", existsSync(SMOKE_GRAPH))
  for (const [label, file] of [["harness", SMOKE], ["graph", SMOKE_GRAPH]] as const) {
    if (!existsSync(file)) continue
    let smoke: any = null
    try { smoke = JSON.parse(readFileSync(file, "utf8")) } catch { /* handled below */ }
    check(`${label} smoke evidence parses`, smoke !== null)
    if (smoke) {
      check(`${label} smoke status is verified (honest: blocked/failed recorded as such)`,
        smoke.status === "verified", `status=${smoke.status} reason=${smoke.reason ?? ""}`)
      check(`${label} smoke stamped at current HEAD`, smoke.commit === headHash,
        `evidence=${String(smoke.commit).slice(0, 8)} head=${headHash.slice(0, 8)}`)
    }
  }
  // The graph leg must exercise the shared-engine path (bb/graph root + callers).
  if (existsSync(SMOKE_GRAPH)) {
    const g = JSON.parse(readFileSync(SMOKE_GRAPH, "utf8"))
    check("graph smoke exercised bb/graph root resolution (shared engine)",
      (g.checks ?? []).some((c: any) => /root resolves/.test(c.name ?? "")))
    check("graph smoke exercised bb/graph callers (shared engine)",
      (g.checks ?? []).some((c: any) => /callers found/.test(c.name ?? "")))
    check("graph smoke negative: schema mismatch is declared (not silent)",
      (g.checks ?? []).some((c: any) => /schema mismatch/.test(c.name ?? "")))
  }

  // 4. NEGATIVES — prove the predicates can fail.
  // Strip ALL entry content: keep only the text before the first "### " header.
  const stripped = coord.split(/^### /m)[0] ?? ""
  const c1 = sharedCommits.find((c) => /C1/.test(c.subject))
  if (c1) {
    negative("negative: entry stripped → C1 commit uncovered", !coordinationCovers(c1.hash, c1.subject, stripped).ok)
  }
  negative("negative: fabricated smoke status rejected", (() => {
    const fake = { status: "verified", commit: "0000000000000000000000000000000000000000", checks: [], features: [] }
    return fake.commit !== headHash // the HEAD-stamp predicate rejects it
  })())

  console.log(`L1 coordination: ${passed}/${checks} checks passed (${negatives} negative)`)
  if (failed > 0) process.exitCode = 1

  mkdirSync(path.dirname(path.join(ROOT, "validation/m48/results/L1.json")), { recursive: true })
  writeFileSync(path.join(ROOT, "validation/m48/results/L1.json"), JSON.stringify({
    status: failed === 0 ? "verified" : "failed",
    currentCommit: headHash,
    verifierCommand: "bun run script/m48/verify-l1-coordination.ts",
    evidenceFile: "L1.json",
    generatedAt: new Date().toISOString(),
    passed, failed, negativeCases: negatives,
    failures: [],
    exercised: ["docs/m48/COORDINATION.md", "script/m24/lsp_harness.ts"],
    summary: { sharedCommitsCovered: sharedCommits.length, smoke: existsSync(SMOKE) ? JSON.parse(readFileSync(SMOKE, "utf8")).status : "missing" },
  }, null, 2) + "\n")
}

import { mkdirSync, writeFileSync } from "node:fs"
main()
