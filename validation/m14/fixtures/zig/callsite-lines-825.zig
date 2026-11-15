// fixture: zig/callsite-lines-825
// M59 (#825). A relationship's line_number is the line of the node that NAMES it,
// never the line of the construct that contains it. Zig emitted NO line at all
// before this pin (measured: 0 of 20,789 edges on a 200-file draw of the zig
// corpus), so the pre-fix state is "unlined"; the traps below are the three ways
// a line can be PRESENT and still wrong in zig's node shapes:
//
//   1. a WRAPPED @import — the `variable_declaration` starts on the `const std =`
//      line while the module path literal is written on the next one, so a
//      construct-start line stamps the import one line early;
//   2. a WRAPPED field access — a `field_expression` starts at its RECEIVER, so
//      `counters\n    .hits` reports the receiver's line unless the leaf is used;
//   3. a WRAPPED parameter type — the `fn` keyword's line is not where `Counters`
//      is written.
//
// The forbidRelationships entries are exactly those pre-fix shapes, so
// re-introducing any of them fails the gate instead of passing silently.
const std =
    @import("std");

const Counters = struct {
    hits: u32,
    misses: u32,
};

pub fn helper(v: u32) u32 {
    return v + 1;
}

pub fn seed(
    counters: *Counters,
    n: u32,
) u32 {
    counters.hits = helper(n);
    return counters.hits;
}

pub fn run(counters: *Counters) u32 {
    const read = counters
        .misses;
    _ = std;
    return seed(counters, read) + helper(read);
}
