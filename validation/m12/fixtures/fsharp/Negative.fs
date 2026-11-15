module Example.Negative

open System

let LocalsAreNotSymbols () =
    let localA = 1
    let localB = "text"
    let localC = localA + 2
    Console.WriteLine(localB + localC)

let LambdaParamsAreNotSymbols (items: int list) =
    let doubled = items |> List.map (fun x -> x * 2)
    Console.WriteLine(doubled)

let ParamsAreNotSymbols (input: string) (count: int) =
    let total = input.Length + count
    total

let BuiltinsAreFiltered () =
    Console.WriteLine("noise")
    let s = "x"
    let t = s.ToString()
    let eq = t.Equals("x")
    let h = t.GetHashCode()
    let ty = t.GetType()
    ()
