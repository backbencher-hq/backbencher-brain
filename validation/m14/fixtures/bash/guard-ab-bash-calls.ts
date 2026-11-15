/**
 * A/B the two candidate `calls` guards the census surfaced, and measure both.
 *
 * The census found `calls` edges emitted from parse regions the grammar damaged
 * (zsh `(( ${+commands[x]} ))` in fbterm.plugin.zsh; a `case` arm pattern read as
 * a command name in kubernetes/third_party/gimme/gimme; a zsh subscript flag
 * `(r)` fragmenting into a one-letter name in ohmyzsh bind.zsh). The analyzer's
 * BD5 comment says the damage half of the guard was deliberately dropped because
 * it "costs 31 calls the independent oracle DOES corroborate" — measured on the
 * 2,747-file corpus of that day. The corpus is larger now, and the DECISION rests
 * on a count nobody can re-derive, so it is re-measured here for both candidates:
 *
 *   GUARD-A  a reserved-word name. `fi`/`esac`/`done` are reserved WORDS: bash
 *            never invokes them, so a `command` node carrying one is grammar
 *            recovery, not a call. Zero risk to real calls by construction.
 *            MEASURED 200 files / 2,945 edges: removes 30, of which 0 are real.
 *            IMPLEMENTED.
 *   GUARD-B  a damaged region. The command's own subtree holds an ERROR or
 *            MISSING node, or its name's ancestor chain is damaged up to the
 *            enclosing statement. MEASURED 200 files: removes 96; 400 files:
 *            removes 108, whose top names are `::log::status` 15, `print` 8,
 *            `autoload` 8 — real work. REJECTED.
 *
 * The question this file answers is not "is the guard nice" but "how many REAL
 * calls does GUARD-B delete". It answers that by printing, for every edge the
 * guard would remove, the source line it came from — so the removal set is
 * auditable by hand rather than counted.
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const flag = (n: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const SAMPLE = Number(flag("sample") ?? "400")
const SHOW = Number(flag("show") ?? "60")

/** POSIX bash reserved words. None of them is ever a command word. */
const RESERVED_WORDS = new Set([
  "if", "then", "else", "elif", "fi", "case", "esac", "for", "select", "while",
  "until", "do", "done", "in", "function", "time", "{", "}", "!", "[[", "]]",
  "((", "))", "coproc",
])

type Admitted = { repo: string; dir: string; rel: string; abs: string; text: string }
const admitted: Admitted[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    admitted.push({ repo: e, dir, rel, abs, text })
  }
}
admitted.sort((a, b) => {
  const ha = createHash("sha256").update(`${a.repo}/${a.rel}`).digest("hex")
  const hb = createHash("sha256").update(`${b.repo}/${b.rel}`).digest("hex")
  return ha < hb ? -1 : ha > hb ? 1 : 0
})
const files = admitted.slice(0, SAMPLE)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-bash.wasm"))))

const subtreeDamaged = (root: any): boolean => {
  const st: any[] = [root]
  while (st.length > 0) {
    const x = st.pop()
    if (x.type === "ERROR" || x.isMissing) return true
    for (let i = 0; i < x.childCount; i++) st.push(x.child(i))
  }
  return false
}
const ancestorDamaged = (node: any): boolean => {
  let p = node.parent
  let depth = 0
  while (p && depth < 8) {
    if (p.type === "ERROR" || p.isMissing) return true
    if (p.type === "list" || p.type === "program" || p.type === "compound_statement") return false
    p = p.parent
    depth++
  }
  return false
}
/** name@line -> {damaged, nameIsPlainWord, inCaseItem, parentType} for every command. */
const commandIndex = (root: any): Map<string, { damaged: boolean; plain: boolean; caseItem: boolean; parent: string }> => {
  const m = new Map<string, { damaged: boolean; plain: boolean; caseItem: boolean; parent: string }>()
  const visit = (n: any) => {
    if (n.type === "command") {
      let nameNode: any = null
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "command_name") { nameNode = c; break }
      }
      if (nameNode) {
        let word: any = null
        for (let j = 0; j < nameNode.namedChildCount; j++) {
          const w = nameNode.namedChild(j)
          if (w && w.type === "word") { word = w; break }
        }
        const nm = word ? word.text : nameNode.text
        const line = nameNode.startPosition.row + 1
        const plain = nameNode.namedChildCount === 0 || (nameNode.namedChildCount === 1 && nameNode.namedChild(0)?.type === "word")
        m.set(`${nm}@${line}`, {
          damaged: subtreeDamaged(n) || ancestorDamaged(nameNode),
          plain,
          caseItem: n.parent?.type === "case_item",
          parent: String(n.parent?.type ?? ""),
        })
      }
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(root)
  return m
}

