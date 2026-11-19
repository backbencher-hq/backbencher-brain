// verify-test-intel.ts — strict static test intelligence (mapping/gaps/impact).
//
// P1-3 (bettercap ISSUE-05): a stored `calls` row is NOT test evidence until the
// target is proven reachable from the test file. The measured defect: the Go
// analyzer records a package-qualified call as its bare leaf (`errors.New` →
// `New`) and the resolver binds that leaf to the project-wide lowest-id symbol,
// so `caplets/caplet_test.go:142` "called" `session.New` and `js/data_test.go`
// benchmarks "called" it too, at direct_call 0.85. This gate pins the exact
// measured row shapes as MUST-REJECT, and pins the legitimate shapes (same
// package, genuinely imported package) as MUST-ACCEPT.
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { testMapping, testGaps, testImpact } from "../src/intelligence/testing/test-intel"
import * as testIntelEngine from "../src/intelligence/testing/test-intel"

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log("  ok: " + label)
  else {
    failures++
    console.log("  FAIL: " + label + (detail ? " " + detail : ""))
  }
}

// ── P1-3 gate A: test-link VALIDATION (pure; no index required) ─────────────
//
// Fixture inputs are the measured bettercap rows of record
// (docs/bb-bettercap-triage/evidence/go-testintel/05-db-new-rows.txt) plus the
// positive controls that must keep working. The API under test is the exact
// function the mapping path calls per stored relationship row.
const engine: any = testIntelEngine

function validate(input: Record<string, unknown>): any {
  if (typeof engine.validateTestLink !== "function") return null
  return engine.validateTestLink(input)
}

function rejected(reason: string) {
  return (v: any) => !!v && v.ok === false && v.reason === reason
}
function accepted(v: any) {
  return !!v && v.ok === true
}

