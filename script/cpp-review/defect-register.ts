/**
 * The C++ lane's DEFECT GATE — asserts on what the analyzer PUBLISHES, not on tree
 * shapes. (v1 asserted on shapes for D4/D5 and on `calls` for D3, and all three
 * were wrong: a shape can be present and handled, `calls` duplicates are two facts
 * not one, and a grammar limitation is not an analyzer defect.)
 *
 * Every class states the CONTRACT it breaks and why the name/edge is impossible —
 * "looks wrong" is not a finding, "C++ has no identifier spelled this way" is.
 * A class that reads 0 is the gate; a class that reads non-zero fails it.
 *
 *   BB_CORPUS_ROOT=$HOME/ishaq/fixtures/repositories \
 *   bun run script/cpp-review/defect-register.ts
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { ASTEngine, parseFile } from "../../src/ast/engine"
import { CPP_KEYWORDS, isCppSpelledName, recoveredDeclaredName } from "../../src/ast/real-cpp-analyzer"

// D7's legibility test is written HERE rather than imported from the analyzer,
// and that asymmetry is deliberate. The other classes import the analyzer's rule
// (#916: one set, one answer), but a gate that imports the code under test cannot
// be run against the code it is gating — the first cut of this check did, and the
// self-test died with "Export named 'specifierDeclaredName' not found" instead of
// reporting a violation. A check that cannot load against a broken analyzer has
// not proved it can fail, which is the M49 selftest rule ("a check that cannot
// fail is decoration").
//
// So this states the CONTRACT in five lines, which is what a gate is for:
//
//   an enum_specifier has NO qualified name in C++ (`enum class ns::E` is not
//   valid; you write `namespace ns { enum class E; }`), so a `::`-qualified path
//   in its name slot is a C++23 `[[=attr]]` the recovery displaced — and either
//   the real name is legible beside it or the enum is genuinely unnamed;
//   a class/struct/union DOES have a qualified name (an explicit
//   specialization), and its leaf is the name.
//
// The analyzer implements that contract in `specifierDeclaredName` /
// `attributeDisplacedEnumName`, which the F5 oracle imports. Two statements of one
// small contract, on purpose: one of them has to be able to run when the other is
// broken.
const d7LegibleName = (n: any): string | null => {
  const leaf = (q: any, d = 0): string | null => {
    if (!q || d > 8) return null
    if (q.type === "type_identifier" || q.type === "identifier") return q.text
    if (q.type === "qualified_identifier") return leaf(q.namedChild(q.namedChildCount - 1), d + 1)
    if (q.type === "template_type") {
      const tn = q.childForFieldName?.("name")
      if (tn) return leaf(tn, d + 1)
      const lt = q.text.indexOf("<")
      return lt > 0 ? q.text.slice(0, lt).trim() : null
    }
    return null
  }
  const nf = n.childForFieldName?.("name")
  if (n.type === "enum_specifier") {
    if (nf && nf.type === "qualified_identifier") {
      // the attribute arm: the real name is the identifier the recovery left in
      // the enclosing declaration's init_declarator
      const decl = n.parent
      const outer = decl && (decl.type === "declaration" || decl.type === "field_declaration")
        ? decl.childForFieldName?.("declarator") : null
      const id = outer && outer.type === "init_declarator" ? outer.childForFieldName?.("declarator") : null
      return id && id.type === "identifier" && id.startIndex > n.endIndex ? id.text : null
    }
    return leaf(nf)
  }
  return leaf(nf)
}

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/ishaq/fixtures/repositories"
const REPOS = (process.env.CPP_REPOS ?? "fmt,nlohmann-json,catch2,abseil-cpp,spdlog,zig").split(",").filter(Boolean)
const EXTS = [".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".hh", ".h++"]
const SKIP = new Set([".git", "build", "node_modules", ".github", "cmake-build-debug"])
const OUT = process.env.CPP_OUT ?? "/tmp/opencode/cpp-review"
const SAMPLE = 12

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

const reg: any = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  corpusRoot: CORPUS,
  corpora: REPOS,
  assertsOn: "analyzer OUTPUT (published symbols and relationships), not tree shapes",
  classes: {},
}
const cls = (id: string, title: string, contract: string, gated = true) => {
  const c = { id, title, contract, gated, n: 0, byName: new Map<string, number>(), sites: [] as any[] }
  reg.classes[id] = c
  return c
}
const add = (c: any, name: string, site: any) => {
  c.n++
  c.byName.set(name, (c.byName.get(name) ?? 0) + 1)
  if (c.sites.length < SAMPLE) c.sites.push(site)
}

const D1 = cls("D1", "a published name is spelled with a C++ keyword",
  "C++ has no identifier spelled with a keyword (ISO 14882 [lex.name]); such a name resolves to nothing for any consumer, at any extraction point.")
const D2 = cls("D2", "an extends edge names a base equal to its source",
  "A class cannot inherit from itself, and the namespace qualifier is the whole information content of a C++ inheritance edge.")
const D3 = cls("D3", "more than one contains/references row for one (source, target) pair in one file",
  "One edge per pair for the read/include shapes, where many sites express ONE fact. `calls` is deliberately EXCLUDED: two call sites are two facts, each with its own M59.A7 line_number.")
const D4 = cls("D4", "a declaration the grammar error-recovered is published under a name that is not the declaration's own",
  "A declared name is not a type. When the recovery displaced the declarator, the name is in the adjacent ERROR (recoveredDeclaredName) or there is no readable name and nothing is published.")
const D5 = cls("D5", "a symbol is published with a FUNCTION as its owner, and is not a local class/struct/enum",
  "C++ has no nested function definition, so a `function_definition` inside a body is a local direct-initialization — a variable, not a function.")
const D6 = cls("D6", "the analyzer's own source uses a regex",
  "The regex census is the honesty artifact; the doc's claim of zero must be true, not asserted.")
const D7 = cls("D7", "a specifier's name arrives as a qualified_identifier, so the class publishes as `anonymous`",
  "A class/struct may have a qualified name (an explicit specialization) and its LEAF is the name; an enum has NO qualified name in C++, so one in that slot is a C++23 [[=attr]] the recovery displaced, and the declared name is the identifier beside it. Publishing `anonymous` also collides with the analyzer's own no-name sentinel.")
const R1 = cls("R1", "REPORTED, not gated: a class/struct node that ends before the source's own brace balance",
  "A tree-sitter-cpp 0.23.4 limitation on legal macro-heavy C++. The analyzer cannot invent a class node the grammar did not produce, so this is reported with its measured count rather than hidden or worked around.",
  false)

let files = 0, syms = 0, rels = 0
const t0 = Date.now()
const sourceClassEnd = (content: string, startRow: number): number => {
  let depth = 0, started = false
  for (let i = startRow; i < content.length; i++) {
    const c = content[i]
    if (c === "{") { depth++; started = true }
    else if (c === "}") { depth--; if (started && depth === 0) return i }
  }
  return -1
}

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
    // D7: the `anonymous` publications this file made, resolved against the tree
    // after the walk. Declared BEFORE the D1/D5 loops that push into it.
    const pendingAnon: { kind: string; line: number; file: string; repo: string }[] = []
    syms += r.symbols?.length ?? 0
    rels += r.relationships?.length ?? 0

    // D1 — every published name.
    for (const s of (r.symbols ?? []) as any[]) {
      if (!isCppSpelledName(String(s.name))) add(D1, `symbol:${s.name}`, { repo, file: rel, line: s.range?.startLine, name: s.name, kind: s.kind })
    }
    for (const x of (r.relationships ?? []) as any[]) {
      if ((x.type === "calls" || x.type === "uses") && !isCppSpelledName(String(x.target))) {
        add(D1, `${x.type}:${x.target}`, { repo, file: rel, line: x.line_number, source: x.source, target: x.target, type: x.type })
      }
    }
    // D2
    for (const x of (r.relationships ?? []) as any[]) {
      if (x.type === "extends" && String(x.source) === String(x.target)) {
        add(D2, `self:${x.source}`, { repo, file: rel, line: x.line_number, source: x.source, target: x.target })
      }
    }
    // D3 — contains + references only, per file. `calls` excluded by contract.
    const pairN = new Map<string, number>()
    for (const x of (r.relationships ?? []) as any[]) {
      if (x.type !== "contains" && x.type !== "references") continue
      const k = `${x.source} ${x.target}`
      const n = (pairN.get(k) ?? 0) + 1
      pairN.set(k, n)
      if (n === 2) add(D3, `${x.type}:${x.source}->${x.target}`, { repo, file: rel, line: x.line_number, source: x.source, target: x.target })
    }
    // D7 — assert on the OUTPUT: no specifier that carries a name in the grammar
    // may be published under the `anonymous` sentinel, and a displaced enum name
    // must not ALSO be published as a variable. Read from the tree (that is where
    // the name lives), judged from what the analyzer published.
    for (const sy of (r.symbols ?? []) as any[]) {
      if (sy.name !== "anonymous") continue
      const line = sy.range?.startLine
      // walk the tree once per file looking for the specifier at this line
      pendingAnon.push({ kind: String(sy.kind ?? ""), line, file: rel, repo })
    }
    // D5 — a function owns nothing, except a local type.
    const LOCAL_TYPE = new Set(["class", "struct", "enum", "union"])
    for (const s of (r.symbols ?? []) as any[]) {
      if (String(s.ownerKind) === "function" && s.ownerName && !LOCAL_TYPE.has(String(s.kind))) {
        add(D5, `${s.kind}`, { repo, file: rel, line: s.range?.startLine, name: s.name, kind: s.kind, owner: s.ownerName })
      }
    }
    // D4 — assert on the OUTPUT, per declaration rather than per file. The first
    // version of this check asked "does the file publish this name ANYWHERE",
    // which is a false positive: after the fix the file legitimately publishes
    // `difference_type` as the class's real alias, and that name appeared on the
    // error-displaced declarator too. The question is whether a symbol was
    // published FOR THIS DECLARATION under a name the recovery contradicts, so
    // the test is span containment against the analyzer's own symbol ranges.
    const symRanges = (r.symbols ?? []).map((s: any) => ({
      name: String(s.name), kind: String(s.kind),
      start: s.range?.startIndex, end: s.range?.endIndex,
    }))
    const visit = (n: any) => {
      if (n.type === "field_declaration" || n.type === "declaration") {
        const declared = n.childForFieldName?.("declarator")
        if (declared && (declared.type === "field_identifier" || declared.type === "identifier") && n.hasError) {
          const rec = recoveredDeclaredName(n)
          if (rec && declared.text !== rec.text) {
            // a symbol whose range CONTAINS this declarator, published under a
            // name the recovery contradicts
            const inside = symRanges.find((sy) =>
              sy.start !== undefined && sy.start <= declared.startIndex &&
              sy.end !== undefined && sy.end >= declared.endIndex &&
              sy.name === declared.text && sy.name !== rec.text)
            if (inside) {
              add(D4, `published-wrong:${declared.text}`, {
                repo, file: rel, line: declared.startPosition.row + 1,
                published: declared.text, real: rec.text, kind: inside.kind,
              })
            }
          }
        }
      }
      if (n.type === "class_specifier" || n.type === "struct_specifier" || n.type === "union_specifier") {
        const se = sourceClassEnd(content, n.startIndex)
        if (se > n.endIndex) {
          const nm = n.childForFieldName?.("name") ?? n.namedChild(0)
          add(R1, n.type, { repo, file: rel, line: n.startPosition.row + 1, name: nm?.text, grammarEndsAt: n.endPosition.row + 1, sourceEndsAt: se + 1, linesOutside: se - n.endIndex })
        }
      }
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) visit(c) }
    }
    visit(tree.rootNode)

    // D7 verdict: for every specifier carrying a name the analyzer published as
    // `anonymous`, the name was legible. And for every enum whose name the
    // attribute displaced, the name must not also be published as a variable.
    if (pendingAnon.length) {
      const named = new Map<string, { kind: string; name: string; line: number }[]>()
      const collect = (n: any) => {
        if (n.type === "enum_specifier" || n.type === "class_specifier" || n.type === "struct_specifier" || n.type === "union_specifier") {
          const body = n.type === "enum_specifier" ||
            (n.namedChildren ?? []).some((c: any) => c.type === "class_body" || c.type === "field_declaration_list")
          if (body) {
            const nm = d7LegibleName(n)
            if (nm) {
              const arr = named.get(String(n.startPosition.row + 1)) ?? []
              arr.push({ kind: n.type, name: nm, line: n.startPosition.row + 1 })
              named.set(String(n.startPosition.row + 1), arr)
            }
          }
        }
        for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) collect(c) }
      }
      collect(tree.rootNode)
      for (const a of pendingAnon) {
        const hits = named.get(String(a.line)) ?? []
        // a genuinely unnamed enum/class has no legible name, so it is absent
        // here and is correct; anything present was publishable
        for (const h of hits) {
          add(D7, `${a.kind}->${h.name}`, { repo, file: a.file, line: h.line, specifier: h.kind, publishableName: h.name, published: "anonymous" })
        }
      }
      pendingAnon.length = 0
    }
  }
  process.stderr.write(`${repo} done files=${files} D1=${D1.n} D2=${D2.n} D3=${D3.n} D4=${D4.n} D5=${D5.n} D7=${D7.n} R1=${R1.n}\n`)
}

// D6 — the analyzer's own source, by the same shape the repo's census records.
try {
  const src = readFileSync(path.join(process.cwd(), "src/ast/real-cpp-analyzer.ts"), "utf8")
  const hits: any[] = []
  src.split("\n").forEach((l, i) => {
    const m = l.match(/\/(?:[^/\\\n]|\\.)+\/[gimsuy]*/g)
    if (!m) return
    for (const mm of m) {
      const at = l.indexOf(mm)
      const before = l.slice(0, at).trimEnd().slice(-1)
      if (at === 0 || /[(,=:[!&|?{};+\-*%<>~^]$/.test(before)) hits.push({ line: i + 1, source: mm, text: l.trim().slice(0, 90) })
    }
  })
  D6.n = hits.length
  D6.sites = hits.slice(0, SAMPLE)
} catch { D6.n = -1 }

