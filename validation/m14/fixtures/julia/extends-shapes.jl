# extends-shapes.jl — the `<:` shapes that ARE subtype facts, and the three that are NOT.
#
# Every row here is one shape that has produced a wrong published edge or a wrong truth row at some
# point in this lane's history; the expectation beside this file pins both directions.
module ExtendsShapes

abstract type Root end
abstract type Mid <: Root end

# POSITIVE 1 — a declaration's supertype. The baseline every other row is read against.
struct Leaf <: Mid
    value::Int64
end

# POSITIVE 2 — a CHAIN states one fact per ADJACENT PAIR, and both ends are NAMES:
# `LB <: A <: Mid` is `LB <: A` and `A <: Mid`. The pre-fix analyzer published a single edge whose
# SOURCE was the fragment `LB <: A`, which is not a symbol and can resolve to nothing.
chained(x::A) where {LB <: A <: Mid} = x

# POSITIVE 3 — a `where` bound INSIDE a supertype argument bounds the ARGUMENT's type variable.
# `Tuple{Vararg{Y, N}} where {X, Y <: Bounded}` makes Y a subtype of Bounded; that is a fact about
# Y, not about Bounded, and both sides must derive it.
struct Bounded{A, N} <: AbstractVector{Tuple{Vararg{Y, N}} where {X, Y <: Bounded}}
end

# NEGATIVE 1 — an INTERPOLATED declaration name is a RUNTIME value. `$Generated` is the loop
# variable, not a type this file declares, so there is no type named `Generated` and no
# `Generated <: Root`. (Corpus shape: julia/stdlib/Dates/src/types.jl, test/core.jl, newinterp.jl.)
for Generated in (:GeneratedOne, :GeneratedTwo)
    @eval struct $Generated <: Root
        value::Int64
    end
end

# NEGATIVE 2 — a `<:` in a type PARAMETER's bound is a fact about the PARAMETER, never about the
# declared type: `struct Parameter <: Root` here would be a fabricated supertype.
struct Parameter{T <: Mid}
    value::T
end

# NEGATIVE 3 — the pinned grammar wraps a `where` around a WHOLE comparison when the comparison is
# what is written (`<expr> <: <expr> where T`), putting the type variable AFTER the binary. That is
# a comparison, not a bound: no `Pair extends Tuple` and no bound on T. (Corpus shape:
# julia/test/subtype.jl:2769, :1588, :1761 and :1762.)
checked = Pair{Int64, Int64} <: Tuple{Vararg{T}} where T

end