function validationGate(): void {
  console.log("\n[P1-3] test-link validation (mapping must not publish unvalidated evidence)")
  check("test-intel engine exports validateTestLink (validation capability)", typeof engine.validateTestLink === "function")

  if (typeof engine.validateTestLink !== "function") {
    // RED evidence: show WHAT the unvalidated path publishes today for the same rows
    // (the classifier the mapping path uses accepts the row unconditionally).
    const kinds: any = engine
    console.log("  current-defect snapshot: a stored `calls` row whose own metadata says")
    console.log("    isStdlib:true, callExpression:\"errors.New\" is classified direct_call at 0.85")
    console.log("    because DIRECT_TYPES = {calls, instantiates} has no reachability check.")
    void kinds
    return
  }

  const goTestImports = ["testing", "fmt"]
  // The measured row: caplets/caplet_test.go:142 TestCapletEvalError -> session.New
  // (caplet_test.go:157 `errors.New("test error")`; it never names session.New).
  const caplet = validate({
    relationshipType: "calls",
    targetExternal: "New",
    targetName: "New",
    targetFile: "session/session.go",
    testFile: "caplets/caplet_test.go",
    language: "go",
    metadata: { relationshipType: "go_function_call", callExpression: "errors.New", isPackageQualified: true, isStdlib: true, stdlibPath: "errors" },
    testImports: goTestImports,
  })
  check("MUST-REJECT: errors.New(...) in caplets/caplet_test.go is not evidence for session.New", rejected("external-stdlib-leaf")(caplet), JSON.stringify(caplet))

  // The measured row: js/data_test.go `vm := otto.New()` (external package, no isStdlib flag).
  const otto = validate({
    relationshipType: "calls",
    targetExternal: "New",
    targetName: "New",
    targetFile: "session/session.go",
    testFile: "js/data_test.go",
    language: "go",
    metadata: { relationshipType: "go_function_call", callExpression: "otto.New", isPackageQualified: true },
    testImports: ["testing", "strings", "encoding/base64", "github.com/robertkrimen/otto"],
  })
  check("MUST-REJECT: otto.New() in js/data_test.go is not evidence for session.New", rejected("qualified-call-target-is-a-leaf")(otto), JSON.stringify(otto))

  // The measured Lock/Unlock rows: modules/arp_spoof/arp_spoof_test.go locks an
  // embedded sync.Mutex (`m.Lock()`), which the resolver bound to session.(*Session).Lock.
  const mutexLock = validate({
    relationshipType: "calls",
    targetExternal: "Lock",
    targetName: "Lock",
    targetFile: "session/session.go",
    testFile: "modules/arp_spoof/arp_spoof_test.go",
    language: "go",
    metadata: { relationshipType: "go_function_call", callExpression: "m.Lock", isPackageQualified: true },
    testImports: ["sync", "testing", "github.com/bettercap/bettercap/v2/packets"],
  })
  check("MUST-REJECT: embedded sync.Mutex `m.Lock()` is not evidence for session.Lock", rejected("receiver-selector-unresolved")(mutexLock) || rejected("qualified-call-target-is-a-leaf")(mutexLock), JSON.stringify(mutexLock))

  // Same-named call in another package, unqualified: caplets_test calls New() but
  // the only indexed `New` is session.New.
  const crossPackageBare = validate({
    relationshipType: "calls",
    targetExternal: "New",
    targetName: "New",
    targetFile: "session/session.go",
    testFile: "caplets/caplet_test.go",
    language: "go",
    metadata: { relationshipType: "go_function_call", callExpression: "New" },
    testImports: ["testing"],
  })
  check("MUST-REJECT: bare New() in another package is not evidence for session.New", rejected("cross-package-unreachable")(crossPackageBare), JSON.stringify(crossPackageBare))

  // POSITIVE CONTROL 1: same Go package, genuine call.
  // session/session_test.go tests session.ParseCommands, declared in session/session_parse.go.
  const samePackage = validate({
    relationshipType: "calls",
    targetExternal: "ParseCommands",
    targetName: "ParseCommands",
    targetFile: "session/session_parse.go",
    testFile: "session/session_test.go",
    language: "go",
    metadata: { relationshipType: "go_function_call", callExpression: "ParseCommands" },
    testImports: ["fmt", "testing"],
  })
  check("CONTROL: same-package Go call (session_test.go -> session.ParseCommands) is ACCEPTED", accepted(samePackage), JSON.stringify(samePackage))

  // POSITIVE CONTROL 2: genuinely imported Go package, qualified call.
  const importedPackage = validate({
    relationshipType: "calls",
    targetExternal: "New",
    targetName: "New",
    targetFile: "session/session.go",
    testFile: "core/net_test.go",
    language: "go",
    metadata: { relationshipType: "go_function_call", callExpression: "session.New", isPackageQualified: true },
    testImports: ["testing", "github.com/bettercap/bettercap/v2/session"],
  })
  check("CONTROL: genuinely imported package call (session.New from a file importing .../v2/session) is ACCEPTED", accepted(importedPackage), JSON.stringify(importedPackage))

  // POSITIVE CONTROL 3: non-call reference kinds keep working when reachable (same package).
  const reference = validate({
    relationshipType: "references",
    targetExternal: "ModuleParam",
    targetName: "ModuleParam",
    targetFile: "session/module_param.go",
    testFile: "session/module_param_test.go",
    language: "go",
    metadata: null,
    testImports: ["regexp", "strings", "testing"],
  })
  check("CONTROL: same-package reference edge is ACCEPTED", accepted(reference), JSON.stringify(reference))
}
validationGate()

// ── Integration gate (needs an index; unchanged contract) ───────────────────
const root = mkdtempSync(path.join(tmpdir(), "bb-testintel-"))
mkdirSync(path.join(root, "src"), { recursive: true })
// add: complex, tested. untested: complex, NOT tested (should be high-risk gap).
// same-name isolation: two files each declare `helper`; only one is tested.
writeFileSync(path.join(root, "src", "calc.ts"),
  "export function add(a: number, b: number): number {\n" +
  "  if (a > 0) { if (b > 0) { return a + b } else { return a } } else { return b }\n" +
  "}\n" +
  "export function untested(a: number): number {\n" +
  "  if (a > 10) { return a * 2 } else if (a > 5) { return a + 1 } else { return 0 }\n" +
  "}\n")
