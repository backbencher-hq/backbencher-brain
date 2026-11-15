// validation/m14/fixtures/fsharp/fs-p10-project/fs-p10-client.fs
//
// FS-P10 — the CONSUMER half: every shape whose resolution class the one-file analyzer could not
// decide, and which the project index settles. Each row below is a DIFFERENT class, because a
// class with no row pinning it is a class a later edit can rename, invert or drop and still pass
// every gate (`override-target.fs` says the same thing about the pre-index classes):
//
//   inherit Animal()        base declared in the OTHER file  -> base-member-in-project
//   override this.Speak()   and its member IS declared there  -> no `baseInProjectLacksMember`
//   interface ITagged with  interface declared in the OTHER file -> interface-member-in-project
//   Kennel()                a BARE name the project declares   -> in-project-name
//                           (the constructor call: the first cut of this fixture asserted the
//                           bare-name row with a value reference — `let promoted = Speak` — and
//                           THAT SHAPE EMITS NO EDGE AT ALL, so the row would have pinned
//                           nothing. Measured, not assumed: the same probe prints zero
//                           relationships for a bare RHS identifier. A `calls` edge to a
//                           constructor is the shape that exists.)
//   k.Best()                a VALUE receiver: the spelling is receiver-bound, so the index must
//                           NOT refine it — the class explains the spelling, not externality
//   open Fixture.Project.Domain
//                           an open of a SIBLING MODULE, which the index CANNOT settle, and the
//                           row exists to state that limit as a test rather than a comment: the
//                           shared index records declared TYPES and MEMBERS and no module names,
//                           which is the measured 24,215-edge scope channel of FS-P16.
//
// Expected classes were read off the analyzer's output through the production walk with the index
// supplied (`script/m14/run-fixtures.ts` builds it for a sub-directory fixture), and the same file
// WITHOUT an index is recorded beside them in the expectation's `note`, because "the index
// changed these classes" is the claim and a fixture that only ran the with-index direction could
// not state it.

module Fixture.Project.Client

open Fixture.Project.Domain
open Fixture.Project.Domain.Helpers

type Dog() =
    inherit Animal()
    override this.Speak() = "woof"

type TagBox() =
    interface ITagged with
        override this.Tag() = "box"

type Use() =
    member this.Go() =
        let k = Kennel()
        k.Best()
        let d = Dog()
        d.Speak()
        this.Also()
    member this.Also() = ()

// FS-P17, the two channels the first cut of the index could not answer. The module-qualified call
// names a SIBLING MODULE as its owner, and the bare call names a module-level BINDING; both were
// `external-*` before the index recorded module and binding names.
let qualifiedCall = Helpers.render "qualified"

let bareCall = render "bare"
