/**
 * R1 census — how much C++ does the grammar actually lose, and is the 715 real?
 *
 * R1 is reported rather than gated because a class node the grammar did not produce
 * cannot be invented by the analyzer. That is the right call, and it is also the
 * reason R1 needs a CENSUS: "715 truncated class bodies" is a number nobody can act
 * on, because it does not say WHICH bodies, HOW MUCH source they lose, or whether the
 * number is even true. This answers those, and it starts by doubting the existing
 * measurement — which had two defects, both of which inflate the count:
 *
 *   1. `linesOutside` is a CHARACTER delta in a field named `linesOutside`.
 *      Recorded on fmt/src/os.cc:262 as 1217; the real ROW delta is 8,205. Any prose
 *      built on that field has been wrong by a factor of about seven, including this
 *      lane's own review, which quoted a character count as a line count.
 *   2. the source-side brace counter is naive — it counts `{` and `}` inside string
 *      literals, comments and character literals, so a brace in a message string
 *      before the real body end makes a class look truncated when the grammar read it
 *      perfectly. That manufactures false positives, and a report that cannot
 *      distinguish a real loss from its own instrumentation has not measured anything.
 *
 * So the census re-derives the end of a class body with a string/comment-aware
 * scanner, reports ROWS and CHARACTERS under their own names, and separates
 *
 *   REAL      the grammar's node ends before the source's brace balance does
 *   ARTIFACT  the naive counter said so and the aware one does not
 *
 *   BB_CORPUS_ROOT=$HOME/fixtures/repositories \
 *   bun run script/cpp-review/r1-census.ts
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, extname } from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPOS = (process.env.CPP_REPOS ?? "fmt,nlohmann-json,catch2,abseil-cpp,spdlog,zig").split(",").filter(Boolean)
// the register's extension set EXACTLY, so the two numbers are comparable.
// A wider set here (`.h`, `.ipp`, `.inl`) scans 13,753 files instead of
// 1,722 and makes every comparison against the register meaningless.
const EXTS = [".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".hh", ".h++"]
const SKIP = new Set([".git", "build", "node_modules", ".github", "cmake-build-debug"])

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue
    const p = join(dir, e)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (EXTS.some((x) => p.endsWith(x)) && st.size > 0) out.push(p)
  }
  return out
}

/** The index just past the `}` that closes the brace opened at/after `from`, or -1. */
function sourceClassEnd(content: string, from: number): number {
  let depth = 0, started = false, i = from
  while (i < content.length) {
    const c = content[i]
    if (c === '"' || c === "'") {                       // string / char literal
      const q = c
      i++
      while (i < content.length) {
        if (content[i] === "\\") { i += 2; continue }
        if (content[i] === q) { i++; break }
        i++
      }
      continue
    }
    if (c === "/" && content[i + 1] === "/") {            // line comment
      const nl = content.indexOf("\n", i)
      i = nl === -1 ? content.length : nl
      continue
    }
    if (c === "/" && content[i + 1] === "*") {            // block comment
      const close = content.indexOf("*/", i + 2)
      i = close === -1 ? content.length : close + 2
      continue
    }
    if (c === "{") { depth++; started = true }
    else if (c === "}") {
      depth--
      if (started && depth === 0) return i
    }
    i++
  }
  return -1
}

/** The same, but naive — the register's original, kept so the two can be compared. */
function naiveClassEnd(content: string, from: number): number {
  let depth = 0, started = false
  for (let i = from; i < content.length; i++) {
    const c = content[i]
    if (c === "{") { depth++; started = true }
    else if (c === "}") { depth--; if (started && depth === 0) return i }
  }
  return -1
}

const rowOf = (content: string, index: number): number => {
  let r = 0
  for (let i = 0; i < index && i < content.length; i++) if (content[i] === "\n") r++
  return r
}

/**
 * Does this specifier node HAVE a body?
 *
 * This is the check whose absence made the register's 715 wrong, and it is worth more
 * than the string/comment-aware scanner. `class Message;` is a FORWARD DECLARATION:
 * tree-sitter produces a `class_specifier` for it with no body at all, which is
 * correct — there is nothing to truncate. Asked "does the source's brace balance end
 * later than your node?", a body-less node answers yes, because the next unrelated
 * `{ … }` anywhere later in the file supplies the closing brace. On fmt alone that
 * turned six consecutive lines of gtest's own `// Forward declarations.` banner
 * (AssertionResult, Message, Test, TestInfo, TestPartResult, UnitTest) into six
 * "truncations" of 1,200+ rows each, every one of them pointing at the same
 * unrelated later class.
 *
 * A truncation is a body that ENDS EARLY. It cannot be a body that was never there.
 */
const bodyNode = (n: any): any | null => {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && (c.type === "field_declaration_list" || c.type === "class_body" || c.type === "enumerator_list")) return c
  }
  return null
}

