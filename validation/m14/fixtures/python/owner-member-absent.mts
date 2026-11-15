// PROBE (executable): ownerMemberAbsent claim, indexed arm only + fail-closed. Nested metadata
// objects are asserted here because the fixture runner compares meta with ===.
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../../src/ast/engine"
import { PYTHON_DECLARATION_SPEC } from "../../../../src/ast/project-index"
import { buildProjectIndex } from "../../../../src/ast/project-index"
import { RealPythonAnalyzer } from "../../../../src/ast/real-python-analyzer"
const file = new URL("./owner-member-absent.py", import.meta.url).pathname
const content = readFileSync(file, "utf8")
const parser: any = await ASTEngine.getParser("python")
const tree = parser.parse(content)
let pass = 0
const check = (ok: boolean, msg: string) => { if (!ok) { console.log(`CHECK FAIL: ${msg}`); process.exit(1) } pass++ }
const run = (opts: { flag: boolean; index: any }): any[] => {
  if (opts.flag) process.env.BB_PY_OWNER_MEMBER_ABSENT = "1"
  else delete process.env.BB_PY_OWNER_MEMBER_ABSENT
  const r: any = new RealPythonAnalyzer().analyze(tree.rootNode, content, file, opts.index ? { projectIndex: opts.index } as any : undefined)
  return r.relationships as any[]
}
const index = buildProjectIndex([{ path: file, tree }], PYTHON_DECLARATION_SPEC)
index.complete = true
const withIdx = run({ flag: true, index })
const claims = withIdx.filter((x) => x.metadata?.ownerMemberAbsent)
const byTarget = (target: string) => withIdx.find((x) => String(x.type) === "calls" && String(x.target) === target)
check(!!byTarget("missing_method")?.metadata?.ownerMemberAbsent, "1. absent member carries the claim")
const c = byTarget("missing_method")!.metadata.ownerMemberAbsent
check(c.owner === "Widget" && c.member === "missing_method", "2. claim is {owner: Widget, member: missing_method}")
check(byTarget("inherited_method")?.metadata?.ownerMemberAbsent === undefined, "3. inherited member UNMARKED")
check(byTarget("direct_method")?.metadata?.ownerMemberAbsent === undefined, "4. declared member UNMARKED")
check(withIdx.find((x) => String(x.target) === "any_method")?.metadata?.ownerMemberAbsent === undefined, "5. unknown owner UNMARKED")
check(claims.length === 1, `6. exactly one claim on the fixture (got ${claims.length})`)
check(run({ flag: true, index: undefined }).every((x) => x.metadata?.ownerMemberAbsent === undefined), "7. NO INDEX => no claim (fail-closed)")
check(run({ flag: false, index }).every((x) => x.metadata?.ownerMemberAbsent === undefined), "8. FLAG OFF => no claim (fail-closed)")
// ── THE MIRROR FIX: A QUALIFIED BASE IS A NAME IN ANOTHER MODULE ────────────────────────────────
// `unittest.TestCase` and a local `class TestCase` are DIFFERENT classes that share a leaf name.
// The lane keeps the qualified identity, never resolves the two together, and WITHHOLDS the claim
// while the project declares that leaf — because the gate's owner map is keyed by the leaf, so the
// map's key for that leaf is a MIXTURE of unrelated classes and the two closures answer different
// questions about the same owner. (The gate's own keying is the Lead's half; this is the mirror.)
const analyzeSrc = (src: string, path: string, index: any): any[] => {
  // THE CLAIM IS BEHIND ITS FLAG, and check 8 above turned it OFF — so the flag is set HERE, and
  // the claim's ABSENCE in case 9 is the claim's own behaviour and not the flag's.
  process.env.BB_PY_OWNER_MEMBER_ABSENT = "1"
  const t = parser.parse(src)
  const r: any = new RealPythonAnalyzer().analyze(t.rootNode, src, path, { projectIndex: index } as any)
  return (r.relationships ?? []) as any[]
}
const claimFor = (rows: any[], target: string): any =>
  rows.find((x) => String(x.type) === "calls" && String(x.target) === target)?.metadata?.ownerMemberAbsent

// 9 · THE SHADOWING CASE. The project declares a class named `TestCase`, so the map's key for that
//     leaf is a mixture and the closure is not comparable ⇒ the claim is WITHHELD. (Before the fix
//     the lane resolved `unittest.TestCase` to the LOCAL `TestCase` and answered a question about a
//     different class entirely.)
const shadowSrc = `class TestCase:
    def inherited_method(self):
        return 1


class Child(unittest.TestCase):
    def direct_method(self):
        return 2


def absent(w: Child):
    return w.missing_method()
`
const shadowPath = file.replace(/[^/]+$/, "shadow.py")
const shadowTree = parser.parse(shadowSrc)
const shadowIndex = buildProjectIndex([{ path: shadowPath, tree: shadowTree }], PYTHON_DECLARATION_SPEC)
shadowIndex.complete = true
check(claimFor(analyzeSrc(shadowSrc, shadowPath, shadowIndex), "missing_method") === undefined,
  "9. a QUALIFIED base whose leaf the project declares => the claim is WITHHELD (the closures are not comparable)")

