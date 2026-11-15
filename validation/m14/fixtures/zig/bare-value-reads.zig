// M49 zig review fixture (2026-09-12) — Z3 bare value reads + error-member
// resolution. Authored from the family contract BEFORE the analyzer run.
//
// Pins:
//   - file-scope const/var reads emit `uses` from the enclosing fn
//     (readLimit->Limit, bump->counter)
//   - shadowing suppresses: param (shadowed->counter), block local
//     (localFirst->Limit), payload capture (arm->Answer)
//   - error-set DECLARATION sites declare, never read (forbid Unused)
//   - error leaves in VALUE positions resolve (fail->Timeout, handle->Fatal)
//   - enum members do NOT resolve as bare values outside error leaves:
//     the enum member Widget collides with the struct used as a return type,
//     and the global payload `|fast|` collides with enum member fast
//     (forbid uses Widget / uses fast)
//   - Z1: real per-symbol cyclomatic complexity (score=5, guard=4)
//   - Z2: 1-based error columns (the trailing stray brace is the last line)
const std = @import("std");

const Limit = 100;
const Answer = 42;
var counter: u32 = 0;

const Mode = enum { fast, slow };
const Names = enum { Widget, Other };

const AppError = error{ Timeout, Fatal, Unused };

const Widget = struct {
    len: u32,
    kind: Mode,
};

fn readLimit() u32 {
    return Limit;
}

fn bump() u32 {
    counter += 1;
    return counter;
}

fn shadowed(counter: u32) u32 {
    return counter;
}

fn localFirst() u32 {
    const Limit = 5;
    return Limit;
}

fn arm(mode: Mode) u32 {
    return switch (mode) {
        .fast => |Answer| Answer,
        else => 0,
    };
}

const picked = switch (Mode.fast) {
    .fast => |fast| fast,
    else => .slow,
};

fn fail() AppError {
    return error.Timeout;
}

fn handle(err: AppError) u32 {
    return switch (err) {
        error.Fatal => 1,
        else => 0,
    };
}

fn typed(w: Widget) void {
    _ = w;
}

fn make() Widget {
    return undefined;
}

fn score(v: u32) u32 {
    if (v > 10) return 1;
    var sum: u32 = 0;
    for (0..v) |i| {
        while (sum < 100) {
            sum += i;
            break;
        }
    }
    return switch (v) {
        0 => 0,
        else => sum,
    };
}

fn guard(a: bool, b: bool, x: ?u32) u32 {
    if (a and b) {
        return x orelse 0;
    }
    return 0;
}

// Z6 (extreme review): a switch-arm capture is scoped to its own arm. The
// global capture `|Clue|` must not read the file const, and the arm capture
// `|K|` must not leak past its arm (the post-switch `return K` is genuine).
const K = 1;
const Clue = 7;

const solved = switch (2) {
    2 => |Clue| Clue,
    else => 0,
};

fn scopeF(x: u32) u32 {
    const a = switch (x) {
        1 => |K| K + Limit,
        else => 0,
    };
    _ = a;
    return K;
}

// Z7 (extreme review): a parameter binds its NAME only — identifiers in the
// parameter's type (Flag), a comptime type use (T), and a default value
// (Def) all read the file-scope value.
const Flag = 1;
const T = u32;
const Def = 7;

fn typeField(s: struct { Flag: u8 }) u32 {
    return Flag;
}

fn takeT(x: T) u32 {
    return x;
}

fn withDefault(x: u32 = Def) u32 {
    return x;
}

// Z8 (extreme review): the blank identifier declares nothing.
var _ = 5;

// Z9 (extreme review): a function-local @import is still an import fact.
fn usesLocal() void {
    const ls = @import("helper.zig");
    _ = ls;
}
}
