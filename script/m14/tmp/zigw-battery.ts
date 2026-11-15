/**
 * ZIG WAVE 1 PROBE — the HOSTILE BATTERY.
 *
 * Every case is a MINIMAL Zig source written from the language's own semantics,
 * with the expected relationship/symbol set declared INDEPENDENTLY (from the
 * Zig reference, not from the analyzer's code). The battery runs the REAL
 * analyzer and prints, per case, what it emitted against what was declared, so
 * a defect class is a measured FAIL rather than a suspicion.
 *
 * Expectation kinds:
 *   SYM  name:kind            the symbol must exist with exactly this kind
 *   NOSYM name                 the symbol must NOT exist
 *   REL  type src -> tgt       the edge must exist (kind, source, target)
 *   NOREL type src -> tgt      the edge must NOT exist
 *   KINDS_ONLY                 reported, not asserted (ruling evidence)
 */
import { init, analyze, rel, sym } from "./zigw-harness"

interface Expect {
  syms?: Array<[string, string?]>
  nosyms?: string[]
  rels?: Array<[string, string, string]>
  norels?: Array<[string, string, string]>
  errors?: number
  note?: string
}

interface Case {
  name: string
  src: string
  expect: Expect
}

const CASES: Case[] = [
  {
    name: "A1 type alias to a builtin type",
    src: `const Pos = c_long;
const Count = u32;
const low = u8;
`,
    expect: { syms: [["Pos", "type"], ["Count", "type"], ["low", "type"]] },
  },
  {
    name: "A2 value expression with an uppercase name",
    src: `const SHIFT = 1 << 10;
const MASK = ~@as(u32, 0);
const WRAPPED = (@as(u32, 3) + 1);
const NEG = -1;
const deref = @as(u32, 1);
const BANG = !false;
`,
    expect: {
      syms: [["SHIFT", "constant"], ["MASK", "constant"], ["WRAPPED", "constant"], ["NEG", "constant"]],
    },
  },
  {
    name: "A3 opaque container owns its declarations",
    src: `const Handle = opaque {
    pub fn create() Handle { return @enumFromInt(0); }
    pub fn destroy(self: Handle) void { _ = self; }
    pub const tag: u8 = 1;
};
`,
    expect: { syms: [["Handle", "type"], ["create", "method"], ["destroy", "method"], ["tag", "constant"]] },
  },
  {
    name: "A4 function-TYPE alias is not a function declaration",
    src: `const Cb = fn (x: u32) void;
const Cb2 = fn (*Any) callconv(.c) void;
extern fn real_one() c_int;
`,
    expect: { syms: [["Cb", "type"], ["Cb2", "type"], ["real_one", "function"]], nosyms: [] },
  },
  {
    name: "B1 declared type of a field with a default value",
    src: `const Size = enum(u8) { byte, word };
const Slice = struct { items: []const u8 };
const Fmt = struct {
    size: Size = .byte,
    n: u32 = 0,
    name: []const u8 = "",
    slice: Slice = .{},
};
`,
    expect: {
      rels: [["references", "(declared-type)", "Size"], ["references", "(declared-type)", "Slice"]],
      norels: [["references", "(declared-type)", "byte"]],
    },
  },
  {
    name: "B2 declared type of a qualified parameter and a function-type parameter",
    src: `const Mode = enum { a, b };
const Fmt = struct { size: Mode = .a };
fn f(mode: Mode, g: Fn) void { _ = mode; _ = g; }
const Fn = fn (u8) void;
fn h(cb: fn (u8) void) void { _ = cb; }
`,
    expect: {
      rels: [["references", "(declared-type)", "Mode"]],
      norels: [["references", "(declared-type)", "a"]],
    },
  },
  {
    name: "B3 declared type through array and optional wrappers",
    src: `const Widget = struct { x: i32 };
const Slice = struct { items: []const u8 };
fn a(w: [4]Widget) void { _ = w; }
fn b(w: ?*Widget) void { _ = w; }
fn c(w: [W]Widget) void { _ = w; }
fn d(w: Slice) void { _ = w; }
const W = 4;
`,
    expect: {
      rels: [
        ["references", "(declared-type)", "Widget"],
        ["references", "(declared-type)", "Slice"],
      ],
    },
  },
  {
    name: "B4 return types through wrappers",
    src: `const Widget = struct { x: i32 };
const S = struct {
    fn one() Widget { return Widget{ .x = 0 }; }
    fn two() [4]Widget { return undefined; }
    fn three() ?*Widget { return null; }
    fn four() error{Nope}!Widget { return Widget{ .x = 0 }; }
    const Nope = error{Nope};
};
`,
    expect: { rels: [["references", "(declared-type)", "Widget"]] },
  },
  {
    name: "C1 write gate: compound and plain field assignment",
    src: `const Point = struct { x: i32, y: i32 };
var p = Point{ .x = 0, .y = 0 };
fn plainWrite() void {
    p.x = 1;
}
fn compound() void {
    p.x += 2;
}
fn read() i32 {
    return p.x;
}
fn chained() i32 {
    p.y = p.y + 1;
    return p.y;
}
`,
    expect: {
      rels: [["uses", "read", "x"], ["uses", "compound", "x"], ["uses", "chained", "y"]],
      norels: [["uses", "plainWrite", "x"]],
    },
  },
  {
    name: "C2 while-continue assignment is a read-modify-write",
    src: `var counter: u32 = 0;
fn plain() void {
    counter = 5;
}
fn compound() void {
    counter += 1;
}
fn loop() void {
    while (counter < 10) : (counter += 1) {}
}
`,
    expect: {
      rels: [["uses", "compound", "counter"], ["uses", "loop", "counter"]],
      norels: [["uses", "plain", "counter"]],
    },
  },
  {
    name: "D1 a local annotation IS a declared type (Z16)",
    src: `const Point = struct { x: i32 };
fn mk() void {
    var p: Point = undefined;
    p.x = 1;
    const s: []const Point = &[_]Point{};
    _ = s;
}
`,
    expect: { rels: [["references", "(declared-type)", "Point"]], note: "construction is a type dependency" },
  },
  {
    name: "D2 @import alias is an import, not a symbol",
    src: `const std2 = @import("std");
pub fn f() void { _ = std2.mem.eql(u8, "a", "b"); }
`,
    expect: { nosyms: ["std2"] },
  },
  {
    name: "E1 error set members and error-type reads",
    src: `const AppError = error{ NotFound, Denied };
fn f() AppError!void {
    return error.NotFound;
}
fn g() AppError!void {
    if (true) return error.Denied;
    return error.Other;
}
`,
    expect: {
      syms: [["AppError", "enum"], ["NotFound", "enum_member"], ["Denied", "enum_member"]],
      rels: [["uses", "f", "NotFound"], ["uses", "g", "Denied"]],
      norels: [["uses", "f", "AppError"], ["uses", "f", "Denied"]],
    },
  },
  {
    name: "F1 packed/extern/aligned containers",
    src: `const Packed = packed struct { a: u4, b: u4 };
const Ext = extern struct { c: c_int };
const Al = struct { x: u32 align(4) };
const U = extern union { i: c_int, f: f32 };
const O = opaque {};
`,
    expect: {
      syms: [["Packed", "struct"], ["Ext", "struct"], ["Al", "struct"], ["U", "union"], ["O", "type"]],
    },
  },
  {
    name: "G1 anonymous struct type in a parameter",
    src: `const Anonymous = struct { FLAG: u8 };
fn f(s: struct { FLAG: u8 }) void { _ = s; }
fn g() void { _ = Anonymous{}; }
`,
    expect: {
      norels: [["references", "(declared-type)", "FLAG"]],
    },
  },
  {
    name: "H1 comptime and test blocks declare nothing",
    src: `const LIMIT = 4;
test "t" {
    var counter: u32 = 0;
    counter += 1;
    _ = counter;
    try expectEq(LIMIT, 4);
}
fn expectEq(a: u32, b: u32) void { _ = a; _ = b; }
comptime {
    var scratch: u32 = 0;
    _ = scratch;
}
`,
    expect: {
      syms: [["LIMIT", "constant"]],
      nosyms: ["counter", "scratch"],
      rels: [["uses", "(global)", "LIMIT"]],
    },
  },
  {
    name: "I1 noalias/comptime/anytype parameters",
    src: `fn f(noalias a: *u32, b: anytype, comptime T: type) void { _ = a; _ = b; }
`,
    expect: { syms: [["f", "function"]] },
  },
  {
    name: "J1 error-union and anyerror types",
    src: `const E = error{A};
const Payload = struct { v: u32 };
fn f() anyerror!u32 { return 1; }
fn g() E!u32 { return 1; }
fn h() E!Payload { return undefined; }
fn i() E!void {}
fn j() error{Fresh}!Payload { return undefined; }
`,
    expect: {
      rels: [["references", "(declared-type)", "Payload"]],
      norels: [["references", "(declared-type)", "anyerror"], ["references", "(declared-type)", "A"], ["references", "(declared-type)", "Fresh"]],
    },
  },
  {
    name: "K1 method call through a struct value",
    src: `const Counter = struct {
    n: u32,
    pub fn bump(self: *Counter) void { self.n += 1; }
    pub fn get(self: Counter) u32 { return self.n; }
};
fn use() u32 {
    var c = Counter{ .n = 0 };
    c.bump();
    return c.get();
}
`,
    expect: {
      syms: [["Counter", "struct"], ["bump", "method"], ["get", "method"]],
      rels: [
        ["calls", "use", "bump"],
        ["calls", "use", "get"],
        ["contains", "Counter", "bump"],
        ["uses", "bump", "n"],
      ],
    },
  },
  {
    name: "L1 builtin calls are not user call edges",
    src: `const MAX = 8;
fn f(a: u32) u32 {
    return @max(a, MAX);
}
`,
    expect: {
      rels: [["uses", "f", "MAX"]],
      norels: [["calls", "f", "max"], ["calls", "f", "@max"]],
    },
  },
  {
    name: "M1 declaration vs definition metadata",
    src: `extern fn c_decl(a: c_int) c_int;
export fn exported() void {}
fn defined() void {}
pub fn withBody() void {}
fn caller() void {
    defined();
    withBody();
}
`,
    expect: {
      rels: [["calls", "caller", "defined"], ["calls", "caller", "withBody"]],
      norels: [["calls", "caller", "c_decl"]],
    },
  },
  {
    name: "N1 slice/array field with sentinel and inferred type",
    src: `const Slice = struct { items: []const u8 };
const Buf = struct {
    data: [:0]const u8 = undefined,
    len: usize = 0,
    view: Slice = .{},
};
fn f(b: []const u8) void { _ = b; }
fn g(b: []Slice) void { _ = b; }
`,
    expect: { rels: [["references", "(declared-type)", "Slice"]], norels: [["references", "(declared-type)", "undefined"]] },
  },
  {
    name: "O1 switch-case payload scope and enum literal reads",
    src: `const Mode = enum { fast, slow };
const default_mode = Mode.fast;
fn f(m: Mode) u32 {
    return switch (m) {
        .fast => |x| 1,
        .slow => 2,
    };
}
fn g() Mode {
    return default_mode;
}
`,
    expect: { rels: [["uses", "g", "default_mode"]], norels: [["uses", "f", "default_mode"]] },
  },
  {
    name: "P1 generic type application is a declared type",
    src: `const Entry = struct { key: u32 };
fn f(m: std.StringHashMap(u32, Entry)) void { _ = m; }
const Reg = std.AutoHashMap(u32, Entry);
`,
    expect: { rels: [["references", "(declared-type)", "Entry"]] },
  },
  {
    name: "Q1 asm and volatile declarations",
    src: `fn f() void {
    asm volatile ("nop");
}
`,
    expect: { nosyms: ["asm"] },
  },
  {
    name: "R1 labeled block is a value; a labeled type expression is a type",
    src: `const Val = blk: {
    var tmp: u32 = 3;
    break :blk tmp;
};
const Typed = value: u32 {
    return 1;
};
const E = error{X};
const TypedErr = other: E {
    return error.X;
};
`,
    expect: { syms: [["Val", "constant"], ["Typed", "type"], ["TypedErr", "type"]] },
  },
  {
    name: "S1 empty and blank declarations",
    src: `const _ = 1;
var _ = 2;
fn f() void {
    _ = 1;
    _ = .{};
}
`,
    expect: { nosyms: ["_"] },
  },
]

