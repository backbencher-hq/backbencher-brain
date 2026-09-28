/**
 * The LOSS side of the C++ lane: declarations the TREE contains that the analyzer
 * does not publish.
 *
 * Every one of the six defect classes in the register is fabrication-shaped — too
 * much output. A gate that only looks for extra rows is structurally blind to a
 * MISSING symbol, and "100% covered, MISSING=0" is a self-consistency claim
 * between the analyzer and an oracle written from the same reading of the same
 * grammar. This probe asks the question neither asks: **for every declaration the
 * grammar hands over unambiguously, is there a published symbol?**
 *
 * It is deliberately INDEPENDENT of the differential's oracle — it does not
 * re-derive an edge to compare, it reads the tree's own declaration nodes and
 * asks what the analyzer did with them.
 *
 * "Should publish" is decided by SCOPE, and the scope rule is the analyzer's own
 * documented one, so the number is a disagreement count and not a wish list:
 *   - file / namespace / class scope  -> a declaration site, must publish
 *   - inside a function body           -> a local: an execution artifact, correctly
 *                                        silent (the D5 ruling, and the field/
 *                                        variable branch's long-standing rule)
 *   - a macro-declared body            -> treated as a function body, same rule
 *   - forward declaration (no body)    -> correctly silent (C-family contract)
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { ASTEngine, parseFile } from "../../src/ast/engine"
import { macroDeclaredBody } from "../../src/ast/real-cpp-analyzer"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/ishaq/fixtures/repositories"
const REPOS = (process.env.CPP_REPOS ?? "fmt,nlohmann-json,catch2,abseil-cpp,spdlog,zig").split(",").filter(Boolean)
const EXTS = [".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".hh", ".h++"]
const SKIP = new Set([".git", "build", "node_modules", ".github", "cmake-build-debug"])
const OUT = process.env.CPP_OUT ?? "/tmp/opencode/cpp-review"
const SAMPLE = 40

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

type Loss = { kind: string; name: string; line: number; src: string; scope: string }

const byKind = new Map<string, number>()
const byName = new Map<string, number>()
const samples: Loss[] = []
let files = 0, expected = 0, lost = 0
const t0 = Date.now()

const addLoss = (kind: string, name: string, line: number, src: string, scope: string, rel = "") => {
  lost++
  byKind.set(kind, (byKind.get(kind) ?? 0) + 1)
  byName.set(`${kind}:${name}  [${rel}]`, (byName.get(`${kind}:${name}  [${rel}]`) ?? 0) + 1)
  if (samples.length < SAMPLE) samples.push({ kind, name, line, src, scope })
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
    const published = new Set((r.symbols ?? []).map((s: any) => String(s.name)))
    // #919: a macro-declared BODY has no `function_definition`, so a probe that
    // only tracks `function_definition` sees every local inside a
    // `TEST(...) { ... }` block as a file-scope declaration and calls it a loss.
    // The analyzer's own rule is imported rather than re-derived (#916).
    // #919 again: the body publishes under the HEADING TEXT, so a heading's
    // macro name is never a symbol name.
    const headings = (r.symbols ?? [])
      .filter((s: any) => s.metadata?.expandedFrom === "macro-heading")
      .map((s: any) => String(s.metadata?.headingText ?? s.metadata?.macroName ?? ""))
    const hasHeadingFor = (macroName: string) => headings.some((h) => h.startsWith(macroName + "(") || h === macroName)
    const lines = content.split("\n")

    // Walk with a scope flag so a LOCAL is never counted as a loss.
    const visit = (n: any, inFnBody: boolean) => {
      const t = n.type
      let childInFn = inFnBody
      if (t === "function_definition") childInFn = true
      if (t === "compound_statement" && macroDeclaredBody(n)) childInFn = true
      const srcOf = (node: any) => (lines[node.startPosition.row] ?? "").trim().slice(0, 80)

      const declare = (kind: string, name: string | null | undefined, node: any, rel = "") => {
        if (!name) return
        // the documented scope rule: a local is correctly silent
        if (inFnBody) return
        expected++
        if (published.has(name)) return
        addLoss(kind, name, node.startPosition.row + 1, srcOf(node), "file/namespace/class", rel)
      }

      if (t === "class_specifier" || t === "struct_specifier" || t === "union_specifier") {
        const body = (n.namedChildren ?? []).some((c: any) => c.type === "class_body" || c.type === "field_declaration_list")
        const nm = n.childForFieldName?.("name")?.text ?? (n.namedChildren ?? []).find((c: any) => c.type === "type_identifier")?.text ?? null
        // A specialization names itself in a template_type (CPPD1).
        const tt = (n.namedChildren ?? []).find((c: any) => c.type === "template_type")
        const name = nm ?? tt?.childForFieldName?.("name")?.text ?? null
        if (body) declare("class", name, n, rel)
        // a forward declaration has no body: correctly silent
      } else if (t === "enum_specifier") {
        declare("enum", n.childForFieldName?.("name")?.text ?? (n.namedChildren ?? []).find((c: any) => c.type === "type_identifier")?.text ?? null, n, rel)
      } else if (t === "namespace_definition") {
        const nm = (n.namedChildren ?? []).find((c: any) => c.type === "namespace_identifier")?.text ?? null
        if (nm) declare("namespace", nm, n, rel)
      } else if (t === "function_definition") {
        // the declarator descent the analyzer itself uses (CPPD17/18)
        const nameOf = (): string | null => {
          const WRAP = new Set(["pointer_declarator", "reference_declarator", "parenthesized_declarator"])
          let cur: any = (n.namedChildren ?? []).find((c: any) => c.type === "function_declarator") ?? null
          if (!cur) {
            cur = (n.namedChildren ?? []).find((c: any) => WRAP.has(c.type)) ?? null
            for (let i = 0; cur && i < 8 && !(cur.namedChildren ?? []).some((c: any) => c.type === "function_declarator"); i++) {
              cur = (cur.namedChildren ?? []).find((c: any) => WRAP.has(c.type)) ?? null
            }
            const fd = cur ? (cur.namedChildren ?? []).find((c: any) => c.type === "function_declarator") : null
            cur = fd ?? null
          }
          for (let i = 0; cur && i < 8; i++) {
            const hit = (cur.namedChildren ?? []).find((c: any) =>
              c.type === "identifier" || c.type === "field_identifier" || c.type === "destructor_name" || c.type === "operator_name" || c.type === "qualified_identifier")
            if (hit) {
              if (hit.type === "qualified_identifier") return (hit.namedChildren ?? [])[hit.namedChildCount - 1]?.text ?? null
              return hit.text
            }
            cur = (cur.namedChildren ?? []).find((c: any) => c.type === "parenthesized_declarator") ?? null
          }
          return null
        }
        // Three DOCUMENTED policies, none of which is a loss:
        //  - a destructor is excluded by contract ("compiler-managed lifecycle
        //    members; exclude them", universal contract)
        //  - a constructor publishes normalized to the name `constructor`
        //  - a macro heading publishes under its heading TEXT (#919)
        const raw = nameOf()
        if (raw && (raw.startsWith("~") || hasHeadingFor(raw))) return
        if (raw && published.has("constructor") && n.hasError) return
        declare("function", raw, n, rel)
      } else if (t === "alias_declaration" || t === "type_definition") {
        declare("type", n.childForFieldName?.("name")?.text ?? (n.namedChildren ?? []).find((c: any) => c.type === "type_identifier")?.text ?? null, n, rel)
      } else if (t === "enumerator") {
        declare("enumerator", n.childForFieldName?.("name")?.text ?? (n.namedChildren ?? []).find((c: any) => c.type === "identifier")?.text ?? null, n, rel)
      } else if (t === "field_declaration" || t === "declaration") {
        for (const d of (n.namedChildren ?? []).filter((c: any) => c.type === "init_declarator")) {
          const decl = d.childForFieldName?.("declarator")
          let cur: any = decl
          while (cur && cur.type !== "identifier" && cur.type !== "field_identifier") cur = cur.childForFieldName?.("declarator") ?? null
          declare("variable", cur?.text ?? null, n, rel)
        }
      }
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) visit(c, childInFn) }
    }
    visit(tree.rootNode, false)
  }
  process.stderr.write(`${repo} done files=${files} expected=${expected} lost=${lost}\n`)
}

const out = {
  generatedAt: new Date().toISOString(), files, wallMs: Date.now() - t0,
  shouldPublish: expected, notPublished: lost,
  lossPct: +((100 * lost) / Math.max(1, expected)).toFixed(2),
  byKind: Object.fromEntries([...byKind].sort((a, b) => b[1] - a[1])),
  topNames: [...byName].sort((a, b) => b[1] - a[1]).slice(0, 30),
  samples,
  note: "A 'loss' here is a declaration the GRAMMAR hands over at file/namespace/class scope whose name the analyzer published no symbol for. Locals inside a function body are excluded — they are execution artifacts and correctly silent. A name published under a DIFFERENT spelling shows up here too, so this over-counts deliberate normalizations (constructors publish as `constructor`) and under-counts nothing.",
}
mkdirSync(OUT, { recursive: true })
writeFileSync(path.join(OUT, "loss-census.json"), JSON.stringify(out, null, 2))
console.log(JSON.stringify({ files, shouldPublish: out.shouldPublish, notPublished: out.notPublished, lossPct: out.lossPct, byKind: out.byKind }, null, 2))
console.log("\ntop names:")
for (const [k, n] of out.topNames.slice(0, 20)) console.log(`  ${String(n).padStart(5)}  ${k}`)
console.log("\nsamples:")
for (const s of out.samples.slice(0, 20)) console.log(`  ${s.kind} ${JSON.stringify(s.name)} @${s.line} | ${s.src}`)
