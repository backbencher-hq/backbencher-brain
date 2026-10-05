# Do the relationship types actually FIRE?

## The correction

Source-derivation counts which `RelationshipType` symbols appear in an analyzer's
source. It answers exactly one of the six questions in the workstream doc:
**is the type constructible?** It does not answer **does it fire?**

A previous progress report claimed "14 lanes verified at 10/10" on the strength of
source-derivation. That claim was wrong and is withdrawn. Re-run against real
corpus through the production path (`getParser` → `parse` → `analyze`),
**no lane fires all ten types.** The honest range is 4–8.

`script/m14/firing-check.mjs` is that test. It is the check that matters, and it
should gate every lane from now on.

## The real numbers: 120 corpus files per lane

Twelve files under-reported. Kotlin went 4 -> 6 and Rust 6 -> 7 at 120 files, so
the small sample was partly corpus starvation. These are the production-path
results at 120 files, and they replace the table below it:

    GO          10/10      SWIFT          7/10
    TYPESCRIPT  10/10      JAVASCRIPT     7/10
    HASKELL      9/10      KOTLIN         6/10
    PYTHON       8/10      CLOJURE        6/10
    SCALA        8/10      CPP            6/10
    GROOVY       8/10      PERL           5/10
    JAVA         8/10      ELIXIR         5/10
    OBJECTIVE_C  8/10      C              5/10
    RUBY         8/10      CSHARP         unmeasured (corpus has 16 .cs files,
    ERLANG       8/10                        the sampler reached 1 — fix the
                                            corpus before believing the number)

**Go and TypeScript fire all ten.** The rest do not, and the gap is real rather
than cosmetic: `overrides` never fires in 9 lanes, `exports` in 12.

## The enum bug is fleet-wide, not per-lane

`brain_import` was emitted by **zero of twenty** lanes at 120 files. Sixteen
analyzers emit the raw literal `"imports"`, which is not an enum value. Fifty call
sites compare against `RelationshipType.Imports`. So the `Imports` relationship
type is currently unreachable through the enum in the entire codebase, and 16
analyzers' import edges are invisible to all 50 consumers — silently, with no
error. Only `real-cpp`, `real-erlang` and `real-html` mention `brain_import` at
all. It arrived in 193d709db with no explanatory comment, so whoever fixes it must
first establish whether that value was a deliberate namespace workaround.

## superseded: the 12-file table

| lane | fires | silent types |
|---|---|---|
| GO | 8 | implements, imports, overrides |
| SCALA | 8 | imports, exports |
| OBJECTIVE_C | 8 | imports, exports |
| TYPESCRIPT | 8 | implements, imports, overrides |
| RUBY | 8 | imports, exports |
| ERLANG | 8 | extends, imports, overrides |
| SWIFT | 7 | imports, exports, overrides |
| JAVASCRIPT | 7 | extends, implements, imports, overrides |
| RUST | 6 | extends, imports, exports, overrides |
| PYTHON | 6 | extends, implements, imports, exports, overrides |
| HASKELL | 6 | extends, uses, imports, references, overrides |
| GROOVY | 5 | extends, implements, imports, exports, overrides |
| PERL | 5 | implements, uses, imports, exports, references |
| CLOJURE | 5 | extends, implements, imports, exports, overrides |
| ELIXIR | 5 | extends, uses, imports, exports, overrides |
| CPP | 5 | implements, imports, exports, overrides, instantiates |
| C | 5 | extends, implements, imports, exports, overrides, instantiates |
| KOTLIN | 4 | extends, implements, imports, exports, overrides, instantiates |

`overrides` is silent in 14 of 18. `exports` in 14. `extends` in 9.

## A real bug this found: `imports` is not a valid relationship type

`src/ast/types.ts:69` declares

    Imports = "brain_import"

The enum **key** is `Imports`; the enum **value** is the string `brain_import`.
Six analyzers — Go, Python, TypeScript, JavaScript, C, Haskell — emit the raw
literal `"imports"`, which is **not any value of the enum**. Only three analyzer
files mention `brain_import` at all, and in the firing run `brain_import` was
produced by **zero** lanes while `imports` was produced by seven.

So every consumer comparing `rel.type === RelationshipType.Imports` silently
misses those import edges. Nothing goes red; the edges are simply absent from
every query, graph view and coverage count that keys on the enum. This is
precisely the class of defect the DERIVATION workstreams exist to surface, and it
was invisible to every agent because each one inspected its own file in isolation.

Twelve files per lane is a floor, not a verdict: silence on a small sample is not
proof a type never fires. But it is a far better signal than source-derivation,
and it is falsifiable.
