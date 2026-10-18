/**
 * cpp-index-consume-verify — the RED-CAPABLE control for the C++ analyzer's project-index consumption
 * (`BB_CPP_INDEX_CONSUME=1`, task-22 milestone 3).
 *
 * WHAT IS VERIFIED, each as an assertion that can FAIL:
 *   1. FLAG OFF (with or without an index in context) the analyzer's output is BYTE-IDENTICAL to the
 *      no-context baseline — the accepted CPP D1–D6 verdict's analyzer behaviour must not move under a
 *      flag nobody set.
 *   2. FLAG ON + a COMPLETE index attaches only the declared facts:
 *        · a call to a project free function            -> meta.declaredInProject + indexDeclarationCount
 *        · a call to a member unique to one project type -> meta.memberOfProjectType (the owner)
 *        · a call to a platform function (printf)        -> NO declaredInProject
 *        · an `extends` whose base the index declares    -> meta.indexBaseKind (the settled kind)
 *   3. FAIL-CLOSED: the same index with `complete !== true` yields the baseline again — an incomplete
 *      index vouches for nothing (the fleet rule every index consumer states).
 *   4. NO ROW MOVES: the relationship COUNT and the (type,target) multiset are identical across all
 *      five runs — metadata-only consumption is what keeps the population invariant the arms depend on.
 *
 * The index here is built over the FIXTURE PROJECT explicitly (base.h + derive.cc) with the C++
 * declaration spec — the lane's local draft until the Lead applies CPP_DECLARATION_SPEC to
 * project-index.ts, after which the exported spec is used automatically (preferring the real one is
 * the point: this script must keep testing the shipped spec, not a copy).
 *
 * USAGE: BB_CORPUS_ROOT not needed. bun run script/m14/cpp-index-consume-verify.ts [--text]
 * EXIT 0 all assertions pass · 3 an assertion failed (the control fired).
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const FIX = path.join(ROOT, "validation", "m14", "fixtures", "cpp", "project-index-consume")
const TEXT = process.argv.includes("--text")

const { getParser } = await import(path.join(ROOT, "script/m14/run-fixtures.ts"))
const cppMod: any = await import(path.join(ROOT, "src/ast/real-cpp-analyzer.ts"))
const indexMod: any = await import(path.join(ROOT, "src/ast/project-index.ts"))

// The spec: the SHIPPED one when the Lead's wiring has landed, else the lane's draft (same code).
const SPEC: any = indexMod.CPP_DECLARATION_SPEC ?? undefined
if (!SPEC) {
  // No draft copy is kept in this script on purpose: until project-index.ts exports the spec, the
  // consumption cannot be exercised against a real index, and that is reported as a FAIL rather than
  // silently tested against a private copy that could drift from the shipped contract.
  console.error("cpp-index-consume-verify: project-index.ts does not export CPP_DECLARATION_SPEC yet (Lead wiring pending) — the consumption control needs the shipped spec.")
  process.exit(3)
}

const files = [
  path.join(FIX, "base.h"),
  path.join(FIX, "derive.cc"),
]
// RED-PROOF MODE: build the index with the WRONG language's spec (Solidity's) and require the
// assertions to FAIL. A control that cannot fail on a wrong input is decoration; this switch is how
// the red-capability is demonstrated without touching the analyzer under test.
const WRONG_SPEC = process.argv.includes("--wrong-spec")
const SPEC_ACTUAL = WRONG_SPEC ? indexMod.SOLIDITY_DECLARATION_SPEC : SPEC
const index: any = await indexMod.buildProjectIndexFromDisk(
  path.join(ROOT, "wasm", "tree-sitter-cpp.wasm"),
  files,
  SPEC_ACTUAL,
)
// COMPLETENESS IS A CALLER FACT, exactly as in the gate (`projectIndexesFor` stamps it from the
// caller's whole/sampled knowledge) — a spec-built index does not vouch for itself.
index.complete = true
await indexMod.buildResolutionTables(index)

const parser: any = await getParser("cpp")
const analyzer: any = new cppMod.RealCppAnalyzer()
const content = fs.readFileSync(path.join(FIX, "derive.cc"), "utf8")

const analyze = async (flag: boolean, ctx: any) => {
  const prev = process.env.BB_CPP_INDEX_CONSUME
  if (flag) process.env.BB_CPP_INDEX_CONSUME = "1"
  else delete process.env.BB_CPP_INDEX_CONSUME
  const tree: any = parser.parse(content, path.join(FIX, "derive.cc"))
  try {
    return await analyzer.analyze(tree.rootNode, content, "fixtures/cpp/project-index-consume/derive.cc", ctx)
  } finally {
    tree.delete?.()
    if (prev === undefined) delete process.env.BB_CPP_INDEX_CONSUME
    else process.env.BB_CPP_INDEX_CONSUME = prev
  }
}

const baseline = await analyze(false, undefined)
const offWithIndex = await analyze(false, { projectIndex: index })
const onNoIndex = await analyze(true, undefined)
const onComplete = await analyze(true, { projectIndex: index })
const incomplete: any = { ...index, complete: false }
const onIncomplete = await analyze(true, { projectIndex: incomplete })

const norm = (r: any) => JSON.stringify({ symbols: r.symbols ?? [], rels: (r.relationships ?? []).map((x: any) => ({ ...x })) })
const rowKey = (x: any) => `${x.type}\u0000${x.target}`
const rowMultiset = (r: any) => (r.relationships ?? []).map(rowKey).sort().join("|")
const rowsOf = (r: any) => (r.relationships ?? []) as any[]
const callRow = (r: any, target: string) => rowsOf(r).find((x: any) => x.type === "calls" && x.target === target)
const extendsRow = (r: any, target: string) => rowsOf(r).find((x: any) => x.type === "extends" && x.target === target)

const checks: Array<{ id: string; ok: boolean; detail: string }> = []
const check = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail })

// 1. flag off / no index = byte-identical
check("off-baseline-equals-index-context-off", norm(baseline) === norm(offWithIndex), "flag off must ignore a context index")
check("off-baseline-equals-flag-on-no-index", norm(baseline) === norm(onNoIndex), "flag on without a context index must be the baseline")
// 3. fail-closed on an incomplete index
check("incomplete-index-changes-nothing", norm(baseline) === norm(onIncomplete), "complete!==true must attach nothing")
// 4. population invariant across every run
const baselineRows = rowMultiset(baseline)
check("population-invariant-flag-on", rowMultiset(onComplete) === baselineRows, "flag-on rows must equal baseline rows exactly (type+target multiset)")
check("population-count-unchanged", rowsOf(onComplete).length === rowsOf(baseline).length, "relationship count unchanged")
// 2. the declared facts
const computeCall = callRow(onComplete, "compute")
check("call-to-project-free-function-declaredInProject", computeCall?.metadata?.declaredInProject === true, `metadata=${JSON.stringify(computeCall?.metadata)}`)
check("call-to-project-free-function-has-declaration-count", computeCall?.metadata?.indexDeclarationCount === 1, `count=${computeCall?.metadata?.indexDeclarationCount}`)
const callRowOf = (r: any, source: string, target: string) => rowsOf(r).find((x: any) => x.type === "calls" && x.source === source && x.target === target)
// THE INHERITANCE CLOSURE IS NOW CORRECT (index patch v2): `memberOwners` is closed over bases, so
// `create` — declared by Base — is ALSO a member of Derived, and the "unique project type" fact must
// legitimately read undefined for it. `nothing` (Other's alone) is the unique case.
const inheritedMemberCall = callRow(onComplete, "create")
check("inherited-member-not-unique", inheritedMemberCall?.metadata?.declaredInProject === true && inheritedMemberCall?.metadata?.memberOfProjectType === undefined, `declaredInProject=${JSON.stringify(inheritedMemberCall?.metadata?.declaredInProject)} owner=${JSON.stringify(inheritedMemberCall?.metadata?.memberOfProjectType)}`)
const uniqueMemberCall = callRowOf(onComplete, "uniqueMember", "nothing")
check("call-to-unique-project-member-owner", uniqueMemberCall?.metadata?.memberOfProjectType === "Other", `owner=${uniqueMemberCall?.metadata?.memberOfProjectType}`)
const printfCall = callRow(onComplete, "printf")
check("platform-call-not-declaredInProject", printfCall !== undefined && printfCall.metadata?.declaredInProject !== true, `metadata=${JSON.stringify(printfCall?.metadata)}`)
const createCall = callRow(onComplete, "create")
check("qualified-call-owner-metadata", createCall?.metadata?.owner === "Base", `owner=${JSON.stringify(createCall?.metadata?.owner)}`)
// RECEIVER TYPING (task-22 milestone 5): three declaration-bearing classes + the two negatives.

const ctorTemp = callRowOf(onComplete, "ctorTemp", "start")
check("constructor-temp-owner", ctorTemp?.metadata?.owner === "Factory", `owner=${JSON.stringify(ctorTemp?.metadata?.owner)}`)
const typedLocal = callRowOf(onComplete, "typedLocal", "start")
check("typed-local-owner", typedLocal?.metadata?.owner === "Factory", `owner=${JSON.stringify(typedLocal?.metadata?.owner)}`)
const paramTypedLocal = callRowOf(onComplete, "use", "start")
check("parameter-typed-local-owner", paramTypedLocal?.metadata?.owner === "Base", `owner=${JSON.stringify(paramTypedLocal?.metadata?.owner)}`)
const chained = callRowOf(onComplete, "chainedNegative", "start")
check("opaque-chained-receiver-no-invented-owner", chained !== undefined && chained.metadata?.owner === undefined, `owner=${JSON.stringify(chained?.metadata?.owner)}`)
const implicitThis = callRowOf(onComplete, "viaImplicit", "start")
check("implicit-this-owner", implicitThis?.metadata?.owner === "Derived", `owner=${JSON.stringify(implicitThis?.metadata?.owner)}`)
const otherTypedLocal = callRowOf(onComplete, "otherNegative", "start")
check("typed-local-not-declaring-no-invented-owner", otherTypedLocal !== undefined && otherTypedLocal.metadata?.owner === undefined, `owner=${JSON.stringify(otherTypedLocal?.metadata?.owner)}`)
const baseExtends = extendsRow(onComplete, "Base")
check("extends-base-kind-settled-by-index", baseExtends?.metadata?.indexBaseKind === "struct", `kind=${baseExtends?.metadata?.indexBaseKind}`)
// flag-off rows must carry NONE of the index keys
const anyIndexKey = (r: any) => rowsOf(r).some((x: any) => ["declaredInProject", "indexDeclarationCount", "memberOfProjectType", "indexBaseKind", "indexDeclaresMethod", "owner"].some((k) => x.metadata && x.metadata[k] !== undefined))
check("flag-off-metadata-clean", !anyIndexKey(baseline) && !anyIndexKey(offWithIndex), "no index keys may appear without the flag")

const failures = checks.filter((c) => !c.ok)
if (WRONG_SPEC && failures.length === 0) {
  console.error("RED PROOF DID NOT FIRE: the control passed with the WRONG spec — the assertions cannot detect a wrong index.")
  process.exit(3)
}
const out = { schemaVersion: 1, instrument: "script/m14/cpp-index-consume-verify.ts", fixture: path.relative(ROOT, FIX), index: { files: files.length, types: index.typeKinds.size, symbols: index.symbolNames.size, typeMembers: index.typeMembers.size }, checks, ok: failures.length === 0 }
if (TEXT) {
  console.log(`cpp-index-consume-verify — ${checks.length} assertions`)
  for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.id}${c.ok ? "" : ` — ${c.detail}`}`)
  console.log(failures.length === 0 ? "PASS — consumption is flag-gated, fail-closed and metadata-only" : `FAIL — ${failures.length} assertion(s) failed`)
} else {
  console.log(JSON.stringify(out, null, 1))
}
if (failures.length > 0) process.exit(3)
