// fixture: zig/unpublished-scope-source-z59
//
// Z59. A relationship's SOURCE must name a symbol the index actually publishes.
//
// The three edge passes each took the nearest `function_declaration` /
// `test_declaration` identifier as the source name without asking whether a
// symbol was published for it. That is wrong for a function the analyzer
// DELIBERATELY declines to publish — a member of a local or anonymous container
// (Z22 / the C negative contract) — and it produced a caller that resolves to
// nothing.
//
// Measured over the full 3,834-file corpus before this pin, through production
// `parseFile` (validation/m14/fixtures/zig/dangling-source-census.ts):
//   11,332 of 224,599 calls+uses+instantiates edges = 5.05% carried a source
//   naming an unpublished declaration, and the class's residual — a dangling
//   source no tree declaration explains — was 0, so that is the whole population.
//
// The trap below is a GENERIC FUNCTION whose body returns an anonymous struct.
// Every method in it is a member of a container with no name and therefore no
// identity, so the analyzer publishes no symbol for `push` — and the pre-fix
// analyzer still emitted `uses push -> capacity` and `calls push -> reserve`,
// which name a caller the store will never hold.
//
// The fix attributes those edges to the nearest scope the analyzer DOES publish.
// Here that is `Stack`, the generic function itself. The second case is the same
// construct reached from a named test, where the enclosing published scope is
// `(global)`: `test` bodies are executable scope, and a local container declared
// inside one has no published owner.
//
// The forbidRelationships entries are exactly the pre-fix shapes, so
// re-introducing them fails the gate instead of passing silently. The Z39 named
// test attribution is asserted too, because the fix must not have reverted it:
// `test namedScope` still names itself, and no symbol exists for it either — that
// class is a declared limitation, not an oversight, and the fixture pins both
// sides of the boundary.
const std = @import("std");

pub fn Stack(comptime T: type, comptime n: usize) type {
    return struct {
        const Self = @This();

        items: [n]T,
        len: usize,

        pub fn reserve(self: *Self) void {
            self.len = self.len + 1;
        }

        pub fn capacity() usize {
            return n;
        }

        pub fn push(self: *Self, v: T) void {
            self.items[self.len] = v;
            self.reserve();
            std.debug.assert(self.capacity() == n);
        }
    };
}

const S = Stack(u8, 4);

test namedScope {
    var s: S = undefined;
    s.reserve();
    s.push(1);
}