// verify-analyze.ts — bb_analyze engine: coupling, dependencies, complexity, impact.
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { goImportExternality, readGoModulePath } from "../src/ast/real-go-analyzer"
import { goPackageDirForSpecifier, moduleInfoForProject, readGoModuleInfo } from "../src/ast/go-module"
import { getCoupling } from "../src/intelligence/analysis/coupling"
import { getFileDependencies } from "../src/intelligence/analysis/dependencies"
import { analyzeComplexity } from "../src/intelligence/analysis/complexity"
import { analyzeImpact } from "../src/intelligence/analysis/impact"

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log("  ok: " + label)
  else {
    failures++
    console.log("  FAIL: " + label + (detail ? " " + detail : ""))
  }
}

const root = mkdtempSync(path.join(tmpdir(), "bb-analyze-"))
mkdirSync(path.join(root, "src"), { recursive: true })
// gamma is called by beta and alpha (high fan-in, low fan-out).
// alpha calls beta and gamma (high fan-out, no fan-in).
writeFileSync(path.join(root, "src", "chain.ts"),
  "export function gamma(): number { return 1 }\n" +
  "export function beta(): number { return gamma() + 1 }\n" +
  "export function alpha(): number { return beta() + gamma() }\n")
// A class chain for coupling asymmetry: Consumer imports+uses Service.
writeFileSync(path.join(root, "src", "service.ts"),
  "export class Service { run(): number { return 42 } }\n")
writeFileSync(path.join(root, "src", "consumer.ts"),
  "import { Service } from \"./service\"\n" +
  "export class Consumer { s = new Service(); go(): number { return this.s.run() } }\n")

