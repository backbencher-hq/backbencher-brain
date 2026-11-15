// PROBE (executable): the `importedName` claim — the PROJECT'S OWN ANSWER gates it, and it is
// fail-closed without a COMPLETE index.
//
// WHY A PROBE AND NOT ONLY A FIXTURE. The claim is emitted only when the analyzer holds a COMPLETE
// project index (the project key space the arbiter's own project-absolute refiner reads), and the
// fixture runner analyses ONE file with NO index. So the fixture can only pin the fail-closed half
// (the import-evidence markers are there, the claim is not) — and the claim's own directions, the
// erosion guard, the two evidence-shape guards and the decoy guard, are pinned HERE.
//
// THE CHECKS, and what each one would catch if it broke:
//   1  the claim's POSITIVE — a bare imported name whose specifier's root the project ships
//      (`typing`, because this probe's project contains a `typing.py`) carries the claim, and the
//      claim's shape is {specifier: the module, name: the target}.
//   2  the EROSION GUARD — a bare imported name whose specifier's root the project does NOT ship
//      (`json`) carries NO claim. Without this the claim would displace the generic external
//      marker's VERIFIED verdict (the parked arm's extOK −16,025).
//   3  the ALIAS guard — `from os import path as os_path` carries NO claim: the gate's
//      import-evidence map holds the IMPORTED ITEM (`path`), not the alias the edge names, so a
//      claim on it would be REFUTED (the parked arm's bindFAIL class).
//   4  the NAMESPACE-IMPORT guard — `import xml.etree` binds a module root, the import edge's
//      target is `xml.etree:*`, and the gate's evidence map has no entry for it at all.
//   5  the fail-closed control — NO INDEX => no claim anywhere.
//   6  the fail-closed control — an index whose completeness nobody stated => no claim anywhere.
//   7  the DECOY guard — a name the PROJECT declares (the probe's third file declares `Optional`)
//      keeps the name model, so the claim is not emitted on it.
//   8  the claim's COUNT — exactly one claim on the fixture, so a widened gate would show up here
//      rather than as a silent growth.
//   9  the NAMESPACE ROOT, PUBLISHED — `import xml.etree` binds the local name `xml`, and the
//      analyzer now publishes it as `metadata.importedBindings` so the gate's import-evidence map
//      can hold it (the Lead's gate half waits on this publication).
//  10  the ALIASED namespace import does NOT bind the root, so no root is published for it.
//  11  a single-segment namespace import binds itself, and publishes that name.
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../../src/ast/engine"
import { PYTHON_DECLARATION_SPEC } from "../../../../src/ast/project-index"
import { buildProjectIndex } from "../../../../src/ast/project-index"
import { RealPythonAnalyzer } from "../../../../src/ast/real-python-analyzer"

const file = new URL("./imported-name-project-collision.py", import.meta.url).pathname
const content = readFileSync(file, "utf8")
const parser: any = await ASTEngine.getParser("python")
const tree = parser.parse(content)

let pass = 0
const check = (ok: boolean, msg: string): void => {
  if (!ok) { console.log(`CHECK FAIL: ${msg}`); process.exit(1) }
  pass++
}

const run = (index: any): any[] => {
  const r: any = new RealPythonAnalyzer().analyze(tree.rootNode, content, file, index ? { projectIndex: index } as any : undefined)
  return (r.relationships ?? []) as any[]
}
const claimOf = (rows: any[], target: string): any =>
  rows.find((x) => String(x.target) === target)?.metadata?.importedName

// THE PROJECT: the fixture's own file, PLUS a `typing.py` (so the project ships a module named
// `typing` — the arbiter's project-absolute demotion). The DECOY project adds a third file that
// DECLARES a name spelled `Optional`, and is used only for check 7.
const typingPath = file.replace(/\/[^/]+$/, "/typing.py")
const declaredPath = file.replace(/\/[^/]+$/, "/declared.py")
const typingTree = parser.parse("class _TypingMarker:\n    pass\n")
const declaredTree = parser.parse("class Optional:\n    pass\n")
const index = buildProjectIndex([{ path: file, tree }, { path: typingPath, tree: typingTree }], PYTHON_DECLARATION_SPEC)
index.complete = true
const decoyIndex = buildProjectIndex(
  [{ path: file, tree }, { path: typingPath, tree: typingTree }, { path: declaredPath, tree: declaredTree }],
  PYTHON_DECLARATION_SPEC,
)
decoyIndex.complete = true

const rows = run(index)
const claims = rows.filter((x) => x.metadata?.importedName !== undefined)

// 1 · THE POSITIVE. `from typing import Optional` -> the name the file imports.
const opt = claimOf(rows, "Optional")
check(!!opt, "1. the bare imported name whose root the project ships carries the claim")
check(opt?.specifier === "typing" && opt?.name === "Optional", `1b. the claim's shape is {specifier: typing, name: Optional} (got ${JSON.stringify(opt)})`)

// 2 · THE EROSION GUARD. `json` is not a module this project ships, so the generic external marker
// verifies the row and the claim must not touch it.
check(claimOf(rows, "JSONDecoder") === undefined, "2. a name whose root the project does NOT ship carries NO claim")

