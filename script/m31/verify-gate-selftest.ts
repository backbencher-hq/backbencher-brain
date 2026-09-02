// script/m31/verify-gate-selftest.ts — M31.G1
// Mutation-based gate self-test: for every registered M31 gate, prove two
// things — (control) the gate PASSES on the clean tree, and (mutation) the gate
// FAILS when a governed surface is corrupted. A gate that cannot fail is not a
// gate. M31 gates honor BB_M31_ROOT (their declared test seam); the legacy
// byte-diff gate is exercised by planting + restoring against the real tree
// with a guaranteed restore in `finally`.

import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULT = path.join(ROOT, "validation/m31/results/gate-selftest.json")

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
  /** repo-relative files the gate reads that the mutation touches */
  surfaces: { from: string; to: string }[]
  mutate: (sandbox: string) => void
  /** legacy gates have no BB_M31_ROOT seam; they are exercised by plant+restore on the real tree */
  legacy?: boolean
  /** source-mutation gates plant a revert in a src file, run the gate, restore */
  mutateSource?: string
  mutatePattern?: { marker: string; until: string }
}

const GATES: GateSpec[] = [
  {
    name: "tool-mode-corpus",
    script: "script/m31/tool-mode-corpus.ts",
    surfaces: [],
    // Mutation: revert the visualize scoped-target validation (the exact
    // regression the corpus exists to catch). Control = --check passes on the
    // clean tree; mutation = --check must fail with named drift.
    mutate: () => {},
    mutateSource: "src/mcp/tool-validation.ts",
    mutatePattern: { marker: "  // M31.T1: scoped graphs require a target", until: "  // M31.T1: confidenceThreshold" },
  },
  {
    name: "m31-tool-docs-deep",
    script: "script/m31/verify-tool-docs-deep.ts",
    surfaces: [{ from: "docs/tools/bb_search.md", to: "docs/tools/bb_search.md" }],
    mutate: (sandbox) => {
      // Mutation A: advertise a mode the registry cannot execute.
      const p = path.join(sandbox, "docs/tools/bb_search.md")
      writeFileSync(p, readFileSync(p, "utf8").replace("- Modes: `symbols`, `content`, `symbol`, `file`", "- Modes: `symbols`, `content`, `symbol`, `file`, `teleport`"))
    },
  },
  {
    name: "m31-tool-docs-deep-badschema",
    script: "script/m31/verify-tool-docs-deep.ts",
    surfaces: [{ from: "docs/tools/bb_search.md", to: "docs/tools/bb_search.md" }],
    mutate: (sandbox) => {
      // Mutation B: make an example violate the schema (query: number instead of string).
      const p = path.join(sandbox, "docs/tools/bb_search.md")
      writeFileSync(p, readFileSync(p, "utf8").replace('`{"mode":"symbols","query":"handleRequest","limit":5}`', '`{"mode":"symbols","query":42,"limit":5}`'))
    },
  },
  {
    name: "m31-tool-docs-deep-stale",
    script: "script/verify-tool-docs.ts",
    legacy: true,
    surfaces: [{ from: "docs/tools/bb_search.md", to: "docs/tools/bb_search.md" }],
    mutate: (sandbox) => {
      // Mutation C (stale stamp): any doc drift must fail the byte gate that
      // D1's freshness check executes.
      const p = path.join(sandbox, "docs/tools/bb_search.md")
      writeFileSync(p, readFileSync(p, "utf8").replace("## Returns", "## Returns TAMPERED"))
    },
  },
  {
    name: "m31-bb-docs-truth-mode",
    script: "script/m31/verify-bb-docs-truth.ts",
    surfaces: [{ from: "docs/BB_VISUALIZE.md", to: "docs/BB_VISUALIZE.md" }],
    mutate: (sandbox) => {
      // Mutation A: advertise a fake scope in a mode list sentence.
      const p = path.join(sandbox, "docs/BB_VISUALIZE.md")
      writeFileSync(p, readFileSync(p, "utf8").replace("It supports `project`, `file`, `module`, `symbol`, and `feature` scopes.", "It supports `project`, `file`, `module`, `symbol`, `feature`, and `galaxy` scopes."))
    },
  },
  {
    name: "m31-bb-docs-truth-invocation",
    script: "script/m31/verify-bb-docs-truth.ts",
    surfaces: [{ from: "docs/BB_MIGRATE.md", to: "docs/BB_MIGRATE.md" }],
    mutate: (sandbox) => {
      // Mutation B: drop the required targetLanguage from a documented invocation.
      const p = path.join(sandbox, "docs/BB_MIGRATE.md")
      writeFileSync(p, readFileSync(p, "utf8").replace('"targetLanguage":"go",', ""))
    },
  },
  {
    name: "m31-bb-docs-truth-mutability",
    script: "script/m31/verify-bb-docs-truth.ts",
    surfaces: [{ from: "docs/BB_EDIT.md", to: "docs/BB_EDIT.md" }],
    mutate: (sandbox) => {
      // Mutation C: claim a WRITE tool (bb_edit, registry mutability=write) is
      // read-only — the mutability claim must fail against the registry.
      const p = path.join(sandbox, "docs/BB_EDIT.md")
      writeFileSync(p, readFileSync(p, "utf8").replace("# Unified Editing (M9.13)", "# Unified Editing (M9.13)\n\nThis tool is read-only."))
    },
  },
  {
    name: "tool-docs-generator",
    script: "script/verify-tool-docs.ts",
    legacy: true,
    surfaces: [{ from: "docs/tools/bb_search.md", to: "docs/tools/bb_search.md" }],
    mutate: (sandbox) => {
      const p = path.join(sandbox, "docs/tools/bb_search.md")
      writeFileSync(p, readFileSync(p, "utf8").replace("# `bb_search`", "# `bb_search` TAMPERED"))
    },
  },
  {
    name: "m31-governance",
    script: "script/m31/verify-governance.ts",
    // Governance reads the FULL governed surface — the sandbox must contain all of it:
    surfaces: [
      { from: "docs/m31/PLAN.md", to: "docs/m31/PLAN.md" },
      { from: "validation/m31/ledger.json", to: "validation/m31/ledger.json" },
      { from: "package.json", to: "package.json" },
      ...(existsSync(path.join(ROOT, "validation/m31/results/gate-selftest.json"))
        ? [{ from: "validation/m31/results/gate-selftest.json", to: "validation/m31/results/gate-selftest.json" }]
        : []),
      // verified ledger entries require their evidence files on disk (governance check 3):
      ...readdirSync(path.join(ROOT, "validation/m31/results"))
        .filter((f) => /^[A-Z][A-Za-z0-9-]*\.json$/.test(f))
        .map((f) => ({ from: `validation/m31/results/${f}`, to: `validation/m31/results/${f}` })),
      // governance audits the M31 verifier sources themselves (auto-pass grep):
      { from: "script/m31/verify-governance.ts", to: "script/m31/verify-governance.ts" },
      { from: "script/m31/verify-gate-selftest.ts", to: "script/m31/verify-gate-selftest.ts" },
    ],
    mutate: (sandbox) => {
      const p = path.join(sandbox, "docs/m31/PLAN.md")
      writeFileSync(p, readFileSync(p, "utf8").replace("src/mcp/tool-registry.ts", "src/REMOVED-AUTHORITY"))
    },
  },
]