type Site = {
  repo: string; file: string; line: number; name: string; kind: string
  grammarEndRow: number; sourceEndRow: number
  rowsOutside: number; charsOutside: number
  verdict: "real" | "artifact"
  naiveRowsOutside: number
}

const sites: Site[] = []
let files = 0, totalNodes = 0, declarations = 0
const perRepo = new Map<string, { real: number; artifact: number; rows: number }>()

for (const repo of REPOS) {
  const root = join(CORPUS, repo)
  if (!existsSync(root)) { console.error(`missing corpus repo: ${root}`); continue }
  for (const f of walk(root)) {
    let tree: any
    let content: string
    try {
      content = readFileSync(f, "utf8")
      ;({ tree } = await ASTEngine.parseTree(f, content))
    } catch { continue }
    files++
    const rel = f.replace(CORPUS + "/", "")
    const acc = perRepo.get(repo) ?? { real: 0, artifact: 0, rows: 0 }

    const visit = (n: any) => {
      if (n.type === "class_specifier" || n.type === "struct_specifier" || n.type === "union_specifier") {
        totalNodes++
        const body = bodyNode(n)
        if (!body) { declarations++; return }   // a forward declaration: nothing to truncate
        const nm = n.childForFieldName?.("name") ?? n.namedChild(0)
        const aware = sourceClassEnd(content, n.startIndex)
        const naive = naiveClassEnd(content, n.startIndex)
        if (aware !== -1 && aware > n.endIndex) {
          const srcRow = rowOf(content, aware)
          const gRow = rowOf(content, n.endIndex)
          const s: Site = {
            repo, file: rel, line: n.startPosition.row + 1, name: String(nm?.text ?? "(unnamed)"), kind: n.type,
            grammarEndRow: gRow + 1, sourceEndRow: srcRow + 1,
            rowsOutside: srcRow - gRow, charsOutside: aware - n.endIndex,
            verdict: naive === aware ? "real" : "artifact",
            naiveRowsOutside: naive === -1 ? -1 : rowOf(content, naive) - gRow,
          }
          sites.push(s)
          if (s.verdict === "real") { acc.real++; acc.rows += s.rowsOutside }
          else acc.artifact++
        } else if (naive !== -1 && naive > n.endIndex) {
          // the naive counter saw a truncation the aware one does not: an artifact
          sites.push({
            repo, file: rel, line: n.startPosition.row + 1, name: String(nm?.text ?? "(unnamed)"), kind: n.type,
            grammarEndRow: rowOf(content, n.endIndex) + 1, sourceEndRow: rowOf(content, naive) + 1,
            rowsOutside: rowOf(content, naive) - rowOf(content, n.endIndex),
            charsOutside: naive - n.endIndex, verdict: "artifact", naiveRowsOutside: -1,
          })
          acc.artifact++
        }
      }
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) visit(c) }
    }
    visit(tree.rootNode)
    perRepo.set(repo, acc)
  }
}

const real = sites.filter((s) => s.verdict === "real")
const artifact = sites.filter((s) => s.verdict === "artifact")
real.sort((a, b) => b.rowsOutside - a.rowsOutside)

console.log(`\n=== R1 census (string/comment-aware) ===`)
console.log(`repos: ${REPOS.join(", ")}`)
console.log(`files scanned: ${files}   class/struct/union nodes: ${totalNodes}`)
console.log(`  of which FORWARD DECLARATIONS (no body, nothing to truncate): ${declarations}`)
console.log(`\n  REAL truncations (grammar ends before the source's brace balance): ${real.length}`)
console.log(`  ARTIFACTS (only the NAIVE counter saw a truncation):                  ${artifact.length}`)
console.log(`  the register's 715 splits into these two; the naive count is the sum.`)

console.log(`\n--- per repo (real only) ---`)
for (const [repo, a] of [...perRepo.entries()].sort()) {
  console.log(`  ${repo.padEnd(16)} real=${String(a.real).padStart(4)}  artifact=${String(a.artifact).padStart(4)}  rowsLost=${a.rows}`)
}

console.log(`\n--- worst 15 by rows lost (real) ---`)
for (const s of real.slice(0, 15)) {
  console.log(`  ${String(s.rowsOutside).padStart(6)} rows  ${s.repo}/${s.file}:${s.line}  ${s.kind} ${s.name}`)
  console.log(`           grammar ends row ${s.grammarEndRow}, source ends row ${s.sourceEndRow} (${s.charsOutside} chars)`)
}

const outDir = process.env.CPP_OUT ?? "/tmp/opencode/cpp-review"
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, "r1-census.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), corpusRoot: CORPUS, corpora: REPOS,
  files, totalNodes, forwardDeclarations: declarations, realCount: real.length, artifactCount: artifact.length,
  naiveCount: real.length + artifact.length,
  perRepo: Object.fromEntries(perRepo), worst: real.slice(0, 40),
}, null, 2))
console.log(`\n→ ${join(outDir, "r1-census.json")}`)