for (const c of Object.values<any>(reg.classes)) c.byName = Object.fromEntries([...c.byName].sort((a, b) => b[1] - a[1]).slice(0, 40))
reg.keywordSetSize = CPP_KEYWORDS.size
reg.totals = { files, symbols: syms, relationships: rels, wallMs: Date.now() - t0, msPerFile: +((Date.now() - t0) / Math.max(1, files)).toFixed(1) }
const gated = Object.values<any>(reg.classes).filter((c) => c.gated)
reg.verdict = {
  pass: gated.every((c) => c.n === 0),
  perClass: Object.fromEntries(Object.entries<any>(reg.classes).map(([k, c]) => [k, c.n])),
  reportedNotGated: Object.fromEntries(Object.entries<any>(reg.classes).filter(([, c]) => !c.gated).map(([k, c]) => [k, c.n])),
}
mkdirSync(OUT, { recursive: true })
writeFileSync(path.join(OUT, "defect-register.json"), JSON.stringify(reg, null, 2))
console.log(JSON.stringify({ totals: reg.totals, verdict: reg.verdict }, null, 2))
for (const c of Object.values<any>(reg.classes)) {
  console.log(`\n${c.id}${c.gated ? "" : " (reported)"} — ${c.title}\n  n=${c.n}\n  contract: ${c.contract}`)
  for (const [k, v] of Object.entries<any>(c.byName).slice(0, 8)) console.log(`    ${String(v).padStart(6)}  ${k}`)
}
process.exit(reg.verdict.pass ? 0 : 1)
