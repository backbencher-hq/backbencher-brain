// Z11/Z12/Z19 — the KIND of a declaration, the OWNER of its declarations, and
// the executable body of a labeled block. Every expectation in
// `kinds-and-owners.expectation.json` is derived from the Zig language rules
// (script/m14/tmp/zigw-battery.ts cases A1-A3, R1, and the corpus census in
// script/m14/tmp/zigw-kinds.ts), not from analyzer output.

// ── Z11a: a VALUE expression with an upper-case name is a constant ──────────
// No Zig type is a bit-shift, a bitwise-not, a negation, an anonymous tuple or
// a list literal. Pre-fix all five of these were published as `type`.
const SHIFT = 1 << 10;
const MASK = ~@as(u32, 0);
const NEG = -1;
const Tuple = .{ 1, 2 };
const TUPLE = .{ 1, 2 };
const NAMES = [_]u8{ 1, 2, 3 };

// ── Z11b: a TYPE alias is a type, whatever the name's case ──────────────────
// `const Pos = c_long;` names a type. Pre-fix `builtin_type` sat in the
// VALUE list, so every alias to a builtin was published as a constant — 440
// sites corpus-wide, 160 of them upper-case.
const Pos = c_long;
const Id = u32;
const Buf = []const u8;
const Opt = ?*Pos;
const small = u8;

// ── Z11c: the two-sided forms keep the name heuristic (the pinned contract) ──
// `pub const B = A` is a type alias; `const b = a` is a value. 30 corpus
// parenthesized forms and 736 generic calls stay on this rule, declared as
// counted limitations rather than guessed at.
const ALIAS = Pos;

// ── Z11d: an array OF TYPES is a type, not a value ──────────────────────────
// `[_]type{gtk.Scrollable}` was the one `struct_initializer` shape that is a
// type; the element type is a direct child of the initializer.
const Implements = [_]type{ u8, Pos };

// ── Z12: an opaque type is a CONTAINER ──────────────────────────────────────
// `opaque {}` has no fields, but it declares functions and constants. Pre-fix
// the walk did not recognise it as a container, so every declaration inside it
// came out as a free file-scope Function with no owner and no `contains` edge:
// 123 opaque containers in the pinned corpora, 352 declarations.
const Handle = opaque {
    pub fn create() Handle { return undefined; }
    pub fn destroy(self: Handle) void { _ = self; }
    pub const tag: u8 = 1;
};

// ── Z19: a labeled block is an EXECUTABLE body ──────────────────────────────
// `const V = blk: { … break :blk v; }` computes a value, and the `var`s inside
// it are comptime locals. Pre-fix the locals of that block were published as
// file-scope symbols — 70 symbols inside 35 block-shaped declarations over 400
// corpus files, including 27 `contains` edges attributing them to the enclosing
// container, two levels below where they were written.
const Labeled = blk: {
    var scratch: u32 = 3;
    break :blk scratch;
};

const Packed = blk: {
    var total: u32 = 0;
    for (0..4) |i| {
        const step = i * 2;
        total += step;
    }
    break :blk total;
};

// A value read of a labeled-block constant is a genuine bare read; before the
// fix `Labeled` was a `type`, and types do not resolve as values, so the read
// was invisible.
fn reader() void {
    _ = SHIFT;
    _ = NAMES;
    _ = Labeled;
    _ = Packed;
}

// ── Z21: an ANONYMOUS container in an expression position owns nothing ───────
// A container declaration is only a container when it is a declaration's
// right-hand side. The same node reached as an EXPRESSION — the branch of an
// `if`/`switch`, a struct literal in a prune — established no container, so its
// declarations were published as members of whatever enclosed them: the fields
// of a union variant's payload became members of the UNION, and where two
// variants declare the same field the two distinct declarations were published
// under ONE identity (measured: 422 symbols and 308 `contains` edges removed
// over 800 corpus files, with 0 added, and `property libc owner=Value` twice in
// one file at lines 19 and 25).
const Payload = union(enum) {
    native: struct {
        libc: u8,
        framework: u8,
    },
    cross: struct {
        libc: u8,
    },
};

const Conditional = if (builtin.os.tag == .windows) Payload else struct {
    pub inline fn helper() void {}
};

