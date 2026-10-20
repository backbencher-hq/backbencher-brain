/**
 * cpp-package-scope-verify — RED-CAPABLE control for the C++ PACKAGE-SCOPE CLAIM.
 *
 * The claim is `packageScope = {package, name}`: "this target is a member of the DEPENDENCY named
 * `package`, and this project declares that dependency". The evidence is the PROJECT'S OWN MANIFEST, so
 * a name from a package the project does not depend on cannot be claimed, and the checkout can refute it.
 *
 * WHAT C++ NEEDS ITS OWN MEMBERSHIP TEST FOR (the lane's ruling — CPP-PACKAGE-SCOPE-RULING.md §1): dart's
 * import says `package:json_annotation/…`, so the package is IN the spelling. A C++ translation unit says
 * which library a name comes from by the HEADER it includes, and a header names a PATH, not a package. So
 * the C++ membership test is the include-root test: the translation unit includes an EXTERNAL
 * (angle-bracketed) header whose first path segment is the package's include root, and the governing
 * manifest declares that package.
 *
 * THE PACKAGE LIST IS THE CALLER'S FACT (`context.cppPackageScopePackages`), because the manifest is read
 * ONCE, by the gate that has to read it to verify the claim. This instrument supplies it directly, so the
 * emission is testable BEFORE the gate is wired — and, just as importantly, so the emission's INERTNESS is
 * testable: with no package list, nothing is claimed.
 *
 * THE ASSERTIONS, as things that can FAIL:
 *   1. POSITIVE — a QUALIFIED call (`acme::make`) in a unit that includes `<acme/widget.h>`, with `acme`
 *      declared, carries `packageScope = {package: "acme", name: <leaf>}` — and the package is the
 *      MANIFEST'S OWN SPELLING;
 *   2. POSITIVE, LOOSE — `<nlohmann/json.hpp>` + the declared package `nlohmann_json` claims the package
 *      AS THE MANIFEST SPELLS IT (`nlohmann_json`), never the include root (`nlohmann`), so the arbiter's
 *      exact-match verification holds and the claim cannot refute itself;
 *   3. NEGATIVES get NO claim: a BARE call (the include test is a UNIT-level fact and cannot say which
 *      header a bare name came from — the lane's own counterexample), a PROJECT include (quoted), a
 *      SINGLE-ROOT system header (`<vector>`), an AMBIGUOUS attribution (two declared packages match the
 *      root), a unit whose manifest declares a package that no include root matches, and a unit with NO
 *      package list at all;
 *   4. FLAG OFF is byte-identical to the baseline (no `packageScope` anywhere, same rows);
 *   5. POPULATION INVARIANCE: the flag changes no (type,target) row.
 *
 * The CLAIM's VERIFICATION (extOK / verifiedBy packageScope; an undeclared dependency REFUTES) is the
 * GATE's job and is measured by the arm, not here — this script controls the EMISSION only.
 *
 * USAGE: bun run script/m14/cpp-package-scope-verify.ts [--text] [--prove-red]   EXIT 0 pass · 3 fail
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const FIX = path.join(ROOT, "validation", "m14", "fixtures", "cpp", "package-scope")
const TEXT = process.argv.includes("--text")

const { getParser } = await import(path.join(ROOT, "script/m14/run-fixtures.ts"))
const cppMod: any = await import(path.join(ROOT, "src/ast/real-cpp-analyzer.ts"))
const parser: any = await getParser("cpp")
const analyzer: any = new cppMod.RealCppAnalyzer()
const readSrc = (name: string) => fs.readFileSync(path.join(FIX, name), "utf8")

const run = async (flag: boolean, packages: string[] | undefined, name = "package_scope.cpp") => {
  const prev = process.env.BB_CPP_PACKAGE_SCOPE
  if (flag) process.env.BB_CPP_PACKAGE_SCOPE = "1"
  else delete process.env.BB_CPP_PACKAGE_SCOPE
  const src = readSrc(name)
  const tree: any = parser.parse(src, path.join(FIX, name))
  try {
    const context: any = {}
    if (packages !== undefined) context.cppPackageScopePackages = packages
    return await analyzer.analyze(tree.rootNode, src, `fixtures/cpp/package-scope/${name}`, context)
  } finally {
    tree.delete?.()
    if (prev === undefined) delete process.env.BB_CPP_PACKAGE_SCOPE
    else process.env.BB_CPP_PACKAGE_SCOPE = prev
  }
}

const base = await run(false, undefined)
const onAcme = await run(true, ["acme"])
const onBoth = await run(true, ["acme", "nlohmann_json"])
const onUnmatched = await run(true, ["unrelated_package"])
const onNone = await run(true, [])
const loose = await run(true, ["nlohmann_json"], "package_scope_loose.cpp")
// the ambiguous unit declares `acme` AND `acme_extra`: the root `acme` matches both (one strictly, one by
// the word-boundary prefix), so the attribution is not unique and the claim must be withheld.
const ambiguous = await run(true, ["acme", "acme_extra"], "package_scope_ambiguous.cpp")

const rows = (r: any) => (r.relationships ?? []) as any[]
const callsTo = (r: any, target: string) => rows(r).filter((x: any) => x.type === "calls" && x.target === target)
const claimOf = (rs: any[]) => rs.find((x: any) => x.metadata?.packageScope)?.metadata?.packageScope

const checks: Array<{ id: string; ok: boolean; detail: string }> = []
const check = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail })

// 1 · POSITIVE — the qualified spelling, corroborated by the checkout's include root
{
  const c = claimOf(callsTo(onAcme, "make"))
  check("qualified-call-claimed-with-declared-package", !!c && c.package === "acme" && c.name === "make", JSON.stringify(c))
}
{
  const c = claimOf(callsTo(onAcme, "count"))
  check("second-qualified-shape-claimed", !!c && c.package === "acme" && c.name === "count", JSON.stringify(c))
}
// 2 · POSITIVE — the loose match, carrying the MANIFEST's spelling
{
  const c = claimOf(callsTo(loose, "json_size"))
  check("loose-match-claims-the-manifests-spelling", !!c && c.package === "nlohmann_json" && c.name === "json_size", JSON.stringify(c))
}
// 2b · THE AMBIGUOUS CASE — two declared packages match the unit, so the attribution is not unambiguous
check("ambiguous-attribution-claims-nothing", rows(ambiguous).filter((x: any) => x.metadata?.packageScope !== undefined).length === 0, `claims=${rows(ambiguous).filter((x: any) => x.metadata?.packageScope !== undefined).length}`)
// 3 · NEGATIVES — and the BARE one is the point of the ruling
check("bare-call-not-claimed", claimOf(callsTo(onAcme, "widget_count")) === undefined, "a bare name names no package: the include test is a UNIT-level fact")
check("project-include-not-claimed", claimOf(callsTo(onAcme, "local_helper")) === undefined, "a quoted include is not external provenance")
check("single-root-system-header-not-claimed", claimOf(callsTo(onAcme, "vector_size")) === undefined, "<vector> names no package root")
check("unmatched-package-not-claimed", claimOf(callsTo(onUnmatched, "make")) === undefined, "the manifest declares a package no include root matches")
check("namespace-without-include-root-not-claimed", claimOf(callsTo(onNone, "make")) === undefined, "the checkout must corroborate the namespace")
check("no-package-list-claims-nothing", rows(onNone).filter((x: any) => x.metadata?.packageScope !== undefined).length === 0, "an emission with no manifest fact must be inert")
check("no-package-list-no-context-claims-nothing", rows(base).filter((x: any) => x.metadata?.packageScope !== undefined).length === 0, "the flag-off state carries no claim")
// 4 · FLAG OFF is byte-identical
const key = (x: any) => `${x.type}\u0000${x.target}`
check("population-invariant", rows(base).map(key).sort().join("|") === rows(onAcme).map(key).sort().join("|"), "rows differ with the flag")
check("row-count-unchanged", rows(base).length === rows(onAcme).length, `${rows(base).length} vs ${rows(onAcme).length}`)
check("flag-off-no-package-scope", rows(base).filter((x: any) => x.metadata?.packageScope !== undefined).length === 0, "the flag leaked")

// RED PROOF: a deliberately impossible expectation makes the instrument exit 3, proving the failure path
// is reachable (the same discipline as the other lane instruments' red proofs).
if (process.argv.includes("--prove-red")) {
  check("prove-red-control-unclaimed-row-claims", claimOf(callsTo(onAcme, "widget_count")) !== undefined, "deliberately false expectation (the instrument must FAIL here)")
}

const failures = checks.filter((c) => !c.ok)
const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-package-scope-verify.ts",
  fixture: path.relative(ROOT, FIX),
  rule: "A C++ translation unit says which library a name comes from by the HEADER it includes. The claim fires when the unit includes an EXTERNAL header whose first path segment is the package's include root and the governing manifest declares that package. The package name carried is the MANIFEST's own spelling.",
  checks,
  ok: failures.length === 0,
}
if (TEXT) {
  console.log(`cpp-package-scope-verify — ${checks.length} assertions`)
  for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.id}${c.ok ? "" : ` — ${c.detail}`}`)
  console.log(failures.length === 0
    ? "PASS — a QUALIFIED call whose namespace agrees with a declared package's include root claims; bare names, project includes, single-root headers, ambiguous attributions and unmatched packages do not"
    : `FAIL — ${failures.length} assertion(s) failed`)
} else console.log(JSON.stringify(report, null, 1))
if (failures.length > 0) process.exit(3)
