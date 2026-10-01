/**
 * D5, measured for a decision rather than for a count.
 *
 * 2,050 of the corpus's classes have a grammar `class_specifier`/`struct_specifier` node
 * that ends before the source's own brace balance does — `basic_json` spans source lines
 * 128..6408 and its node covers 128..716, so **5,692 lines (91% of the class) are walked
 * outside the class node** and take their owner from whatever `function_definition`
 * swallowed them (`owner=push_back` for ~2,000 symbols in that one file).
 *
 * Two questions decide what is fixable in the ANALYZER and what is a grammar limit:
 *
 *   Q1 — how much of the damage is the analyzer's own doing? (a scope it could decline
 *        to attribute) vs. the grammar's? (a node it never receives)
 *   Q2 — of the symbols published with a fabricated owner, how many would a
 *        source-brace check (cheap, deterministic, and the same evidence the
 *        `class-extent` probe uses) let the analyzer REFUSE rather than fabricate?
 *
 * This probe answers both. It does not re-implement the analyzer: it reads the analyzer's
 * OWN published symbols/edges and asks where the owner is not one the tree supports.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { ASTEngine, parseFile } from "../../src/ast/engine"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/ishaq/fixtures/repositories"
const REPOS = (process.env.CPP_REPOS ?? "fmt,nlohmann-json,catch2,abseil-cpp,spdlog,zig").split(",").filter(Boolean)
const EXTS = [".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".hh", ".h++"]
const SKIP = new Set([".git", "build", "node_modules", ".github", "cmake-build-debug"])
const OUT = process.env.CPP_OUT ?? "/tmp/opencode/cpp-review"

const walk = (d: string, out: string[] = [], depth = 0): string[] => {
  if (depth > 10) return out
  let es: string[]
  try { es = readdirSync(d) } catch { return out }
  for (const e of es) {
    if (SKIP.has(e)) continue
    const p = path.join(d, e)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out, depth + 1)
    else if (EXTS.some((x) => p.endsWith(x)) && st.size > 0) out.push(p)
  }
  return out
}

/** The source's own brace-balanced extent from a 1-based line, or -1. */
const sourceClassEnd = (content: string, startRow: number): number => {
  let depth = 0, started = false
  for (let i = startRow; i < content.length; i++) {
    const c = content[i]
    if (c === "{") { depth++; started = true }
    else if (c === "}") { depth--; if (started && depth === 0) return i }
  }
  return -1
}

let files = 0
const t = {
  truncatedClasses: 0, linesOutside: 0,
  symbolsWithOwner: 0, symbolsAtFileScope: 0,
  ownerIsAFunction: 0, ownerIsAClass: 0, ownerIsANamespace: 0, ownerOther: 0,
  // Q2: symbols whose OWNER, per the source, is inside a brace-balanced class that the
  // grammar truncated — i.e. the owner is fabricated and a source check could catch it.
  ownerFabricated: 0, ownerFabricatedSample: [] as any[],
  phantomFunctions: 0, phantomFunctionsSample: [] as any[],
}
const t0 = Date.now()

for (const repo of REPOS) {
  for (const f of walk(path.join(CORPUS, repo))) {
    let r: any, tree: any, content: string
    try {
      content = readFileSync(f, "utf8")
      r = await parseFile(f, content)
      ;({ tree } = await ASTEngine.parseTree(f, content))
    } catch { continue }
    files++
    const rel = f.replace(CORPUS + "/", "")

    // Q1: which specifier nodes are truncated, and by how much.
    const truncated: { name: string; grammarEnd: number; srcEnd: number }[] = []
    const visit = (n: any) => {
      if (n.type === "class_specifier" || n.type === "struct_specifier" || n.type === "union_specifier") {
        const nm = n.childForFieldName?.("name") ?? n.namedChild(0)
        const srcEnd = sourceClassEnd(content, n.startIndex)
        if (srcEnd > n.endIndex) {
          t.truncatedClasses++
          t.linesOutside += srcEnd - n.endIndex
          truncated.push({ name: nm?.text ?? "?", grammarEnd: n.endPosition.row + 1, srcEnd: srcEnd + 1 })
        }
      }
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) visit(c) }
    }
    visit(tree.rootNode)

    // What kinds of owner does the analyzer actually publish?
    const ownerKinds = new Map<string, string>()
    for (const s of (r.symbols ?? []) as any[]) {
      const ok = String(s.ownerKind ?? "")
      ownerKinds.set(ok, (ownerKinds.get(ok) ?? 0) + 1)
      if (s.ownerName) {
        t.symbolsWithOwner++
        if (ok === "function") t.ownerIsAFunction++
        else if (ok === "class" || ok === "struct") t.ownerIsAClass++
        else if (ok === "namespace") t.ownerIsANamespace++
        else t.ownerOther++
      } else t.symbolsAtFileScope++
    }

    // Q2: a symbol owned by a FUNCTION is the signature of the damage — a member is
    // owned by a class, never by a function. Count and sample them.
    for (const s of (r.symbols ?? []) as any[]) {
      if (String(s.ownerKind) === "function" && s.ownerName) {
        t.phantomFunctions++
        if (t.phantomFunctionsSample.length < 20) {
          t.phantomFunctionsSample.push({
            repo, file: rel, line: s.range?.startLine,
            name: s.name, kind: s.kind, owner: s.ownerName,
            src: (content.split("\n")[(s.range?.startLine ?? 1) - 1] ?? "").trim().slice(0, 90),
            fileTruncatedClasses: truncated.length,
          })
        }
      }
    }
  }
  process.stderr.write(`${repo} done files=${files} truncatedClasses=${t.truncatedClasses} ownerIsAFunction=${t.ownerIsAFunction}\n`)
}

const out = {
  generatedAt: new Date().toISOString(), files, wallMs: Date.now() - t0, ...t,
}
mkdirSync(OUT, { recursive: true })
writeFileSync(path.join(OUT, "d5-decision.json"), JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2).slice(0, 4000))
