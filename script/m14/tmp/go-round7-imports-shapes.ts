// Round-7 `imports` shapes probe.
//
// A full-extent corpus read can agree on every file and still miss a shape, so
// each case below is a DISCRIMINATING one: a case the oracle and the analyzer
// must BOTH be shown to handle, and a control the two must agree is WRONG
// about. The controls are the half that matters — an oracle that only ever
// confirms the analyzer cannot fail, and round 6 learned that the expensive
// way (GOD9: the truth was written to mirror a defect, so the lane reported
// agreement on a self-contradiction).
import * as fs from "node:fs"
import * as path from "node:path"
import { deriveGoImports } from "./go-round7-imports-truth"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

type Case = {
  id: string
  why: string
  src: string
  /** target paths the ANALYZER must publish */
  expect: string[]
  /** target paths the analyzer must NOT publish (the control half) */
  forbid?: string[]
}

const CASES: Case[] = [
  {
    id: "single-unparenthesised",
    why: "`import \"fmt\"` has no parentheses and no import_spec_list, so a grouped-only derivation returns zero. GO18 was fixed on the import_spec edge and this is the shape most real files are not.",
    src: `package p\n\nimport "fmt"\n\nvar _ = fmt.Sprintf\n`,
    expect: ["fmt"],
  },
  {
    id: "grouped-multiple",
    why: "One import_declaration wrapping several specs must yield one edge per spec, not one edge for the block. This is the shape 98% of the corpus uses, so a bug here would be invisible in any file that is not grouped.",
    src: `package p\n\nimport (\n\t"fmt"\n\t"os"\n\t"strings"\n)\n\nvar _, _, _ = fmt.Sprint, os.Args, strings.TrimSpace\n`,
    expect: ["fmt", "os", "strings"],
  },
  {
    id: "aliased",
    why: "`import f \"a/b\"` has a `name` field. The target is the PATH, not the alias — an oracle that publishes the alias would satisfy the differential against garbage while the real module path is never checked.",
    src: `package p\n\nimport f "fmt"\n\nvar _ = f.Sprint\n`,
    expect: ["fmt"],
    forbid: ["f"],
  },
  {
    id: "dot-import",
    why: "`import . \"a/b\"` is legal and its name field is a dot. A derivation that treats a present `name` as an alias to publish would emit `.` as a module path; the analyzer must publish the real path only.",
    src: `package p\n\nimport . \"strings\"\n\nvar _ = TrimSpace("x")\n`,
    expect: ["strings"],
    forbid: ["."],
  },
  {
    id: "blank-import-cgo",
    why: "`import _ \"C\"` is the cgo pseudo-import and `_ \"embed\"` is the embed marker. The path `C` is one character and names no module on disk, so any derivation that resolves a path to a package name, or that skips a spec with a `name` field, drops it. 158 of the pinned corpora's files are in the cgo tree family.",
    src: `package p\n\n/*\n#include <stdlib.h>\n*/\nimport "C"\n\nvar _ = C.int(0)\n`,
    expect: ["C"],
  },
  {
    id: "blank-identifier-embed",
    why: "`import _ \"embed\"` must publish `embed` even though `_` discards the name — the dependency is real, which is the whole point of the label.",
    src: `package p\n\nimport _ \"embed\"\n\n//go:embed x.txt\nvar s string\n`,
    expect: ["embed"],
    forbid: ["_"],
  },
  {
    id: "grouped-aliased-mixed",
    why: "A grouped import mixing aliased, blank and plain specs must yield all three, and the aliased one must still carry its path.",
    src: `package p\n\nimport (\n\tf \"fmt\"\n\t_ \"os/exec\"\n\t\"strings\"\n)\n\nvar _, _ = f.Sprint, strings.TrimSpace\n`,
    expect: ["fmt", "os/exec", "strings"],
    forbid: ["f", "_"],
  },
  {
    id: "duplicate-path-one-file",
    why: "The same path twice in one file is legal to write and illegal to compile. The analyzer pushes one edge PER SPEC, so two edges are published; the harness dedupes the analyzer side by label|target, so the truth must dedupe too or it reports a phantom surplus on a file that is otherwise identical.",
    src: `package p\n\nimport (\n\t\"fmt\"\n\t\"fmt\"\n)\n\nvar _ = fmt.Sprint\n`,
    expect: ["fmt"],
  },
  {
    id: "no-package-clause-source-fallback",
    why: "A file with no package clause (a fragment, or one the grammar recovered badly) must fall back to the file path as the edge SOURCE. The truth cannot see the filePath the analyzer was handed, so this is a documented asymmetry — but the TARGET set must still be right, and a derivation that bails on a missing package clause would report zero and look clean.",
    src: `import "fmt"\n\nvar _ = fmt.Sprint\n`,
    expect: ["fmt"],
  },
  {
    id: "import-in-error-region",
    why: "A malformed import leaves the spec inside a recovered ERROR subtree. GO15/GO17's ruling is that a recovered region is not a fact to read a VALUE out of, so the question is whether an import path inside one is still a dependency. This case is a CONTROL: the oracle and the analyzer must AGREE, and whichever way they agree is the contract to write down — not a case to bend the oracle to.",
    src: `package p\n\nimport (\n\t\"fmt\"\n\t"os\"\n\nvar _ = fmt.Sprint\n`,
    expect: ["fmt", "os"],
  },
  {
    id: "versioned-and-nested-paths",
    why: "The path is a string, and its separators (`/`, `.`, `-`, `v2`) are what moved the label off `references` in the first place. An oracle that normalised or truncated a path would agree on `fmt` and quietly disagree on every real module path in the corpus.",
    src: `package p\n\nimport (\n\t\"github.com/go-logr/logr\"\n\t\"go.opentelemetry.io/otel/trace\"\n\t\"golang.org/x/net/v2/http2\"\n\t\"gopkg.in/yaml.v3\"\n)\n\nvar _, _, _, _ = logr.Logger{}, trace.Span{}, http2.Transport{}, yaml.Marshal\n`,
    expect: [
      "github.com/go-logr/logr",
      "go.opentelemetry.io/otel/trace",
      "golang.org/x/net/v2/http2",
      "gopkg.in/yaml.v3",
    ],
  },
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-go.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-go-analyzer.ts"))

  let pass = 0
  let fail = 0
  for (const c of CASES) {
    const p = new P()
    p.setLanguage(g)
    const tree = p.parse(c.src)
    let res: any
    try { res = await new mod.RealGoAnalyzer().analyze(tree.rootNode, c.src, "probe.go") } catch (e: any) {
      console.log(`THROW  ${c.id}: ${e?.message ?? e}`)
      fail++
      continue
    }
    const got = new Set<string>()
    const lineOf = new Map<string, number>()
    for (const r of res.relationships ?? []) {
      if (String(r.type) !== "imports") continue
      got.add(String(r.target ?? ""))
      lineOf.set(String(r.target ?? ""), r.line_number)
    }
    const truth = new Set(deriveGoImports(tree.rootNode, "probe.go").map((t) => t.target))

    const problems: string[] = []
    for (const e of c.expect) if (!got.has(e)) problems.push(`analyzer missing ${e}`)
    for (const e of c.forbid ?? []) if (got.has(e)) problems.push(`analyzer published forbidden ${e}`)
    for (const t of truth) if (!got.has(t)) problems.push(`oracle derived ${t}, analyzer does not publish it`)
    for (const e of got) if (!truth.has(e)) problems.push(`analyzer published ${e}, oracle does not derive it`)

    if (problems.length === 0) { console.log(`ok    ${c.id}`); pass++ } else {
      console.log(`FAIL  ${c.id}`)
      for (const p2 of problems) console.log(`        ${p2}`)
      fail++
    }
  }
  console.log(`\nimports shapes: ${pass} pass / ${fail} fail (${CASES.length} cases)`)
  process.exit(fail === 0 ? 0 : 1)
}
main()
