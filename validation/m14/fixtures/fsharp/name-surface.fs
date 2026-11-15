// validation/m14/fixtures/fsharp/name-surface.fs
//
// FS-D6 + FS-D7 (fsharp lane, 2026-09-28) — the lane's NAME surface, which the
// completion matrix's `diff: n/a` / `folder: n/a` cells hid completely: the lane had no
// fixture, no closure record and no differential, so nothing measured what it called
// things.
//
// FS-D6. An `identifier_pattern` in the grammar spans the ENTIRE left-hand side of a
// binding — parameters and return annotation included — and the analyzer read its text
// as the symbol's NAME. `let f (a: string) : string = …` was published as
// `f (a: string) : string`. Measured on 400 real files: 60 such symbols, none joinable
// by a consumer (37 with a curried argument list, 23 with a generic argument in the
// return type); script/m14/tmp/fs019-adjudicate-loss.ts counts the removed names by the
// character that disqualifies them — 57 by a parameter list, 16 by a generic argument,
// 9 by a space, 8 otherwise. This file pins all four shapes plus the four controls that
// must NOT move, because a first draft of the fix that also redirected the plain
// `identifier` case regressed `let f a b = …` and `let f x = …`, and the A/B reported
// them as dropped symbols.
//
// FS-D7. An `object_expression` published a Class symbol and never opened a scope for
// it, so in an F# SCRIPT — no namespace, no module, therefore an empty enclosing scope —
// every member of every object expression came out with NO owner: elmish
// `docs/docs/subscription.fsx` at lines 71/144/803/833, suave
// `examples/WebSocket/Program.fs:181`, fsharp-data
// `src/FSharp.Data.Html.Core/HtmlNode.fs:123,206`. The scope is opened under the SAME
// name the symbol is published under, so the `contains` edge resolves to a symbol that
// exists.
//
// NOT PINNED HERE, and stated rather than hidden: an `active_pattern` is published under
// its full pattern text (`(|Even|Odd|)`), 617 per 400 files. That is a DECIDED contract
// — it is what validation/m12/ground-truth/fsharp.json pins — and it is not a name any
// consumer can call, so it is recorded in the lane's limitations rather than changed
// here. Likewise an object expression is published as `new <Iface>`, 91 per 400 files.

module Fixture.Names

// --- FS-D6: a whole signature must never be a name -----------------------------
let takesAnnotated (a: string) : string = a
let takesCurried (path: string) (processFile: string -> string) : string = path
let takesGeneric (payload: ResizeArray<int>) : Map<string, int> = Map.empty
let hasReturnOnly (a: string) : string = a

// --- the controls: these four must be unaffected by the name rule ----------------
let plain = 1
let curried a b = a + b
let lambdaArg x = x
let mutable counter = 0

// --- FS-D7: an object expression's members belong to the object ------------------
let ownsMembers =
    { new System.IDisposable with
        member _.Dispose() = ()
        member _.Other = 1 }

let nested =
    let inner = { new System.IComparable with member _.CompareTo(_) = 0 }
    let after = 2
    (inner, after)

// FS-D14. An object expression's interface name, where the name is QUALIFIED and the
// member body mentions identifiers of its own. Both halves are load-bearing: a
// two-segment name is where "first `long_identifier`" stops being the name, and the
// body is where "last identifier in the subtree" stops being the name.
let qualified =
    { new System.Collections.Generic.IEqualityComparer<Foo> with
        member _.Equals(x, y) = failwith "nope"
        member _.GetHashCode() = 0 }
