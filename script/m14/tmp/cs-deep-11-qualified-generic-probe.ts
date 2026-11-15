// CS-DEEP-11 — a DIRECT probe of D1, plus a corpus occurrence count for the shape.
//
// The corpus diffs (cs-deep-10) came back 0/0 on 400 roslyn and 400 aspnetcore files,
// which is a real and reportable result: on those two draws the declared-type graph is
// COMPLETE. But the qualified-generic shape is rare in both (aspnetcore: 3 files in 400
// carry a fully-qualified generic in a declared-type position, and the two draws'
// samples missed them), which is exactly the trap the lane's own record describes —
// "record struct has no corpus coverage in the lane's pinned pair … the fixture is
// therefore the only gate that can catch it today".
//
// So this is the fixture-shaped instrument: every spelling of a qualified generic in a
// declared-type position, plus the plain twin, side by side, plus the corpus count of
// the shape over a caller-supplied list. The claim it supports is the honest one:
// the shape is a DEFECT (measured here) whose corpus frequency is LOW (measured there).
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

const CASES: Array<{ name: string; src: string }> = [
  { name: "Q1-plain-base (the twin that WORKS)", src: `public class Holder { Dictionary<string, Widget> _m; } public class Widget { }` },
  { name: "Q2-qualified-base (the defect)", src: `public class Holder { System.Collections.Generic.Dictionary<string, Widget> _m; } public class Widget { }` },
  { name: "Q3-qualified-base-2-segments", src: `public class Holder { My.Ns.Dictionary<string, Widget> _m; } public class Widget { }` },
  { name: "Q4-qualified-base-global", src: `public class Holder { global::System.Collections.Generic.Dictionary<string, Widget> _m; } public class Widget { }` },
  { name: "Q5-qualified-base-property", src: `public class Holder { public System.Collections.Generic.Dictionary<string, Widget> P { get; set; } } public class Widget { }` },
  { name: "Q6-qualified-base-parameter", src: `public class C { public void M(System.Collections.Generic.Dictionary<string, Widget> d) { } } public class Widget { }` },
  { name: "Q7-qualified-base-return", src: `public class C { public System.Collections.Generic.Dictionary<string, Widget> M() => null!; } public class Widget { }` },
  { name: "Q8-qualified-base-nested-args", src: `public class Holder { System.Collections.Generic.Dictionary<string, System.Collections.Generic.List<Widget>> _m; } public class Widget { }` },
  { name: "Q9-qualified-base-tuple-arg", src: `public class Holder { System.Collections.Generic.Dictionary<string, (Widget w, int n)> _m; } public class Widget { }` },
  { name: "Q10-qualified-base-no-args (control)", src: `public class Holder { System.Collections.Generic.Dictionary _m; }` },
]

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const mod: any = await import(path.join(ROOT, "src/ast/real-csharp-analyzer.ts"))

  console.log("== the shape, spelled out\n")
  for (const c of CASES) {
    const tree = parser.parse(c.src + "\n")
    const refs = mod.csharpDeclaredTypeRefs(tree.rootNode)
    const got = refs.map((r: any) => r.target).join(", ")
    console.log(`   ${c.name}\n      src:  ${c.src}\n      refs: ${got || "(none)"}   errors=${tree.rootNode.hasError ? "YES" : "no"}`)
  }

  // Corpus frequency of the shape.
  const listFile = arg("--list")
  if (!listFile) return
  const limit = Number(arg("--limit") ?? 2000)
  const files = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, limit)
  let occurrences = 0
  let filesWith = 0
  const where: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    // A qualified generic in a declared-type position: a dotted path whose LAST
    // segment is followed by `<` on a declaration line. Counted from the TEXT so the
    // number does not depend on the analyzer at all.
    const re = /(^|\n)\s*((public|private|protected|internal|static|readonly|virtual|override|sealed|abstract|partial|new|const|extern|unsafe|async|file|required|volatile|event|ref)\s+)+[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*<[^;={]*>/g
    const m = src.match(re)
    if (m && m.length > 0) {
      occurrences += m.length
      filesWith++
      if (where.length < 12) where.push(`${path.basename(f)}: ${m.length}`)
    }
  }
  console.log(`\n== corpus frequency of the shape over ${files.length} files: ${occurrences} occurrences in ${filesWith} files`)
  for (const w of where) console.log(`   ${w}`)
}

if (import.meta.main) await main()