async function main(): Promise<void> {
  await init()
  let fails = 0
  let checks = 0
  for (const c of CASES) {
    let res: any
    try {
      res = analyze(c.src, "battery.zig")
    } catch (e) {
      console.log(`ERROR ${c.name}: ${(e as Error).message}`)
      fails++
      continue
    }
    const syms = res.symbols as any[]
    const rels = res.relationships as any[]
    const problems: string[] = []
    for (const [name, kind] of c.expect.syms ?? []) {
      checks++
      const hits = syms.filter((s) => s.name === name)
      if (hits.length === 0) problems.push(`MISSING SYMBOL ${name}${kind ? ` kind=${kind}` : ""}`)
      else if (kind && !hits.some((s) => String(s.kind) === kind)) {
        problems.push(`SYMBOL ${name} kind=${hits.map((s) => String(s.kind)).join("+")} want=${kind}`)
      } else if (hits.length > 1 && kind) {
        problems.push(`SYMBOL ${name} declared ${hits.length}x (${hits.map((s) => String(s.kind)).join("+")})`)
      }
    }
    for (const name of c.expect.nosyms ?? []) {
      checks++
      if (syms.some((s) => s.name === name)) {
        problems.push(`FORBIDDEN SYMBOL ${name} (${syms.filter((s) => s.name === name).map((s) => String(s.kind)).join("+")})`)
      }
    }
    for (const [t, src, tgt] of c.expect.rels ?? []) {
      checks++
      if (!rels.some((r: any) => String(r.type) === t && r.source === src && r.target === tgt)) {
        problems.push(`MISSING REL ${t} ${src} -> ${tgt}`)
      }
    }
    for (const [t, src, tgt] of c.expect.norels ?? []) {
      checks++
      const hit = rels.filter((r: any) => String(r.type) === t && r.source === src && r.target === tgt)
      if (hit.length > 0) problems.push(`FORBIDDEN REL ${t} ${src} -> ${tgt} (${hit.length}x)`)
    }
    if (problems.length > 0) fails++
    console.log(`\n${problems.length === 0 ? "PASS" : "FAIL"} ${c.name}${c.expect.note ? `   (${c.expect.note})` : ""}`)
    for (const p of problems) console.log(`     - ${p}`)
    if (process.env.ZIGW_VERBOSE) {
      console.log("  symbols:")
      for (const s of syms) console.log(`    ${sym(s)}`)
      console.log("  relationships:")
      for (const r of rels) console.log(`    ${rel(r)}`)
    }
  }
  console.log(`\n=== ${fails} case(s) with findings, ${checks} assertions ===`)
}
void main()