// 10 · THE QUALIFIED BASE WHOSE LEAF THE PROJECT DOES NOT DECLARE. Nothing in the project is named
//      `TestCase`, so the map holds nothing for that leaf, the two closures ARE comparable, and the
//      claim is made — the qualified base simply contributes nothing.
const qualifiedSrc = `class Child(unittest.TestCase):
    def direct_method(self):
        return 2


def absent(w: Child):
    return w.missing_method()
`
const qualifiedPath = file.replace(/[^/]+$/, "qualified.py")
const qualifiedTree = parser.parse(qualifiedSrc)
const qualifiedIndex = buildProjectIndex([{ path: qualifiedPath, tree: qualifiedTree }], PYTHON_DECLARATION_SPEC)
qualifiedIndex.complete = true
const qualifiedClaim = claimFor(analyzeSrc(qualifiedSrc, qualifiedPath, qualifiedIndex), "missing_method")
check(!!qualifiedClaim, "10. a QUALIFIED base whose leaf the project does NOT declare => the claim is MADE")
check(qualifiedClaim?.owner === "Child" && qualifiedClaim?.member === "missing_method",
  `10b. the claim is {owner: Child, member: missing_method} (got ${JSON.stringify(qualifiedClaim)})`)

// ── THE PUBLICATION THE LEAD's MAP KEYING NEEDS ────────────────────────────────────────────────
// The gate's owner map folds a base to its LEAF (`(r.superTypes ?? []).map(leaf)`), so the map
// cannot tell `unittest.TestCase` from a local `class TestCase` — and a map that cannot tell them
// apart holds a MIXTURE under one key. Fixing that needs the base's name AS WRITTEN, and the
// analyzer did not publish it: `baseClasses` and the `superTypes` column are the LEAF form. So the
// lane publishes the written form ALONGSIDE the leaf form, and the leaf form every existing walk
// reads is NOT TOUCHED.
const symbolsOf = (src: string, path: string): any[] => {
  const t = parser.parse(src)
  const r: any = new RealPythonAnalyzer().analyze(t.rootNode, src, path, undefined)
  return (r.symbols ?? []) as any[]
}
const classSymbol = (rows: any[], name: string): any => rows.find((x) => String(x.name) === name)
const shadowSymbols = symbolsOf(shadowSrc, shadowPath)
const childSym = classSymbol(shadowSymbols, "Child")
check(!!childSym, "12. the class symbol exists")
check(Array.isArray(childSym?.metadata?.basesAsWritten) && childSym?.metadata?.basesAsWritten?.[0] === "unittest.TestCase",
  `12b. the base is published AS WRITTEN: basesAsWritten = ["unittest.TestCase"] (got ${JSON.stringify(childSym?.metadata?.basesAsWritten)})`)
check(Array.isArray(childSym?.metadata?.baseClasses) && childSym?.metadata?.baseClasses?.[0] === "TestCase",
  `12c. the LEAF form is untouched: baseClasses = ["TestCase"] (got ${JSON.stringify(childSym?.metadata?.baseClasses)})`)
check(Array.isArray(childSym?.metadata?.superTypes) && childSym?.metadata?.superTypes?.[0] === "TestCase",
  `12d. the WALKED heritage column is untouched: superTypes = ["TestCase"] (got ${JSON.stringify(childSym?.metadata?.superTypes)})`)

// 13 · A LOCAL BASE IS ITS WRITTEN NAME. `class Widget(Base)` names the local `Base`, and the
//      written form says exactly that — no qualifier, and no leaf-folding ambiguity either.
const widgetSym = classSymbol(symbolsOf(`class Base:
    def m(self):
        return 1


class Widget(Base):
    def n(self):
        return 2
`, file.replace(/[^/]+$/, "localbase.py")), "Widget")
check(Array.isArray(widgetSym?.metadata?.basesAsWritten) && widgetSym?.metadata?.basesAsWritten?.[0] === "Base",
  `13. a LOCAL base is published as written: basesAsWritten = ["Base"] (got ${JSON.stringify(widgetSym?.metadata?.basesAsWritten)})`)

console.log(`PROBE PASS (${pass} checks) — ownerMemberAbsent: claim shape, inheritance-closed absence, declared/inherited/unknown negatives, both fail-closed controls, the qualified-base identity (a local class of the same leaf is NOT the base, and the claim is withheld while the project declares that leaf), and the base published AS WRITTEN (the leaf form untouched) — the publication the gate's map keying needs`)
