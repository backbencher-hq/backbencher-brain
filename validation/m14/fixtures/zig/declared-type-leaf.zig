// Z13/Z16/Z18 — the DECLARED-TYPE graph: which type a declaration names, and
// what its text is when the name is a quoted identifier. Every expectation in
// `declared-type-leaf.expectation.json` is derived from the grammar's own
// `type` FIELD and from the Zig reference, not from analyzer output.

// ── Z13a: a declaration's DEFAULT VALUE is not its type ─────────────────────
// The leaf used to be "the last identifier anywhere under the declaration",
// and a default value contributes identifiers after the type: `size: Size =
// .byte` published a reference to `byte` — an enum member — and never to `Size`.
// Measured corpus-wide, the sites where the emitted target changes are dominated
// by exactly this shape (`script/m14/tmp/zigw-decltype.ts`).
const std2 = @import("std");
const Size = enum(u8) { byte, word };
const Slice = struct { items: []const u8 };
const Mode = enum { a, b };

const Fmt = struct {
    size: Size = .byte,
    mode: Mode = .a,
    n: u32 = 0,
    view: Slice = .{},
    fixed: [4]Size = undefined,
    maybe: ?*Slice = null,
};

// ── Z13b: a type that NAMES nothing publishes nothing ───────────────────────
// An anonymous struct type in a parameter position has fields, not a name, and
// the last identifier under it is a FIELD name. An error SET is unnamed for the
// same reason, and `!T` keeps its dependency in the `ok` half, not in a member
// of the error set.
const Opaque1 = struct { FLAG: u8 };
const Boom = error{ NotFound };
fn anon(s: struct { FLAG: u8 }) void { _ = s; }
fn errUnion() Boom!Fmt { return undefined; }
fn errUnionAnon() error{ Fresh }!Fmt { return undefined; }
fn errUnionVoid() Boom!void {}
fn wrapped() [4]Size { return undefined; }
fn qualified(w: std2.mem.Allocator) void { _ = w; }

// ── Z16: the local annotation is a declared type too ────────────────────────
// The family declares four positions (field, parameter, return, local); the
// collector covered three. A local carries the grammar's `type` field 43,949
// times in the pinned corpora.
fn local() void {
    var p: Fmt = undefined;
    const q: Size = .byte;
    const w: Slice = .{ .items = "" };
    _ = p;
    _ = q;
    _ = w;
}

// A local whose type is named NOWHERE else in the file, so the collector's
// per-file dedupe cannot hide the position: this row fails if the local
// position is not read at all.
const Only = struct { v: u8 };
fn localOnly() void {
    var o: Only = undefined;
    _ = o;
}

// ── Z18: a quoted identifier is published AS WRITTEN ─────────────────────────
// `@"weird type"` is the identifier's source spelling and that is what every
// other surface of this analyzer publishes (symbol names, `uses` field leaves,
// call leaves), so edges resolve inside the index. The junk-strip regex that
// used to sit on this path could only ever fire HERE — a plain identifier is
// `[A-Za-z_][A-Za-z0-9_]*` — and where it fired it CORRUPTED the name:
// `@"zig lib"` became `@"ziglib"`, `@"weird function name"` became
// `@"weirdfunctionname"`. 1,916 of the corpora's 34,132 quoted identifiers carry
// a character from that class (`script/m14/tmp/zigw-remaining.ts`,
// and the textual probe in the review).
const @"weird type" = u32;
const Holder = struct {
    @"odd field": @"weird type" = 0,
};
fn usesQuoted(x: @"weird type") void { _ = x; }
