// PINS the fsharp wave fixture pack (M29.R2 wave 3, wave-onboarding lane C).
// Uniform wave convention: type Greeter with member Greet, exercised in main.

module WaveTest

open System

/// A greeter that reports the number of items it stores.
type Greeter(items: string list) =
    member this.Items = items

    /// Returns the greeting for the stored items.
    member this.Greet() =
        sprintf "hello %d" (List.length items)

[<EntryPoint>]
let main _ =
    let greeter = Greeter([ "a"; "b" ])
    printfn "%s" (greeter.Greet())
    0
