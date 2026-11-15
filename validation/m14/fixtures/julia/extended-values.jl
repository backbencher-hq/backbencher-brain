module ExtendedValues

export Shape, Circle, render

abstract type Shape end

struct Circle <: Shape
    radius::Float64
end

@inline function area(c::Circle)
    c.radius * c.radius
end

function render(c::Circle)
    string("circle ", area(c))
end

render(Circle(1.0))

end
