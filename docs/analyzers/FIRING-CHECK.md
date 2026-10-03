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

## What actually fires (12 real corpus files per lane)

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
