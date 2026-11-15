// validation/m14/fixtures/fsharp/call-ownership.fs
//
// FS-D10, FS-D11, FS-D12, FS-D13 (fsharp lane, 2026-09-28) — the CALL-OWNERSHIP and
// TYPE-QUERY rules. All four were found by the lane's own truth oracle
// (script/m14/fsharp-truth-oracle.ts) as differential rows, not by reading the analyzer,
// which is why they are grouped here: they are one family ("a body whose calls had no
// owner") plus one family ("a type position that is not a declared type").
//
// WHAT EACH SHAPE IS, WITH THE MEASUREMENT THAT PRODUCED IT
//
// 1. FS-D10 — a TOP-LEVEL `let` owns the calls in its INITIALISER, whatever its kind.
//    The rule was keyed on the kind, so `let checker = …` (a VARIABLE, because it takes
//    no arguments) never became an owner; in an F# SCRIPT, where the top level IS the
//    program and there is no enclosing namespace, module or function, every call in it
//    had no source and was DROPPED. Measured: 2,520 MISSING `calls` rows per 200 real
//    files before the fix.
//
// 2. FS-D12 — a `default` implementation of an abstract member publishes no SYMBOL (the
//    abstract signature is canonical — that dedup is correct) but its BODY belongs to
//    that member. The arm passed the enclosing owner through unchanged, and inside a
//    class the enclosing owner is undefined, so every call in every `default`
//    implementation was dropped. F#'s OO surface is written exactly this way.
//    Measured: 731 of the 817 MISSING rows after FS-D10, on 120 real files.
//
// 3. FS-D13 — the "a computed property getter emits no calls" contract (inherited from
//    the C# family) is about an EXPRESSION-bodied property, which in C# has no second
//    body for code to live in. F#'s `with get, set` DOES: the setter body executes, and
//    suppressing its calls deletes real code paths. The discriminator is the `set`
//    token on a `property_accessor` node. The four `Get`/`Set` rows below pin BOTH
//    halves — a member WITH a setter emits, an expression-bodied property does not.
//
// 4. FS-D11 — a TYPE QUERY is not a written type. `typeof<T>` and `unbox<T>` are
//    EXPRESSIONS that carry a type argument: `typeof<T>.Assembly.Location` depends on a
//    runtime value, and a `declared_type` edge for it claims the opposite. The grammar
//    spells the query as a `typed_expression` whose `long_identifier_or_op` child reads
//    `typeof` — a SIBLING of the type, not its parent, which is why the first two
//    attempts at the discriminator each measured nothing.
//
//    AND THE OTHER SIDE OF 4: the same family owns a defect the differential found in
//    the ATTRIBUTION. A `let` inside a member's BODY is a local, so its written type
//    belongs to the enclosing CALLABLE, not to the class; a first draft asked "is there a
//    type above me" and answered the class. `BodyLocal` pins the correct source.

namespace Fixture.Ownership

let topLevelValue = computeIt 1
let topLevelFunction a b = combine a b
let mutable counter = 0
let scriptStyle = transform counter

type Shape =
    abstract member Describe : unit -> string
    abstract member Area : unit -> float
    default this.Describe () = describeWith 2
    default this.Area () = computeArea 1.0

type Config() =
    let mutable field : Leaf = Leaf.zero
    member _.Probe
        with get () = field
        and set (x: Leaf) =
            reset field
            field <- x
    member _.Computed = field.Length
    member this.ComputedMethod() = field.Length
    member _.FromLocal() =
        let local : Leaf = Leaf.zero
        local

module Utility =
    let quoted = typeof<Foo>.Assembly.Location
    let unboxed = unbox<int> 3
    let annotated : Bar = Bar.zero

// A RECURSIVE call is a true fact about the program, and it is the control for the
// per-label self-edge rule: FS-D3 refuses a self-CONTAINMENT and keeps a self-CALL.
let rec loop n = if n <= 0 then 0 else loop (n - 1) + 1
