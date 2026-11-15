// validation/m14/fixtures/fsharp/type-extension-and-containment.fs
//
// FS-D2 + FS-D3 (fsharp lane, 2026-09-28). Every shape here was measured on a real
// corpus file before the fix and the file/line is named; the expectations are the
// ANALYZER'S OWN output after the fix, dumped by script/m14/tmp/fs004-dump.ts --raw
// (the honesty contract's "probe-verified, expectation derived from the real emission").
//
// WHAT EACH SHAPE IS AND WHY IT IS HERE
//
// 1. `type Foo with` after `type Foo()` — a type EXTENSION, F#'s only way to add
//    members to a type declared elsewhere. Corpus evidence: 68 extensions per 400
//    files, 54 of which published a SECOND symbol for the extended type and a
//    `contains Foo -> Foo` self-edge. Pinned: exactly ONE Foo, and the extension's
//    members owned by it.
//
// 2. `type Foo with` BEFORE `type Foo()` — four of the corpus's 68 extensions precede
//    their own declaration, so a walk-order rule would read the extension as the
//    declaration. Pinned: the ORDER does not change the outcome, and the symbol
//    still sits on the real declaration's line (3), not the extension's (1).
//
// 3. `type Solo with` with NO `type Solo =` anywhere — a member-only type, which F#
//    also allows. Pinned: the extension DOES publish the type, once. (Without this
//    arm the members would own a type no symbol exists for.)
//
// 4. `type Two` extended TWICE with no declaration — the case that must still publish
//    exactly one type. Pinned: one Two, not two.
//
// 5. `type SelfNamed = SelfNamed of int` — a DU case named after its OWN type, a real
//    and common F# spelling (`TypeProviderDesignation = TypeProviderDesignation of
//    string` in the compiler). Pinned: the case is a symbol, and there is NO
//    `SelfNamed -> SelfNamed` contains edge — a name cannot contain itself.
//
// 6. `member _.Loop` inside `type Loop` — a member named after its own type (three
//    corpus sites: `E.E`, `MatchClause.Pattern`, `Map.Map`). Pinned: no self-edge.
//
// 7. The class-body `let` (F#'s private field) and the forward-declaration pair an
//    `.fsi` surface uses — the first because FS-D6's name rule touches the same read,
//    the second because a first draft of FS-D2's publication rule collapsed it (30
//    dropped `type_definition` symbols caught by script/m14/tmp/fs018-compare-dumps.ts
//    before it shipped). Pinned: BOTH the surface and the definition survive.

namespace Fixture.Extensions

type Foo() =
    member this.A = 1
    member this.Double x = x * 2

type Foo with
    member this.B = 2
    member this.Triple x = x * 3

type Later with
    member this.FromExtension = 1

type Later() =
    member this.FromDeclaration = 2

type Solo with
    member this.Only = 1

type Twice with
    member this.First = 1

type Twice with
    member this.Second = 2

type SelfNamed = SelfNamed of int

type Loop =
    member this.Loop = 1

type Surface

type Surface =
    member this.Real : int = 1

// FS-P7-1, the SOURCE half. A containment edge names its parent by IDENTITY when the file has
// exactly one symbol of that name, and by the bare NAME when it has two with different
// identities — and the second case is 17,724 of the draw's 58,298 `contains` edges (30.4%), so
// it is pinned here rather than described. `First.Same` and `Second.Same` are two declarations
// with ONE name and TWO identities, which is exactly the shape `fqnByName` nulls.
module First =
    type Same = { A: int }

module Second =
    type Same = { B: int }
