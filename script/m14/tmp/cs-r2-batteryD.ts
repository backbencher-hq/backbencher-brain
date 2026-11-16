// cs-r2-batteryD — round-2 closing cases: property-pattern designators,
// explicit-interface read attribution, namespace-scoped using detection.
import * as fs from "fs"
import * as path from "path"
import { RealCSharpAnalyzer } from "../../../src/ast/real-csharp-analyzer"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-c_sharp.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  let passN = 0, failN = 0
  const check = (n: string, ok: boolean, d: string) => { if (ok) passN++; else failN++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : "  -> " + d}`) }
  { // D1: property-pattern designator collides with member; designator silent
    const src = `class Point { public int X; }\nclass S { static int X = 1; bool Sub(Point pt) { return pt is { X: 1 } && X > 0; } }\n`
    const root = await parseSrc(src)
    const r: any = await new RealCSharpAnalyzer().analyze(root, src, "r2d1.cs")
    const pairs = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => `${x.source}->${x.target}`)
    const readsX = pairs.filter((p: string) => p.endsWith("->X"))
    check("D1_property_pattern_designator_silent_member_read_kept", readsX.length >= 1 && root.hasError === false, JSON.stringify(pairs))
  }
  { // D2: explicit interface implementation body reads attribute by name (family-accepted name-keying)
    const src = `interface IFoo { int M(); }\nclass C : IFoo { static int Helper = 2; int IFoo.M() { return Helper; } }\n`
    const root = await parseSrc(src)
    const r: any = await new RealCSharpAnalyzer().analyze(root, src, "r2d2.cs")
    const pairs = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => `${x.source}->${x.target}`)
    check("D2_explicit_interface_read_emits", pairs.some((p: string) => p.endsWith("->Helper")), JSON.stringify(pairs))
  }
  { // D3: using inside a namespace block is still a marker
    const src = `namespace N { using Microsoft.AspNetCore.Mvc; class C { } }\n`
    const root = await parseSrc(src)
    const r: any = await new RealCSharpAnalyzer().analyze(root, src, "r2d3.cs")
    const det: string[] = (r.metadata as any)?.detectedFrameworks ?? []
    check("D3_namespace_scoped_using_detected", det.includes("ASP.NET Core"), JSON.stringify(det))
  }
  console.log(`\nBattery D: ${passN} pass / ${failN} fail`)
}
main()
