// cs-r2-batteryC — round-2 (third verification) regression re-derivations of
// the fixed shapes from both reviews: CS-R1 shadows, CS-C1 designators,
// CS-C3 binds, CS-C4 attribution, CS-B1/CS-B2/CS-B5. Each re-derives the
// CONTRACT on the current analyzer rather than trusting the old fixtures.
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

async function main() {
  let passN = 0, failN = 0
  const check = (name: string, ok: boolean, detail: string) => {
    if (ok) passN++; else failN++
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`)
  }

  // C1: initializer designator never reads, value collides with a member
  {
    const src = `class P2 { public int X; }\nclass S { static int X = 1; static int G = 2; P2 Build() { return new P2 { X = G }; } }\n`
    const root = await parseSrc(src)
    const r: any = await new RealCSharpAnalyzer().analyze(root, src, "r2c1.cs")
    const pairs = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => `${x.source}->${x.target}`)
    check("C1_initializer_designator_silent_value_reads", pairs.includes("Build->G") && !pairs.includes("Build->X"), JSON.stringify(pairs))
  }

  // C2: shadowing param suppresses; post-binding member read flows
  {
    const src = `class C { static int Max = 9; int Shadowed(int Max) { return Max; } int N() { return Max; } }\n`
    const root = await parseSrc(src)
    const r: any = await new RealCSharpAnalyzer().analyze(root, src, "r2c2.cs")
    const pairs = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => `${x.source}->${x.target}`)
    check("C2_shadow_suppressed_member_flows", !pairs.includes("Shadowed->Max") && pairs.includes("N->Max"), JSON.stringify(pairs))
  }

  // C3: positional pattern invocation is not a call; bindings silent
  {
    const src = `class Point { public int X; }\nclass S { bool Pos(object o) { return o is Point(1, int y) && y > 0; } }\n`
    const root = await parseSrc(src)
    const r: any = await new RealCSharpAnalyzer().analyze(root, src, "r2c3.cs")
    const calls = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "calls").map((x: any) => `${x.source}->${x.target}`)
    const uses = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => `${x.source}->${x.target}`)
    check("C3_positional_pattern_no_call_no_binding_read", !calls.some((p: string) => p.endsWith("->Point")) && !uses.includes("Pos->y"), JSON.stringify({ calls, uses }))
  }

  // C4: member-initializer read attributes to the INNERMOST CLASS (not global)
  {
    const src = `class Holder { static int Limit = 10; int bound = Limit; }\n`
    const root = await parseSrc(src)
    const r: any = await new RealCSharpAnalyzer().analyze(root, src, "r2c4.cs")
    const pairs = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => `${x.source}->${x.target}`)
    check("C4_class_scope_attribution", pairs.includes("Holder->Limit") && !pairs.includes("global->Limit"), JSON.stringify(pairs))
  }

  // C5: top-level statements attribute to global (CS-B1)
  {
    const src = `System.Console.WriteLine("x");\nclass K { }\n`
    const root = await parseSrc(src)
    const r: any = await new RealCSharpAnalyzer().analyze(root, src, "r2c5.cs")
    const calls = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "calls").map((x: any) => `${x.source}->${x.target}`)
    check("C5_top_level_calls_global", calls.includes("global->WriteLine"), JSON.stringify(calls))
  }

  // C6: nameof emits no call and no operand read
  {
    const src = `class C { static int Max = 9; string N() { return nameof(Max); } }\n`
    const root = await parseSrc(src)
    const r: any = await new RealCSharpAnalyzer().analyze(root, src, "r2c6.cs")
    const calls = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "calls").map((x: any) => `${x.source}->${x.target}`)
    const uses = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => `${x.source}->${x.target}`)
    check("C6_nameof_silent", !calls.some((p: string) => p.endsWith("->nameof")) && !uses.includes("N->Max"), JSON.stringify({ calls, uses }))
  }

  // C7: bare read + chain root (CONV-CS-1 pin, re-derived)
  {
    const src = `class W { private int x; public int Get() { return x; } }\nclass Ch { public Inner inner; public int Read() { return inner.deeper.leaf; } }\nclass Inner { public Deeper deeper; }\nclass Deeper { public int leaf; }\n`
    const root = await parseSrc(src)
    const r: any = await new RealCSharpAnalyzer().analyze(root, src, "r2c7.cs")
    const pairs = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => `${x.source}->${x.target}`)
    check("C7_chain_root_and_bare_reads", pairs.includes("Get->x") && pairs.includes("Read->inner"), JSON.stringify(pairs))
  }

  // C8: framework payload shell on a plain file (no keys missing)
  {
    const src = `using System;\nclass Plain { public int Value; }\n`
    const root = await parseSrc(src)
    const r: any = await new RealCSharpAnalyzer().analyze(root, src, "r2c8.cs")
    const md: any = r.metadata ?? {}
    check("C8_empty_shell_keys_present", Array.isArray(md.detectedFrameworks) && md.detectedFrameworks.length === 0 && Array.isArray(md.frameworkPatterns) && md.hasFrameworkIntelligence === true, JSON.stringify({ det: md.detectedFrameworks, fp: md.frameworkPatterns }))
  }

  console.log(`\nBattery C: ${passN} pass / ${failN} fail`)
}
main()
