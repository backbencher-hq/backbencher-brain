// M13 — a file that IS a struct. Zig lets a file's top level be a struct body:
// `const Widget = @This();` followed by bare fields. The grammar states that
// structurally — the fields arrive as `container_field` whose DIRECT parent is
// `source_file`, not as a child of any `container_declaration`.
//
// Before this shape was read, the file published its own type and none of its
// own fields, so every read of one was a `uses` edge naming a declaration the
// parser already had in hand. Measured over the published 3,834-file draw:
// 411 files carry at least one such field, 3,324 in all, and 2,892 of those
// names were published nowhere in their own file.
//
// The rows below are the four places a plausible implementation goes wrong:
// the field is published; the CONTAINER it belongs to is the file's `@This()`
// binding and not the file's own name; a file that does not bind `@This()` still
// publishes its fields but owns nothing; and the corpus's malformed
// file-level-tuple cases must mint nothing at all.

const Widget = @This();

const std = @import("std");

// ── a field OF THIS FILE. Owned by `Widget`, because `Widget = @This()` names
// the file's own struct. `count` is read below, and that read must resolve.
pub count: u32 = 0,
name: []const u8 = "w",

// An ORDINARY named struct in the same file, which must be untouched: its
// fields are owned by it and were already published before this shape was read.
// A change that published file-level fields by attributing them to the nearest
// declaration would double-publish `inner` here.
pub const Nested = struct {
    inner: u8 = 0,

    pub fn get(self: Nested) u8 {
        return self.inner;
    }
};

/// A comptime-only field with a default that is itself a call, so the field's
/// `type` FIELD is the only thing that can name its type.
allocator: std.mem.Allocator = undefined,

/// A field whose type is a pointer to a container declared in this file.
owner: ?*Nested = null,

pub fn bump(self: *Widget) u32 {
    // Every one of these names a declaration THIS FILE declares, and each must
    // now resolve. `self.count` is the shape the whole change exists for.
    self.count += 1;
    return self.count;
}

pub fn describe(self: Widget) []const u8 {
    return self.name;
}
