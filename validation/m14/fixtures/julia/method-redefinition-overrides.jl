# A method redefinition IS an `overrides` edge, and this lane omitted the type.
#
# The file header declined `overrides` on the grounds that julia has multiple dispatch rather than
# overriding. That argument is sound for the case it names: two methods of the same name with
# DIFFERENT signatures are different methods, both live, and neither replaces the other. It does not
# cover the case julia actually has. Julia's method table holds exactly one entry per
# (name, signature) pair, so a second declaration of the SAME pair REPLACES the first — julia itself
# says so, printing `WARNING: Method definition f(Int) in module Main at line 12 overwritten at
# line 40` under `--warn-overwrite=yes`.
#
# The differential could not find the omission because the oracle omitted `overrides` too: two
# independent implementations that both say nothing agree perfectly. The ontology-coverage gate's
# header (BD8b) records the bash instance of exactly this failure.
#
# MEASURED, not asserted: `validation/m14/fixtures/julia/census.ts` counts redefinition DECLARATIONS
# on the parse tree across the whole admitted corpus at three levels of guard — all positions,
# unconditional positions only, and unconditional positions inside a declared module. The counts and
# the examples are in `docs/analyzers/real-julia-analyzer.md`. The version-guard pair below is one of
# the corpus's OWN conditional redefinitions, copied in shape, because the guard is the part of the
# rule that decides whether an edge is true or fabricated.

module Registry
    # Declared ONCE — the control. No `overrides` edge may exist for this name, and the forbidden
    # direction is asserted in the expectation file so the contract cannot be satisfied by an
    # analyzer that emits the edge for every declaration.
    function only_once(x)
        x
    end

    # A SECOND declaration of the SAME (name, signature). This one replaces the first.
    function area(r::Float64)
        3.141592653589793 * r * r
    end

    function area(r::Float64)
        pi * r^2
    end

    # The short form is the form the corpus prefers, so the pre-pass admits it too. Measuring only
    # `function ... end` would miss most real redefinitions.
    label() = "unit"
    label() = "meter"

    # A DIFFERENT signature of the same generic function is a NEW METHOD, not a replacement: both
    # stay live in the method table and neither displaces the other. This is the exact case the file
    # header's ruling was right about, kept in the fixture so the signature half of the key is
    # pinned by a negative assertion as well as a positive one.
    area(r::Int) = r * r

    # A version guard written with `&&`, which is the case the short-circuit test exists for and the
    # only one in the corpus. `julia/JuliaSyntax/src/core/parse_stream.jl:316`:
    #
    #     VERSION < v"1.11.0-DEV.753" && function ParseStream(io::IOBuffer; version=VERSION)
    #         …
    #     end
    #
    # On an older julia the method is defined; on a newer one it is not, and the file then declares
    # `ParseStream(io::Base.GenericIOBuffer; …)` — a DIFFERENT signature, so that pair is not a
    # redefinition at all. Measured over the 971 admitted files: 11,549 `&&` binary_expressions, of
    # which exactly 1 has a declaration node as its right operand, and that one is the line above.
    # The number is 1 rather than 0, which is what keeps this branch from being a dead predicate.
    ok && function guarded(v)
        v
    end

    ok && function guarded(v)
        -v
    end

# THE `where` HALF OF THE KEY, which is a defect the fixture caught rather than the corpus probe.
# Two methods of the same generic function whose argument lists agree and whose type-variable BOUNDS
# differ are two methods: julia keys the method table on the fully-specialised signature, so both stay
# live and neither displaces the other.
#
# The key was originally taken from the callable AFTER `unwrapWhere`, which discarded the clause
# because it hangs off the assignment's left-hand side rather than the call. Three corpus pairs
# collided because of it and each was a false `overrides` edge — julia/base/checked.jl:138-139
# (`{T<:SignedInt}` vs `{T<:UnsignedInt}`), julia/base/math.jl:834 and :838 (`{T<:AbstractFloat}` vs
# `{T<:IEEEFloat}`), julia/test/testhelpers/Furlongs.jl:21-22 (`where {p,q}` vs `where {T,p,q}`).
bounded(x) where {T<:SignedInt} = x
bounded(x) where {T<:UnsignedInt} = x

# And the shape that IS a replacement, with the clause identical — the positive half of the same rule,
# so the assertion is not "no `where`, ever".
bounded(x) where {T<:SignedInt} = -x
end

# THE SCOPE LINE, for two MODULES THAT SHARE A NAME. Julia treats them as two modules with two
# method tables, so `same` below is declared once in each and neither replaces the other. The corpus
# shape is `julia/test/deprecation_exec.jl`, which declares `module Src` at line 325 inside
# `DeprecatedReexportTest` and again at line 358 inside `DeprecatedShadowTest`, each holding a
# `newg() = 1` — keyed on the module NAME alone those are one method and the second reads as replacing
# the first.
#
# The key therefore carries the scope's own declaration line. The bug this pins is subtle and was
# caught by the corpus rather than by a fixture: the scope NAME propagated down the pre-pass while its
# LINE reset to 0 at every frame, so every key came out `name@0` and the fix appeared to do nothing.
# A fixture with one module cannot see it.
module First
    same(x) = 1
end

module Second
    same(x) = 1
end

# THE LOCAL-BINDING HALF, which is the half that separates a method-table replacement from two
# closures that never met. Inside a function body `f(x) = …` binds a LOCAL variable holding a
# closure; it adds no method and displaces nothing.
#
# The shape below is copied from the corpus: `julia/JuliaLowering/src/desugaring.jl` declares
# `wrap(asgn) = …` at line 153 inside `tuple_to_assignments` and again at line 324 inside a different
# function. `julia/base/range.jl` declares `throwbool(r) = …` at line 488 and again at line 496, in
# two different inner constructors of `OneTo`. An earlier revision keyed the pre-pass on
# (name, signature) alone, so both pairs collided and the lane published 14 fabricated edges — a
# replacement asserted between functions with no relationship at all.
function tuple_to_assignments(ctx, ex)
    wrap(asgn) = asgn
    return nothing
end

function other(ctx, ex)
    wrap(asgn) = asgn + 1
    return nothing
end

# THE MAJORITY CASE, and it is a refusal rather than an oversight. 71.9% of the admitted julia corpus
# declares no module at all, so at file scope there is no declared symbol to name as the edge's
# source. `global` is a synthetic scope this codebase documents precisely so it is not mistaken for
# a symbol (GLOBAL_SCOPE in src/ast/real-julia-analyzer.ts), and an edge whose source resolves to
# nothing is the dangling identity this lane's `contains` case already declines to invent.
#
# The redefinition below is real — same name, same signature, two declarations — and NO `overrides`
# edge is published for it. The forbidden row in the expectation file is what makes that a pinned
# contract rather than a comment, and the census counts the bucket over the corpus rather than
# leaving it invisible.
toplevel_only(x) = x
toplevel_only(x) = x + 1