// ── coverage: every m31 verifier must be covered here or declared infra ──
const INFRA = new Set(["verify-governance.ts", "verify-gate-selftest.ts", "sync-ledger.ts"])
const verifiers = readdirSync(path.join(ROOT, "script/m31")).filter((f) => f.startsWith("verify-") && f.endsWith(".ts"))
const covered = new Set(GATES.map((g) => path.basename(g.script)))
const uncovered = verifiers.filter((v) => !covered.has(v) && !INFRA.has(v))
check("every M31 verifier is covered by a mutation or declared infra", uncovered.length === 0, uncovered.join(","))

function runGate(script: string, env: Record<string, string> = {}): { exit: number; output: string } {
  try {
    const out = execFileSync("bun", ["run", script], { cwd: ROOT, encoding: "utf8", stdio: "pipe", env: { ...process.env, ...env } })
    return { exit: 0, output: out }
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number }
    return { exit: err.status ?? 1, output: String(err.stdout ?? "") + String(err.stderr ?? "") }
  }
}

const gateResults: { name: string; mutationFailed: boolean; controlPassed: boolean }[] = []
for (const gate of GATES) {
  check(`${gate.name}: gate script exists`, existsSync(path.join(ROOT, gate.script)), gate.script)
  if (!existsSync(path.join(ROOT, gate.script))) {
    gateResults.push({ name: gate.name, mutationFailed: false, controlPassed: false })
    continue
  }

  // Source-mutation gate: control (--check passes clean), plant a src revert,
  // gate must fail, restore byte-identical. Independent of the sandbox path.
  if (gate.mutateSource && gate.mutatePattern) {
    const srcPath = path.join(ROOT, gate.mutateSource)
    const backup = readFileSync(srcPath, "utf8")
    try {
      const control = runGate(gate.script, { BB_M31_CORPUS_CHECK_ONLY: "1" })
      check(`${gate.name}: control — clean tree PASSES`, control.exit === 0, control.output.slice(-200))
      const start = backup.indexOf(gate.mutatePattern.marker)
      const end = backup.indexOf(gate.mutatePattern.until)
      check(`${gate.name}: mutation markers found in source`, start !== -1 && end > start)
      if (start !== -1 && end > start) {
        writeFileSync(srcPath, backup.slice(0, start) + backup.slice(end))
        const mutated = runGate(gate.script, { BB_M31_CORPUS_CHECK_ONLY: "1" })
        check(`${gate.name}: mutation — reverted guard FAILS the gate`, mutated.exit !== 0, mutated.output.slice(-200))
        gateResults.push({ name: gate.name, mutationFailed: mutated.exit !== 0, controlPassed: control.exit === 0 })
      } else {
        gateResults.push({ name: gate.name, mutationFailed: false, controlPassed: control.exit === 0 })
      }
    } finally {
      writeFileSync(srcPath, backup)
    }
    check(`${gate.name}: source restored byte-identical`, readFileSync(srcPath, "utf8") === backup)
    continue
  }

  const sandbox = mkdtempSync(path.join(tmpdir(), "bb-m31-selftest-"))
  try {
    for (const s of gate.surfaces) {
      mkdirSync(path.dirname(path.join(sandbox, s.to)), { recursive: true })
      copyFileSync(path.join(ROOT, s.from), path.join(sandbox, s.to))
    }
    // Gates that read a whole docs/ directory need ALL files of it in the sandbox.
    const docDirs = ["docs/tools", "docs"]
    for (const dir of docDirs) {
      if (gate.surfaces.some((s) => s.to.startsWith(dir + "/")) && gate.surfaces.length === 1) {
        mkdirSync(path.join(sandbox, dir), { recursive: true })
        for (const f of readdirSync(path.join(ROOT, dir))) {
          if (!/\.md$/.test(f)) continue
          copyFileSync(path.join(ROOT, dir, f), path.join(sandbox, dir, f))
        }
      }
    }

    if (gate.legacy) {
      // Control: clean tree passes.
      const control = runGate(gate.script)
      check(`${gate.name}: control — clean tree PASSES`, control.exit === 0, control.output.slice(-200))
      // Mutation: plant the corrupted file in the real tree, run, RESTORE.
      gate.mutate(sandbox) // corrupt the sandboxed copy first (legacy has no sandbox seam)
      const realPath = path.join(ROOT, gate.surfaces[0].from)
      const backup = readFileSync(realPath, "utf8")
      try {
        writeFileSync(realPath, readFileSync(path.join(sandbox, gate.surfaces[0].to), "utf8"))
        const mutated = runGate(gate.script)
        check(`${gate.name}: mutation — corrupted doc FAILS the gate`, mutated.exit !== 0, mutated.output.slice(-200))
        gateResults.push({ name: gate.name, mutationFailed: mutated.exit !== 0, controlPassed: control.exit === 0 })
      } finally {
        writeFileSync(realPath, backup)
      }
      check(`${gate.name}: real tree restored byte-identical`, readFileSync(realPath, "utf8") === backup)
    } else {
      // The sandbox control world is "everything conforming": the selftest
      // evidence baseline records every registered gate as proven (mutation
      // fails, control passes). Governance must PASS this world.
      const stPath = path.join(sandbox, "validation/m31/results/gate-selftest.json")
      if (existsSync(stPath)) {
        writeFileSync(stPath, JSON.stringify({ generatedAt: new Date().toISOString(), gates: GATES.map((g) => ({ name: g.name, mutationFailed: true, controlPassed: true })) }, null, 2) + "\n")
      }
      // Control FIRST: unmutated sandbox passes.
      const control = runGate(gate.script, { BB_M31_ROOT: sandbox })
      check(`${gate.name}: control — unmutated sandbox PASSES`, control.exit === 0, control.output.slice(-200))
      // THEN plant the mutation and prove the gate flips to failing.
      gate.mutate(sandbox)
      const mutated = runGate(gate.script, { BB_M31_ROOT: sandbox })
      check(`${gate.name}: mutation — corrupted surface FAILS the gate`, mutated.exit !== 0, mutated.output.slice(-200))
      gateResults.push({ name: gate.name, mutationFailed: mutated.exit !== 0, controlPassed: control.exit === 0 })
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
}

mkdirSync(path.dirname(RESULT), { recursive: true })
writeFileSync(RESULT, JSON.stringify({ generatedAt: new Date().toISOString(), gates: gateResults }, null, 2) + "\n")
console.log(`M31 GATE SELF-TEST: ${failed === 0 ? "PASS" : "FAIL"} (${passed}/${checks})`)
process.exit(failed === 0 ? 0 : 1)
