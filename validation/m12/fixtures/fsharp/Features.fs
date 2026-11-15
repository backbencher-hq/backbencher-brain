module Example.Features

open System

type Person =
    { Name: string
      Age: int }

    member this.Greeting = sprintf "Hello %s" this.Name
    member this.BirthYear = DateTime.Now.Year - this.Age

type Shape =
    | Circle of radius: float
    | Rectangle of width: float * height: float

    member this.Area =
        match this with
        | Circle r -> Math.PI * r * r
        | Rectangle (w, h) -> w * h

type Animal() =
    abstract member Speak: unit -> string
    default _.Speak() = "..."

type Dog() =
    inherit Animal()
    override _.Speak() = "Woof"

type Point(x: int, y: int) =
    member _.X = x
    member _.Y = y
    new() = Point(0, 0)

exception NotFound of string

let (|Even|Odd|) n = if n % 2 = 0 then Even else Odd

let describe n =
    match n with
    | Even -> "even"
    | Odd -> "odd"
