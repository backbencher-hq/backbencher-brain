module IncludeParts

include("part.jl")
include("src/nested.jl")

const dynamic = "dynamic.jl"
include(dynamic)
include(joinpath("src", "joined.jl"))

function wraps()
    include("inner.jl")
end

module Shadowed
    function include(x)
        x
    end
    include("not-a-file.jl")
end

end
