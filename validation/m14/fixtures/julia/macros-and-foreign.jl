# Julia fixture — macro definitions, `@ccall`, and the function form of `ccall`.
#
# The distinction pinned here is the one that produced a real defect: a C symbol
# reached through `ccall`/`@ccall` is a real CALL, but its target is not a Julia
# binding. Both spellings must report it, and the two-tuple form must keep the
# library the source states.
module Native

export measure, describe_size

macro cached(expr)
    quote
        local v = $(esc(expr))
        v
    end
end

# Function form: the C symbol is the first ARGUMENT, as a quote_expression or a
# tuple of them, and the two-tuple form names the library.
measure(p::Ptr{Float64}) = ccall(:jl_issorted, Cint, (Ptr{Float64}, 1), p)
allocate(n::Integer) = ccall((:malloc, :libc), Ptr{Cvoid}, (Csize_t, n))

# Macro form: the C function sits in an ordinary `call_expression` inside the
# macro's argument list, so it is indistinguishable from a Julia call unless the
# analyzer knows it is under an `@ccall`.
function describe_size(s::Ptr{UInt8})
    Base.@ccall strlen(s::Ptr{UInt8})::Csize_t
end

# A macro DEFINITION is a declaration and must appear as a macro symbol, owned by
# the module that contains it.
@inline fast(x) = x

end # module Native
