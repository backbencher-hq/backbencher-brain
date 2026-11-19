// script/m71/verify-refactor-safety.ts — P0-1 GATE for bb_edit refactor safety.
//
// WHAT THIS FILE IS — the gate for the four stacked defects of triage ISSUE-01
//   (docs/bb-bettercap-triage/findings/ISSUE-01-unsafe-refactor.md):
//   (A) caller-span attribution (a `calls` row sourced at a 12-byte module/package
//       symbol instead of the enclosing function) must not shrink the rename window;
//   (B) package/namespace-qualified references (Go `pkg.F`, TS `import * as ns; ns.f`)
//       are references, not member names, and must be renamed — while a member of a
//       value receiver (`obj.method`) stays untouched;
//   (C) a caller-evidenced file that yields zero renamed sites must refuse (or report
//       every skipped site by file:line) — never a silent success;
//   (D) a pre-commit verification step must reparse every planned file, run an
//       unresolved-identifier scan, and (when a cheap toolchain exists) build the
//       changed compilation units, refusing with the toolchain's own output.
//
// RED BEFORE THE FIX (recorded in docs/bb-bettercap-fix/evidence/edit-safety/):
//   G1/G2 fail (qualified callers never renamed), G6 fails (silent success over
//   injected evidence), G7 fails (post-commit `go build ./...` reports the old name).
//   G3 fails (TS namespace import untouched). G4/G5 are controls and pass both ways.
//
// Run: npx tsx script/m71/verify-refactor-safety.ts
//   BB_DATA_DIR must point at a writable dir: the sandbox cannot create
//   ~/.bb/projects/<hash>. `--only=G1` (or GATE_CASE=G1) runs one case.
// Exit: 0 only when every case's assertions hold.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { executeEdit } from "../../src/intelligence/edit/edit-engine"

type Outcome = {
  ok: boolean
  summary?: { renamedFiles: number; renamedSites: number }
  warnings?: string[]
  changes: { path: string; before: string; after: string }[]
  verification?: unknown
}

