# Julia fixture — multiple dispatch, type hierarchy, and BOTH function forms.
#
# Authored from Julia semantics BEFORE the analyzer was run against it, so the
# expectations are a test and not a snapshot of whatever the analyzer happened
# to emit.
module Geom

export Area, Shape, Circle, Square

abstract type Shape end

struct Circle{T<:Real} <: Shape
    radius::T
end

struct Square{T<:Real} <: Shape
    side::T
end

# TWO methods, ONE function symbol. Julia dispatches on argument types, so both
# are live simultaneously and neither replaces the other. An `overrides` edge
# between them would state a falsehood, which is why the analyzer declines the
# relation rather than inventing a substitute for it.
#
# THE KEYWORD PARAMETER AND THE CALL THROUGH IT PIN AN F1 (GRAMMAR-AUDIT) FIX. F1 reported the
# node-type literal `parameters` as unregistered: this grammar has no such node, and the construct
# the branch was reaching for is `named_argument` (`f(a; x=1)` dumps as
# `argument_list(identifier, named_argument(identifier, operator, …))`). Naming the real construct
# matters because a keyword parameter is a LOCAL BINDING: `f` must be collected for `Area`'s scope,
# so `f(...)` is published as a call to `Area\0f` carrying `metadata.localBinding` — a call through
# the argument — and not as a bare call to a declaration named `f`. This row fails against the
# pre-fix analyzer, which published `Area -> f`.
Area(c::Circle; f=identity) = f(c.radius^2)
Area(s::Square) = s.side^2

# Long form, with a `where` bound and a return type annotation. THE `&&` GUARD PINS THE SECOND F1
# FIX: `binary_expression`'s operator is a NAMED CHILD at index 1, not a field — the grammar's six
# field names do not include `operator` — so `&&`/`||` are decision points, and this symbol's
# complexity is 3 (base 1 + `if_statement` + `&&`). It read 2 while the analyzer asked for an
# `operator` field the grammar does not have.
function scaled{T<:Real}(s::Shape, k::T)::Float64
    if k > zero(T) && k < one(T)
        return k
    end
    return k
end

# Short form WITH a return type: the left-hand side is a `typed_expression`
# wrapping the call, which is a different tree shape from `f(x) = ...`.
perimeter(c::Circle)::Float64 = 2 * c.radius

# A type parameter's BOUND is a subtype edge from the PARAMETER, not from the function. The braced
# spelling is the one people write, and it puts the bound inside a `curly_expression` rather than
# among the `where_expression`'s direct children — so the unbraced form was found and the braced one
# was missed, and `function scaled{T<:Real}(…)` published no bound at all. A `>:` UPPER bound is the
# same edge with the other operator, and the operator test said `>` where it must say `>:`.
bounded{T<:Real}(x::T) = x
capped{T>:Int}(x::T) = x

# A CONSTRUCTION that appears BEFORE its type declaration is still a construction. The set of
# declared types used to be filled DURING the walk and consulted during it, so this was a plain
# `calls`; it is now a pre-pass. Julia does not care about declaration order within a module, so
# "defined above the use" is a habit, not a rule.
early = Deferred(1)

struct Deferred
    n::Int
end

end # module Geom