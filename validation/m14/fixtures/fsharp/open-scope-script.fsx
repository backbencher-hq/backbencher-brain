// FS-D17, half two — the same shape as `open-scope.fs` and the OPPOSITE answer, and the
// pair is the point. Here the `open` is above the `module` keyword, the file has one
// top-level module, and the import still belongs to `Global`, because `let topLevel`
// EXECUTES before any module exists. That is what makes a file a script, and in a script
// the code above the first module is at the script's scope.
//
// The fix that resolved this was a pre-pass over the file's declared scope, and its first
// version took the FIRST module it found — which is `OpenScript` here and would have been
// exactly this fixture's forbidden row. It is the same mistake twice in one lane: a rule
// that is right for the common case and silently wrong for the uncommon one.
//
// Counting module nodes cannot tell the two fixtures apart, and that matters because it is
// the obvious implementation: `docs/fcs/project.fsx` contains `module M` and `module N` which
// read as two more top-level modules and are inside triple-quoted strings, so the count
// alone would classify a single-module file as a script
// (script/m14/tmp/fs036-top-level.ts). The executing binding is the fact. Keying on the
// `.fsx` extension would have been shorter and would have been a guess about which files
// are scripts rather than a statement about the code — and it would have been wrong for a
// `.fs` file that genuinely is a script.
open System

let topLevel = DateTime.UtcNow

module OpenScript =
    let other = 1