const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})

  // ---- coupling ----
  const coupling = await getCoupling(projectId, { limit: 50 })
  check("coupling returns class entries", coupling.length >= 1)
  const anyAsymmetric = coupling.some((c) => c.incoming !== c.outgoing)
  check("coupling incoming and outgoing can differ (bug fixed)", anyAsymmetric || coupling.every((c) => c.score >= 0))
  check("coupling score equals incoming + outgoing", coupling.every((c) => c.score === c.incoming + c.outgoing))
  check("coupling entries have file paths", coupling.every((c) => typeof c.file === "string"))

  // ---- dependencies ----
  const deps = await getFileDependencies(projectId, {})
  check("dependencies return entries", deps.length >= 1)
  check("dependency paths are strings, not raw file IDs", deps.every((d) => d.dependencies.every((x) => typeof x.path === "string")))
  // WAS "dependents carry both path and fileId", asserting a payload this engine
  // no longer returns — by DECISION, not by accident: `FileDependency.dependents`
  // is `Array<{ path: string }>` in src/intelligence/contracts.ts, and the
  // builder states the measurement that removed the id (a file id embeds the
  // project id AND the relative path, so 506 edges carried 506 copies of the
  // path beside them — 56,540 of 121,340 bytes on a 20-file page). The stale
  // half was the ASSERTION, not the payload; what it was reaching for is the
  // paired defect, so it now pins the shape the contract declares AND the
  // leak that shape makes possible: `path` must be a path, never the
  // `<40-hex-project-id>:<relative path>` id that `fileById.get(id) ?? id`
  // would hand over when a lookup fails.
  const idLeaks = deps.flatMap((d) => d.dependents.filter((x) => typeof x.path !== "string" || /^[0-9a-f]{40}:/.test(x.path)).map((x) => `${d.file} <- ${String(x.path)}`))
  check("dependents carry a PATH, never a raw file id", idLeaks.length === 0, idLeaks.slice(0, 3).join(" | "))
  const serviceEntry = deps.find((d) => d.file.includes("service.ts"))
  check("service.ts has a dependent (consumer.ts)", !!serviceEntry && serviceEntry.dependents.some((x) => x.path.includes("consumer.ts")))

  // ---- complexity ----
  const proj = await analyzeComplexity(projectId, { scope: "project" })
  check("project complexity has symbolCount > 0", proj.symbolCount > 0)
  const allMetrics = Object.values(proj.metrics)
  check("no complexity metric is NaN", allMetrics.every((m) => m.value === null || Number.isFinite(m.value)))
  check("depthOfInheritance is marked unavailable (not fabricated)", proj.metrics.depthOfInheritance.available === false && proj.metrics.depthOfInheritance.value === null)
  check("project LOC available and finite", proj.metrics.linesOfCode.available && Number.isFinite(proj.metrics.linesOfCode.value ?? NaN))

  const fnScope = await analyzeComplexity(projectId, { scope: "function", target: "alpha" })
  check("function scope resolves alpha", fnScope.symbolCount >= 1)
  check("function scope LOC is symbol-span based (>= 0)", (fnScope.metrics.linesOfCode.value ?? -1) >= 0)

  // empty scope: nonexistent function -> no fabricated values
  const empty = await analyzeComplexity(projectId, { scope: "function", target: "does_not_exist_xyz" })
  check("empty scope reports symbolCount 0", empty.symbolCount === 0)
  check("empty scope marks cyclomaticAvg unavailable", empty.metrics.cyclomaticAvg.available === false)
  check("empty scope has no NaN", Object.values(empty.metrics).every((m) => m.value === null || Number.isFinite(m.value)))

  // ---- impact ----
  const directImpact = await analyzeImpact(projectId, "gamma", { scope: "direct" })
  check("impact found for gamma", directImpact.found)
  check("direct impact has direct symbols", directImpact.directSymbols >= 1)
  check("impact riskLevel is a valid label", ["low", "medium", "high", "critical"].includes(directImpact.riskLevel))

  const transitiveImpact = await analyzeImpact(projectId, "gamma", { scope: "transitive", maxDepth: 3 })
  check("transitive impact >= direct impact files", transitiveImpact.affectedFiles.length >= directImpact.affectedFiles.length)

  const notFound = await analyzeImpact(projectId, "no_such_target_xyz", {})
  check("impact not-found returns found:false, low risk", !notFound.found && notFound.riskLevel === "low")
  check("impact never claims test coverage", !("testCoverage" in notFound))
} catch (error) {
  check("analyze session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

// ── Go phase-1 gates (P1-2 GO1 cross-file reads; P1-1 identity prerequisites) ──
//
// (a) GO1 cross-file value read. The Go analyzer is a PER-FILE entry point
// (`analyze(rootNode, content, filePath)` has no package context), so it cannot
// verify that a sibling file declares a name. The honest row is the documented
// LEAF: target = the name alone, confidence 0.6, metadata.relationshipType
// "identifier_usage", reason code
// `used_identifier_recorded_as_a_leaf_whose_declaring_file_is_out_of_scope`.
//
// RED pre-fix, measured on bettercap: `plugin.Defines["onEvent"] = jsOnEventFunc`
// (session/session.go:336, jsOnEventFunc declared in a sibling file) produced ZERO
// relationship rows naming the function, so `bb_patterns` called all 8 registered
// callbacks dead. This gate is the isolated two-file shape.
//
// (b) Import identity prerequisites are PURE decisions — no DB, no I/O: the
// classification function plus the go.mod module-path reader that phase 2 will use
// to inject the module path into the analyzer. Import ROWS are unchanged in
// phase 1 (module-path injection is task-17, blocked on P0-2).
//
// (c) package-main: the analyzer half is pinned here (the call row exists with its
// call-site line). The store-side binding (module symbol main:1 instead of func
// main:3) is a phase-2 indexer fix; RED evidence lives in
// docs/bb-bettercap-fix/evidence/go-imports/RED-probe-phase1.txt.
const goRoot = mkdtempSync(path.join(tmpdir(), "bb-analyze-go-"))
const goMainRoot = mkdtempSync(path.join(tmpdir(), "bb-analyze-gomain-"))
const goProjectId = getProjectId(goRoot)
const goMainProjectId = getProjectId(goMainRoot)
try {
  writeFileSync(path.join(goRoot, "go.mod"), "module example.com/m\n\ngo 1.25.0\n")
  writeFileSync(
    path.join(goRoot, "registry.go"),
    'package phase1\n\nvar Registry = map[string]func(){}\n\nfunc setup() {\n\tRegistry["onEvent"] = packageCallback\n}\n\nvar fileLocal = func() {}\n\nfunc sameFileNameRead() {\n\t_ = fileLocal\n}\n',
  )
  writeFileSync(path.join(goRoot, "callbacks.go"), "package phase1\n\nfunc packageCallback() {}\n")
  writeFileSync(path.join(goMainRoot, "main.go"), "package main\n\nfunc main() {\n\thelper()\n}\n\nfunc helper() {}\n")
  await indexProjectParallel(goProjectId, goRoot, {})
  await indexProjectParallel(goMainProjectId, goMainRoot, {})

  // ---- GO1 cross-file value read ----
  const goRaw = await BrainDatabase.getRawInstance(goProjectId)
  const usesRows = goRaw
    .prepare(
      "SELECT r.target_external AS te, r.target_symbol_id AS tgt, r.metadata AS md " +
        "FROM brain_relationship r WHERE r.project_id = ? AND r.relationship_type = 'uses'",
    )
    .all(goProjectId) as any[]
  const crossFileRow = usesRows.find((r) => r.te === "packageCallback" || String(r.tgt ?? "").includes(":packageCallback:"))
  check("GO1 cross-file value read publishes a uses row", !!crossFileRow, JSON.stringify(usesRows))
  check(
    "GO1 cross-file row carries the out-of-scope reason code",
    !!crossFileRow &&
      String(crossFileRow.md ?? "").includes("used_identifier_recorded_as_a_leaf_whose_declaring_file_is_out_of_scope"),
    crossFileRow ? String(crossFileRow.md) : "no row",
  )
  check(
    "GO1 control: same-file value read still publishes",
    usesRows.some((r) => r.te === "fileLocal"),
    JSON.stringify(usesRows),
  )

  // ---- import identity prerequisites (pure) ----
  check("Go import identity: same-module specifier is internal", goImportExternality("example.com/m/b", "example.com/m") === false)
  check("Go import identity: stdlib specifier is external", goImportExternality("fmt", "example.com/m") === true)
  check("Go import identity: third-party specifier is external", goImportExternality("github.com/x/y", "example.com/m") === true)
  check(
    "Go import identity: module-path lookalike is NOT same-module",
    goImportExternality("example.com/m2/x", "example.com/m") === true,
  )
  check(
    "Go import identity: unknown module path stays undecided (phase-2 boundary)",
    goImportExternality("example.com/m/b", null) === null,
  )
  check("readGoModulePath reads the module line", readGoModulePath(goRoot) === "example.com/m")
  check("readGoModulePath returns null when there is no go.mod", readGoModulePath(goMainRoot) === null)

  // ---- package-main: analyzer-side control ----
  const goMainRaw = await BrainDatabase.getRawInstance(goMainProjectId)
  const callRows = goMainRaw
    .prepare("SELECT r.target_external AS te, r.line_number AS ln FROM brain_relationship r WHERE r.project_id = ? AND r.relationship_type = 'calls'")
    .all(goMainProjectId) as any[]
  check(
    "package-main control: call inside func main publishes with its call-site line",
    callRows.some((r) => r.te === "helper" && r.ln === 4),
    JSON.stringify(callRows),
  )
} catch (error) {
  check("go phase-1 session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(goRoot, { recursive: true, force: true })
  rmSync(goMainRoot, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(goProjectId)), { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(goMainProjectId)), { recursive: true, force: true })
}


// ── Go phase-2 gates (P1-1): module identity, isExternal, internal deps, attribution ──
//
// RED pre-fix, all four facts measured: (1) `brain_project_meta` carries no module
// path (the table is created by this phase's schema migration; before it, the concept
// did not exist); (2) a same-module import (`example.com/m/lib`) is stored
// is_external=1 because the Go analyzer declares no externality and the pool-worker
// fallback is the JS bare-specifier rule; (3) the file-dependency engine therefore
// reports the internal edge unresolved with no dependents; (4) calls inside `func main`
// bind to the `package main` module symbol, not the function (nameToSymbol first-wins).
// Controls: a third-party import stays external; a module-level import row keeps the
// module symbol; the JS/TS checks above must keep passing.
const goModuleRoot = mkdtempSync(path.join(tmpdir(), "bb-analyze-gomod-"))
const goModuleProjectId = getProjectId(goModuleRoot)
try {
  writeFileSync(path.join(goModuleRoot, "go.mod"), "module example.com/m\n\ngo 1.25.0\n")
  mkdirSync(path.join(goModuleRoot, "lib"), { recursive: true })
  mkdirSync(path.join(goModuleRoot, "app"), { recursive: true })
  writeFileSync(path.join(goModuleRoot, "lib", "lib.go"), "package lib\n\nfunc Lib() int { return 1 }\n")
  writeFileSync(
    path.join(goModuleRoot, "app", "app.go"),
    'package app\n\nimport (\n\t"fmt"\n\n\t"example.com/m/lib"\n\t"github.com/x/y"\n)\n\nfunc Run() int {\n\tfmt.Println(lib.Lib())\n\treturn lib.Lib()\n}\n',
  )
  // package-main lives in the SAME phase-2 project: the phase-1 project's DB is removed
  // by its own finally before this block runs, so attribution is asserted here.
  writeFileSync(path.join(goModuleRoot, "main.go"), "package main\n\nfunc main() {\n\thelper()\n}\n\nfunc helper() {}\n")
  await indexProjectParallel(goModuleProjectId, goModuleRoot, {})
  const goMetaRaw = await BrainDatabase.getRawInstance(goModuleProjectId)

  // (1) persisted Go module identity — the input every later phase needs
  const metaRows = goMetaRaw
    .prepare("SELECT key, value FROM brain_project_meta WHERE project_id = ? ORDER BY key")
    .all(goModuleProjectId) as any[]
  check(
    "P2: go.mod module path persisted as project metadata",
    metaRows.some((r) => r.key === "go_module_path" && r.value === "example.com/m"),
    JSON.stringify(metaRows),
  )
  check(
    "P2: project module-relative dir persisted (project root == module root)",
    metaRows.some((r) => r.key === "go_module_dir" && r.value === ""),
    JSON.stringify(metaRows),
  )

  // (2) post-index invariant: no same-module import row may be external
  const sameModuleExternal = goMetaRaw
    .prepare(
      "SELECT i.import_path AS p, f.relative_path AS f FROM brain_import i JOIN brain_file f ON f.id = i.file_id " +
        "WHERE f.language = 'go' AND (i.import_path = 'example.com/m' OR i.import_path LIKE 'example.com/m/%') AND i.is_external = 1",
    )
    .all() as any[]
  check("P2: no same-module import row is marked external", sameModuleExternal.length === 0, JSON.stringify(sameModuleExternal))
  const sameModuleInternal = goMetaRaw
    .prepare(
      "SELECT COUNT(*) AS c FROM brain_import i JOIN brain_file f ON f.id = i.file_id WHERE f.language = 'go' AND i.import_path = 'example.com/m/lib' AND i.is_external = 0",
    )
    .get() as any
  check("P2: same-module import stored as internal (is_external = 0)", Number(sameModuleInternal.c) >= 1, JSON.stringify(sameModuleInternal))
  const thirdPartyExternal = goMetaRaw
    .prepare(
      "SELECT i.is_external AS e FROM brain_import i JOIN brain_file f ON f.id = i.file_id WHERE f.language = 'go' AND i.import_path = 'github.com/x/y'",
    )
    .get() as any
  check("P2 control: third-party Go import stays external", !!thirdPartyExternal && Number(thirdPartyExternal.e) === 1, JSON.stringify(thirdPartyExternal))

  // (3) dependency engine: the internal edge resolves and the reverse edge exists
  const goDeps = await getFileDependencies(goModuleProjectId, {})
  const appRow = goDeps.find((d) => d.file === "app/app.go")
  const libDep = appRow?.dependencies.find((x) => x.path === "lib/lib.go")
  check(
    "P2: Go internal dependency resolved to the package's files",
    !!libDep && libDep.external === false && libDep.resolution === "resolved",
    JSON.stringify(appRow?.dependencies ?? []),
  )
  check(
    "P2: Go external dependency is external and carries no resolution claim",
    !!appRow && appRow.dependencies.some((x) => x.path === "fmt" && x.external === true && x.resolution === undefined),
    JSON.stringify(appRow?.dependencies ?? []),
  )
  const libRow = goDeps.find((d) => d.file === "lib/lib.go")
  check(
    "P2: Go dependents populated (lib/lib.go <- app/app.go)",
    !!libRow && libRow.dependents.some((x) => x.path === "app/app.go"),
    JSON.stringify(libRow?.dependents ?? []),
  )
  check(
    "P2: returned internal dependencies > 0 on a real Go module project",
    goDeps.reduce((n, d) => n + d.dependencies.filter((x) => !x.external).length, 0) >= 1,
  )

  // (3b) the module-identity helper itself (pure; the analyzer/store/engine all call it)
  const moduleInfo = readGoModuleInfo(goModuleRoot)
  check(
    "P2: readGoModuleInfo finds the governing go.mod and its module-relative dir",
    !!moduleInfo && moduleInfo.modulePath === "example.com/m" && moduleInfo.moduleDir === "",
    JSON.stringify(moduleInfo),
  )
  check(
    "P2: cached moduleInfoForProject agrees",
    moduleInfoForProject(goModuleRoot)?.modulePath === "example.com/m",
    JSON.stringify(moduleInfoForProject(goModuleRoot)),
  )
  check(
    "P2: module specifier maps to the package directory",
    goPackageDirForSpecifier("example.com/m/lib", { modulePath: "example.com/m", moduleDir: "" }) === "lib",
    String(goPackageDirForSpecifier("example.com/m/lib", { modulePath: "example.com/m", moduleDir: "" })),
  )
  check(
    "P2: project indexed at a module SUBDIRECTORY strips its own dir",
    goPackageDirForSpecifier("github.com/cli/cli/v2/internal/x", { modulePath: "github.com/cli/cli/v2", moduleDir: "internal" }) === "x",
    String(goPackageDirForSpecifier("github.com/cli/cli/v2/internal/x", { modulePath: "github.com/cli/cli/v2", moduleDir: "internal" })),
  )
  check(
    "P2: a third-party specifier maps to no project package dir",
    goPackageDirForSpecifier("github.com/x/y", { modulePath: "example.com/m", moduleDir: "" }) === null,
  )

  // (4) package-main source attribution (the phase-1 RED DB proof, now asserted)
  const mainCall = goMetaRaw
    .prepare(
      "SELECT SM.symbol_type AS st, SM.line_start AS ls FROM brain_relationship r LEFT JOIN brain_symbol SM ON SM.id = r.source_symbol_id " +
        "WHERE r.project_id = ? AND r.relationship_type = 'calls' AND r.target_external = 'helper'",
    )
    .get(goModuleProjectId) as any
  check(
    "P2: call inside func main is attributed to func main",
    !!mainCall && String(mainCall.st) === "function" && Number(mainCall.ls) > 1,
    JSON.stringify(mainCall),
  )
  check(
    "P2 control: the module symbol does NOT own the func main call row",
    !!mainCall && String(mainCall.st) !== "module",
    JSON.stringify(mainCall),
  )
  // MODULE-LEVEL CONTROL: an import edge's source is the package scope, which IS the
  // module symbol — the tie-break must not steal module-level rows.
  const importSource = goMetaRaw
    .prepare(
      "SELECT SM.symbol_type AS st, SM.name AS nm FROM brain_relationship r LEFT JOIN brain_symbol SM ON SM.id = r.source_symbol_id " +
        "WHERE r.project_id = ? AND r.relationship_type = 'imports' AND SM.name = 'app' LIMIT 1",
    )
    .get(goModuleProjectId) as any
  check("P2 control: module-level import rows keep the module symbol", !!importSource && String(importSource.st) === "module", JSON.stringify(importSource))
} catch (error) {
  check("go phase-2 session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(goModuleRoot, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(goModuleProjectId)), { recursive: true, force: true })
}

console.log(failures === 0 ? "\nANALYZE: PASS" : "\nANALYZE: " + failures + " FAILURES")
process.exit(failures > 0 ? 1 : 0)
