// Z65 — target scope. A zig relationship carries six keys and both endpoints are
// NAME STRINGS, so an edge's name is all a reverse walk has. These are the shapes
// that decide whether a name-keyed bind lands on the declaration the author meant.

const std = @import("std");

// A `pub const` whose name the file publishes: an edge naming it is file-local
// and the kind is decidable from this file alone.
pub const Local = struct {
    field: u32 = 0,

    pub fn make() Local {
        return .{ .field = 0 };
    }
};

// TWO kinds under ONE name in this file. `Collide` is a type and a function, so
// `targetKind` must be ABSENT and `targetKindCount` must say 2 — picking one would
// be the guess this annotation exists to refuse.
const Collide = struct { x: u8 = 0 };
fn Collide() void {}

// An EXTERNAL name: nothing in this file declares `ArrayList`, so no per-file
// rule can pick and the edge must say so rather than implying it can.
fn external() void {
    var list: std.ArrayList(u8) = undefined;
    _ = list;
}

// An import PATH as a target — also external, and a path can never be a symbol.
fn importer() void {
    const other = @import("./other.zig");
    _ = other;
}

fn local() void {
    const made = Local.make();
    _ = made.field;
    _ = Collide();
}
