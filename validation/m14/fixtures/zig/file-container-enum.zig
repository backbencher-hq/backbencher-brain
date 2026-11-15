// M13b — a file that IS an enum. The companion to `file-container-fields.zig`,
// and the reason the kind of a file-level field cannot be taken from the
// container's published kind.
//
// `const Color = @This();` publishes `Color` as a `Type`, and so does
// `const Widget = @This();` for the struct case — the binding is a
// `variable_declaration` and the analyzer cannot tell from it whether the body
// is a struct or an enum. So for a file-level field the ONLY evidence is the
// field's own `type` FIELD: the grammar uses one node type (`container_field`)
// for `a: u8` and for `north`, and only the former carries a type. That is this
// analyzer's own discriminator, used the same way inside a named container at
// `:2180`.
//
// The rows below pin both halves: a bare member is an `enum_member` owned by the
// file's container, and a `pub const` member is a `constant` — a different node
// type entirely, which a "no type field means enum member" rule applied to
// `variable_declaration` would get wrong.

const Color = @This();

const std = @import("std");

// Bare members: `container_field` with no `type` field. These are the enum
// members, and they are what the shape exists for.
red,
green,

// A member spelled as a `const` declaration instead: a `variable_declaration`,
// so it is a constant and NOT an enum member — the same value the language gives
// it inside a named enum. Getting this one wrong is a mislabel in the direction
// that looks plausible, because `blue` is textually an enum member to a reader.
pub const blue = 2,

pub fn name(self: Color) []const u8 {
    return switch (self) {
        .red => "r",
        .green => "g",
        .blue => "b",
    };
}
