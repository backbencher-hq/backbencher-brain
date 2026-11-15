// validation/m14/fixtures/fsharp/fs-p10-project/fs-p10-domain.fs
//
// FS-P10, the SIBLING half. This file exists so that the file beside it can reference a
// declaration the ONE-FILE analyzer cannot see — which is the only way to test what the project
// index (FS-P14) is for. It declares four things, chosen because each is answered by a different
// channel of the index:
//
//   Animal   a class, so `typeKinds` says `class` and `typeMembers` says it declares `Speak`
//   ITagged  an interface, so a base resolved through it is an INTERFACE and not a class
//   Kennel   a class whose member `Best` is what the client file calls on a VALUE receiver
//   Speak    a MEMBER name, which is the population `bare-external` turns out to contain
//
// A subdirectory fixture is a multi-file project by the runner's rule (`script/m14/run-fixtures.ts`),
// so this file is indexed and its sibling is analyzed WITH the index.

module Fixture.Project.Domain

type Animal() =
    member this.Speak() = "generic"

type ITagged =
    abstract member Tag : unit -> string

type Kennel() =
    member this.Best() = Animal()

// FS-P17, the binding and scope channels. A NESTED MODULE and a module-level BINDING are neither
// a type nor a member, so before `nameOnlyNodes` existed the index held neither name and every
// reference to one of them looked exactly like FSharp.Core:
//
//   `Helpers.render`  the owner is a project MODULE      -> external-type-or-module, unanswerable
//   `render`          a bare call to a project BINDING   -> bare-external, unanswerable
//   `open …Helpers`   a namespace path the project declares -> external-namespace, unanswerable
//
// 23,995 + 16,456 edges on the lane's 3,000-file draw hang off these shapes, which is the whole
// reason the third channel exists (`.tmp-probe/fs-p16-index-refine.py`).
module Helpers =
    let render (s: string) = s
