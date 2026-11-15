// cs-r2-batteryB — round-2 (third verification) framework-marker exotics.
// Attacks the CONV-CS-2 mechanism: over-match guards (prefix fakes), the
// static/alias/global using forms, Forms-vs-Window precedence, attribute-only
// detection and the fixed priority order.
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

type Case = { name: string; src: string; expect?: string[]; forbid?: string[]; primary?: string | null }

const CASES: Case[] = [
  {
    name: "B1_static_and_alias_using_forms",
    src: `using static Microsoft.EntityFrameworkCore.EF;\nusing EF = Microsoft.EntityFrameworkCore;\nclass C { }\n`,
    expect: ["Entity Framework Core"],
  },
  {
    name: "B2_global_using_form",
    src: `global using Microsoft.AspNetCore.Builder;\nclass C { }\n`,
    expect: ["ASP.NET Core"],
  },
  {
    name: "B3_prefix_fake_not_matched",
    src: `using Foo.Microsoft.AspNetCore;\nusing MyXunit;\nclass C { }\n`,
    forbid: ["ASP.NET Core", "xUnit"],
    primary: null,
  },
  {
    name: "B4_namespace_decl_is_not_a_using_marker",
    src: `namespace Microsoft.AspNetCore.Mvc;\nclass C { }\n`,
    forbid: ["ASP.NET Core"],
    note: "markers are usings/bases/attributes only (documented)",
  },
  {
    name: "B5_forms_base_and_using_never_wpf",
    src: `using System.Windows.Forms;\nclass F : System.Windows.Forms.Form { }\n`,
    expect: ["Windows Forms"],
    forbid: ["WPF"],
  },
  {
    name: "B6_wpf_using_and_window_base",
    src: `using System.Windows;\nclass W : Window { }\n`,
    expect: ["WPF"],
    forbid: ["Windows Forms"],
  },
  {
    name: "B7_attribute_only_detection",
    src: `class T { [NUnit.Framework.TestFixture] void X() { } }\nclass U { [Fact] void Y() { } }\nclass V { [TestMethod] void Z() { } }\n`,
    expect: ["NUnit", "xUnit", "MSTest"],
    primary: "xUnit",
    note: "priority: xUnit before NUnit before MSTest; all three present",
  },
  {
    name: "B8_priority_primary_pick",
    src: `using Xunit;\nusing Microsoft.EntityFrameworkCore;\nclass D : DbContext { }\n`,
    expect: ["Entity Framework Core", "xUnit"],
    primary: "Entity Framework Core",
    note: "fixed order: EF before test frameworks; array order = priority order",
  },
  {
    name: "B9_unity_base_only",
    src: `class G : UnityEngine.MonoBehaviour { }\n`,
    expect: ["Unity"],
  },
  {
    name: "B10_controller_base_without_using",
    src: `class Home : ControllerBase { }\n`,
    expect: ["ASP.NET Core"],
  },
  {
    name: "B11_generic_base_hub_unwrapped",
    src: `class H : Hub<IClient> { }\n`,
    expect: ["ASP.NET Core"],
    note: "generic_name leaf unwrapping in base lists",
  },
  {
    name: "B12_system_text_json_is_not_a_framework",
    src: `using System.Text.Json;\nusing System.Collections.Generic;\nclass C { }\n`,
    forbid: ["ASP.NET Core", "Entity Framework Core", "Unity", "WPF", "Windows Forms", "xUnit", "NUnit", "MSTest"],
    primary: null,
  },
]

async function main() {
  let passN = 0, failN = 0
  for (const c of CASES) {
    const root = await parseSrc(c.src)
    const r: any = await new RealCSharpAnalyzer().analyze(root, c.src, "r2b.cs")
    const det: string[] = (r.metadata as any)?.detectedFrameworks ?? []
    const primary = (r.metadata as any)?.framework ?? null
    const problems: string[] = []
    for (const want of c.expect ?? []) if (!det.includes(want)) problems.push(`missing ${want}`)
    for (const bad of c.forbid ?? []) if (det.includes(bad)) problems.push(`forbidden ${bad}`)
    if (c.primary !== undefined && primary !== c.primary) problems.push(`primary ${JSON.stringify(primary)} != ${JSON.stringify(c.primary)}`)
    const ok = problems.length === 0
    if (ok) passN++; else failN++
    console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}${problems.length ? "  -> " + problems.join("; ") : ""}`)
    if (!ok || process.env.BB_R2_VERBOSE) console.log(`      detected=${JSON.stringify(det)} primary=${JSON.stringify(primary)}${c.note ? " | " + c.note : ""}`)
  }
  console.log(`\nBattery B: ${passN} pass / ${failN} fail`)
}
main()
