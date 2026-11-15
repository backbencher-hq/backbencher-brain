# Minimal Julia fixture for the M12 language-coverage gate.
#
# Julia had no fixture anywhere in the repository when this gate was written
# (validation/m12/fixtures/ had no julia/ directory), so a coverage claim for it
# rested on nothing in-tree. Two named declarations: a struct (the type) and a
# function.

struct CoveragePoint
    x::Int
    y::Int
end

function coverage_add(a::Int, b::Int)
    return a + b
end
