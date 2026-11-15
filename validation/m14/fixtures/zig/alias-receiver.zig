// Z66 — the RECEIVER. A read through a name this file binds by `@import` names a
// member of that module, not a same-named declaration of this file.
//
// Every row below is a place where the old behaviour published a bare leaf and a
// plausible implementation would keep doing it. `std.ArrayList` is the case the
// shared `zig/target-scope` fixture already pinned as EXTERNAL; what is new here is
// that the edge now SAYS which module, and that the two refusal shapes below stay
// refused.

// ── EXTERNAL: a bare module path, outside this project by construction ──────────
const std = @import("std");

pub fn externalTypes() void {
    var list: std.ArrayList(u8) = undefined;
    _ = list;
}

pub fn externalValues() void {
    std.debug.assert(true);
}

// ── LOCAL: a module path that names a file in this project ──────────────────────
// `c.zig` is a file here, so its members are published under their own names and
// qualifying this read would replace a leaf that binds with a path nothing in the
// index publishes. The bare leaf is CORRECT here and the fixture pins that.
const c = @import("c.zig");

pub fn localModule() void {
    const n = c.COUNT;
    _ = n;
}

// ── REFUSED 1: the name is bound BOTH by an import and by something else ────────
// `extpkg` is a BARE module path, so the alias would qualify if the name were not
// also shadowed. A shadowed alias means `ext.print` need not be a module member at
// all, and this analyzer does not model which binding wins at which site. Refusing
// to qualify is the only answer that cannot publish a path the source does not
// spell — and the module path has to be a bare one for that to be a decision at all:
// `const c = @import("c.zig")` above is already refused for being local.
const ext = @import("extpkg");

pub fn shadowedBinding() void {
    const ext = struct { pub const VALUE: u8 = 1; }.VALUE;
    _ = ext.print;
}

// ── REFUSED 2: the receiver is a CALL RESULT, not a path ───────────────────────
// `std.io.getStdOut().writer()` has no name this analyzer can spell a path out of,
// so the leaf stays a leaf. Qualifying it would require inventing a receiver name.
pub fn receiverIsACall() void {
    const out = std.io.getStdOut().writer();
    out.print("hi");
}
// ── THE ALIAS SPELLING, which is not the module spelling ───────────────────────
// `gobject` is bound as `g`, so the source writes `g.Object.new` and NOT
// `gobject.Object.new`. The published target is the spelling the SOURCE uses, and
// meta.zigImportModule carries the module. An implementation that published the
// module name instead would produce a target the file does not contain.
const g = @import("gobject");

pub fn aliasedModule() void {
    const o = g.Object.new(.init);
    _ = o;
}
