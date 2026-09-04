// script/m35/verify-gate-selftest.ts — M35.G1
// Mutation-based gate self-test (M31 pattern): for every registered M35 gate,
// prove two things — (control) the gate PASSES on the clean/conforming world,
// and (mutation) the gate FAILS when a governed surface is corrupted. A gate
// that cannot fail is not a gate.
//
// Coverage contract: every verifier in script/m35/ must appear here under a
// mutation or be declared infrastructure — a new gate cannot merge unwired or
// unproven. Governance enforces the same from its side (staged wiring check).
//
// Sandbox rule (M31 audit lesson): child runs NEVER inherit BB_M35_EVIDENCE —
// a sandboxed gate can never stamp real evidence.

import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULT = path.join(ROOT, "validation/m35/results/gate-selftest.json")

let checks = 0
let passed = 0
let failed = 0
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else {
    failed++
    console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

type GateSpec = {
  name: string
  script: string
  /** repo-relative files copied into the sandbox for seam-based gates */
  surfaces: { from: string; to: string }[]
  mutate: (sandbox: string) => void
  /** evidence-mutation gates plant+restore against the real tree (no seam yet) */
  mutateEvidence?: { file: string; from: string; to: string }
}

const GATES: GateSpec[] = [
  {
    name: "m35-envelope-handler",
    script: "script/m35/verify-envelope-contract.ts",
    // E1 mutation 1 (issue criterion 2): a registered handler mode that OMITS
    // the staleness block must fail the gate. Remove the symbol-mode block.
    surfaces: [],
    mutate: () => {},
    mutateEvidence: {
      file: "src/mcp/tool-handlers.ts",
      from: "return textResult(JSON.stringify({ ...found, freshness: buildStalenessEnvelope(detail.summary, { kind: \"dir\" }) }, null, 2))",
      to: "return textResult(JSON.stringify(found, null, 2))",
    },
  },
  {
    name: "m35-envelope-remediation",
    script: "script/m35/verify-envelope-contract.ts",
    // E1 mutation 2 (issue criterion 2): remediation text that does NOT match
    // the registered constant must fail the gate. Corrupt the registered
    // dir remediation — every dir-scope remediation check must flip.
    surfaces: [],
    mutate: () => {},
    mutateEvidence: {
      file: "src/brain/freshness.ts",
      from: "dir: 'run: bb index --changed",
      to: "dir: 'run: bb reindex --changed",
    },
  },
  {
    name: "m35-s1-stale-flag",
    script: "script/m35/verify-s1-read-paths.ts",
    // S1 mutation 1 (issue criterion 2): a stale row reported FRESH. Flip the
    // graph-mode flag comparison — the edited-file node must be reported stale
    // but comes out fresh, and the callees flag check fails.
    surfaces: [],
    mutate: () => {},
    mutateEvidence: {
      file: "src/mcp/tool-handlers.ts",
      from: "{ onRows: (statuses) => { for (const n of nodes) if (!n.isExternal) n.stale = statuses.get(n.filePath || n.file) !== \"fresh\" } },",
      to: "{ onRows: (statuses) => { for (const n of nodes) if (!n.isExternal) n.stale = statuses.get(n.filePath || n.file) === \"fresh\" } },",
    },
  },
  {
    name: "m35-s1-envelope-counts",
    script: "script/m35/verify-s1-read-paths.ts",
    // S1 mutation 2 (issue criterion 2): envelope counts WRONG. Zero the
    // summary the graph-mode envelope is built from — every count check and
    // the independent-recomputation check must fail.
    surfaces: [],
    mutate: () => {},
    mutateEvidence: {
      file: "src/mcp/tool-handlers.ts",
      from: "      const detail = resolveRowsFreshnessDetailed(raw, projectId as any, resolved, { freshnessMode: mode })",
      to: "      const detail = { ...resolveRowsFreshnessDetailed(raw, projectId as any, resolved, { freshnessMode: mode }), summary: { fresh: 0, stale: 0, missing: 0, staleRatio: 0, freshnessMode: mode } }",
    },
  },
  {
    name: "m35-s2-stale-finding-fresh",
    script: "script/m35/verify-s2-derived.ts",
    // S2 mutation (issue criterion 3): a stale finding presented FRESH. Invert
    // the derived-staleness flag source — edited-file findings come out fresh,
    // untouched-file findings come out stale, footers count wrong, and the
    // fresh-negative controls fail.
    surfaces: [],
    mutate: () => {},
    mutateEvidence: {
      file: "src/mcp/tool-handlers.ts",
      from: "    isStale: (rel) => rel != null && statuses.get(relToId.get(rel) ?? \"\") === \"stale\",",
      to: "    isStale: (rel) => rel != null && statuses.get(relToId.get(rel) ?? \"\") !== \"stale\",",
    },
  },
  {
    name: "m35-s3-stale-plan-unflagged",
    script: "script/m35/verify-s3-graph-migrate.ts",
    // S3 mutation 1 (issue criterion 2): a stale migration plan unflagged.
    // Flip the per-plan comparison — the edited-file plan comes out fresh and
    // the up-front notice miscounts; the plan flag checks must fail.
    surfaces: [],
    mutate: () => {},
    mutateEvidence: {
      file: "src/mcp/tool-handlers.ts",
      from: "      p.stale = migStatus(p.sourceFile) === \"stale\"",
      to: "      p.stale = migStatus(p.sourceFile) !== \"stale\"",
    },
  },
  {
    name: "m35-s3-link-wrong-endpoint",
    script: "script/m35/verify-s3-graph-migrate.ts",
    // S3 mutation 2 (issue criterion 2): link inherits the WRONG endpoint
    // state — worst-of (OR) becomes all-of (AND), so a stale-source link
    // with a fresh target drops its flag; the worst-of-endpoints check fails.
    surfaces: [],
    mutate: () => {},
    mutateEvidence: {
      file: "src/mcp/tool-handlers.ts",
      from: "      l.stale = (!!s && vizStatus(s.filePath) === \"stale\") || (!!t && vizStatus(t.filePath) === \"stale\")",
      to: "      l.stale = (!!s && vizStatus(s.filePath) === \"stale\") && (!!t && vizStatus(t.filePath) === \"stale\")",
    },
  },
  {
    name: "m35-c1-baseline-tamper",
    script: "script/m35/staleness-corpus.ts",
    // C1 mutation (issue criterion 3): committed-baseline tampering detected.
    // Flip a recorded staleness summary (stale→fresh) — the --check deep-diff
    // must catch the drift and fail the gate.
    surfaces: [],
    mutate: () => {},
    mutateEvidence: {
      file: "validation/m35/results/staleness-corpus.json",
      from: '"stale": 1,\n        "missing": 0,\n        "staleRatio": 1,',
      to: '"stale": 0,\n        "missing": 0,\n        "staleRatio": 1,',
    },
  },
  {
    name: "m35-d1-doc-claims-unimplemented",
    script: "script/m35/verify-docs-staleness.ts",
    // D1 mutation (issue criterion 3): a doc claims staleness support for a
    // tool that has NO staleness surface — the docs-truth gate must fail
    // (unimplemented-mode claims are exactly what D1 exists to catch).
    surfaces: [],
    mutate: () => {},
    mutateEvidence: {
      file: "docs/tools/bb_health.md",
      from: "This tool does not report index staleness. Output reflects the index as of the last bb index run; run bb index --changed to refresh changed files before acting on results.",
      to: "Staleness surfaces as: per-row stale flags; remediation: run: bb reindex --changed",
    },
  },
  {
    name: "m35-x1-subordinate-evidence-flip",
    script: "script/m35/verify-closure.ts",
    // X1 mutation (issue criterion 1): a subordinate gate declared verified
    // while actually failed — the closure aggregation must refuse closure.
    surfaces: [],
    mutate: () => {},
    mutateEvidence: {
      file: "validation/m35/results/S2.json",
      from: '"status": "verified",\n  "currentCommit"',
      to: '"status": "failed",\n  "currentCommit"',
    },
  },
  {
    name: "m35-freshness-core",
    script: "script/m35/verify-freshness-core.ts",
    // Evidence-mutation form: F1's governed surface is the production core
    // itself (src/brain/freshness.ts). Plant the O(rows) stat mutation → the
    // batch-cost check must fail the gate → restore byte-identical.
    surfaces: [],
    mutate: () => {},
    mutateEvidence: { file: "src/brain/freshness.ts", from: "return memoStat(p)", to: "return rawStat(p)" },
  },
  {
    name: "m35-governance",
    script: "script/m35/verify-governance.ts",
    // Governance reads the FULL governed surface — the sandbox must contain it:
    surfaces: [
      { from: "docs/m35/PLAN.md", to: "docs/m35/PLAN.md" },
      { from: "validation/m35/ledger.json", to: "validation/m35/ledger.json" },
      { from: "package.json", to: "package.json" },
      ...(existsSync(path.join(ROOT, "validation/m35/results/gate-selftest.json"))
        ? [{ from: "validation/m35/results/gate-selftest.json", to: "validation/m35/results/gate-selftest.json" }]
        : []),
      // verified ledger entries require their evidence files on disk (governance check 3):
      ...readdirSync(path.join(ROOT, "validation/m35/results"))
        .filter((f) => /^[A-Z][A-Za-z0-9-]*\.json$/.test(f))
        .map((f) => ({ from: `validation/m35/results/${f}`, to: `validation/m35/results/${f}` })),
      // governance audits the M35 verifier sources themselves (auto-pass grep):
      { from: "script/m35/verify-governance.ts", to: "script/m35/verify-governance.ts" },
      { from: "script/m35/verify-gate-selftest.ts", to: "script/m35/verify-gate-selftest.ts" },
    ],
    mutate: (sandbox) => {
      // Mutation: erase the declared authority from the plan — governance must
      // refuse a milestone whose plan no longer names its staleness oracle.
      // Replace ALL occurrences: a partial first-hit replace stops being a
      // mutation the moment the authority string legitimately appears more
      // than once in the plan (it does, since the F1 delivery log).
      const p = path.join(sandbox, "docs/m35/PLAN.md")
      writeFileSync(p, readFileSync(p, "utf8").replaceAll("src/brain/freshness.ts", "src/REMOVED-AUTHORITY"))
    },
  },
]

// ── dynamic coverage: any other M35 verifier on disk must be covered or infra ──
const INFRA = new Set(["verify-governance.ts", "verify-gate-selftest.ts", "verify-closure.ts", "sync-ledger.ts"])
const m35Dir = path.join(ROOT, "script/m35")
const verifiers = existsSync(m35Dir) ? readdirSync(m35Dir).filter((f) => f.startsWith("verify-") && f.endsWith(".ts")) : []
const coveredScripts = new Set(GATES.map((g) => path.basename(g.script)))
const uncovered = verifiers.filter((v) => !coveredScripts.has(v) && !INFRA.has(v))
check("every M35 verifier is covered by a mutation or declared infra", uncovered.length === 0, uncovered.join(","))

// Fresh-clone robustness: git does not track empty directories, so
// validation/m35/results/ may not exist on a fresh checkout. Create it before
// any readdirSync/copy — the self-test must NEVER crash; gates may fail, code
// may not throw.
mkdirSync(path.join(ROOT, "validation/m35/results"), { recursive: true })

function runGate(script: string, env: Record<string, string> = {}): { exit: number; output: string } {
  try {
    // Self-test child runs NEVER stamp real evidence (explicit-stamping model):
    // strip BB_M35_EVIDENCE so a sandboxed gate cannot poison real results.
    const { BB_M35_EVIDENCE: _drop, ...parentEnv } = process.env
    const out = execFileSync("bun", ["run", script], { cwd: ROOT, encoding: "utf8", stdio: "pipe", env: { ...parentEnv, ...env } })
    return { exit: 0, output: out }
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number }
    return { exit: err.status ?? 1, output: String(err.stdout ?? "") + String(err.stderr ?? "") }
  }
}

