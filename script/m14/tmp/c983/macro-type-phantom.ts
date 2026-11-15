// #985 — a member named after a MACRO, published alongside the real one.
//
// #928 refused to publish the macro's own name as a member, but only for the
// shape where the macro OWNS the name (`BIT(closing);` — no declarator at all).
// When the macro is the TYPE and a real declarator is a SIBLING, the descent
// still walks into the macro node:
//
//   field_declaration
//     macro_type_specifier      <- the TYPE
//       identifier "git_array_t"
//       type_descriptor
//     field_identifier "lines"  <- the real member
//
// and BOTH are published: `contains git_blame -> git_array_t` (a member clang
// does not have) and `contains git_blame -> lines` (correct).
//
// The detector is STRUCTURAL, not lexical: the member's name comes from a node
// inside a macro_type_specifier / macro_prefixed_type_specifier. A name-based
// test would miss the real case — libgit2's `git_array_t` is defined in
// src/util/array.h and the field is declared in include/git2/blame.h, so within
// one file the name is not a macro at all, and a probe that looked for
// file-scope macro names reported 0 of a class that clang sees as 6 phantoms.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm"))))
const { RealCAnalyzer } = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))
const analyzer = new RealCAnalyzer()
const CORPUS = "/home/sano/ishaq/bb_tests/repositories"

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const LIMIT = Number(arg("max-files", "400"))

function collectC(dir: string, out: string[], cap: number): string[] {
  if (out.length >= cap) return out
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (out.length >= cap) return out
    if (e.name === ".git" || e.name === "node_modules") continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collectC(full, out, cap)
    else if (e.name.endsWith(".c") || e.name.endsWith(".h")) out.push(full)
  }
  return out
}

const files: string[] = []
for (const repo of ["curl", "libgit2", "redis", "zig"]) collectC(path.join(CORPUS, repo), files, LIMIT)

/**
 * Member names that came out of a macro type specifier, with the sibling member
 * the same declaration also publishes. Keyed by owner.
 */
function macroTypeMembers(root: any): Map<string, { macroNames: string[]; siblingNames: string[] }> {
  const byOwner = new Map<string, { macroNames: string[]; siblingNames: string[] }>()
  const visitBody = (body: any, owner: string): void => {
    if (!body) return
    const macroTypes: any[] = []
    const plainNames: string[] = []
    for (let i = 0; i < body.namedChildCount; i++) {
      const field = body.namedChild(i)
      if (field?.type !== "field_declaration") continue
      // the macro's own name, structurally: a macro_type_specifier in TYPE position
      let macroName = ""
      for (let j = 0; j < field.namedChildCount; j++) {
        const c = field.namedChild(j)
        if (c?.type === "macro_type_specifier" || c?.type === "macro_prefixed_type_specifier") {
          const inner = c.namedChild(0)
          if (inner?.type === "identifier" || inner?.type === "macro_specifier") macroName = inner.text
          break
        }
      }
      if (macroName) {
        macroTypes.push(macroName)
        // and any sibling declarator in the SAME declaration -- that is the real
        // member the phantom sits next to
        for (let j = 0; j < field.namedChildCount; j++) {
          const c = field.namedChild(j)
          if (c?.type === "field_identifier") plainNames.push(c.text)
        }
        continue
      }
      // a bare macro_type_specifier with NO sibling declarator is #928's shape,
      // which publishes nothing; record the name so a phantom can be told apart
      let hasDeclarator = false
      for (let j = 0; j < field.namedChildCount; j++) {
        const c = field.namedChild(j)
        if (c && ["field_identifier", "pointer_declarator", "array_declarator", "function_declarator", "parenthesized_declarator"].includes(c.type)) {
          hasDeclarator = true
        }
      }
      if (!hasDeclarator) for (let j = 0; j < field.namedChildCount; j++) {
        const c = field.namedChild(j)
        if (c?.type === "macro_type_specifier") {
          const inner = c.namedChild(0)
          if (inner?.type === "identifier") plainNames.push(inner.text)
        }
      }
    }
    if (macroTypes.length > 0) byOwner.set(owner, { macroNames: macroTypes, siblingNames: plainNames })
  }
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()
    if (!n) continue
    if (n.type === "struct_specifier" || n.type === "union_specifier") {
      const nameNode = n.childForFieldName("name")
      if (nameNode) visitBody(n.childForFieldName("body"), nameNode.text)
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) st.push(c)
    }
  }
  return byOwner
}

let filesParsed = 0
let phantoms = 0
let withRealSibling = 0
const rows: string[] = []
const tally = new Map<string, number>()

for (const file of files) {
  let src: string
  try {
    src = fs.readFileSync(file, "utf8")
  } catch {
    continue
  }
  if (src.length > 400_000) continue
  let root: any
  try {
    root = parser.parse(src).rootNode
  } catch {
    continue
  }
  filesParsed++
  let result: any
  try {
    result = analyzer.analyze(root, src, file)
  } catch {
    continue
  }
  const membersByOwner = new Map<string, Set<string>>()
  for (const s of result.symbols ?? []) {
    if (String(s.kind) !== "property") continue
    const owner = String(s.ownerName ?? "")
    if (!owner) continue
    if (!membersByOwner.has(owner)) membersByOwner.set(owner, new Set())
    membersByOwner.get(owner)!.add(String(s.name))
  }
  const expected = macroTypeMembers(root)
  const lines = src.split("\n")
  for (const rel of result.relationships ?? []) {
    if (String(rel.type) !== "contains") continue
    const owner = String(rel.source)
    const want = expected.get(owner)
    if (!want) continue
    const t = String(rel.target)
    if (!want.macroNames.includes(t)) continue
    // the #928 shape publishes nothing at all, so a member carrying a macro name
    // on an owner that HAS members is the new shape
    if (!membersByOwner.has(owner)) continue
    phantoms++
    tally.set(t, (tally.get(t) ?? 0) + 1)
    if (want.siblingNames.length > 0 && membersByOwner.get(owner)!.has(want.siblingNames[0])) withRealSibling++
    if (rows.length < 30) {
      const L = Number(rel.line_number ?? 0)
      rows.push(`${path.relative(CORPUS, file)}:${L}  contains ${owner} -> ${t}  (siblings published: ${[...(membersByOwner.get(owner) ?? [])].join(",")})   "${(lines[L - 1] ?? "").trim().slice(0, 48)}"`)
    }
  }
}

console.log(`files parsed ${filesParsed} of ${files.length}`)
console.log(`PHANTOM members: a \`contains\` target that is a macro_type_specifier's own name, where the same declaration also yields a real member: ${phantoms} (${withRealSibling} with the sibling also published)`)
for (const [k, v] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`)
for (const r of rows) console.log("  " + r)
