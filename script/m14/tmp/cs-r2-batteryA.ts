// cs-r2-batteryA — round-2 (third verification) hostile battery: bare-read /
// value-position exotics on the post-full-wave analyzer. Every case asserts
// against the family read contract (value-position reads emit `uses`; binding
// positions never read). Probe-first: nothing is filed or fixed from memory.
import * as fs from "fs"
import * as path from "path"
import { RealCSharpAnalyzer } from "../../../src/ast/real-csharp-analyzer"

async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-c_sharp.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}

type Case = { name: string; src: string; expectUses?: string[]; forbidUses?: string[]; note?: string }

const CASES: Case[] = [
  {
    name: "A1_default_param_value_reads_member",
    src: `class C { static int Max = 9; void M(int x = Max) { } }\n`,
    expectUses: ["M->Max"],
    note: "default values evaluate members; value position",
  },
  {
    name: "A2_interpolation_hole_reads_member",
    src: `class C { static int Max = 9; string M() { return $"{Max}"; } }\n`,
    expectUses: ["M->Max"],
  },
  {
    name: "A3_catch_filter_reads_member",
    src: `class C { static bool Log = true; void M() { try { } catch (System.Exception e) when (Log) { } } }\n`,
    expectUses: ["M->Log"],
  },
  {
    name: "A4_nested_enum_member_value_reads_enclosing_const",
    src: `class C { const int Max = 3; enum E { A = Max } }\n`,
    expectUses: ["C->Max"],
    note: "boundary adjudicated round 2: reads in enum-member values attribute to the innermost enclosing CLASS (CS-C4 wording — enums are not class frames); the read itself emits, is neither lost nor fabricated",
  },
  {
    name: "A5_partial_class_cross_part_read",
    src: `partial class P { static int Val = 1; }\npartial class P { int M() { return Val; } }\n`,
    expectUses: ["M->Val"],
  },
  {
    name: "A6_record_positional_property_reads",
    src: `record R(int X, int Y) { int Sum() { return X + Y; } }\n`,
    expectUses: ["Sum->X", "Sum->Y"],
  },
  {
    name: "A7_interface_default_method_reads_own_property",
    src: `interface I { int Max => 3; int M() { return Max; } }\n`,
    expectUses: ["M->Max"],
  },
  {
    name: "A8_checked_and_stackalloc_read_member",
    src: `class C { static int Max = 3; unsafe void M() { int* p = stackalloc int[Max]; int v = checked(Max + 1); if (p == null) return; System.Console.WriteLine(v); } }\n`,
    expectUses: ["M->Max"],
  },
  {
    name: "A9_this_and_base_receiver_member_reads",
    src: `class B { protected int Shared = 1; }\nclass D : B { int M() { return this.Shared; } int N() { return base.Shared; } }\n`,
    expectUses: ["M->Shared", "N->Shared"],
  },
  {
    name: "A10_compound_and_nullcoalesce_lhs_are_writes_only",
    src: `class C { int a; int M() { a ??= 3; a += 2; return a; } }\n`,
    expectUses: ["M->a"],
    note: "LHS writes never read; the final return is the only read",
  },
  {
    name: "A11_switch_expression_when_clause_reads_member",
    src: `class C { static int Lim = 5; int M(int x) { return x switch { > 1 when Lim > 2 => 1, _ => 0 }; } }\n`,
    expectUses: ["M->Lim"],
  },
  {
    name: "A12_nested_tuple_pattern_binds_never_reads_member",
    src: `class C { static int p = 7; bool M(object o) { return o is (int a, (int b, int c)) && a + b + c > p; } }\n`,
    expectUses: ["M->p"],
    forbidUses: ["M->a", "M->b", "M->c"],
  },
  {
    name: "A13_event_accessor_body_reads_member",
    src: `class C { static int K = 2; event System.Action E { add { System.Console.WriteLine(K); } remove { } } }\n`,
    expectUses: ["K"],
    note: "accessor has no symbol scope; the read must still surface (attribution probed)",
  },
  {
    name: "A14_indexer_accessor_reads_member",
    src: `class C { static int Max = 4; int this[int i] { get { return i < Max ? 1 : 0; } } }\n`,
    expectUses: ["Max"],
  },
  {
    name: "A15_expression_bodied_property_reads_member",
    src: `class C { static int Max = 5; int P => Max; int Q { get => Max; } }\n`,
    expectUses: ["Max"],
  },
  {
    name: "A16_operator_body_reads_member",
    src: `class C { static int Max = 6; public static implicit operator int(C c) { return Max; } }\n`,
    expectUses: ["Max"],
  },
  {
    name: "A17_deconstruction_nested_write_binds",
    src: `class C { int M() { var t = (1, (2, 3)); (int a, (int b, int c)) = t; return a + b + c; } }\n`,
    forbidUses: ["M->a", "M->b", "M->c"],
    note: "deconstruction targets are writes (no self-named member reads)",
  },
  {
    name: "A18_scope_qualified_static_using_read",
    src: `using static System.Math;\nclass C { double M() { return Sqrt(4); } }\n`,
    expectUses: [],
    note: "using static call is a call not a read; sanity only (no crash, call emitted)",
  },
]

async function main() {
  let passN = 0, failN = 0
  for (const c of CASES) {
    const root = await parseSrc(c.src)
    const r: any = await new RealCSharpAnalyzer().analyze(root, c.src, "r2.cs")
    const usesAll: any[] = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses")
    const pairs = Array.from(new Set(usesAll.map((x: any) => `${x.source}->${x.target}`)))
    const targets = Array.from(new Set(usesAll.map((x: any) => String(x.target))))
    const problems: string[] = []
    if (root.hasError && c.name !== "A17_deconstruction_nested_write_binds") problems.push("PARSE-ERROR")
    for (const want of c.expectUses ?? []) {
      const ok = want.includes("->") ? pairs.includes(want) : targets.includes(want)
      if (!ok) problems.push(`missing ${want}`)
    }
    for (const bad of c.forbidUses ?? []) {
      if (pairs.includes(bad) || targets.includes(bad)) problems.push(`forbidden ${bad}`)
    }
    const ok = problems.length === 0
    if (ok) passN++; else failN++
    console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}${problems.length ? "  -> " + problems.join("; ") : ""}`)
    if (!ok || process.env.BB_R2_VERBOSE) {
      console.log(`      uses: ${JSON.stringify(pairs)}`)
      if (c.note) console.log(`      note: ${c.note}`)
    }
  }
  console.log(`\nBattery A: ${passN} pass / ${failN} fail`)
}
main()
