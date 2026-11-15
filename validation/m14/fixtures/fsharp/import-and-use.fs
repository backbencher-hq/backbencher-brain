module Fixture.ImportAndUse
open System
open type System.Math

#r "nuget: FSharp.Core"
#I "/tmp/fixture-lib"
#load "Other.fsx"
#time "on"
#help
#quit

module IO = System.IO
module Diagnostics = FSharp.Compiler.Diagnostic

[<Struct>]
type Point =
  { X: int
    Y: int }

[<Literal>]
let Origin = Point.Zero

[<RequireQualifiedAccess>]
type Flag = A | B

[<assembly: CompilationRepresentation(CompilationRepresentationFlags.UseNullAsTrueValue)>]
do ()

[<Struct>]
val Apply: int -> int

// FS-P8: the external CLAIM (`metadata.isExternalTarget`), and the only shape that can carry
// it. The claim is verified by the incoming gate's own rule (`incoming-rule.ts`
// `verifyExternalClaim`), which looks up the target's OWNER — everything before the last dot —
// so a claim needs a path with at least TWO owner segments: a one-segment owner is a module
// NAME, and a project very often declares one itself (`Seq`, `List`, `Array`, `Expect`, `String`:
// 25,362 refuted against 13,663 verified on the `calls` label alone). `open System` on line 2
// and `open type System.Math` on line 3 are therefore NOT marked and this one is.
//
// It sits at the END of the file on purpose: a fixture's pins carry line numbers, and an `open`
// inserted above them would renumber six rows that have nothing to do with this rule.
open System.Collections.Generic