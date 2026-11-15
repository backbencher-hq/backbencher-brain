// ── Z30/Z32/Z33: the relationship TYPES, one site each ──────────────────────
// Wave 4 asked the blunt question — is any relationship type the engine defines
// left unaccounted for? — and the answer was no for six types and "the census
// caught me" for `exports`. This fixture pins the three sites that were missing a
// type or a line, so a lane that stops emitting one of them fails here rather
// than in a percentage.
//
// Z30 (`imports`): a module dependency is not a symbol. The path `../helper.zig`
// contains a separator no zig declaration name can hold, which is the same
// argument go made for moving its own import edges off `references`.
const helper = @import("../helper.zig");
const prefixed = @import("std").ArrayList;

// Z30b: a re-export. `pub const X = @import(...)` is the canonical zig
// re-export idiom and it is a file-scope `pub`, so it belongs in the export
// surface; 119 of them were missing from it.
pub const reexported = @import("reexported.zig");

// Z32 (`instantiates`), class 1: a call to an in-file `fn ... type` is a
// generic type application, derivable from the declaration alone.
pub fn Scaled(comptime T: type, comptime factor: u8) type {
    return struct { value: T, scale: u8 };
}
pub const Small = Scaled(u8, 4);

// Z32, class 2: a construction of an in-file type. `Point{ .x = 1 }` is the
// value-position instantiation ZIG.GAP.3 has wanted since it was written.
pub const Point = struct { x: u32, y: u32 };
pub const origin = Point{ .x = 0, .y = 0 };
// A QUALIFIED head is the same class: `Color.C{ .r = 0 }` \u2014 the first version of
// the mirror accepted only a bare identifier and read 2 PHANTOM rows.
pub const Nested = struct {
    pub const Inner = struct { v: u8 };
    pub const made = Inner{ .v = 1 };
};

// Z33 (`exports`): `pub` and `export` both publish a file-scope declaration.
pub const published = 1;
pub fn alsoPublished() void {}
export fn cAbiExported() void {}
// ... and a `pub` INSIDE a container is deliberately NOT an export (Z20): it is
// reached as `Nested.made`, so it is a `contains` edge and a visibility.
pub const NotAModuleExport = struct {
    pub const member_level = 2;
};

// Z31: the published type-bearing payload is canonicalized too. A quoted type
// is written `@"weird type"` and PUBLISHED as `weird type`; leaving the sigil in
// `returnType` while the edge target is bare makes the two unjoinable.
pub const Quoted = struct {
    @"odd field": @"weird type",
    fn usesQuoted(x: @"weird type") @"weird type" { _ = x; }
};

// ── Z38: a DOTTED type path in a signature is a declared-type fact ──────────
// The type-position guard used to test only the DIRECT parent, so every segment
// of a qualified type in a signature had a `field_expression` parent, none was
// recognised as a type position, and each was published as a `uses` READ of a type
// name — duplicating the declared-type class, which already publishes
// `references (declared-type) -> Local` for the same text. 480 rows over 200
// corpus files, and invisible at name level.
const Local = struct {
    pub const Opts = struct { a: u8 };
    pub const Res = struct { b: u8 };
};
pub fn dottedPathInSignature(o: Local.Opts, r: Local.Res) void {
    _ = o;
    _ = r;
}

// ── Z39: a named test is a SCOPE with a name ────────────────────────────────
// Neither attribution pass recognised `test_declaration`, so every read and call
// inside a named test was attributed to `(global)`. The shared matcher discards
// the source, so this class is invisible to it by construction.
// The read has to be of a FILE-SCOPE value: an import binding is a declaration,
// not a read, so `const marker = @import(...)` inside the test would assert
// nothing — which is exactly what the first version of this row did, and the
// fixture runner reported it honestly instead of accepting an inert assertion.
const fileLevelValue: u32 = 5;

test readsInsideANamedTestAreAttributedToTheTest {
    _ = fileLevelValue;
}
