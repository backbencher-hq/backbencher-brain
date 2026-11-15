module Fixture.QualifiedNameSeam

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

let describe (a: Animal) : string = a.Speak()