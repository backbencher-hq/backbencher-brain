// validation/m12/fixtures/zig/Negative.zig
// M12.20 Zig negative fixture: function-local variables, control flow,
// switch arms, field access, and keyword usage must NOT become symbols;
// locals inside function bodies are execution artifacts; @import stays in
// the imports array (no dangling references edge).

const std = @import("std");

fn localOnly(value: i32) i32 {
    var doubled = value * 2;        // function-local — NO symbol
    const tripled = doubled + value; // local const — NO symbol
    var i: usize = 0;
    while (i < 3) : (i += 1) {
        doubled += 1;               // control flow — no symbol
    }
    if (doubled > 10) {
        return tripled;
    }
    return switch (doubled) {
        1 => 1,
        else => 0,
    };
}

fn classify(n: i32) []const u8 {
    return switch (n) {
        0 => "zero",
        1 => "one",
        else => "many",
    };
}

pub fn main() void {
    const result = localOnly(5);    // local — NO symbol
    _ = classify(result);
    _ = std.mem.eql;
}