// 3 · THE ALIAS GUARD.
check(claimOf(rows, "os_path") === undefined, "3. an ALIASED import carries NO claim")
check(claimOf(rows, "join") === undefined, "3b. a member leaf of an aliased route carries NO claim")

// 4 · THE NAMESPACE-IMPORT GUARD.
check(claimOf(rows, "xml") === undefined, "4. a NAMESPACE import carries NO claim")
check(claimOf(rows, "etree") === undefined, "4b. a member leaf of a namespace route carries NO claim")

// 5 · THE FAIL-CLOSED CONTROL — no index.
check(run(undefined).every((x) => x.metadata?.importedName === undefined), "5. NO INDEX => no claim (fail-closed)")

// 6 · THE FAIL-CLOSED CONTROL — an index whose completeness nobody stated.
const incomplete = buildProjectIndex([{ path: file, tree }, { path: typingPath, tree: typingTree }], PYTHON_DECLARATION_SPEC)
check(run(incomplete).every((x) => x.metadata?.importedName === undefined), "6. INCOMPLETE INDEX => no claim (fail-closed)")

// 7 · THE DECOY GUARD — a name the project DECLARES keeps the name model.
check(run(decoyIndex).every((x) => x.metadata?.importedName === undefined || String(x.target) !== "Optional"),
  "7. a name the PROJECT declares carries NO claim")

// 8 · THE COUNT — every claim is on the one name of the one class, and there is no other. The
// fixture writes `Optional` twice (a parameter annotation and a return annotation) and the lane
// publishes those as TWO edges, so two claims is the honest number.
check(claims.length === 2, `8. exactly TWO claims on the fixture — the parameter and the return annotation (got ${claims.length})`)
check(claims.every((x) => x.metadata?.importedName?.name === "Optional" && x.metadata?.importedName?.specifier === "typing"),
  "8b. every claim is {specifier: typing, name: Optional} — no other name was claimed")

// 9 · THE NAMESPACE ROOT, PUBLISHED. `import xml.etree` binds the LOCAL NAME `xml` (python's rule:
// the root of the dotted path is what enters the scope), and the edge's target is `xml.etree:*` —
// whose `*` item the gate's import-evidence map SKIPS, so before this publication the map could
// not hold the bound name at all and a claim about it was unverifiable against a blind map. The
// analyzer publishes it as `metadata.importedBindings` — the contract java, typescript and kotlin
// already use for "the local names this import binds" — so the gate's EXISTING generic path holds
// it with no gate change at all. This is the publication the Lead's gate half waits on.
const importEdges = rows.filter((x) => String(x.type ?? x.relationshipType ?? "") === "imports")
const xmlEdge = importEdges.find((x) => String(x.target) === "xml.etree:*")
check(!!xmlEdge, "9. the namespace import edge exists")
const xmlBindings = xmlEdge?.metadata?.importedBindings
check(Array.isArray(xmlBindings) && xmlBindings.length === 1 && xmlBindings[0] === "xml",
  `9b. it publishes the ROOT it binds: importedBindings = ["xml"] (got ${JSON.stringify(xmlBindings)})`)

// 10 · THE ALIASED NAMESPACE IMPORT DOES NOT BIND THE ROOT. `import a.b as c` binds `c` and NOT
// `a`, so publishing the root there would publish a name the file does not bind — a name in the
// map that no scope in the file can refer to.
const aliasTree = parser.parse("import a.b as c\n")
const aliasRows: any[] = (new RealPythonAnalyzer().analyze(aliasTree.rootNode, "import a.b as c\n", file.replace(/[^/]+$/, "aliased_ns.py"), undefined) as any).relationships ?? []
const aliasEdge = aliasRows.find((x) => String(x.type ?? x.relationshipType ?? "") === "imports")
check(aliasEdge?.metadata?.importedAs === "c", `10. an ALIASED namespace import publishes the alias it binds (got ${JSON.stringify(aliasEdge?.metadata?.importedAs)})`)
check(aliasEdge?.metadata?.importedBindings === undefined,
  "10b. it publishes NO root — `import a.b as c` does not bind `a`")

// 11 · A SINGLE-SEGMENT NAMESPACE IMPORT BINDS ITSELF. `import a` binds the name `a`, and its
// target is `a:*` — so the map skips the item half here too, and the publication is the only thing
// that can hold the bound name.
const oneTree = parser.parse("import a\n")
const oneRows: any[] = (new RealPythonAnalyzer().analyze(oneTree.rootNode, "import a\n", file.replace(/[^/]+$/, "one_ns.py"), undefined) as any).relationships ?? []
const oneEdge = oneRows.find((x) => String(x.type ?? x.relationshipType ?? "") === "imports")
check(Array.isArray(oneEdge?.metadata?.importedBindings) && oneEdge?.metadata?.importedBindings?.[0] === "a",
  `11. a single-segment namespace import publishes the name it binds (got ${JSON.stringify(oneEdge?.metadata?.importedBindings)})`)

console.log(`PROBE PASS (${pass} checks) — importedName: the project's own answer gates the claim, the erosion guard holds, the alias/namespace evidence shapes are withheld, the namespace root is PUBLISHED, the decoy guard holds, and both fail-closed controls fire`)