writeFileSync(path.join(root, "src", "a.ts"), "export function helper(): number { return 1 }\n")
writeFileSync(path.join(root, "src", "b.ts"), "export function helper(): number { return 2 }\n")
writeFileSync(path.join(root, "src", "calc.test.ts"),
  "import { add } from './calc'\nimport { helper } from './a'\n" +
  "export function testAdd(): void { if (add(1,2) !== 3) throw new Error('x'); helper() }\n")

const projectId = getProjectId(root)
let indexUnavailable = false
try {
  await indexProjectParallel(projectId, root, {})
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  // Sandbox precondition (FIX-CHARTER §5): this environment cannot create
  // ~/.bb/projects/<hash>, so the index-backed half cannot run HERE. The pure
  // validation gate above has already run; a real environment runs both halves.
  if (message.includes("ENOENT") && message.includes(".bb/projects")) {
    console.log("\n  SKIP(env): index harness unavailable in this sandbox (" + message.split("\n")[0] + ")")
    indexUnavailable = true
  } else {
    check("test-intel session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
    indexUnavailable = true
  }
}

try {
  if (!indexUnavailable) {
    // --- mapping ---
    const mapping = await testMapping(projectId)
    check("mapping runs on brain_* tables (no crash)", !!mapping.summary)
    check("test files detected", mapping.summary.testFiles >= 1, `testFiles=${mapping.summary.testFiles}`)
    const addEntry = mapping.entries.find((e) => e.name === "add")
    check("add is mapped to a test (direct call)", !!addEntry && addEntry.links.some((l) => l.evidence === "direct_call"))
    check("add strongest evidence is direct_call", !!addEntry && addEntry.strongestEvidence === "direct_call")
    const untestedEntry = mapping.entries.find((e) => e.name === "untested")
    check("untested has no test links", !!untestedEntry && untestedEntry.links.length === 0)

    // same-name isolation: a.ts helper tested, b.ts helper NOT.
    const helperA = mapping.entries.find((e) => e.name === "helper" && e.file.includes("a.ts"))
    const helperB = mapping.entries.find((e) => e.name === "helper" && e.file.includes("b.ts"))
    check("helper in a.ts is mapped", !!helperA && helperA.links.length > 0)
    check("helper in b.ts is NOT mapped (same-name isolation + import reachability)", !!helperB && helperB.links.length === 0)

    // --- gaps ---
    const gaps = await testGaps(projectId)
    check("gaps include untested symbol", gaps.gaps.some((g) => g.name === "untested"))
    check("gaps exclude tested add", !gaps.gaps.some((g) => g.name === "add"))
    check("no_evidence category present", (gaps.summary.byCategory["no_evidence"] ?? 0) > 0)
    const untestedRank = gaps.gaps.findIndex((g) => g.name === "untested")
    const helperBRank = gaps.gaps.findIndex((g) => g.name === "helper" && g.file.includes("b.ts"))
    check("high-complexity untested ranks above trivial gap", untestedRank >= 0 && (helperBRank < 0 || untestedRank < helperBRank))

    // --- impact ---
    const impact = await testImpact(projectId, "add")
    check("impact found for add", impact.found)
    check("impact lists a direct test", impact.directTests.length > 0, JSON.stringify(impact.directTests))
    check("impact affected test files non-empty", impact.affectedTestFiles.length > 0)
    check("runtime coverage is a separate unpopulated field", impact.runtimeCoverage.available === false)
    const noImpact = await testImpact(projectId, "does_not_exist_zzz")
    check("impact not-found returns found:false", !noImpact.found)
  }
} catch (error) {
  check("test-intel session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

console.log(failures === 0 ? "\nTEST-INTEL: PASS" : "\nTEST-INTEL: " + failures + " FAILURES")
process.exit(failures > 0 ? 1 : 0)
