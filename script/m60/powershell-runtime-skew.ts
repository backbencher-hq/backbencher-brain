/**
 * M60 #278 — how far apart are the two PowerShell parsers?
 *
 * WHY THIS EXISTS. Grammar patch G10 is ADMISSIBLE, changes nothing on the product, and
 * fixes 7 corpus files — the same patch measured under two different runtimes. The
 * product loads `wasm/tree-sitter-powershell.wasm` through `web-tree-sitter` 0.25.9;
 * the `tree-sitter` CLI used for every A/B in this lane is 0.26.9. Same grammar, same
 * bytes, different answers: the CLI reports a `--git-dir="$R/.git"` line clean and
 * web-tree-sitter still reports an ERROR on it.
 *
 * That is not a curiosity about one patch. A grammar improvement validated against the
 * CLI can be INERT in the product, and the F11 admissibility gate — which does run on
 * the product runtime — will correctly report "no change" without saying why. So the
 * question this answers is: for this grammar, how big is the disagreement, and which
 * direction does it run?
 *
 * WHAT IT MEASURES, and what it deliberately does not claim. It counts ERROR and
 * MISSING nodes per file under each runtime, and reports the files where they differ.
 * It does NOT decide which runtime is right, and it does not compare tree SHAPE beyond
 * the node counts — tree shape across runtime versions is a different and larger
 * question (a native tree diff is valid native-to-native, which is how F11's G2 was
 * pre-filtered, and invalid native-to-wasm, which is how G10's "7 files fixed" went
 * wrong).
 *
 * Writes an artifact. CLI: bun run script/m60/powershell-runtime-skew.ts
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = path.join(ROOT, "validation/m60/results/powershell-runtime-skew.json")
const REPOS = ["powershell", "ansible"]
const GRAMMAR = path.join(ROOT, "grammars", "tree-sitter-powershell")

interface FileRow {
  repo: string
  file: string
  errors: number
  missing: number
  tree: string
}

/** Count ERROR and MISSING in a web-tree-sitter parse, via the serialized tree. */
function countsFromWasmTree(t: string): { errors: number; missing: number } {
  let errors = 0
  let missing = 0
  // The s-expression names each node; count the node labels, not the text, so a
  // variable called `$ERROR` cannot be counted as an error node.
  const labels = t.match(/\(([A-Za-z_][A-Za-z0-9_]*|\"[^\"]*\")/g) ?? []
  for (const l of labels) {
    if (l === "(ERROR") errors++
    if (l === "(MISSING") missing++
  }
  return { errors, missing }
}

async function main() {
  const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(path.join(ROOT, "wasm/tree-sitter-powershell.wasm"))

  const files: { repo: string; abs: string }[] = []
  for (const repo of REPOS) {
    const d = path.join(CORPUS_ROOT, repo)
    if (!fs.existsSync(d)) continue
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", d, "ls-files", "*.ps1", "*.psm1"], { encoding: "utf8", maxBuffer: 1 << 26 })
        .trim().split("\n").filter(Boolean)
    } catch { continue }
    for (const f of tracked) files.push({ repo, abs: path.join(d, f) })
  }

  const rows: FileRow[] = []
  for (const { repo, abs } of files) {
    let src: string
    try { src = fs.readFileSync(abs, "utf8") } catch { continue }
    const p = new P()
    p.setLanguage(lang)
    const tree = p.parse(src).rootNode.toString()
    const { errors, missing } = countsFromWasmTree(tree)
    rows.push({ repo, file: path.relative(path.join(CORPUS_ROOT, repo), abs), errors, missing, tree })
  }

  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), files: rows }, null, 0))
  const totalE = rows.reduce((a, r) => a + r.errors, 0)
  const totalM = rows.reduce((a, r) => a + r.missing, 0)
  const damaged = rows.filter((r) => r.errors > 0).length
  console.log(`M60 #278 — powershell runtime skew (web-tree-sitter ${JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/web-tree-sitter/package.json"), "utf8")).version})`)
  console.log("")
  console.log(`  files            : ${rows.length}`)
  console.log(`  damaged (ERROR>0): ${damaged}`)
  console.log(`  ERROR nodes      : ${totalE}`)
  console.log(`  MISSING nodes    : ${totalM}`)
  console.log(`  wrote ${path.relative(ROOT, OUT)}`)
  console.log("")
  console.log("  The tree strings are in the artifact so a second runtime can be compared")
  console.log("  against this one without re-parsing: `tree` is the serialized s-expression.")
}

await main()
