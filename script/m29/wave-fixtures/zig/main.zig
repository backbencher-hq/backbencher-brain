// PINS the zig wave fixture pack (M29.R2 — wave-2 candidate).
// Uniform wave convention (same shape as the wave-1 packs): a Greeter type with
// a greet method, called once, plus a constant.

const std = @import("std");

const Greeter = struct {
    items: []const []const u8,

    pub fn init(items: []const []const u8) Greeter {
        return Greeter{ .items = items };
    }

    pub fn greet(self: Greeter) []const u8 {
        _ = self;
        return "hello";
    }
};

pub fn main() void {
    const g = Greeter.init(&[_][]const u8{ "a", "b" });
    std.debug.print("{s}\n", .{g.greet()});
    _ = g;
}

pub const CONSTANT: u32 = 42;
