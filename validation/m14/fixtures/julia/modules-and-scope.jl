# Julia fixture — modules, using/import, export, and FILE-SCOPE code.
#
# Julia files do not have to open a module. This one deliberately does not, because
# the majority of corpus files do not: measured over 295 tracked files, 71.9% have
# no module block at all. Top-level code in such a file is ordinary executable
# code, so its calls must be attributed to something rather than dropped.
using LinearAlgebra
import Base: show

const DEFAULT_SCALE = 2.0

mutable struct Counter
    value::Int
end

function bump!(c::Counter, by::Int=1)
    c.value += by
    return c
end

# Short form at FILE scope — `bump!` above, this one below.
label(c::Counter)::String = string(c.value)

# A qualified declaration extends another module's function; the qualified path
# is the identity of the binding, so the symbol is `Base.show`, not `show`.
Base.show(io::IO, c::Counter) = print(io, "Counter(", c.value, ")")

# Top-level executable statements, outside any declaration.
total = label(Counter(1))
println(total, DEFAULT_SCALE)
