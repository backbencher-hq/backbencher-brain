// Z-p20 — an enum member may be NAMED with a primitive type name, and the lexer
// spells that name as a `builtin_type` node rather than an `identifier`.
//
// Zig has no reserved words: `bool`, `u8`, `usize`, `type`, `void`, `noreturn`
// and `anyerror` are ordinary identifiers in declaration position. The corpus
// uses that, in 122 places over 28 files on the published 3,834-file draw
// `sha256:2f3545f9`, e.g.
//
//   pub const Feature = enum { bool, clamps, coprocessor, ... }   xtensa.zig:8
//   pub const TypeId  = enum { bool, ... }                       Build.zig:232
//   const BlockType   = enum(u8) { f64 = 0x7C, f32 = 0x7D, ... }  wasm.zig:663
//
// Every expectation here is derived from the Zig reference (an enum body has no
// positional form, so a bare token in one is a member name) and from the pinned
// wasm's own node types — NOT from analyzer output.

// ── the positive half: a member named with a primitive type name ────────────
pub const Feature = enum {
    bool,
    usize,
    type,
    void,
    noreturn,
    anyerror,
    // a neighbour that needs none of this, so a mutant that simply publishes
    // EVERY bare token in the file cannot pass by publishing everything
    clamps,
    coprocessor,
};

pub const BlockType = enum(u8) {
    f64 = 0x7C,
    f32 = 0x7D,
    custom = 0x00,
};

// ── the second positive half: a member named with a KEYWORD LITERAL ─────────
// Same rule, three more node types. `SimpleValue.undefined` / `.null` / `.true`
// are real members of zig/src/InternPool.zig:6318 and `OptRef.null` a real
// member of aro/backend/Interner.zig:265, so the lexer spelling these as
// `undefined` / `null` / `boolean` does not make them expressions.
pub const SimpleValue = enum(u32) {
    undefined = 0,
    null = 1,
    true = 2,
    false = 3,
    void = 4,
};

// ── the negative half, and it is the reason the rule is gated ───────────────
// A STRUCT body does have a positional form, so `struct { usize, bool }` names
// nothing: the bare tokens are element TYPES. The corpus has 332 of these
// against the enum's 122, and an earlier version of this analyzer that published
// them fabricated 31 `contains` edges in one file. They must stay unpublished.
const Tuple = struct { usize, bool };
const Bound = struct { []const u8, u32 };
const Tag = union { usize, bool };

// a named field whose TYPE is a builtin is unaffected either way — the type
// lives in the grammar's `type` FIELD, so this was never the ambiguous shape
const Sized = struct {
    usize: u32,
    bool: u8,
};

pub fn useTuple() usize {
    const t = Tuple{ 0, false };
    return @sizeOf(@TypeOf(t));
}