// Failure detail that surfaces the child's ACTUAL failing checks (FAIL lines
// from its stdout) instead of trailing stderr noise (wasm/worker logs).
function gateFailureDetail(output: string): string {
  const failLines = output.split("\n").filter((l) => l.startsWith("FAIL") || l.includes("OVER") || l.includes("CRASH")).slice(0, 4).join(" | ")
  return failLines || output.slice(-200)
}

const gateResults: { name: string; script: string; mutationFailed: boolean; controlPassed: boolean }[] = []
for (const gate of GATES) {
  check(`${gate.name}: gate script exists`, existsSync(path.join(ROOT, gate.script)), gate.script)
  if (!existsSync(path.join(ROOT, gate.script))) {
    gateResults.push({ name: gate.name, script: gate.script, mutationFailed: false, controlPassed: false })
    continue
  }

  // Evidence-mutation gate: control passes clean, corrupt the evidence file,
  // gate must fail, restore byte-identical. (Used for gates whose governed
  // surface is an evidence file rather than a sandboxable doc.)
  if (gate.mutateEvidence) {
    const evPath = path.join(ROOT, gate.mutateEvidence.file)
    const backup = readFileSync(evPath, "utf8")
    try {
      const control = runGate(gate.script, { BB_M35_SELFTEST_CONTROL: "1", ...(gate.name === "m35-c1-baseline-tamper" ? { BB_M35_CORPUS_CHECK_ONLY: "1" } : {}) })
      check(`${gate.name}: control — clean tree PASSES`, control.exit === 0, gateFailureDetail(control.output))
      check(`${gate.name}: mutation anchor found in evidence`, backup.includes(gate.mutateEvidence.from))
      writeFileSync(evPath, backup.replace(gate.mutateEvidence.from, gate.mutateEvidence.to))
      const mutated = runGate(gate.script, gate.name === "m35-c1-baseline-tamper" ? { BB_M35_CORPUS_CHECK_ONLY: "1" } : {})
      check(`${gate.name}: mutation — corrupted evidence FAILS the gate`, mutated.exit !== 0, gateFailureDetail(mutated.output))
      gateResults.push({ name: gate.name, script: gate.script, mutationFailed: mutated.exit !== 0, controlPassed: control.exit === 0 })
    } finally {
      writeFileSync(evPath, backup)
    }
    check(`${gate.name}: evidence restored byte-identical`, readFileSync(evPath, "utf8") === backup)
    continue
  }

  const sandbox = mkdtempSync(path.join(tmpdir(), "bb-m35-selftest-"))
  try {
    for (const s of gate.surfaces) {
      mkdirSync(path.dirname(path.join(sandbox, s.to)), { recursive: true })
      copyFileSync(path.join(ROOT, s.from), path.join(sandbox, s.to))
    }
    // Build the conforming sandbox world (M31 pattern): a COMPLETE milestone
    // world — all nine issues verified at ONE in-world stamp, evidence files
    // written for every code (whether or not they exist in the real tree yet),
    // ledger constructed from that evidence, self-test baseline proving all gates.
    const evDir = path.join(sandbox, "validation/m35/results")
    mkdirSync(evDir, { recursive: true })
    const stampSrc = path.join(evDir, "G1.json")
    const worldStamp = existsSync(stampSrc)
      ? (JSON.parse(readFileSync(stampSrc, "utf8")).currentCommit as string)
      : "0".repeat(40)
    const ALL_CODES = ["G1", "F1", "E1", "S1", "S2", "S3", "C1", "D1", "X1"]
    const issueNumbers: Record<string, number> = { G1: 579, F1: 580, E1: 581, S1: 582, S2: 583, S3: 584, C1: 585, D1: 586, X1: 587 }
    const worldLedger = ALL_CODES.map((code) => {
      const ev = {
        status: "verified", currentCommit: worldStamp, workingTreeRelevantChanges: [] as string[],
        verifierCommand: `bun run script/m35/verify-${code.toLowerCase()}.ts`, evidenceFile: `${code}.json`,
        generatedAt: new Date().toISOString(), passed: 1, failed: 0, negativeCases: 1,
      }
      writeFileSync(path.join(evDir, `${code}.json`), JSON.stringify(ev, null, 2) + "\n")
      return { code, githubIssue: issueNumbers[code], tool: code.toLowerCase(), status: "verified",
        scope: "conforming-world", acceptanceCriteria: ["a", "b"], closureRequirements: ["c", "d"],
        evidence: { ...ev } }
    })
    const stPath = path.join(evDir, "gate-selftest.json")
    const REQUIRED_GATES = ["verify-governance.ts", "verify-gate-selftest.ts", "verify-freshness-core.ts", "verify-envelope-contract.ts", "verify-s1-read-paths.ts", "verify-s2-derived.ts", "verify-s3-graph-migrate.ts", "staleness-corpus.ts", "verify-docs-staleness.ts", "verify-closure.ts"]
    // Conforming-world selftest evidence uses the CURRENT entry shape: each
    // gate carries its script path so governance's closure-claimed check can
    // match proven mutations by script (infra gates are exempt there).
    const gatesAllProven = REQUIRED_GATES.map((g) => ({ name: `m35-${g.replace(".ts", "")}`, script: `script/m35/${g}`, mutationFailed: true, controlPassed: true }))
    writeFileSync(stPath, JSON.stringify({
      status: "verified", currentCommit: worldStamp, workingTreeRelevantChanges: [],
      verifierCommand: "bun run script/m35/verify-gate-selftest.ts", evidenceFile: "gate-selftest.json",
      generatedAt: new Date().toISOString(), passed: gatesAllProven.length, failed: 0,
      negativeCases: gatesAllProven.length, gates: gatesAllProven,
    }, null, 2) + "\n")
    // The conforming world claims closure (all verified), so its package.json
    // must carry the FULL gate wiring — governance enforces exactly that.
    const pkgPath = path.join(sandbox, "package.json")
    const sandboxPkg = JSON.parse(readFileSync(pkgPath, "utf8"))
    const missingWiring = REQUIRED_GATES.filter((g) => !String(sandboxPkg.scripts["verify"] ?? "").includes(`script/m35/${g}`))
    sandboxPkg.scripts["verify"] = String(sandboxPkg.scripts["verify"] ?? "") + (missingWiring.length ? " && " + missingWiring.map((g) => `bun run script/m35/${g}`).join(" && ") : "")
    writeFileSync(pkgPath, JSON.stringify(sandboxPkg, null, 2) + "\n")
    mkdirSync(path.join(sandbox, "validation/m35"), { recursive: true })
    writeFileSync(path.join(sandbox, "validation/m35/ledger.json"), JSON.stringify(worldLedger, null, 2) + "\n")
    const control = runGate(gate.script, { BB_M35_ROOT: sandbox })
    check(`${gate.name}: control — unmutated sandbox PASSES`, control.exit === 0, gateFailureDetail(control.output))
    // THEN plant the mutation and prove the gate flips to failing.
    gate.mutate(sandbox)
    const mutated = runGate(gate.script, { BB_M35_ROOT: sandbox })
    check(`${gate.name}: mutation — corrupted surface FAILS the gate`, mutated.exit !== 0, gateFailureDetail(mutated.output))
    gateResults.push({ name: gate.name, script: gate.script, mutationFailed: mutated.exit !== 0, controlPassed: control.exit === 0 })
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
}

mkdirSync(path.dirname(RESULT), { recursive: true })
let commit = "unknown"
try { commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim() } catch {}
if (process.env.BB_M35_EVIDENCE === "1") writeFileSync(RESULT, JSON.stringify({
  status: failed === 0 ? "verified" : "blocked",
  currentCommit: commit,
  workingTreeRelevantChanges: [],
  verifierCommand: "bun run script/m35/verify-gate-selftest.ts",
  evidenceFile: "gate-selftest.json",
  generatedAt: new Date().toISOString(),
  passed,
  failed,
  negativeCases: gateResults.length,
  gates: gateResults,
}, null, 2) + "\n")
console.log(`M35 GATE SELF-TEST: ${failed === 0 ? "PASS" : "FAIL"} (${passed}/${checks})`)
process.exit(failed === 0 ? 0 : 1)