const Pruned = switch (@import("builtin").mode) {
    .Debug => std.debug.assert,
    else => (struct {
        inline fn assert(ok: bool) void {
            _ = ok;
        }
    }).assert,
};

// ── Z22: a CONTAINER declared inside an executable body owns nothing ────────
// A local type has no file-scope identity, so its declarations cannot be
// attributed to the enclosing container. Pre-fix `callback` was published as a
// Method OWNED BY `Callback` (the enclosing struct) with a
// `contains Callback -> callback` edge — and no differential can see that class,
// because the coverage match is `label + target` and ignores the source. The
// ownership verifier (script/m14/tmp/zigw-ownership.ts) found it in 150 files.
const Host = struct {
    pub fn run(comptime T: type) void {
        const Local = struct {
            pub fn helper(v: T) void {
                _ = v;
            }
            pub const limit: u8 = 3;
        };
        _ = Local;
    }
};

// ── Z26: a function-pointer TYPE is not a method ───────────────────────────
// `f: *const fn (a: u8) callconv(.c) ComparisonResult` parses as
// container_field > pointer_type > function_signature, and a function_signature
// has NO `declarator` field — so the old `anyChild(identifier)` name-picking
// took the RETURN TYPE and published a method named `ComparisonResult` on the
// enclosing struct. The field below also carries a qualified segment
// (`*apprt.ClipboardRequest`) inside its function-pointer parameters, which read
// as a method named `apprt`. Two methods that do not exist, in a class that is
// 16.6% of everything this analyzer emits.
const Sort = struct {
    less: *const fn (a: u8, b: u8) callconv(.c) ComparisonResult,
    pub fn sortWith(comptime cmp: ?*const fn (x: u8) callconv(.c) Order) void {
        _ = cmp;
    }
};

// ── Z28: a field's name is not a length test ───────────────────────────────
// The extraction used to require `length < 50`, which dropped 14 REAL field
// declarations out of 27,004 in 1,200 corpus files (0.05%): an LSP capability
// flag 74 characters long, and the aro `__builtin_amdgcn_wmma_*` shims at
// 50-52. A declaration that exists in the source was absent from the index, and
// no count of published symbols could show it — the class is a LOSS, so the only
// instrument that finds it is one that asks what SHOULD be there. The name now
// comes from the grammar's own `name` field, and the cap (200) is stated as the
// guard it is rather than used as a filter.
const Capabilities = struct {
    supports_workspace_did_change_configuration_dynamic_registration: bool = false,
    short_name: bool = false,
};

// ── Z29: the right-hand side of a field assignment READS ───────────────────
// `limits.field_assignment_rhs = field_assignment_rhs;` parses as a
// variable_declaration whose first named child is the field_expression (the
// LHS) and whose first IDENTIFIER child is the VALUE. The extraction tested
// "first named child of type `identifier`" and therefore declared the read to
// be a definition, so the analyzer published no `uses` for it. The same
// predicate was wrong twice in the truth first (Z24, Z25) and the analyzer's
// copy was the third — the correct version (`isWriteLhs`, node identity against
// the first named child) was already in this file, 600 lines away.
const field_assignment_rhs: u32 = 7;

const limits = struct {
    pub fn apply() void {
        limits.field_assignment_rhs = field_assignment_rhs;
    }
};

// ── Z46: `_` in a BINDING is a discard; `_` in a DECLARATION is a name ─────────
// `const _ = 1;` mints nothing (Z8/GO5, and it still does). But `pub fn _()` is a
// real, callable declaration — the gettext convention: ghostty's whole i18n entry
// point is `pub fn _(msgid: [*:0]const u8) [*:0]const u8`. Excluding it from the
// FUNCTION branch left the analyzer publishing `calls (global) -> _` for a function
// it had declined to declare: an edge pointing at a name the index can never
// resolve. Both halves are pinned here, because the fix is the DISTINCTION and a
// fixture that only asserted the positive case would let the blanket refusal back.
pub fn _(msgid: [*:0]const u8) [*:0]const u8 {
    return msgid;
}

// The contrast: a discard binding, which must publish no symbol at all.
const _ = 42;

fn callsTheBlankFn(msgid: [*:0]const u8) [*:0]const u8 {
    return _(msgid);
}