/**
 * GUARD-C candidate: the `command` node was carved out of a COMMENT. A comment's
 * text is never a command, so this is a fabrication by construction — but the
 * parse does not nest the command INSIDE the comment (measured: in
 * ohmyzsh/lib/termsupport.zsh:35 the `command` and the `comment` are SIBLINGS on
 * the same line), so the test has to be span overlap rather than ancestry.
 */
const commentLines = (root: any): Map<number, string[]> => {
  const m = new Map<number, string[]>()
  const visit = (n: any) => {
    if (n.type === "comment") {
      const row = n.startPosition.row + 1
      const a = m.get(row) ?? []
      a.push(n.text)
      m.set(row, a)
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(root)
  return m
}

/** GUARD-D candidate: a `command` sitting in a `case_item`'s PATTERN slot — i.e. it
 *  is the first named child of the `case_item`. In a well-formed arm the pattern is
 *  a `word`/`string`, so a `command` in that slot is the pattern read as a name. */
const casePatternCommands = (root: any): Set<string> => {
  const s = new Set<string>()
  const visit = (n: any) => {
    if (n.type === "case_item") {
      const first = n.namedChild(0)
      if (first && first.type === "command") {
        for (let i = 0; i < first.namedChildCount; i++) {
          const c = first.namedChild(i)
          if (c && c.type === "command_name") {
            for (let j = 0; j < c.namedChildCount; j++) {
              const w = c.namedChild(j)
              if (w && w.type === "word") s.add(`${w.text}@${c.startPosition.row + 1}`)
            }
          }
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(root)
  return s
}

/**
 * GUARD-E candidate, found by the 400-file census AFTER GUARD-A landed.
 *
 * `kubernetes/third_party/gimme/gimme` emits four `calls` edges that name no
 * command bash can run: `-> binary` @936, `-> git` @938, `-> auto` @939 and
 * `-> *` @940. Every one is a `case` arm's PATTERN. The source is
 *
 *   935   if ! case "${GIMME_TYPE}" in
 *   936       binary) _try_existing binary || _try_binary "${GIMME_GO_VERSION}" "${GIMME_ARCH}" ;;
 *   ...
 *   940       *)
 *
 * — a `case` in the `!` position of an `if`, which the pinned grammar cannot
 * close. Three of the four arms keep the `)` as an ERROR hanging directly off
 * the `command` node, so they read as
 *
 *   (command (command_name (word))  (ERROR (")"))  (word) (word))
 *
 * and the fourth (`*)`) loses the `case_item` entirely and arrives as
 * `(command (command_name (word)))`.
 *
 * This is also a FALSIFIED WRITTEN RULING. `script/m14/spec/bash-completeness.json`
 * BD8 states "a `case` arm's PATTERN is a `word` or `string` node, never a
 * `command`, so no pattern was ever emitted as a call". The first clause holds —
 * the pattern IS a `word` — and the conclusion does not: once the surrounding
 * `case` is destroyed, that `word` sits in a `command_name` inside a `command`
 * and the pattern IS emitted as a call. BD8's DECISION (lift the `caseDepth`
 * suppression) stands and is untouched; only its stated evidence is wrong.
 *
 * GUARD-D was the obvious guard and it cannot work here: it keys on the arm
 * being the first named child of a `case_item`, and in this shape there IS no
 * `case_item` — measured 0 on 400 files, before and after.
 *
 * GUARD-E keys on the one structural fact that survives: an `ERROR` node that is
 * a DIRECT child of `command`. In a well-formed bash parse a `command`'s children
 * are its name, its arguments and its redirections; an ERROR among them means the
 * node is a fragment the parser could not close. It is strictly narrower than
 * GUARD-B, which tested the whole subtree plus the ancestor chain and removed 108
 * edges dominated by real calls (`::log::status` 15, `print` 8, `autoload` 8).
 * The question this A/B answers is whether the narrower test keeps the real calls
 * on the SAME LINES as the fabrications — gimme:936 alone carries both
 * `calls -> binary` (fabricated) and `calls -> _try_binary` (real).
 *
 * MEASURED, and REJECTED. 400 hash-ordered corpus files, 5,232 `calls` edges:
 * GUARD-E removes 18 (0.34%) — the 3 gimme fabrications and **15 real calls to
 * `kube::log::status` in kubernetes/test/e2e_node/gubernator.sh**. The reason is
 * the same one that sinks GUARD-B: `V=2 kube::log::status "..."` is a
 * `variable_assignment` in the command's own slot, and the pinned grammar puts an
 * ERROR beside it, so a REAL call and a lost `case` arm are the same node shape
 * here. 3 fabrications against 15 real calls is not a trade this lane should make
 * silently, so GUARD-E is not implemented and the 3 fabrications stand, named and
 * counted, rather than hidden inside a guard that costs more than it saves.
 *
 * The fourth gimme fabrication, `calls -> *` @940, survives GUARD-A and GUARD-E
 * both: it arrives as `(command (command_name (word)))` with no damage anywhere on
 * it, so no structural guard can see it, and the only test that would is a
 * blacklist on the literal name `*`, which is not a POSIX fact (a file named `*`
 * is legal). It is carried as a NAMED RESIDUAL: 1 edge on this sample.
 */
const directErrorCommand = (root: any): Set<string> => {
  const s = new Set<string>()
  const visit = (n: any) => {
    if (n.type === "command") {
      let hit = false
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c && (c.type === "ERROR" || c.isMissing)) { hit = true; break }
      }
      if (hit) {
        for (let j = 0; j < n.namedChildCount; j++) {
          const cn = n.namedChild(j)
          if (cn && cn.type === "command_name") s.add(`${cn.text.split(" ")[0]}@${cn.startPosition.row + 1}`)
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(root)
  return s
}

let totalCalls = 0
let idx = 0
const removedA: string[] = []
const removedB: string[] = []
const removedBPlainWord: string[] = []
const removedC: string[] = []
const removedD: string[] = []
const removedE: string[] = []
const damagedAll = new Map<string, number>()
const damagedByParent = new Map<string, number>()
let filesWithDamagedCalls = 0
let damagedFiles = 0

async function worker() {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const label = `${f.repo}/${f.rel}`
    const lines = f.text.split("\n")
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    if (!r || r.success === false) continue
    const calls = (r.relationships ?? []).filter((x: any) => String(x?.type).toLowerCase() === "calls")
    totalCalls += calls.length
    if (calls.length === 0) continue
    let m: Map<string, { damaged: boolean; plain: boolean; caseItem: boolean; parent: string }>
    let cm: Map<number, string[]>
    let pat: Set<string>
    let patE: Set<string>
    try {
      const t = parser.parse(f.text)
      if (!t) continue
      m = commandIndex(t.rootNode)
      cm = commentLines(t.rootNode)
      pat = casePatternCommands(t.rootNode)
      patE = directErrorCommand(t.rootNode)
      t.delete?.()
    } catch { continue }
    let anyDamaged = false
    for (const c of calls) {
      const nm = String(c?.target ?? "")
      const info = m.get(`${nm}@${c?.line_number}`)
      if (!info) continue
      if (info.damaged) {
        anyDamaged = true
        damagedAll.set(nm, (damagedAll.get(nm) ?? 0) + 1)
        damagedByParent.set(info.parent, (damagedByParent.get(info.parent) ?? 0) + 1)
      }
      const line = Number(c?.line_number)
      const src = (lines[line - 1] ?? "").trim()
      if (RESERVED_WORDS.has(nm)) removedA.push(`${label}: calls -> ${nm} @${line} :: ${src.slice(0, 100)}`)
      if (info.damaged) {
        removedB.push(`${label}: calls -> ${nm} @${line} parent=${info.parent} :: ${src.slice(0, 100)}`)
        if (info.plain) removedBPlainWord.push(`${label}: calls -> ${nm} @${line} parent=${info.parent} :: ${src.slice(0, 100)}`)
      }
      // GUARD-C: the name is a word of a comment on the same line.
      const comments = cm.get(line)
      if (comments) {
        for (const t2 of comments) {
          if (t2.includes(nm)) {
            removedC.push(`${label}: calls -> ${nm} @${line} :: ${src.slice(0, 100)}`)
            break
          }
        }
      }
      // GUARD-D: the command sits in a case arm's pattern slot.
      if (pat.has(`${nm}@${line}`)) removedD.push(`${label}: calls -> ${nm} @${line} :: ${src.slice(0, 100)}`)
      // GUARD-E: the command node has a DIRECT ERROR/missing child — an unclosed fragment.
      if (patE.has(`${nm}@${line}`)) removedE.push(`${label}: calls -> ${nm} @${line} :: ${src.slice(0, 100)}`)
    }
    if (anyDamaged) filesWithDamagedCalls++
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()))

console.log(`bash guard A/B — sample ${files.length} files (hash order)`)
console.log(`  calls edges total             : ${totalCalls}`)
console.log(`  GUARD-A reserved word         : ${removedA.length}  (${((100 * removedA.length) / (totalCalls || 1)).toFixed(2)}%)`)
console.log(`  GUARD-B any damaged region    : ${removedB.length}  (${((100 * removedB.length) / (totalCalls || 1)).toFixed(2)}%)`)
console.log(`  GUARD-B on plain-word names   : ${removedBPlainWord.length}`)
console.log(`  GUARD-C name is comment text  : ${removedC.length}  (${((100 * removedC.length) / (totalCalls || 1)).toFixed(2)}%)`)
console.log(`  GUARD-D case-arm pattern slot : ${removedD.length}  (${((100 * removedD.length) / (totalCalls || 1)).toFixed(2)}%)`)
console.log(`  GUARD-E direct ERROR child      : ${removedE.length}  (${((100 * removedE.length) / (totalCalls || 1)).toFixed(2)}%)`)
console.log(`  A ∪ C ∪ D total removed       : ${new Set([...removedA, ...removedC, ...removedD].map((r) => r.split(" :: ")[0])).size}  (${((100 * new Set([...removedA, ...removedC, ...removedD].map((r) => r.split(" :: ")[0])).size) / (totalCalls || 1)).toFixed(2)}%)`)
console.log(`  files with >=1 damaged calls  : ${filesWithDamagedCalls}`)
console.log(`\n  GUARD-C removal set (every row):`)
for (const r of removedC.slice(0, SHOW)) console.log(`    ${r}`)
console.log(`\n  GUARD-D removal set (every row):`)
for (const r of removedD.slice(0, SHOW)) console.log(`    ${r}`)
console.log(`\n  GUARD-E removal set (every row):`)
for (const r of removedE.slice(0, SHOW)) console.log(`    ${r}`)
console.log(`\n  damaged-call names by frequency:`)
for (const [k, v] of [...damagedAll.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`    ${v}\t${k}`)
console.log(`\n  damaged calls by parent node type:`)
for (const [k, v] of [...damagedByParent.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${v}\t${k}`)
