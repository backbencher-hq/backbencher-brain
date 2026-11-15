// The `#load` DIRECTIVE — F#'s `part_of` construct (the R3 remedy, 2026-10-22).
//
// `#load "Other.fs"` is a TEXTUAL INCLUDE: the named file's source is compiled as part of
// THIS compilation unit. It is not a module — it shares this file's single scope, it imports
// nothing, and it cannot be resolved as a separate module. That is exactly the `part_of`
// contract (src/ast/types.ts:164-190) and exactly DART's `part 'x.dart'`.
//
// THE TARGET is the PROJECT-RELATIVE PATH of the file the directive names, resolved against
// the INCLUDING FILE'S OWN DIRECTORY, and the row carries `metadata.partRole: "library"`
// because F# has only one of Dart's two forms: the file carrying the directive is the host
// that INCLUDES the part.
//
// The expected target is "fixtures/fsharp/part-of-load/Other.fs" — the synthetic path the
// harness hands `analyze()`, exactly as the dart lane's `part-of` fixture records. The corpus
// runs pass REAL paths and the rule is the same one. "Other.fs" does not need to exist for
// the rule to hold: a specifier that names a file this checkout cannot place stays
// UNRESOLVED and visible, which is the store's question, not the analyzer's.
//
// THE MODULE COMES FIRST, and that is not a style choice: the wired grammar MIS-LEXES
// `#load` BEFORE a module declaration — `#load "a.fs"` then `module M` parses as
// `(fsi_directive_decl (string))` plus `(module_defn (ERROR (identifier) (identifier)) …)`,
// a file with an ERROR tree. `module M` then `#load "a.fs"` parses clean
// (`(named_module name: (long_identifier (identifier)) (fsi_directive_decl (string)) …)`), and
// that is the shape the corpus writes.
module Host

#load "Other.fs"

let value = 42
