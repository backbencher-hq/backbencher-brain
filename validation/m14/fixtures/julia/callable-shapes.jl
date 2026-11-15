# callable-shapes.jl — the CALLABLE-NAME shapes, and the ones that name nothing at all.
#
# Every row here published a wrong symbol, a wrong member or no declaration at some point in this
# lane's history: a parametric alias the analyzer did not declare, a call-overload pattern named
# after its own argument (plain and with a `where`), a spliced member, an interpolated type head,
# and a long-form signature with no argument list.
module CallableShapes

struct Model
    value::Int64
end

# POSITIVE 1 — a PARAMETRIC ALIAS declares a type name. `Dims{N} = NTuple{N,Int}` is Julia's
# spelling for a parameterized alias; the assignment's left is a `parametrized_type_expression`,
# which is neither a call (a short-form method) nor a plain binding, so the assignment case used to
# skip it and `Dims` was never declared. 43 sites over the corpus, every one this shape.
Dims{N} = NTuple{N, Int64}

# NEGATIVE 1 — a CALL-OVERLOAD pattern declares a method on `Model`, not a binding named `m`.
# (julia/base/gmp.jl, Flux.jl's layers, Documenter's DOM: 423 sites corpus-wide.)
(m::Model)(x) = Model(x)

# NEGATIVE 2 — the same pattern with a `where` clause around the typed value. `unwrapWhere` walks
# THROUGH `typed_expression`, so testing its result never saw a typed node: this spelling read the
# pattern's variable `t` and published `contains CallableShapes -> t`.
@inline (t::Type{Model} where X)(x) = Model(x)

# NEGATIVE 3 — a SPLICED member is dynamic: `(Base.$fJ)(…)` names whatever the loop variable holds,
# so neither `Base` (the receiver) nor `fJ` is a member of this module. Corpus shape:
# julia/base/gmp.jl's `(Base.$fJ)(x::Rational{BigInt}, …)`.
for fJ in (:+ , :*)
    @eval (Base.$fJ)(a::Model, b::Model) = a
end

# NEGATIVE 4 — an INTERPOLATED type head is a runtime value, not a name. Corpus shape:
# julia/test/subtype.jl:2962 `@eval struct $(Symbol(:T58129, k)){T} end`.
for Gen in (:GeneratedOne,)
    @eval struct $Gen
        value::Int64
    end
end

# POSITIVE 2 — a long-form declaration with NO argument list declares its name, and the macro
# applied to it decorates it. Corpus shape: Documenter.jl/test/doctests/doctestapi.jl's
# `@doc @doc(foo) function bar end` — the declaration is the SECOND argument, after a nested macro.
@doc @doc(nothing) function bare_declaration end

end
