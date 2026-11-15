// FS-D17, half one (fsharp lane, 2026-09-28) — WHICH SCOPE an `open` belongs to, for a
// file with ONE top-level module and its imports written ABOVE the module keyword. In this
// grammar an `import_decl` is a SIBLING of the file's `module` declaration, not a child of
// it, so a scope stack maintained by walking down the tree is empty when the walk reaches
// one, and the answer the analyzer used was wherever the walk happened to be. That is
// position, and position is not a property of the program: `AssemblyCheck.fs` (open line 3,
// module line 10) was sourced to the module because the walk had entered it, and
// `docs/fcs/project.fsx` — the same shape — was sourced to `Global` because the walk had
// not. One rule, two answers, and the two files disagreed with each other rather than with
// the truth. This file and its sibling `open-scope-script.fsx` are that pair, reduced to the
// minimum difference between them. Here the imports belong to the file's scope, which is
// `OpenScope`, because a file with one top-level module is in that module wherever the
// `open` is written.
//
// FORMATTING, which cost a run and is worth writing down. `module X` with no `=` and a
// declaration beneath it — the form the F# manual shows — is a PARSE RECOVERY REGION in
// this grammar: the module takes its name from the following `let` and the file silently
// becomes about something else. `module X =` with an INDENTED body parses. The first run of
// this fixture failed with "expected symbol not found" for the very module the file exists
// to pin, and the cause was whitespace. The symptom pointed at the analyzer.
open System
open System.IO

module OpenScope =
    let exists = File.Exists "x"
