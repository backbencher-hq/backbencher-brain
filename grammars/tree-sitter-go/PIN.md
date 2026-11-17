# tree-sitter-go — grammar pin

**This grammar is an UPSTREAM BUILD, NOT A LOCAL PATCH.** The wired wasm is a
stock build of an upstream commit that is NEWER than the one previously wired.
Nothing here is a modified grammar, and no upstream file was edited to produce
the wired bytes — the entire change is *which upstream commit we build from*.

| | |
| --- | --- |
| Upstream | `tree-sitter/tree-sitter-go` |
| Upstream revision | `e395081ba9a8b2cfa24ad2b3b8254a002d795292` — "feat: support type instantiation expressions" |
| Upstream package | `tree-sitter-go` 0.20.0 (MIT, `LICENSE` beside this file) |
| Wired wasm | `wasm/tree-sitter-go.wasm`, sha256 `cc55ee8a3579e03a1b94e5371f92f6a5c92045308ee633c25360ab7789573a08`, 212,660 bytes |
| Previous wired wasm | sha256 `9963ca89b616eaf04b08a43bc1fb0f07b85395bec313330851f1f1ead2f755b6`, 235,957 bytes (a revision that predates `e395081`) |
| Build | `tree-sitter generate && tree-sitter build --wasm` (CLI, ABI 14 — the same ABI the previous wired build reports, so the swap is ABI-compatible) |
| Gate | `bun run audit:fixtures` (lane `go`, 40 fixtures) |
| Pin record | `src/ast/engine.ts`, `PATCHED_GRAMMAR_SHA256["tree-sitter-go.wasm"]` |

## Why the previous build had to move: two legal constructs, and the declarations they cost

The previously wired build errored on constructs the Go language documents:

```go
var _ = slices.Backward[[]int]              // Go 1.21+ generic function instantiated as a VALUE
func (Either[A, B]) A() A { ... }           // Go 1.18+ method on an instantiated generic receiver
```

The damage was not the construct itself — it was the **error recovery**. Everything
after the first error was re-read as composite-literal debris, so real
declarations stopped being declarations at all.

Measured on a real corpus file,
`go-tools/go/analysis/passes/modernize/testdata/src/slicesbackward/slicesbackward.go`
(which carries `var _ = slices.Backward[[]int]` on line 11):

| | previous build | this build |
| --- | --- | --- |
| symbols | **1** | **40** |
| parse errors | **195** | **0** |
| relationships | 10 | 24 |
| `contains` edges | 0 | 4 |

**39 of that file's 40 declarations were being lost to recovery.** This is
registered in the lane spec as `GO-GAP-1` ("grammar capability, registered, NOT
hidable"), and it is the reason this swap exists.

## Why `e395081` and not upstream HEAD

`e395081` is the commit that ADDS the instantiation production. A later upstream
commit, `b82ab80` ("refactor!: rework type parameters and interface type
elements", note the `!`), RENAMES interface nodes — `constraint_elem` →
`type_elem`, `method_spec` → `method_elem`. Building HEAD would therefore change
the analyzer's node contract as a side effect of a parse fix.

Measured, HEAD reproduces the instantiation fix but regresses the lane: `extends`
and `implements` both fall to **0** and symbols drop 58,489 → 56,373, because
interface embedding arrives as `type_elem` instead of `constraint_elem`. `e395081`
has the instantiation production AND still emits `constraint_elem`, so the node
contract is untouched.

## The analyzer half (ships with this pin, and is required by it)

The newer grammar types a generic **call** differently:

```
previous:  call_expression > function: identifier "identity"  +  type_arguments
this:      type_conversion_expression > type: generic_type "identity[int]"
```

`type_conversion_expression` had **no** analyzer handling, so on its own this pin
would turn 140 corpus calls and 2 fixtures into silence. The same commit teaches
three places to read the new shape — `findGoFunctionCalls`,
`buildGoCallExpression`, and the package-scope call walk — plus
`resolveGoCallLeaf`.

The type/call decision stays semantic, which is where Go puts it: the resolved
name is pushed into `qualified_calls` and only becomes a `calls` row when
`isGoPackageCallable` accepts it. A conversion to a generic *type*
(`Vec[int](x)`, `Vec` being a struct) therefore still publishes no `calls` row —
verified by fixture `go/package-var-func-type-source` and by the three-way test
`identity[int](x)` → `calls`, `int(x)` → nothing, `Vec[int]{v: x}` → `instantiates`.

## A/B, so the cost is stated and not implied

go-tools + terraform, 3,422 files, `testdata/` excluded (the lane's normal census
rule), production `parseFile`:

| metric | previous build | this build |
| --- | --- | --- |
| files parsed | 3,422 / 0 crashed | 3,422 / 0 crashed |
| symbols | 58,489 | **58,489** (identical) |
| relationships | 363,852 | 363,830 (**−22**) |
| `calls` | 128,259 | **128,259** (identical) |
| `instantiates` | 20,135 | 20,124 (−11) |
| `uses` | 74,930 | 74,919 (−11) |
| relationship types firing | 12 of 14 | **12 of 14** (same two ontological exclusions) |
| `global` sources | 742 | **742** (identical) |

**The 22 removed edges are fabricated ones.** They were recovery artifacts —
`instantiates`/`uses` rows read out of composite-literal debris, attached to
names the source never mentions. The lane's own fixture
`go/grammar-error-not-a-construction-889` exists to forbid exactly that class,
and it still passes.

Note what the A/B does NOT show: the census excludes `testdata/`, and the
GO-GAP-1 recovery damage lives mostly in `testdata/`. That is why the aggregate
symbol count is unchanged while the single real file above went 1 → 40. The
aggregate is not evidence against the fix; it is evidence that the fix's
population is excluded from the aggregate.

## What this pin does not claim

It does not fix `GO-GAP-3` (the receiver `func (T) NoName()` vs `func (s) Untyped()`
ambiguity), which is a genuine ambiguity in Go's surface syntax — two different
semantic readings of one identical token sequence — and not something a grammar
revision can settle. It does not touch `decorates` or `part_of`, the lane's two
legitimate exclusions.
