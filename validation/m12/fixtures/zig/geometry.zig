// validation/m12/fixtures/zig/geometry.zig
// M12.20 Zig positive fixture: structs, enums, unions, functions, constants,
// pointer parameters, error unions, imports, calls.

const std = @import("std");

pub const MAX_POINTS: usize = 1024;

pub const Point = struct {
    x: f64,
    y: f64,

    pub fn init(x: f64, y: f64) Point {
        return Point{ .x = x, .y = y };
    }

    pub fn distance(self: Point, other: Point) f64 {
        const dx = self.x - other.x;
        const dy = self.y - other.y;
        return @sqrt(dx * dx + dy * dy);
    }
};

pub const ShapeType = enum {
    circle,
    square,
    triangle,
};

pub const Circle = struct {
    center: Point,
    radius: f64,
};

pub const Shape = union(enum) {
    circle: Circle,
    point: Point,

    pub fn area(self: Shape) f64 {
        return switch (self) {
            .circle => |c| std.math.pi * c.radius * c.radius,
            .point => 0.0,
        };
    }
};

pub const ParseError = error{ InvalidPoint, OutOfMemory };

pub fn parsePoint(text: []const u8) ParseError!Point {
    if (text.len < 3) return ParseError.InvalidPoint;
    return Point.init(0.0, 0.0);
}

pub fn main() void {
    var a = Point.init(1.0, 2.0);
    var b = Point.init(4.0, 6.0);
    const dist = a.distance(b);
    var circle = Circle{ .center = a, .radius = 5.0 };
    var shape = Shape{ .circle = circle };
    _ = shape.area();
    _ = dist;
}
