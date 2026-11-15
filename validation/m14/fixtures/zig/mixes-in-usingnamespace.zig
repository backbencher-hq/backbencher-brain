// `usingnamespace` composes another declaration SET into the enclosing container:
// the merged declarations become members of the host, and no conformance clause
// is declared anywhere in the statement. The pinned grammar carries
// `using_namespace_declaration`, so the relation is readable at rung R3 with no
// grammar change. The admitted corpus no longer contains the construct (Zig
// removed it from the language), which is why every positive shape is pinned
// here: a corpus zero must have a fixture that shows the emission works.
//
// The four argument forms, and the merged unit each names:
//   1. @import("x.zig")          -> the imported module's symbol (the file stem)
//   2. @import("x.zig").Member   -> the member expression's last name
//   3. an @import-binding alias  -> the alias binding (published as a symbol)
//   4. a same-file struct name   -> the written name

const merged = @import("merged.zig");

pub const Shared = struct {
    pub const answer: u32 = 42;
};

pub const Host = struct {
    pub usingnamespace Shared;
    pub usingnamespace @import("imported.zig");
    pub usingnamespace merged;
    pub usingnamespace @import("with_member.zig").inner;
};

// A file is a struct in Zig, so a file-scope `usingnamespace` composes into the
// file's own unit; its source is the file-scope marker the lane uses for
// relationships that belong to the unit rather than to a named container.
usingnamespace @import("root.zig");
