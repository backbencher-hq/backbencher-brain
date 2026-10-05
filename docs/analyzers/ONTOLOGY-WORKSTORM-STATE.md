
## ROOT CAUSE of the fleet's worst ambiguity/unresolved: fsharp does not capture local bindings

`fsharp` has the largest unresolved population in the fleet (9,304 of 20,324 `calls`
edges at 200 files; 33,339 across 600). Traced to a specific, reproducible defect rather
than left as a number.

`FSharpx.Extras/tests/FSharpx.Tests/UndoTest.fs`:

```fsharp
[<Test>]
let ``When starting a text editor...``() =
  let test = undoable {          // <- a real declaration
    let! _ = addText "foo"
    let! _ = addText "bar"
    return () }
  let actual = exec test (newHistory "")   // <- a call to it
  actual |> shouldEqual "foobar"
```

The analyzer emits **5 `calls` edges whose target is `test`** and captures **ZERO symbols
named `test`**. In that file it reports 9 symbols total: 1 `module` and 8 `function`. The
local `let` bindings inside the function bodies are simply not modelled.

### Why this is the important one

An unresolved `calls` target has two possible causes that look identical in the output:

1. the target genuinely does not exist in the analysed set — legitimate, e.g. F# BCL
   (`Some`, `not`, `failwith`, `iter`, `sprintf`, `box`, `defaultArg`, `raise`); and
2. **the analyzer did not capture the declaration that exists** — a defect.

Measured split over 60 files, 842 distinct call targets, 1,664 declared symbols:

```
call targets NOT declared : 421 of 842  (50%)   carrying 1,830 edges
top: test 160 · Some 96 · not 79 · CloseComponent 50 · ignore 48 · box 38
     sprintf 31 · args 28 · failwith 26 · defaultArg 24 · iter 24 · Append 20
```

`Some`/`not`/`failwith`/`iter`/`box`/`sprintf`/`defaultArg`/`raise` are F# standard
library — legitimately outside the corpus, and an external reference that should be
published as such rather than silently unresolved. But `test` at 160 edges is a LOCAL
BINDING the analyzer failed to capture, and `CloseComponent`/`AddAttribute`/`OpenElement`
are test-framework declarations in the same class.

**So roughly half of fsharp's "unresolved" is not unresolved at all — it is unmodelled.**
A local `let` is a declaration the analyzer does not represent, so every call to one is
emitted as an edge to a target that cannot exist. That inflates the unresolved column AND
means the lane is under-reporting its own coverage.

### The distinction worth generalising

`contains` in the same lane: **1,228 ambiguous, 0 unresolved**. `contains` targets always
exist — the analyzer is walking structure it can see. `calls` targets frequently do not,
because a name can resolve to a binding the analyzer never made. The two columns are
measuring different things, and only one of them is a scoping problem.

Every lane reporting a large unresolved count should split it this way before treating it
as a defect: **external-but-real**, **declared-but-not-captured**, and
**genuinely-absent**. Only the last is a resolution defect; the middle one is a coverage
defect wearing a resolution defect's clothes.
