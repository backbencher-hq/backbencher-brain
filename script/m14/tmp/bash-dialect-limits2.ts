/**
 * READ-ONLY PROBE — classify by the ERROR NODE'S OWN TEXT, not its start line.
 *
 * The first pass attributed a construct from the line an ERROR node *begins* on,
 * which is only meaningful for a small node. A file the grammar cannot parse at
 * all produces ONE node spanning the file, and attributing that to whatever sits
 * on line 1 reported `rpm.bash:1: # bash completion for rpm` — a comment — which
 * is a methodological artefact, not a finding. Here each node is classified from
 * the text it actually contains, and nodes that span many lines are reported as
 * such instead of being guessed at.
 *
 * Writes nothing.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const FILES = [
  "bash-completion/completions-core/rpm.bash", "bash-completion/completions-core/tmux.bash",
  "bash-completion/completions-core/jarsigner.bash", "bash-completion/completions-core/bzip2.bash",
  "bash-completion/completions-core/lzip.bash", "bash-completion/completions-core/killall.bash",
  "kubernetes/hack/benchmark-go.sh", "kubernetes/hack/_update-generated-protobuf-dockerized.sh",
  "kubernetes/hack/local-up-cluster.sh", "kubernetes/cluster/get-kube-binaries.sh",
  "kubernetes/cluster/gce/config-test.sh", "kubernetes/cluster/gce/util.sh",
  "kubernetes/test/cmd/discovery.sh",
]

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(process.cwd(), "wasm/tree-sitter-bash.wasm"))))

const CONSTRUCTS: [string, (t: string) => boolean][] = [
  ["extglob !( ) @() +() ?() *()", (t) => /(^|[^\\])[!?@+*]\(/.test(t)],
  ["[[ =~ ]] regex operator", (t) => /=~/.test(t)],
  ["here-string <<<", (t) => t.includes("<<<")],
  ["arithmetic (( ))", (t) => /\(\(/.test(t)],
  ["process substitution <( )", (t) => /[<>]\(/.test(t)],
  ["coproc", (t) => /\bcoproc\b/.test(t)],
  ["array slice ${a[@]:n:m}", (t) => /\$\{[^}]*@\][^}]*:[0-9]/.test(t)],
  ["local -n nameref", (t) => /\blocal\s+-[a-zA-Z]*n\b/.test(t)],
  ["c-style for ((;;))", (t) => /for\s*\(\(/.test(t)],
  ["select", (t) => /\bselect\b/.test(t)],
  ["${var:offset:len} substring", (t) => /\$\{[A-Za-z_][A-Za-z0-9_]*:[0-9-]/.test(t)],
  ["unicode quotes", (t) => /[\u2018\u2019\u201c\u201d]/.test(t)],
  ["CRLF line ending", (t) => t.includes("\r")],
  ["\\ continuation", (t) => /\\\r?\n/.test(t)],
]

const groups = new Map<string, { n: number; files: Set<string>; ex: string[] }>()
let total = 0, wholeFile = 0, unclassified = 0
for (const f of FILES) {
  const abs = path.join(CR, f)
  let text: string
  try { text = readFileSync(abs, "utf8") } catch { continue }
  const tree = parser.parse(text)
  if (!tree) continue
  const nodes: any[] = []
  const visit = (n: any) => { if (n.type === "ERROR" || n.isMissing) nodes.push(n); for (let i = 0; i < n.childCount; i++) visit(n.child(i)) }
  visit(tree.rootNode)
  tree.delete?.()
  for (const n of nodes) {
    total++
    const t = n.text ?? ""
    const lines = t.split("\n").length
    const fileLines = text.split("\n").length
    const spans = lines > 3
    if (spans && lines >= fileLines * 0.5) { wholeFile++; continue }
    // THIRD pass, and the defensible one. Pass 1 classified by the node's START
    // LINE and counted 33 extglob; pass 2 classified by the node's OWN TEXT and
    // counted 3. Both are wrong, in opposite directions, and the source says why:
    // `*[[ ${words[*]} == *\ -@(*([^ -])f|-file )* ]]` breaks at the TAIL, so the
    // extglob marker sits in successfully-parsed context OUTSIDE the error node
    // and pass 2 could not see it, while pass 1 charged every spanning node to
    // whatever its first line happened to contain. The window below is the node
    // plus a margin of surrounding lines, which is the only region that can hold
    // both halves of the construct.
    const W = Number(process.env.BB_W ?? 2)
    const sRow = Math.max(0, n.startPosition.row - W)
    const eRow = Math.min(text.split("\n").length - 1, n.endPosition.row + W)
    const window = text.split("\n").slice(sRow, eRow + 1).join("\n")
    const hit = CONSTRUCTS.find(([, p]) => p(window))
    const key = hit ? hit[0] : "UNCLASSIFIED"
    if (key === "UNCLASSIFIED") unclassified++
    const g = groups.get(key) ?? { n: 0, files: new Set<string>(), ex: [] }
    g.n++; g.files.add(f)
    if (g.ex.length < 3) g.ex.push(`${f.split("/").pop()}:${n.startPosition.row + 1} ${JSON.stringify(window.trim().split("\n")[0].slice(0, 92))}`)
    groups.set(key, g)
  }
}
console.log(`=== ${total} ERROR/MISSING nodes in ${FILES.length} real bash files ===`)
console.log(`    ${wholeFile} span most of their file and are reported as whole-file, not guessed at`)
console.log(`    ${unclassified} remain UNCLASSIFIED after 14 construct probes, over a +/-2-line window\n`)
console.log(`    (window-dependent: +/-1 and +/-3 lines are in the sensitivity note in the closure record)\n`)
for (const [k, g] of [...groups.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${k}  —  ${g.n} node(s) across ${g.files.size} file(s)`)
  for (const e of g.ex) console.log(`      ${e}`)
}
