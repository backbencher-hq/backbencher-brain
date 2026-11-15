import * as fs from "fs"
import * as path from "path"
import { RealZigAnalyzer } from "../../../src/ast/real-zig-analyzer"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-zig.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
const CASES: Record<string, string> = {
  X1_global_payload: `const Answer = 42;
const out = switch (1) {
    1 => |Answer| Answer,
    else => 0,
};
`,
  X2_global_read: `const Answer = 42;
const out2 = Answer;
`,
  X4_w9_flag: `const Flag = 1;
fn typeField(s: struct { Flag: u8 }) u32 {
    return Flag;
}
`,
  X5_param_type_read: `const T = u32;
fn takeT(x: T) u32 {
    return x;
}
`,
  X6_ifelse_capture: `const v = 1;
fn elbow(o: ?u32) u32 {
    if (o) |v| {
        return v;
    } else {
        return v;
    }
}
`,
  X7_blank_decl: `var _ = 1;
const Named = 2;
`,
  X9_fnlocal_import: `fn usesLocal() void {
    const s = @import("std");
    _ = s;
}
`,
  X10_param_default: `const Def = 7;
fn withDefault(x: u32 = Def) u32 {
    return x;
}
`,
  X11_switch_postread: `const K = 1;
const Limit = 100;
fn scopeF(x: u32) u32 {
    const a = switch (x) {
        1 => |K| K + Limit,
        else => 0,
    };
    _ = a;
    return K;
}
`,
}
async function main() {
  const which = process.argv[2]
  for (const [name, src] of Object.entries(CASES)) {
    if (which && name !== which) continue
    const root = await parseSrc(src)
    const mod: any = await import("../../../script/m14/differential")
    const r: any = await new RealZigAnalyzer().analyze(root, src, "x.zig")
    const uses = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => `${x.source}->${x.target}`)
    const truth = [...mod.deriveTreeEdges(root, "zig"), ...mod.deriveZigEdges(root), ...mod.deriveZigBareUses(root, r.symbols ?? [])].filter((x: any) => x.label === "uses").map((x: any) => `(${x.from})->${x.target}`)
    const syms = (r.symbols ?? []).map((s: any) => `${s.name}:${s.kind}`)
    console.log(`=== ${name}\n  ana-uses: ${JSON.stringify(uses)}\n  ora-uses: ${JSON.stringify(truth)}\n  syms: ${JSON.stringify(syms)}\n  imports: ${JSON.stringify((r.imports ?? []).map((i: any) => i.module))}`)
  }
}
main()
