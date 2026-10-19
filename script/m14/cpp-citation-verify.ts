/**
 * cpp-citation-verify — RED-CAPABLE control for the ISO C++ citation claim (`iso-cpp-stdlib`).
 *
 * Asserts, as things that can FAIL:
 *  1. the analyzer's copied vocabulary is IDENTICAL to `ISO_CPP_STDLIB` in script/m14/citations.ts
 *     (a drift between the committed list and the analyzer's copy is the exact defect the copy invites);
 *  2. with BB_CPP_CITATION=1, a LISTED symbol spelled `std::<symbol>` carries
 *     `metadata.languageNamespace = [<symbol>]` — and the target is the symbol (exact);
 *  3. NEGATIVES get NO claim: an unlisted `std::` symbol, a listed symbol reached through another root,
 *     and an unqualified call;
 *  4. flag OFF is byte-identical to the baseline (no languageNamespace anywhere, same rows);
 *  5. population invariance: the flag changes no (type,target) row.
 *
 * The CLAIM's verification (extOK / verifiedBy namespace; unlisted root REFUTES) is the gate's job and is
 * measured by the arm, not here — this script controls the EMISSION only.
 *
 * USAGE: bun run script/m14/cpp-citation-verify.ts [--text]   EXIT 0 pass · 3 fail
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const FIX = path.join(ROOT, "validation", "m14", "fixtures", "cpp", "citation")
const TEXT = process.argv.includes("--text")

const cites: any = await import(path.join(ROOT, "script/m14/citations.ts"))
const committed: string[] = cites.ISO_CPP_STDLIB?.roots ?? []
const { getParser } = await import(path.join(ROOT, "script/m14/run-fixtures.ts"))
const cppMod: any = await import(path.join(ROOT, "src/ast/real-cpp-analyzer.ts"))
const parser: any = await getParser("cpp")
const analyzer: any = new cppMod.RealCppAnalyzer()
const src = fs.readFileSync(path.join(FIX, "citation.cpp"), "utf8")

const run = async (flag: boolean) => {
  const prev = process.env.BB_CPP_CITATION
  if (flag) process.env.BB_CPP_CITATION = "1"
  else delete process.env.BB_CPP_CITATION
  const tree: any = parser.parse(src, path.join(FIX, "citation.cpp"))
  try {
    return await analyzer.analyze(tree.rootNode, src, "fixtures/cpp/citation/citation.cpp")
  } finally {
    tree.delete?.()
    if (prev === undefined) delete process.env.BB_CPP_CITATION
    else process.env.BB_CPP_CITATION = prev
  }
}
const base = await run(false)
const on = await run(true)
const rows = (r: any) => (r.relationships ?? []) as any[]
const calls = (r: any, target: string, qualifiedContains?: string) => rows(r).filter((x: any) => x.type === "calls" && x.target === target && (qualifiedContains === undefined || String(x.metadata?.qualified ?? "").includes(qualifiedContains)))
const claimsOf = (rs: any[]) => rs.filter((x: any) => Array.isArray(x.metadata?.languageNamespace))

const checks: Array<{ id: string; ok: boolean; detail: string }> = []
const check = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail })

// 1. vocabulary copy drift guard
const analyzerRoots = (() => {
  // the analyzer does not export its set; parse it from the source's copied block (the copy is literal)
  const text = fs.readFileSync(path.join(ROOT, "src/ast/real-cpp-analyzer.ts"), "utf8")
  const start = text.indexOf("const CPP_CITATION_STDLIB_ROOTS")
  const end = text.indexOf("])", start)
  const blockText = start >= 0 && end > start ? text.slice(start, end) : ""
  const found = [...blockText.matchAll(/"([^"]+)"/g)].map((m) => m[1])
  return found
})()
check("vocabulary-copy-matches-committed", JSON.stringify(analyzerRoots.slice().sort()) === JSON.stringify(committed.slice().sort()), `analyzer=${analyzerRoots.length} committed=${committed.length}`)

// 2. positives — exact target, listed symbol, root std
for (const [target, shape] of [["move", "std::move"], ["string", "std::string"], ["max", "std::max"]] as const) {
  const rs = claimsOf(calls(on, target, shape))
  check(`listed-${target}-claimed`, rs.length >= 1 && Array.isArray(rs[0].metadata.languageNamespace) && rs[0].metadata.languageNamespace[0] === target && rs[0].metadata.languageNamespace.length === 1, `rows=${rs.length}`)
}
// 3. negatives
check("unlisted-std-symbol-unclaimed", claimsOf(calls(on, "for_each")).length === 0, `claims=${claimsOf(calls(on, "for_each")).length}`)
check("listed-symbol-other-root-unclaimed", claimsOf(calls(on, "move", "mylib::")).length === 0, `claims=${claimsOf(calls(on, "move", "mylib::")).length}`)
check("unqualified-call-unclaimed", claimsOf(calls(on, "move").filter((x: any) => !String(x.metadata?.qualified ?? "").includes("::"))).length === 0, "bare move claimed")
// 4. flag-off byte-identity (metadata-only emission; rows identical)
const key = (x: any) => `${x.type}\u0000${x.target}`
check("flag-off-no-citation", claimsOf(rows(base)).length === 0, `claims=${claimsOf(rows(base)).length}`)
check("population-invariant", rows(base).map(key).sort().join("|") === rows(on).map(key).sort().join("|"), "rows differ with the flag")
check("row-count-unchanged", rows(base).length === rows(on).length, `${rows(base).length} vs ${rows(on).length}`)

// RED PROOF: a deliberately impossible expectation makes the instrument exit 3, proving the failure path
// is reachable (the same discipline as the other lane instruments' --wrong-spec modes).
if (process.argv.includes("--prove-red")) {
  check("prove-red-control-unlisted-claims", claimsOf(calls(on, "for_each")).length > 0, "deliberately false expectation (the instrument must FAIL here)")
}
const failures = checks.filter((c) => !c.ok)
const report = { schemaVersion: 1, instrument: "script/m14/cpp-citation-verify.ts", fixture: path.relative(ROOT, FIX), vocabulary: { id: cites.ISO_CPP_STDLIB?.id, roots: committed.length, analyzerCopy: analyzerRoots.length }, checks, ok: failures.length === 0 }
if (TEXT) {
  console.log(`cpp-citation-verify — ${checks.length} assertions`)
  for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.id}${c.ok ? "" : ` — ${c.detail}`}`)
  console.log(failures.length === 0 ? "PASS — listed std symbols claim; unlisted/mis-rooted/unqualified do not" : `FAIL — ${failures.length} assertion(s) failed`)
} else console.log(JSON.stringify(report, null, 1))
if (failures.length > 0) process.exit(3)