class Harness {
  failures: string[] = []
  passes = 0
  constructor(readonly root: string) {}
  ok(name: string, condition: boolean, detail = ""): void {
    if (condition) {
      this.passes++
      console.log(`  PASS ${name}${detail ? ` — ${detail}` : ""}`)
    } else {
      this.failures.push(`${name}${detail ? `: ${detail}` : ""}`)
      console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`)
    }
  }
  fail(name: string, detail: string): void {
    this.failures.push(`${name}: ${detail}`)
    console.log(`  FAIL ${name} — ${detail}`)
  }
  eq(name: string, actual: unknown, expected: unknown): void {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a === e) this.ok(name, a)
    else this.fail(name, `expected ${e}, got ${a}`)
  }
  contains(name: string, haystack: string, needle: string): void {
    if (haystack.includes(needle)) this.ok(name, JSON.stringify(needle))
    else this.fail(name, `missing ${JSON.stringify(needle)} in ${JSON.stringify(haystack.slice(0, 400))}`)
  }
  notContains(name: string, haystack: string, needle: string): void {
    if (!haystack.includes(needle)) this.ok(name, `absent ${JSON.stringify(needle)}`)
    else this.fail(name, `unexpected ${JSON.stringify(needle)} in ${JSON.stringify(haystack.slice(0, 400))}`)
  }
}

const onlyArg = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length) ?? process.env.GATE_CASE
const write = (root: string, rel: string, content: string): void => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  writeFileSync(path.join(root, rel), content)
}
const read = (root: string, rel: string): string => readFileSync(path.join(root, rel), "utf8")

async function freshProject(prefix: string, files: Record<string, string>): Promise<{ root: string; projectId: string }> {
  const root = mkdtempSync(path.join(tmpdir(), `bb-refactor-safety-${prefix}-`))
  for (const [rel, content] of Object.entries(files)) write(root, rel, content)
  const projectId = getProjectId(root)
  await indexProjectParallel(projectId, root, {})
  return { root, projectId }
}

function cleanup(root: string, projectId: string): void {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

async function plan(root: string, projectId: string, symbolName: string, filePath: string, newName: string, dryRun = true): Promise<Outcome> {
  // dryRun keeps the plan observable without mutating the fixture; the commit cases
  // call again with dryRun=false.
  const result: any = await executeEdit(root, projectId, {
    mode: "refactor",
    symbolName,
    newName,
    filePath,
    format: false,
    dryRun,
  } as any)
  return result as Outcome
}

async function caseG1GoQualified(h: Harness): Promise<void> {
  console.log("── G1 go: package-qualified caller modules.LoadModules (report shape)")
  const files = {
    "go.mod": "module example.com/g1\n\ngo 1.21\n",
    "modules/modules.go": "package modules\n\nfunc LoadModules() {}\n",
    "modules/extra.go": "package modules\n\nfunc Use() { LoadModules() }\n",
    "main.go": 'package main\n\nimport "example.com/g1/modules"\n\nfunc main() { modules.LoadModules() }\n',
  }
  const { root, projectId } = await freshProject("g1", files)
  try {
    let planOut: Outcome
    try {
      planOut = await plan(root, projectId, "LoadModules", "modules/modules.go", "LoadModulesRenamed")
    } catch (e: any) {
      h.fail("G1 plan succeeded", `threw ${e?.message}`)
      return
    }
    const byPath = new Map(planOut.changes.map((c) => [path.resolve(c.path), c]))
    h.eq("G1 files planned", planOut.summary, { renamedFiles: 3, renamedSites: 3 })
    const mainChange = byPath.get(path.resolve(root, "main.go"))
    h.ok("G1 main.go in plan", !!mainChange, mainChange ? "present" : "MISSING")
    if (mainChange) {
      h.contains("G1 main.go qualified site renamed", mainChange.after, "modules.LoadModulesRenamed()")
      h.notContains("G1 main.go old qualified name gone", mainChange.after, "modules.LoadModules()")
    }
    const extraChange = byPath.get(path.resolve(root, "modules/extra.go"))
    h.ok("G1 CONTROL same-package unqualified call renamed", !!extraChange, extraChange ? "present" : "MISSING")
    if (extraChange) h.contains("G1 control text", extraChange.after, "LoadModulesRenamed()")
    // control: declaration still renamed
    const decl = byPath.get(path.resolve(root, "modules/modules.go"))
    if (decl) h.contains("G1 declaration renamed", decl.after, "func LoadModulesRenamed()")
  } finally {
    cleanup(root, projectId)
  }
}

async function caseG2PackageMain(h: Harness): Promise<void> {
  console.log("── G2 go: package-main attribution (module/function name collision)")
  const files = {
    "go.mod": "module example.com/g2\n\ngo 1.21\n",
    "modules/modules.go": "package modules\n\nfunc LoadModules() {}\n",
    "main.go": [
      "package main",
      "",
      'import "example.com/g2/modules"',
      "",
      "func run() { modules.LoadModules() }",
      "",
      "func main() {",
      "\trun()",
      "\tmodules.LoadModules()",
      "}",
      "",
    ].join("\n"),
  }
  const { root, projectId } = await freshProject("g2", files)
  try {
    let planOut: Outcome
    try {
      planOut = await plan(root, projectId, "LoadModules", "modules/modules.go", "LoadModulesRenamed")
    } catch (e: any) {
      h.fail("G2 plan succeeded", `threw ${e?.message}`)
      return
    }
    const mainChange = planOut.changes.find((c) => path.resolve(c.path) === path.resolve(root, "main.go"))
    h.ok("G2 main.go caller file planned despite module-symbol attribution", !!mainChange, mainChange ? "present" : "MISSING")
    if (mainChange) {
      h.eq("G2 both qualified call sites renamed", (mainChange.after.match(/modules\.LoadModulesRenamed\(\)/g) ?? []).length, 2)
      h.notContains("G2 old qualified name gone", mainChange.after, "modules.LoadModules()")
    }
  } finally {
    cleanup(root, projectId)
  }
}

async function caseG3TsNamespace(h: Harness): Promise<void> {
  console.log("── G3 ts: namespace import (import * as m; m.target())")
  const files = {
    "src/a.ts": "export function target(): number {\n  return 1\n}\n",
    "src/b.ts": "import * as m from './a'\nexport const n = m.target()\n",
  }
  const { root, projectId } = await freshProject("g3", files)
  try {
    let planOut: Outcome
    try {
      planOut = await plan(root, projectId, "target", "src/a.ts", "renamedTarget")
    } catch (e: any) {
      h.fail("G3 plan succeeded", `threw ${e?.message}`)
      return
    }
    const b = planOut.changes.find((c) => path.resolve(c.path) === path.resolve(root, "src/b.ts"))
    h.ok("G3 namespace-import caller planned", !!b, b ? "present" : "MISSING")
    if (b) {
      h.contains("G3 qualified site renamed", b.after, "m.renamedTarget()")
      h.notContains("G3 old member name gone", b.after, "m.target()")
    }
  } finally {
    cleanup(root, projectId)
  }
}

async function caseG4ValueReceiverControl(h: Harness): Promise<void> {
  console.log("── G4 CONTROL: value-receiver member obj.target() must NOT be renamed")
  const files = {
    "src/a.ts": "export function target(): number {\n  return 1\n}\n",
    "src/b.ts": "import { target } from './a'\nexport const n = target()\n",
    "src/c.ts":
      "class Box {\n  target(): number {\n    return 2\n  }\n}\nexport const box = new Box()\nexport const v = box.target()\n",
  }
  const { root, projectId } = await freshProject("g4", files)
  try {
    let planOut: Outcome
    try {
      planOut = await plan(root, projectId, "target", "src/a.ts", "renamedTarget")
    } catch (e: any) {
      h.fail("G4 plan succeeded (a legitimate declaration rename)", `threw ${e?.message}`)
      return
    }
    const c = planOut.changes.find((ch) => path.resolve(ch.path) === path.resolve(root, "src/c.ts"))
    h.ok("G4 CONTROL unrelated member file untouched", c === undefined, c ? `CHANGED: ${JSON.stringify(c.after)}` : "unchanged")
    // and the genuine named-import call site still renames
    const b = planOut.changes.find((ch) => path.resolve(ch.path) === path.resolve(root, "src/b.ts"))
    h.ok("G4 CONTROL named-import call renamed", !!b, b ? "present" : "MISSING")
    if (b) h.contains("G4 control text", b.after, "renamedTarget()")
  } finally {
    cleanup(root, projectId)
  }
}

async function caseG6ZeroSiteRefusal(h: Harness): Promise<void> {
  console.log("── G6 caller-evidenced file with ZERO sites must refuse")
  const files = {
    "go.mod": "module example.com/g6\n\ngo 1.21\n",
    "modules/modules.go": "package modules\n\nfunc LoadModules() {}\n",
    "main.go": 'package main\n\nimport "example.com/g6/modules"\n\nfunc main() { modules.LoadModules() }\n',
    "orphan.go": "package main\n\nfunc other() {}\n",
  }
  const { root, projectId } = await freshProject("g6", files)
  try {
    const raw: any = await BrainDatabase.getRawInstance(projectId as any)
    const decl: any = raw
      .prepare("SELECT id FROM brain_symbol WHERE name = ? AND file_id = ?")
      .get("LoadModules", `${projectId}:modules/modules.go`)
    const src: any = raw
      .prepare("SELECT id, line_start FROM brain_symbol WHERE name = ? AND file_id = ?")
      .get("other", `${projectId}:orphan.go`)
    if (!decl?.id || !src?.id) {
      h.fail("G6 setup", `could not resolve symbols decl=${JSON.stringify(decl)} src=${JSON.stringify(src)}`)
      return
    }
    // Simulate the class the triage measured: an index row claims a call from a file
    // that contains no occurrence of the name (stale/misbound edge — P0-2 class).
    const now = Date.now()
    raw
      .prepare(
        "INSERT OR REPLACE INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, line_number, metadata, is_cross_language, time_created, time_updated) " +
          "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(`${projectId}:rel:gate-g6`, projectId, src.id, decl.id, "calls", 0.8, src.line_start ?? 3, "{}", 0, now, now)
    let outcome = "ok"
    let error = ""
    try {
      const res = await plan(root, projectId, "LoadModules", "modules/modules.go", "LoadModulesRenamed")
      outcome = res ? "ok" : "ok"
      // A plan may succeed only if it NAMES the unrenamable evidence (skipped sites / warning).
      const named =
        (res.warnings ?? []).some((w) => w.includes("orphan.go")) ||
        JSON.stringify((res as any).summary ?? {}).includes("orphan.go")
      if (!named) outcome = "silent-success"
    } catch (e: any) {
      outcome = "refused"
      error = e?.message ?? String(e)
    }
    h.eq("G6 outcome is a refusal (or an explicitly-named survivor)", outcome, "refused")
    if (outcome === "refused") h.contains("G6 refusal names the evidence file", error, "orphan.go")
  } finally {
    cleanup(root, projectId)
  }
}

function goEnv(root: string): NodeJS.ProcessEnv {
  // The sandbox's ~/.cache/go-build is read-only; a gate fixture owns its cache.
  return { ...process.env, GOCACHE: path.join(root, ".gocache"), GOPATH: path.join(root, ".gopath"), GOPROXY: "off", GOFLAGS: "-mod=mod" }
}

async function caseG7BuildGate(h: Harness): Promise<void> {
  console.log("── G7 plan→apply→`go build ./...`: the plan must be build-complete (compile verdict)")
  const files = {
    "go.mod": "module example.com/g7\n\ngo 1.21\n",
    "modules/modules.go": "package modules\n\nfunc LoadModules() {}\n",
    "main.go": 'package main\n\nimport "example.com/g7/modules"\n\nfunc main() { modules.LoadModules() }\n',
  }
  // Phase 1 — the PLAN is the claim: apply exactly the bytes it says it will write,
  // then compile. This is the user-visible symptom ("applying it would not compile"):
  // a plan that misses the qualified caller fails THIS assertion with the compiler's
  // own `undefined: modules.LoadModules`, pre-fix, without depending on commit
  // mechanics. Post-fix the plan includes main.go and the build passes.
  {
    const { root, projectId } = await freshProject("g7plan", files)
    try {
      const planOut = await plan(root, projectId, "LoadModules", "modules/modules.go", "LoadModulesRenamed")
      h.ok("G7 plan includes the qualified caller file", planOut.changes.some((c) => path.resolve(c.path) === path.resolve(root, "main.go")), JSON.stringify(planOut.changes.map((c) => c.path)))
      for (const change of planOut.changes) writeFileSync(path.resolve(change.path), change.after, "utf8")
      let buildOk = true
      let buildErr = ""
      try {
        execFileSync("go", ["build", "./..."], { cwd: root, stdio: "pipe", timeout: 60_000, env: goEnv(root) })
      } catch (e: any) {
        buildOk = false
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        buildErr = `${e?.stderr ?? ""}${e?.stdout ?? ""}`.trim().slice(0, 600) || String(e?.message)
      }
      h.ok("G7 plan-applied tree compiles", buildOk, buildOk ? "go build ./... exit 0" : `go build FAILED: ${buildErr}`)
    } finally {
      cleanup(root, projectId)
    }
  }
  // Phase 2 — the COMMIT declares its verification, and the committed tree compiles.
  {
    const { root, projectId } = await freshProject("g7commit", files)
    try {
      let commit: Outcome | null = null
      let commitError = ""
      try {
        commit = await plan(root, projectId, "LoadModules", "modules/modules.go", "LoadModulesRenamed", false)
      } catch (e: any) {
        commitError = e?.message ?? String(e)
      }
      h.ok("G7 commit succeeds on a build-complete plan", commit !== null, commitError || "committed")
      if (commit) {
        h.ok("G7 verification declared", !!commit.verification, commit.verification ? JSON.stringify(commit.verification).slice(0, 300) : "MISSING")
        let buildOk = true
        let buildErr = ""
        try {
          execFileSync("go", ["build", "./..."], { cwd: root, stdio: "pipe", timeout: 60_000, env: goEnv(root) })
        } catch (e: any) {
          buildOk = false
          buildErr = `${e?.stderr ?? ""}${e?.stdout ?? ""}`.trim().slice(0, 600) || String(e?.message)
        }
        h.ok("G7 post-commit `go build ./...`", buildOk, buildOk ? "exit 0" : `FAILED: ${buildErr}`)
      }
    } finally {
      cleanup(root, projectId)
    }
  }
}

async function manager(): Promise<void> {
  if (!process.env.BB_DATA_DIR) {
    console.error("BB_DATA_DIR must point at a writable scratch dir (sandbox cannot create ~/.bb/projects/<hash>)")
    process.exit(2)
  }
  const cases: [string, (h: Harness) => Promise<void>][] = [
    ["G1", caseG1GoQualified],
    ["G2", caseG2PackageMain],
    ["G3", caseG3TsNamespace],
    ["G4", caseG4ValueReceiverControl],
    ["G6", caseG6ZeroSiteRefusal],
    ["G7", caseG7BuildGate],
  ]
  const failures: string[] = []
  let passes = 0
  for (const [id, run] of cases) {
    if (onlyArg && onlyArg !== id) continue
    const h = new Harness(process.cwd())
    try {
      await run(h)
    } catch (e: any) {
      h.fail(`${id} unexpected`, e?.stack ?? String(e))
    }
    passes += h.passes
    failures.push(...h.failures.map((f) => `${id} ${f}`))
  }
  console.log(`\n${passes} passed, ${failures.length} failed`)
  if (failures.length > 0) {
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(1)
  }
}

manager().catch((e) => {
  console.error(e)
  process.exit(2)
})
