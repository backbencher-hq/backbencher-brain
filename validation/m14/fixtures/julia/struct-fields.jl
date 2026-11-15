module StructFields

Base.@kwdef struct Config
    depth::Int = 1
    name::String = ""
end

struct Bare
    value
end

mutable struct WithConst
    const id::Int
end

struct Inner
    x::Int
    Inner(x) = new(x)
end

end
