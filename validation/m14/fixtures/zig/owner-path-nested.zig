// Z-p22 — a container member's owner is the container's ABSOLUTE path, so a
// member is reachable from the only spelling that identifies its container.
//
// The shared projection spells a symbol `scope ? scope + "." + name : name`
// (pool-worker.ts:930). The analyzer set a member's `scope`/`ownerName` to
// `container.name` — the container's BARE name — so a container published its
// absolute name and its members published a relative one:
//
//   pub const IOSurface = struct {          // ghostty/pkg/macos/iosurface/iosurface.zig:10
//       pub const Error = error{             // container -> qn `IOSurface.Error`
//           InvalidOperation,                // member    -> qn `Error.InvalidOperation`
//
// `Error` alone is not a published qualified name anywhere in that file, so the
// `contains` edge named a source the graph could not reach, and the member was
// unreachable from the container. Measured over the published 3,834-file draw
// `sha256:2f3545f9`: 15,686 of 80,876 `contains` edges (19.4%), in 421 files.
//
// Every expectation here is derived from the Zig language rules and from the
// pinned wasm's own node types — NOT from analyzer output.

// ── nesting depth 2: the shape the corpus actually has ───────────────────────
// `Elf64.Chdr.reserved` is the measured site (zig/lib/std/elf.zig:1173-1177)
// and `Elf32.Chdr` (elf.zig:1083) is the reason a bare name cannot work: the
// file declares `Elf32.Chdr`, `Elf64.Chdr` AND a file-scope alias `Chdr`, so
// `Chdr` names three real declarations and an edge to it binds by a rule nobody
// chose.
pub const Elf64 = struct {
    pub const Chdr = extern struct {
        type: u32,
        reserved: u64 = 0,
        size: u64,
    };

    pub const Shdr = extern struct {
        sh_name: u32,
        sh_type: u32,
    };

    pub fn init() void {}
};

// ── nesting depth 3: the path must be the WHOLE chain, not one segment ───────
// A mutant that qualifies by exactly one level passes every depth-2 row above
// and fails here, which is why this row exists.
pub const Registry = struct {
    pub const Entry = struct {
        pub const Slot = struct {
            value: u64,
            tag: u8,
        };

        count: u32,
    };

    entries: [4]Entry,
};

// ── an ERROR SET nested in a container ──────────────────────────────────────
// The error-set member branch reads the container's name directly
// (`ownerName: container.name` at real-zig-analyzer.ts), so it is a second site
// the fix had to reach — `IOSurface.Error.InvalidOperation` is the measured one.
pub const IOSurface = struct {
    pub const Error = error{
        InvalidOperation,
        OutOfMemory,
    };

    handle: usize,
};

// ── the negative half: a FILE-SCOPE container is unchanged ──────────────────
// The path of a top-level container equals its bare name, so every one of these
// rows is what the analyzer published BEFORE the fix and must still publish.
// A mutant that simply prefixes something, or that qualifies every name it
// sees, cannot produce these spellings.
pub const Point = struct {
    x: i32,
    y: i32,
};

pub const Shape = union {
    circle: f32,
    rect: Point,
};

pub const Color = enum {
    red,
    green,
};

// ── a container inside a FUNCTION is still not published ─────────────────────
// Z22's refusal, kept here so a mutant that widens the path logic to every
// enclosing node does not pass by publishing these.
pub fn locals() void {
    const Case = struct {
        layout: u8,
        click_y: u32,
    };
    _ = Case{ .layout = 0, .click_y = 1 };
}

// ── a QUOTED component keeps the path joinable ──────────────────────────────
// `@"my type"` is a legal Zig identifier (zig/lib/std/demangle.zig uses the
// shape) and `canonicalizePublishedNames` strips quoting from `ownerName` but
// NOT from `scope`. So the path is built from ALREADY-STRIPPED components: a
// raw `@"my type"` component would spell the member `@"my type".field` while
// the container spells `my type`, which is the same split this change removes,
// one level down. The corpus form is `= <container>`; the first draft of this
// fixture wrote `:` and the grammar read that as a field with an inline struct
// type, so the row asserted a shape Zig does not have.
pub const @"my type" = struct {
    field: u8,
};

pub const @"outer" = struct {
    @"inner name": u8,
    plain: u8,
};

