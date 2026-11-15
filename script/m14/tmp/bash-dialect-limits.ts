/**
 * READ-ONLY PROBE — what exactly is the pinned bash grammar failing to parse?
 *
 * The generalization draw DEFERred 13 real bash files across four repos the lane
 * has never been tuned against, none of them zsh. A file count is not a finding;
 * the SHAPE of the failure is, because a common cause is one documented boundary
 * and an idiosyncratic one is a list of work. So this prints the offending line
 * for every ERROR/MISSING node and groups them by the construct they contain.
 *
 * Writes nothing.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const FILES = [
  "bash-completion/completions-core/tmux.bash",
  "bash-completion/completions-core/jarsigner.bash",
  "bash-completion/completions-core/bzip2.bash",
  "bash-completion/completions-core/lzip.bash",
  "bash-completion/completions-core/rpm.bash",
  "bash-completion/completions-core/killall.bash",
  "kubernetes/hack/benchmark-go.sh",
  "kubernetes/hack/_update-generated-protobuf-dockerized.sh",
  "kubernetes/hack/local-up-cluster.sh",
  "kubernetes/cluster/get-kube-binaries.sh",
  "kubernetes/cluster/gce/config-test.sh",
  "kubernetes/cluster/gce/util.sh",
  "kubernetes/test/cmd/discovery.sh",
]

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(process.cwd(), "wasm/tree-sitter-bash.wasm"))))

// Construct probes, ordered most-specific first. Each is a thing a real bash
// script does that the pinned grammar may or may not model.
const CONSTRUCTS: [string, (l: string) => boolean][] = [
  ["extglob !(...)", (l) => /(^|[^)]|[|()])\!?\([^)]*[|)]/.test(l)],
  ["[[ =~ ]] regex match", (l) => /=~/.test(l)],
  ["here-string <<<", (l) => l.includes("<<<")],
  ["arithmetic (( ))", (l) => /\(\(/.test(l)],
  ["process substitution <( ) >( )", (l) => /[<>]\(/.test(l)],
  ["coproc", (l) => /\bcoproc\b/.test(l)],
  ["array slice ${a[@]:1:2}", (l) => /\$\{[^}]*@\][^}]*:[0-9]/.test(l)],
  ["brace expansion {a,b}", (l) => /\{[^}]*,[^}]*\}/.test(l)],
  ["local -n nameref", (l) => /\blocal\s+-[a-zA-Z]*n\b/.test(l)],
  ["[[ -v ]]", (l) => /\[\[\s+-[a-zA-Z]*v/.test(l)],
  ["select", (l) => /^\s*select\b/.test(l)],
  ["c-style for ((;;))", (l) => /for\s*\(\(/.test(l)],
  ["declare -g", (l) => /\bdeclare\s+-[a-zA-Z]*g\b/.test(l)],
  ["test -o pipefail", (l) => /-o\s+pipefail/.test(l)],
  ["&& / || chain", (l) => /(&&|\|\|)/.test(l)],
  ["unicode / smart quotes", (l) => /[\u2018\u2019\u201c\u201d]/.test(l)],
  ["backslash line continuation", (l) => /\\$/.test(l)],
]

const groups = new Map<string, { n: number; files: Set<string>; lines: string[] }>()
let total = 0
for (const f of FILES) {
  const abs = path.join(CR, f)
  let text: string
  try { text = readFileSync(abs, "utf8") } catch { continue }
  const lines = text.split("\n")
  const tree = parser.parse(text)
  const rows: string[] = []
  const visit = (n: any) => {
    if (n.type === "ERROR" || n.isMissing) rows.push(`${n.startPosition.row + 1}: ${lines[n.startPosition.row] ?? ""}`)
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  if (tree) { visit(tree.rootNode); tree.delete?.() }
  total += rows.length
  console.log(`\n${f}  (${rows.length} ERROR/MISSING)`)
  for (const r of rows.slice(0, 4)) console.log(`   ${r.trim().slice(0, 150)}`)
  for (const r of rows) {
    const line = r.slice(r.indexOf(":") + 1)
    const hit = CONSTRUCTS.find(([, p]) => p(line))
    const key = hit ? hit[0] : "UNCLASSIFIED"
    const g = groups.get(key) ?? { n: 0, files: new Set<string>(), lines: [] }
    g.n++; g.files.add(f)
    if (g.lines.length < 3) g.lines.push(`${f.split("/").pop()}:${r.slice(0, r.indexOf(":") + 1)} ${line.trim().slice(0, 100)}`)
    groups.set(key, g)
  }
}

console.log(`\n\n=== ${total} ERROR/MISSING nodes across ${FILES.length} real bash files, grouped by construct ===`)
for (const [k, g] of [...groups.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`\n  ${k}  —  ${g.n} node(s) across ${g.files.size} file(s)`)
  for (const l of g.lines) console.log(`      ${l}`)
}
