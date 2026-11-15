module Decorated

export Config, fast, documented, short

Base.@kwdef mutable struct Config
    depth::Int = 1
end

@inline function fast(x::Int)
    x + 1
end

@doc "documented is decorated by @doc." function documented()
    nothing
end

@inline short(x) = x

@time fast(1)

end
