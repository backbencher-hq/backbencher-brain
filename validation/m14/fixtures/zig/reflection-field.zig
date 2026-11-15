const std = @import("std");

const Point = struct {
    x: i32,
    y: i32,
    z: i32 = 0,

    pub fn origin() Point {
        return .{ .x = 0, .y = 0, .z = 0 };
    }
};

const HasFuncs = struct {
    one: *const fn (i32) i32,
    two: *const fn (i32) i32,
};

// POSITIVE: a read of a member by name-as-text. `x` is a `container_field` of `Point`, which
// `contains` publishes, so this edge resolves at both ends inside the file.
fn readByName(p: Point) i32 {
    return @field(p, "x");
}

// POSITIVE: an ASSIGNMENT through the reflected field. The left-hand `@field(p, "y")` is an
// assignment target rather than a read, but it still names the member `y` the function
// reaches, and so does the right-hand `@field(p, "x")` — two edges from one source.
fn writeByName(p: *Point) void {
    @field(p, "y") = @field(p, "x") + 1;
}

// POSITIVE: a read of a FUNCTION-valued member, then a call of the value read. The edge is to
// the member `one`, not to a `calls` edge on `one` — the name is data here, not a callee the
// analyzer can resolve by position.
fn callByName() i32 {
    return @field(HasFuncs, "one")(0);
}

// POSITIVE, AND THE TARGET DOES NOT RESOLVE: the container is a field expression rather than a
// bare identifier. This is the corpus's one application-code `@field` site
// (ghostty/src/input/Binding.zig:1324, `@field(field.type, "default")`), where the target `x`
// has FOUR published symbols in the file. Here nothing publishes `default`, so `targetScope` is
// `file-external`: the edge is TRUE and it says so, rather than the analyzer picking one of the
// four. This row pins that the container's SHAPE does not suppress the edge — the ambiguity is
// the consumer's to resolve, and it is disclosed rather than hidden.
fn containerMayBeAnExpression(field: struct { type: anytype }) void {
    _ = @field(field.type, "default");
}

// POSITIVE, AND THE TARGET IS GENUINELY OUTSIDE THE FILE: `Type.Int` is a member of
// `std.builtin.Type`, read through `@typeInfo`. The name is identifier-shaped so the edge is
// emitted; `targetScope` is `file-external` because no per-file rule can bind it.
fn builtinEnumMemberIsExternal() void {
    if (@field(@typeInfo(u8), "Int")) |_| {}
}

// NEGATIVE: `@hasDecl` is an EXISTENCE TEST, not a read. The code handles both answers, so an
// edge here would assert a dependency the source deliberately does not take. The container IS
// read — `Point` gets its declared-type edge — but the member must not be named.
fn hasDeclIsNotARead() void {
    if (@hasDecl(Point, "x")) {
        std.debug.print("has x\n", .{});
    } else {
        std.debug.print("no x\n", .{});
    }
}

// NEGATIVE: the member name given by a COMPTIME VALUE names nothing statically, which is the
// majority shape in the corpus — 757 of the 779 `@field` sites.
fn comptimeNamedMember(comptime field_name: []const u8, p: Point) void {
    _ = @field(p, field_name);
}

// NEGATIVE: an error-set member name is legal Zig and is NOT identifier-shaped.
// `@field(anyerror, "Expected closing ]")` is a read of an error-set member, not of a
// declaration named `Expected closing ]`. Publishing such text as a bare target is what produced
// targets like `@"ziglib"` for legitimate names once already (Z18); three corpus sites are
// exactly this shape (`zig/lib/std/fmt.zig:1550,1557`, `zig/test/behavior/error.zig:897`) and
// all three resolve to nothing published.
fn errorNameIsNotAMemberName() void {
    _ = @field(anyerror, "Expected closing ]");
}

test "reflection field reads" {
    var p = Point.origin();
    try std.testing.expectEqual(@as(i32, 0), readByName(p));
    writeByName(&p);
    try std.testing.expectEqual(@as(i32, 0), p.y);
    callByName();
    containerMayBeAnExpression(.{ .type = Point });
    builtinEnumMemberIsExternal();
    hasDeclIsNotARead();
    comptimeNamedMember("x", p);
    errorNameIsNotAMemberName();
}