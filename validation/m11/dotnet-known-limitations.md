# .NET Fixture Limitations

The minimized fixture is compiler-validated with .NET SDK 8.0.423. C# truth is
derived from Microsoft.CodeAnalysis semantic symbols, and F# truth is derived
from FSharp.Compiler.Service assembly symbols. Both compiler projects build
with zero warnings and zero errors.

The focused declaration comparison covers namespaces, partial classes,
overloaded constructors and methods, records, record fields, interfaces,
delegates, events, extension methods, generics, discriminated unions, modules,
and async functions. Partial declarations and overloads are compared by file,
line, kind, and name so same-name symbols are not conflated.

Runtime reflection, dynamic dispatch, expression-tree lowering, generated state
machines, and compiler-generated members are outside source-declaration truth.
Those constructs require inferred or generated evidence in the later universal
relationship and support-matrix milestones.

## Real-corpus observations (dotnet-corpus-observed.json)

- **Roslyn (17,137 C# files)**: 600,869 symbols and 3,166,002 relationships in
  103.5 min wall / 556 MB peak RSS, 0 errors, 0 timeouts. The relationship
  count is lower than earlier pre-fix runs because the indexer now dedupes
  engine-generated `contains` edges correctly (a separator mismatch between
  the dedupe set's insert and lookup had silently disabled it, emitting
  duplicate containment edges).
- **dotnet/fsharp (6,627 F# files)**: 146,925 symbols and 115,453 relationships
  in 2.9 min wall / 231 MB peak RSS. Ten files hit the 45s worker timeout once
  each and were recovered via retry; all 6,627 files are indexed.
- **Parser hangs**: a small number of F# files (e.g.
  `src/Compiler/Utilities/Cancellable.fs`) can stall tree-sitter parsing past
  the engine's 120s self-destruct timer. Hangs are confined to worker
  processes and killed/retried by the pool; the in-process "missed files"
  retry path now also runs through the isolated worker pool so a hang can
  never exit the parent index run.
