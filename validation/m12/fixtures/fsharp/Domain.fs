namespace Example.Domain

open System

module CustomerModule =
    type Status =
        | Active
        | Inactive

    type Customer = { Id: int; Name: string }

    type Repository<'T> =
        abstract member Get: int -> 'T
        abstract member Save: 'T -> unit

    let format customer = sprintf "%d:%s" customer.Id customer.Name
    let findById id (items: Customer list) = items |> List.tryFind (fun c -> c.Id = id)

    let createAsync customer = async { return format customer }

    [<Measure>]
    type kg

    [<Measure>]
    type s

    let speed = 100.0<kg> / 2.0<s>
