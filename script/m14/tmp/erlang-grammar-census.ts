// ER3 wave — the grammar census.
//
// Purpose: prove there is no UNKNOWN surface left. It walks real corpus files
// (OTP / rebar3 / cowboy) with the PINNED wasm and reports, for every node type
// the grammar can produce:
//   count       how many nodes of that type the corpus contains
//   parents     the parent node types it appears under (structural context)
//   example     the shortest source text seen, with its file
//   err         whether the type is an ERROR/MISSING node (grammar failures)
//
// The output is the classification table: every named type must be either
// HANDLED (a branch in real-erlang-analyzer.ts) or EXPLAINED (a deliberate
// negative: keywords, punctuation, literals, a category the family contract
// says must not emit edges). Nothing may be left unexplained.
//
// Usage:
//   bun run script/m14/tmp/erlang-grammar-census.ts [--files N] [--dir P] [--out P]
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..", "..")
const REPO_ROOT = "/home/sano/ishaq/bb_tests/repositories"

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? (process.argv[i + 1] ?? dflt) : dflt
}

const FILE_LIMIT = parseInt(arg("files", "400"), 10)
const CORPUS_DIRS = arg("dirs", "otp,rebar3,cowboy").split(",")
const OUT = arg("out", "")

interface Stat {
  count: number
  named: boolean
  parents: Map<string, number>
  example: string
  exampleFile: string
  isErrorish: boolean
}

function collectErFiles(): { file: string; root: string }[] {
  const out: { file: string; root: string }[] = []
  for (const d of CORPUS_DIRS) {
    const base = path.join(REPO_ROOT, d)
    if (!fs.existsSync(base)) continue
    const stack = [base]
    while (stack.length > 0) {
      const cur = stack.pop()!
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        if (e.name === ".git") continue
        const p = path.join(cur, e.name)
        if (e.isDirectory()) stack.push(p)
        else if (e.name.endsWith(".erl")) out.push({ file: p, root: d })
      }
    }
  }
  // Deterministic draw: spread across each corpus, not the first N of one.
  out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
  const byRoot = new Map<string, typeof out>()
  for (const f of out) {
    const arr = byRoot.get(f.root) ?? []
    arr.push(f)
    byRoot.set(f.root, arr)
  }
  const picked: typeof out = []
  const perRoot = Math.max(1, Math.floor(FILE_LIMIT / Math.max(1, byRoot.size)))
  for (const [, arr] of byRoot) {
    for (let i = 0; i < Math.min(perRoot, arr.length); i++) picked.push(arr[i])
  }
  return picked
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new ParserClass()
  parser.setLanguage(await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm"))))

  const files = collectErFiles()
  console.log(`corpus draw: ${files.length} .erl files from [${CORPUS_DIRS.join(", ")}]`)

  const stats = new Map<string, Stat>()
  let parseErrors = 0
  let totalNodes = 0

  for (const { file } of files) {
    let content: string
    try {
      content = fs.readFileSync(file, "utf8")
    } catch {
      continue
    }
    const tree = parser.parse(content)
    if (tree!.rootNode.hasError) parseErrors++
    const stack: any[] = [tree!.rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      totalNodes++
      const t: string = n.type
      let st = stats.get(t)
      if (!st) {
        st = { count: 0, named: n.isNamed, parents: new Map(), example: "", exampleFile: "", isErrorish: t === "ERROR" || n.isMissing }
        stats.set(t, st)
      }
      st.count++
      if (n.isError || n.isMissing) st.isErrorish = true
      const pt = n.parent?.type ?? "(root)"
      st.parents.set(pt, (st.parents.get(pt) ?? 0) + 1)
      const txt = n.text ?? ""
      if (st.example === "" || (txt.length < st.example.length && txt.length > 0 && txt.length < 120)) {
        st.example = txt
        st.exampleFile = file.replace(`${REPO_ROOT}/`, "")
      }
      for (let i = n.childCount - 1; i >= 0; i--) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }
  }

  const rows = [...stats.entries()].sort((a, b) => b[1].count - a[1].count)
  const lines: string[] = []
  lines.push(`# ER3 grammar census — ${files.length} files, ${totalNodes} nodes, ${parseErrors} files with a parse error`)
  lines.push("")
  lines.push("| node type | count | named | parents | example |")
  lines.push("|---|---|---|---|---|")
  for (const [t, s] of rows) {
    const parents = [...s.parents.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([p, c]) => `${p}(${c})`).join(" ")
    const ex = s.example.replace(/\|/g, "\\|").replace(/\n/g, "\\n")
    lines.push(`| \`${t}\` | ${s.count} | ${s.named ? "y" : "n"} | ${parents} | \`${ex}\` |`)
  }
  const md = lines.join("\n") + "\n"

  console.log(md)
  console.log(`\nSUMMARY types=${rows.length} named=${rows.filter(([, s]) => s.named).length} filesWithError=${parseErrors}`)
  if (OUT) {
    fs.writeFileSync(OUT, md)
    console.log(`wrote ${OUT}`)
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
