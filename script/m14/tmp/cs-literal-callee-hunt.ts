// script/m14/tmp/cs-literal-callee-hunt.ts — what makes the grammar recover into
// an invocation whose CALLEE is a boolean literal? The 900-file powershell depth
// draw produced exactly one: `calls StartSSHProcess -> false`. Reproduce the
// shape on a small source so the fixture can pin the fix.
import * as fs from "fs"
import * as path from "path"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-c_sharp.wasm"))
  const p = new P()
  p.setLanguage(LANG)
  const ROOT = process.cwd()
  const { RealCSharpAnalyzer } = await import(path.join(ROOT, "src/ast/real-csharp-analyzer"))

  const cases: Array<[string, string]> = [
    ["interp-verbatim-char-literals", [
      "class C {",
      "  void M(string filePath) {",
      "    var startInfo = new System.Diagnostics.ProcessStartInfo();",
      "    startInfo.ArgumentList.Add(string.Create(null, $@\"-s {this.Name.TrimStart('[').TrimEnd(']')} {this.Sub}\"));",
      "    startInfo.CreateNoWindow = true;",
      "    startInfo.UseShellExecute = false;",
      "    return StartSSHProcessImpl(startInfo, out var a);",
      "  }",
      "}",
    ].join("\n")],
    ["bool-literal-then-call", [
      "class C {",
      "  void M() {",
      "    x = false;",
      "    return StartSSHProcessImpl(a);",
      "  }",
      "}",
    ].join("\n")],
    ["missing-semi-then-return", [
      "class C {",
      "  void M() {",
      "    x = false",
      "    return Z(a);",
      "  }",
      "}",
    ].join("\n")],
    ["missing-semi-then-long-call", [
      "class C {",
      "  void M(string filePath) {",
      "    startInfo.WorkingDirectory = Path.GetDirectoryName(filePath);",
      "    startInfo.CreateNoWindow = true;",
      "    startInfo.UseShellExecute = false",
      "    return StartSSHProcessImpl(startInfo, out a, out b, out c);",
      "  }",
      "}",
    ].join("\n")],
    ["missing-semi-then-long-call-with-inner", [
      "class C {",
      "  void M(string filePath) {",
      "    startInfo.ArgumentList.Add(string.Create(null, $@\"-s {this.N.TrimStart('[').TrimEnd(']')} {this.S}\"));",
      "    startInfo.WorkingDirectory = Path.GetDirectoryName(filePath);",
      "    startInfo.CreateNoWindow = true;",
      "    startInfo.UseShellExecute = false",
      "    return StartSSHProcessImpl(startInfo, out a, out b, out c);",
      "  }",
      "}",
    ].join("\n")],
    ["interp-with-char-indexer", [
      "class C {",
      "  void M() {",
      "    var s = $\"-s {this.Name.TrimStart('[').TrimEnd(']')} {this.Sub}\";",
      "    y = false;",
      "    return Z(a);",
      "  }",
      "}",
    ].join("\n")],
  ]
  for (const [label, src] of cases) {
    const root = p.parse(src).rootNode
    const errs: string[] = []
    const bad: string[] = []
    const walk = (n: any) => {
      if (n.type === "ERROR" || n.isMissing) errs.push(`${n.type}@${n.startPosition.row + 1}`)
      if (n.type === "invocation_expression") {
        const f = n.childForFieldName("function")
        if (f && f.type !== "identifier" && f.type !== "member_access_expression" && f.type !== "generic_name") bad.push(`${f.type}@${n.startPosition.row + 1} text=${JSON.stringify(f.text.slice(0, 24))}`)
      }
      for (let i = 0; i < n.childCount; i++) walk(n.child(i))
    }
    walk(root)
    const res: any = await new RealCSharpAnalyzer().analyze(root, src, "x.cs")
    const calls = (res.relationships ?? []).filter((r: any) => r.type === "calls").map((r: any) => `${r.source}->${r.target}`)
    console.log(`\n[${label}] ERROR=${errs.length ? errs.join(",") : "none"} nonNameCallee=${bad.length ? bad.join(",") : "none"}`)
    console.log(`  analyzer calls: ${JSON.stringify(calls)}`)
  }
}

main()
