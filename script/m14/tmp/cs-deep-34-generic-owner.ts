// CS-DEEP-34 — WHY are reads of a generic type's own members dropped?
//
// Two shapes the reconcile says the analyzer misses, both inside a GENERIC class:
//
//   AbstractSimplifyLinqExpressionDiagnosticAnalyzer<TExpressionSyntax, ...>
//     protected abstract ISyntaxFacts SyntaxFacts { get; }        (line 49)
//     var name = SyntaxFacts.GetIdentifierOfSimpleName(...);        (line 157)  <- a real read
//
//   AbstractRemoveUnusedMembersDiagnosticAnalyzer<TDocumentationCommentTriviaSyntax, ...>
//     private readonly AbstractRemoveUnusedMembersDiagnosticAnalyzer<...> _analyzer;  (147)
//     _analyzer.HandleNamedTypeSymbolStart(...);                   (line 284)  <- a real read
//
// The mechanism under test: the member inventory is keyed by `ownerName`, and resolution looks
// members up by the class's BARE name. If a generic type's members are published with the type
// ARGUMENTS still attached to `ownerName`, the two strings differ, the lookup misses, and every
// bare read of every member of every generic type is dropped. `leafOf` cannot bridge it either --
// it splits on `.` and `::`, and `<A, B>` contains neither.
//
// That predicts the misses correlate with GENERICITY and not with anything about the reads, which
// is the prediction this probe measures.
import * as fs from "fs"; import * as path from "path"
const ROOT = process.cwd()
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const files = [
  "/home/sano/ishaq/bb_tests/repositories/roslyn/src/Analyzers/Core/Analyzers/SimplifyLinqExpression/AbstractSimplifyLinqExpressionDiagnosticAnalyzer.cs",
  "/home/sano/ishaq/bb_tests/repositories/roslyn/src/Analyzers/Core/Analyzers/RemoveUnusedMembers/AbstractRemoveUnusedMembersDiagnosticAnalyzer.cs",
  "/home/sano/ishaq/bb_tests/repositories/roslyn/src/Analyzers/Core/Analyzers/RemoveUnnecessarySuppressions/AbstractRemoveUnnecessaryPragmaSuppressionsDiagnosticAnalyzer.cs",
]
const leafOf = (s: string): string => { const segs: string[] = []; for (const a of s.split("::")) for (const b of a.split(".")) if (b) segs.push(b); return segs.length > 0 ? segs[segs.length - 1] : s }
for (const f of files) {
  const res: any = await ASTEngine.parseFile(f, fs.readFileSync(f, "utf8"))
  console.log(`\n=== ${path.basename(f)}`)
  const owners = new Set<string>()
  for (const s of res.symbols ?? []) if (s.ownerName) owners.add(String(s.ownerName))
  const generic = [...owners].filter((o) => o.includes("<"))
  const plain = [...owners].filter((o) => !o.includes("<"))
  console.log(`   distinct ownerName values: ${owners.size}   with type arguments: ${generic.length}   without: ${plain.length}`)
  for (const o of [...generic, ...plain].slice(0, 6)) {
    const lo = leafOf(o)
    console.log(`      owner="${o.slice(0, 62)}"`)
    console.log(`        leafOf(owner)="${lo.slice(0, 62)}"  ${o === lo ? "(unchanged -- resolution CAN find these)" : "(DIFFERENT -- resolution CANNOT find these)"}`)
  }
  const target = path.basename(f).startsWith("AbstractSimplify") ? "SyntaxFacts" : path.basename(f).includes("RemoveUnused") ? "_analyzer" : "s_removeUnnecessarySuppressionDescriptor"
  const rows = (res.symbols ?? []).filter((s: any) => s.name === target)
  for (const s of rows) console.log(`   SYMBOL ${s.name} kind=${s.kind} owner="${String(s.ownerName).slice(0, 70)}"`)
}
