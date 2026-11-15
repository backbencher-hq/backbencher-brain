module Fixture.OneCharCalls

let double x = x * 2
let triple x = x * 3

let applyBoth n = double n |> triple
let applyOne n = double n

let composed =
    let f x = x + 1
    f 41

type Choice =
    | A of int
    | B of string

let unwrap c =
    match c with
    | A n -> n
    | B _ -> 0

[<EntryPoint>]
let main argv =
    let total = applyBoth 1 + applyOne 2
    printfn "%d" total
    0

let composedOp = double >> triple
let lambdaPipe x = x |> (fun y -> y + 1)
let equal x y = x = y
