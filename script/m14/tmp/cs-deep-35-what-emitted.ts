// CS-DEEP-35 — for the three names the reconcile says the analyzer misses: what DID it emit?
//
// Three hypotheses have now been proposed and refuted by the tree (genericity, a wrong owner, a
// shadowing parameter). Each was refuted by reading a DIFFERENT fact than the one the reconciler
// compares, which is the recurring failure: the reconciler reports (source, target) pairs, so a
// hypothesis about WHY a pair is missing has to be checked against the pairs the analyzer
// actually published -- including the ones for the same target under a different source.
//
// A missing (src, target) has three possible causes, and they are distinguishable:
//   (1) the target was never emitted, under any source  -> a resolution failure
//   (2) it was emitted under a DIFFERENT source        -> an attribution failure
//   (3) it was emitted with a different marker          -> a labelling failure
// Only (1) is the defect this round set out to find. Reading the emitted rows tells them apart.
import * as fs from "fs"; import * as path from "path"
const ROOT = process.cwd()
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const cases: Array<[string, string]> = [
  ["/home/sano/ishaq/bb_tests/repositories/roslyn/src/Analyzers/Core/Analyzers/SimplifyLinqExpression/AbstractSimplifyLinqExpressionDiagnosticAnalyzer.cs", "SyntaxFacts"],
  ["/home/sano/ishaq/bb_tests/repositories/roslyn/src/Analyzers/Core/Analyzers/RemoveUnusedMembers/AbstractRemoveUnusedMembersDiagnosticAnalyzer.cs", "_analyzer"],
  ["/home/sano/ishaq/bb_tests/repositories/roslyn/src/Analyzers/Core/Analyzers/RemoveUnnecessarySuppressions/AbstractRemoveUnnecessaryPragmaSuppressionsDiagnosticAnalyzer.cs", "s_removeUnnecessarySuppressionDescriptor"],
]
for (const [f, target] of cases) {
  const src = fs.readFileSync(f, "utf8")
  const res: any = await ASTEngine.parseFile(f, src)
  console.log(`\n=== ${path.basename(f)}  target=${target}`)
  console.log(`   classes in file: ${[...new Set((res.symbols ?? []).filter((s: any) => s.kind === "class").map((s: any) => s.name))].join(", ")}`)
  const sym = (res.symbols ?? []).find((s: any) => s.name === target)
  console.log(`   symbol: kind=${sym?.kind} owner=${sym?.ownerName}`)
  const rows = (res.relationships ?? []).filter((r: any) => (r.type ?? r.relationshipType) === "uses" && r.target === target)
  if (rows.length === 0) console.log(`   USES ROWS: (none)  <-- case (1): resolution failed, never emitted under any source`)
  for (const r of rows) console.log(`   USES ${String(r.source).padEnd(48)} marker=${String((r.metadata ?? {}).relationshipType).padEnd(20)} line=${r.line_number}`)
  // the source lines, so the attribution can be compared to the method that encloses them
  const lines = src.split("\n")
  for (const r of rows) {
    const ln = Number(r.line_number)
    if (ln > 0) console.log(`        line ${ln}: ${(lines[ln - 1] ?? "").trim().slice(0, 88)}`)
  }
  // every class and method with its line, to locate the enclosing scopes
  const cls: string[] = [], fn: string[] = []
  for (const s of res.symbols ?? []) {
    if (s.kind === "class") cls.push(`${s.name}@${s.line ?? s.startLine ?? "?"}`)
    if (s.kind === "method") fn.push(`${s.name}@${s.line ?? s.startLine ?? "?"}`)
  }
  console.log(`   classes: ${cls.join(" ")}`)
  console.log(`   the methods named in the reconcile: ${fn.filter((m) => /AddAllDocumentationComments|AddUnnecessaryPragmaDiagnostics|AddEntryCore|AnalyzeInvocationOperation|NeedsRename|TryAddConstructorAssignmentsAsync/.test(m)).join(" ")}`)
}
