// PROBE (executable, matches the project-index probe precedent): the `importedName` claim on the
// fixture file. The fixture JSON cannot assert a nested metadata OBJECT (the runner compares meta
// values with === by design), so the claim's exact shape is pinned here, with a mutation path:
// remove the emission from `certifyImportedNameClaims` and check 1 goes red.
//
// WHAT CHANGED ON 2026-10-20, AND WHY THIS FILE WAS CORRECTED (the superseded probe is recorded
// in the git history; the superseded EXPECTATION is kept beside this one as
// `imported-name-claim.expectation.superseded-81db3e7301.json`, per the fleet's R3 rule).
//
// THE OLD PROBE ran the analyzer with NO project index and asserted that `mkstemp()` carried the
// claim, because the old emission was gated on a LANE-MAINTAINED VOCABULARY (`tempfile` is in the
// committed `python-stdlib` root list). The whole-population arm (D7 W3) then measured what that
// gate does: extOK −16,025, ext? −7,540, bindOK +23,204, **bindFAIL 361** — the claim landed on
// rows the generic external marker VERIFIES, displacing a verified answer, and on evidence shapes
// the gate's import map does not hold. The Lead ruled that an INSTRUMENT GAP (charter §18.30) and
// the emission was parked.
//
// THE REBUILD (this lane, 2026-10-20) replaces the vocabulary gate with the PROJECT'S OWN ANSWER:
// the complete project index's locality verdict, whose `unknown` IS the arbiter's project-absolute
// demotion condition — so the claim lands exactly on the class the arbiter cannot verify and
// nowhere else. The claim is therefore an INDEXED-ARM instrument, and this probe now builds the
// project index the fixture runner does not have: a project that ships a module named `tempfile`.
// The same file's NEGATIVES keep their meaning, and one of them gains the erosion reading: a
// third-party root the project does NOT ship (`requests`) is a row the generic external marker
// VERIFIES, and claiming it would displace a verified answer.
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../../src/ast/engine"
import { PYTHON_DECLARATION_SPEC } from "../../../../src/ast/project-index"
import { buildProjectIndex } from "../../../../src/ast/project-index"
import { RealPythonAnalyzer } from "../../../../src/ast/real-python-analyzer"

const file = new URL("./imported-name-claim.py", import.meta.url).pathname
const content = readFileSync(file, "utf8")
const parser: any = await ASTEngine.getParser("python")
const tree = parser.parse(content)

// THE PROJECT: the fixture's own file plus a `tempfile.py`, so the project ships a module named
// `tempfile` — the arbiter's project-absolute demotion condition, reproduced here.
const tempfilePath = file.replace(/\/[^/]+$/, "/tempfile.py")
const index = buildProjectIndex(
  [{ path: file, tree }, { path: tempfilePath, tree: parser.parse("class _TempfileMarker:\n    pass\n") }],
  PYTHON_DECLARATION_SPEC,
)
index.complete = true

const r: any = new RealPythonAnalyzer().analyze(tree.rootNode, content, file, { projectIndex: index } as any)
const rels = r.relationships as any[]
const call = (target: string) => rels.find((x) => String(x.type) === "calls" && String(x.target) === target)
const imports = rels.filter((x) => String(x.type) === "imports")
let pass = 0
const check = (ok: boolean, msg: string) => { if (!ok) { console.log(`CHECK FAIL: ${msg}`); process.exit(1) } pass++ }
const claim = call("mkstemp")?.metadata?.importedName
check(!!claim && typeof claim === "object", "1. mkstemp() carries an importedName claim")
check(claim?.specifier === "tempfile" && claim?.name === "mkstemp", "2. claim is {specifier: tempfile, name: mkstemp}")
check(call("not_imported_anywhere")?.metadata?.importedName === undefined, "3. unimported bare name carries NO claim (arbiter would refute it)")
check(call("local_thing")?.metadata?.importedName === undefined, "4. relative specifier is UNMARKED")
check(call("HTTPAdapter")?.metadata?.importedName === undefined, "5. a third-party root the project does NOT ship is UNMARKED — the generic external marker verifies it, and claiming it would displace a verified answer")
check(imports.some((x) => String(x.target) === "tempfile:mkstemp"), "6. the evidence source exists: the import row spells the item (module:item)")
// THE FAIL-CLOSED CONTROLS — the emission needs a COMPLETE project index, so a run without one is
// byte-identical to the behaviour before the claim existed.
const bare: any = new RealPythonAnalyzer().analyze(tree.rootNode, content, file)
check((bare.relationships as any[]).every((x) => x.metadata?.importedName === undefined), "7. NO INDEX => no claim (fail-closed)")
const incomplete = buildProjectIndex([{ path: file, tree }], PYTHON_DECLARATION_SPEC)
const inc: any = new RealPythonAnalyzer().analyze(tree.rootNode, content, file, { projectIndex: incomplete } as any)
check((inc.relationships as any[]).every((x) => x.metadata?.importedName === undefined), "8. INCOMPLETE INDEX => no claim (fail-closed)")
console.log(`PROBE PASS (${pass} checks) — importedName claim shape, the project's own gate, the evidence source, and both fail-closed controls`)
