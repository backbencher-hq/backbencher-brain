namespace Fixture.TargetSpelling

// FS-P6 fixture. One call site per resolution class, so the reason a target carries is
// pinned by a test instead of by prose. `open FSharpPlus` is here to fill `openedScopes`
// with a SINGLE-segment module name: the opened-module class is only reachable when the
// open target is one segment, because the branch tests the path's FIRST segment.
open FSharpPlus

/// A file-level binding, so a bare call to it can be spelled by identity.
let renderSink () = ()

type Message =
    | SetInput of string
    | SetRadioItem of int

type Sink() =
    member _.Render() = ()

type Factory() =
    member _.Build() = Sink()

type Base() =
    abstract member Speak: unit -> int
    default _.Speak() = 1

type Derived() =
    inherit Base()
    override this.Speak() = base.Speak() + 1

type Widget() =
    member _.RenderTo() = ()

    member _.Render(factory: Factory, sink: Sink) =
        // local-binding: a `let` in a BODY is not published, so the name cannot be an
        // identity; the edge keeps the name and says so.
        let helper (x: int) = x + 1
        helper 1 |> ignore
        // external-type-or-module: written with a module-like qualifier that nothing in
        // this file declares, so the qualifier is kept as written.
        Array.fold (+) 0 [| 1 |] |> ignore
        // opened-module: the qualifier is a name this file OPENED.
        FSharpPlus.map id [ 1 ] |> ignore
        // module-member: three segments with a module-like one before the leaf, so the
        // store's shape is the LAST TWO segments (`Seq.map`), not the whole path.
        Microsoft.FSharp.Collections.Seq.map id [ 1 ] |> ignore
        // in-file-qualified: `Message` is a type this file declares and `SetInput` is one
        // of its cases, published as `Message.SetInput` — the identity itself. A case in
        // CALLEE position with a payload is a real application, which is why it emits.
        Message.SetInput "x" |> ignore
        // receiver-value: a lowercase qualifier is a VALUE, and no symbol is ever stored
        // as `value.member`, so the member's own name is the honest target.
        sink.Render() |> ignore
        // call-chain-receiver: a chain is not a path. The called member is the last NAME
        // in it, on a receiver whose type the file cannot know.
        factory.Build().Render() |> ignore
        // self-member: `this` is the enclosing type, which this file published.
        this.RenderTo()
        // bare-external: written unqualified and declared nowhere in this file.
        unqualifiedCall 1
        // instantiates, the TYPE position: `new X()` names a TYPE, and a written type is
        // stored with its whole namespace as ONE owner, so the target stays the leaf here
        // while a callee in the same shape keeps its qualifier.
        let built = new System.Text.StringBuilder()
        ignore built
        // in-file-declaration: a bare name THIS file published is spelled exactly.
        renderSink ()

    member _.Helper(baseBuilder: Factory) =
        // pipe-call: the pipeline site is a SEPARATE emission point from the application
        // site, and both go through the same spelling rule, so a bare external name on the
        // right of a pipe is the `bare-external` class there too.
        baseBuilder.Build() |> ignore
