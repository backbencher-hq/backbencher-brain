// validation/m14/fixtures/fsharp/declared-type-graph.fs
//
// FS-D4 (fsharp lane, 2026-09-28) — the R9 DECLARED-TYPE reference graph, a FAMILY
// standard the lane did not implement at all. `script/m60/declared-type-refs-census.ts`
// measured fsharp `absent` with the control present: the snippet parses, the holder is
// walked, and the lane emitted no type reference of any kind. Thirteen lanes emit it;
// rust's own R13 header names it one. An absent capability emits nothing, so no
// per-edge oracle can adjudicate it — that is the whole reason R9 exists as a census.
//
// WHAT IS HERE, position by position, with the F# reason stated in the comment on each
// shape. Expectations are the analyzer's post-fix emission, dumped through the
// production walk (script/m14/tmp/fs004-dump.ts --raw) — derived from a real probe, not
// from the contract text.
//
//   Dep        a plain nominal type: the thing every position below points at
//   R          a RECORD: its field's written type belongs to the record TYPE
//   Holder     a CLASS: a `let` in a class body is F#'s private field, so its written
//              type belongs to the TYPE (the family attribution rule)
//   Shape     a DU: a case payload's written type belongs to the UNION
//   Alias     a type ABBREVIATION: the RHS is a real dependency (`List<Dep>`)
//   Bad       the NEGATIVES, and they matter more than the positives:
//                - a bound type PARAMETER ('T) is a BINDING, not a dependency
//                - an UNDERSCORE (`_`) is not a name at all
//                - F# PREDEFINED types (int, string, unit, obj) name no declaration
//                - `inherit` and `interface … with` are ALREADY extends/implements,
//                  so a declared_type edge for them would be a duplicate fact
//              Without these the positives look perfect and the graph is still wrong.

namespace Fixture.Types

type Dep = class end
type Other = class end
type NotDeclared = interface end

type R =
    { FieldOfDep : Dep
      FieldOfPredefined : int }
    member this.M() = 1

type Holder() =
    let mutable privateField : Dep = Unchecked.defaultof<Dep>
    member this.TakesParam(a : Dep, b : Other) : Dep = a
    member this.BodyLocal() =
        let local : Dep = Unchecked.defaultof<Dep>
        local

type Shape =
    | FromDep of Dep
    | FromPredefined of int

type Alias = Dep list

type Bad<'T when 'T : comparison>() =
    inherit Object()
    val mutable UsesParameter : 'T
    val mutable UsesPredefined : string
    val mutable UsesUnderscore : _
    val mutable UsesUnit : unit
    member this.Param(x : 'T) : 'T = x
    member this.Returning() : 'T = Unchecked.defaultof<'T>

// FS-D29. A MUTUAL RECURSION GROUP is ONE binding node, and the group's own name is a
// `value_declaration_left` at index 0 while the `and` clause's is a
// `function_declaration_left` at index 2. Asking for the function form first therefore
// names the group after its SECOND function, and every declared type in the FIRST
// binding's signature is published under the second binding's name — which is a real
// published symbol, so the edge resolves and nothing downstream can tell.
//
// The F# compiler corpus is written almost entirely in this shape, and it is the only
// construct in this file whose OWNER the analyzer had to get right for the rows above to
// mean anything: `GroupFirst -> GroupDep` and `GroupSecond -> GroupSecondDep` are the
// positive statement that the two clauses have different owners.
let rec groupFirst (a: GroupDep) : GroupSecond =
    groupSecond a

and groupSecond (b: GroupSecondDep) : GroupFirst =
    groupFirst b

// FS-P7-2. A TYPE WRITTEN WITH A NAMESPACE, which is the one shape that separates the two
// halves of the declared-type target rule and which no row above could state.
//
// `System.IO.Stream` is not declared in this file, so the LEAF is the target and the path the
// source wrote is recorded beside it — and the price says that is the right way round: spelling
// the path instead moves `+85` targets to determinate and `-158` the other way
// (`.tmp-probe/fs-p7-price.py`, 1,155 rows that carry a written path, rows-pass8-meta.ndjson),
// because a dotted target that misses strategy 1 falls to strategy 3, whose tail is everything
// after the FIRST dot — `IO.Stream`, which no symbol is named. `Dep` above is the other half:
// declared HERE, so the target is the identity this file published, not the leaf.
type Dotted =
    { StreamOfDotted : System.IO.Stream
      DepOfDotted : Dep }
