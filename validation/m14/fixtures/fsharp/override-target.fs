module Fixture.OverrideTarget

type Animal() =
    member this.Speak() = "generic"
    member this.Dispose() = ()

type Dog() =
    inherit Animal()
    override this.Speak() = "woof"

type Resource() =
    interface System.IDisposable with
        override this.Dispose() = ()
        member this.Tag() = "resource"

type Guarded() =
    inherit Animal()
    interface System.IDisposable with
        override this.Dispose() = ()
        override this.Speak() = "guarded"

let mock =
    { new System.IDisposable with
        override this.Dispose() = ()
        member this.Tag() = "mock" }

// FS-P7-1: the two `overrides` reason classes that had no row pinning them, each the MIRROR of
// a case already above. `Dog.Speak -> Animal.Speak` is `base-member` because `Animal` is THIS
// file's type; `Buffer.Flush` has an external base, so its class is `base-member-external`.
// `Resource.Dispose -> IDisposable.Dispose` is `interface-member-external` because that
// interface is not this file's; `ITagged` IS, so `Tagged` pins `interface-member`. An unpinned
// class is a class a later edit can rename, invert or drop and still pass every gate.
type ITagged =
    abstract member Tag : unit -> string

type Tagged() =
    interface ITagged with
        override this.Tag() = "tagged"

type Buffer() =
    inherit System.IO.MemoryStream()
    override this.Flush() = ()
