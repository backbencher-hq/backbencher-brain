// PINS the zig wave family-standard surface (2026-08-29): calls (callee leaf),
// uses (field access), contains (container ownership), references declared_type
// + import, per-symbol complexity, parameters payload, pub visibility, and the
// error-set/EnumMember + enum/struct symbol kinds.
//
// Deep-review pins (final zig pass 2026-08-29):
//   - `var` globals are Variable, not Constant (mutable global mislabel)
//   - generic type applications in parameter position emit the generic BASE
//     (`x: MyList(u32)` -> references MyList; previously the builtin arg
//     shadowed it and MyList was lost)
//   - enum members emit NO declared-type references (they are not types)
const std = @import("std");

var global_counter: u32 = 0;

const MyList = struct {
    items: []u32,
};

const Shape = struct {
    sides: u32,
    pub fn perimeter(self: *const Shape) u32 {
        return self.sides * 4;
    }
};

const Direction = enum {
    North,
    South,
};

const AppError = error{ Timeout, Fatal };

// F6 coverage (2026-09-02): union_declaration was declared handled_verified but
// NO fixture ever contained a tagged union — the F6 gate caught the claim as
// unevidenced. This union exercises it end-to-end (symbol + container fields).
const Value = union(enum) {
    int: i32,
    text: []const u8,
    none,
};

fn compute(s: *Shape, list: MyList(u32)) u32 {
    const p = s.perimeter();
    if (p > 10) {
        return p;
    } else {
        return p + std.math.add(u32, 1, 2);
    }
}

pub fn main() !void {
    const shape: Shape = .{ .sides = 4 };
    const result = compute(&shape);
    _ = result;

    const v = Value{ .int = 7 };
    _ = v;
}

// F6 coverage: extern fn — a function DECLARATION without a body. Probed
// 2026-09-02: it parses as function_declaration (the `function_signature`
// spec type was reclassified as ZIGD2 — no valid Zig produces it).
extern fn platform_init(flags: u32) void;

// Expression-form control flow (deep-review pin, 2026-08-29): Zig's dominant
// `const x = if (c) a else b;` / for-else / while-else forms parse as
// if_expression / for_expression / while_expression with an ANONYMOUS `else`
// token — previously NOT counted by zigBodyComplexity (only the statement
// forms were), and the binary_expression substring check falsely counted
// identifiers like `standard`/`order` ("and"/"or" substrings).
fn pick(cond: bool, a: u32, b: u32) u32 {
    const chosen = if (cond) a else b;
    const sum = chosen + standard + order;
    return sum;
}
// ─── ZGD wave pins (M37 #600 dual-lens, 2026-09-04) ───

// ZGD4: usingnamespace declarations are first-class import facts (the walk
// previously dropped them entirely — no import record, no references edge).
// Probed 2026-09-04: they parse as using_namespace_declaration whose
// builtin_function child carries the @import.
usingnamespace @import("std.zig");
pub usingnamespace @import("io.zig");

// ZGD2: bare-identifier and qualified return types are declared-type facts
// (previously emitted NOTHING — the collection list lacked both shapes).
fn makeWidget() Widget {
    return undefined;
}

fn qualifiedReturn() io.Writer {
    return undefined;
}

// ZGD5b: a qualified TYPE ANNOTATION is a declared-type fact, never a
// runtime read (previously emitted `uses qualifiedReturn->Writer`).
fn takesWriter(w: io.Writer) void {
    _ = w;
}

// ZGD1: assignment LHS is a WRITE, plain and compound alike (the zig grammar
// folds = and += into variable_declaration) — never a `uses` read.
const Counter = struct {
    n: u32,
    fn set(self: *Counter) void {
        self.n = 5;
    }
    fn bump(self: *Counter) void {
        self.n += 1;
    }
};

// ZGD3: test/comptime bodies are executable scope — their locals are NOT
// file-scope symbols (previously every test local leaked as a Variable).
test "counter writes" {
    var local_only: u32 = 0;
    _ = local_only;
}

comptime {
    var compile_time_local: usize = 0;
    _ = compile_time_local;
}

// ── Z44: the complexity OPERATORS, pinned ────────────────────────────────────
// `pick` above already pins the three cases the implementation notes admit were
// wrong (the if-EXPRESSION form, its anonymous `else` token, and the
// `standard`/`order` substring trap). But the operators the counter actually
// counts -- for, while, switch, and/or/orelse -- had NO pin at all, so a
// regression in any of them would have been invisible to F3.
//
// Every value below was HAND-COMPUTED from the documented rule (base 1, plus one
// per counted construct) and only then compared with the analyzer. All eight
// matched on the first run, which is the outcome worth recording: the
// implementation was right and the fixture was thin, rather than the reverse.
fn cyBase() u32 { return 1; }                                              // 1
fn cyFor(n: u32) u32 { var s: u32 = 0; for (0..n) |i| { s += i; } return s; }   // 2
fn cyWhile(n: u32) u32 { var s: u32 = 0; while (n > 0) { s += 1; n -= 1; } return s; } // 2
fn cySwitch(x: u8) u8 { return switch (x) { 0 => 1, 1 => 2, else => 3 }; }   // 2
fn cyAnd(a: bool, b: bool) bool { return a and b; }                       // 2
fn cyOr(a: bool, b: bool) bool { return a or b; }                         // 2
fn cyOrelse(x: ?u32) u32 { return x orelse 0; }                           // 2
fn cyNested(c: bool, x: u32) u32 { if (c) { while (x > 0) { x -= 1; } } return x; } // 3
