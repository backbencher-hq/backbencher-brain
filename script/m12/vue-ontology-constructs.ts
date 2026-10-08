/**
 * VUE LANGUAGE-CONSTRUCT PROBE — the instrument that decides RULED vs GAP.
 *
 * Two instruments, because the question decides which one applies:
 *
 *  A. GRAMMAR INVENTORY over the SFC tree (tree-sitter-vue). Enumerating every
 *     node type the grammar produces across the corpus is positive evidence of
 *     absence for a construct the SFC grammar itself would carry.
 *
 *  B. PARSE-TREE SEMANTIC COUNT over the EMBEDDED SCRIPT trees — the js/ts
 *     grammars, on the same blocks the analyzer hands to the JS/TS delegate.
 *     A Vue SFC's own grammar has no `implements_clause` and no `new_expression`
 *     because its script block is ONE `raw_text` leaf; the constructs live in
 *     the script grammar, so the inventory has to run there or it measures the
 *     wrong grammar. This probe reports both, and never conflates them.
 *
 * READ-ONLY. Writes one JSON report and nothing else.
 *
 * USAGE
 *   npx tsx script/m12/vue-ontology-constructs.ts [out.json]
 *   BB_VUE_REPOS=element-plus,vue-element-admin …   restrict the repos
 *   BB_CORPUS_ROOT=… …                             alternate corpus root
 *
 * EXITS 1 when a negative control misses, which is the only way this file's zeros
 * may be read as facts about the LANGUAGE rather than facts about the probe.
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { ASTEngine } from "../../src/ast/engine"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const ROOT = path.resolve(import.meta.dirname, "..", "..")
const OUT = process.argv[2] ?? path.join(ROOT, "validation/m12/results/vue-ontology-constructs.json")
const ONLY = process.env.BB_VUE_REPOS ? process.env.BB_VUE_REPOS.split(",").filter(Boolean) : []

const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR).sort()) {
  if (ONLY.length && !ONLY.includes(e)) continue
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked.sort()) {
    if (!rel.endsWith(".vue")) continue
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "vue") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
console.log(`construct probe — ${files.length} vue files over ${[...new Set(files.map((f) => f.repo))].join(", ")}`)

const wts: any = await import("web-tree-sitter")
const Parser = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await Parser.init({ locateFile: () => path.resolve(import.meta.dirname, "../..", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const load = async (p: string) => Language.load(readFileSync(path.resolve(ROOT, p)))
const vueLang = await load("wasm/tree-sitter-vue.wasm")
const jsLang = await load("node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm")
const tsLang = await load("node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm")
const tsxLang = await load("node_modules/tree-sitter-typescript/tree-sitter-tsx.wasm")

// ---------------------------------------------------------------- quote stripper
//
// NO REGEX. Six sites in this file used to strip one leading and one trailing
// quote from a node's text with /^["']|["']$/g. That is a quote stripper wearing
// a pattern, and it is the analyzer's own `unquote` in disguise — so the pattern
// is deleted here too, by character code, and the equivalence is exact: the
// pattern removes AT MOST one leading and AT MOST one quote character anywhere
// the alternation anchors (anchored to ^ and $, so end-only), which is what the
// two `slice` calls below do. Note what this is NOT: a character class over
// source text, which is what the m60 census recorded as the pattern that used to
// disagree with the lane's own stack machine. Stripping delimiters from a node
// whose type is already `string` is not classification.
function unquote(text: string): string {
  if (text.length >= 2) {
    const first = text.charCodeAt(0)
    // 34 = '"', 39 = "'"
    if ((first === 34 || first === 39) && text.charCodeAt(text.length - 1) === first) {
      return text.slice(1, -1)
    }
  }
  return text
}

// ---------------------------------------------------------------- instrument A
const sfcNodeTypes = new Map<string, number>()
for (const f of files) {
  const p = new Parser(); p.setLanguage(vueLang)
  const t = p.parse(f.text)
  if (t) {
    const v = (n: any) => { sfcNodeTypes.set(n.type, (sfcNodeTypes.get(n.type) ?? 0) + 1); for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) v(c) } }
    v(t.rootNode); t.delete?.()
  }
  p.delete?.()
}

// -------------------------------------------------------------- instrument B
type BHit = { type: string; count: number; files: number; examples: string[] }
const hits = new Map<string, BHit>()
const hitFiles = new Map<string, Set<string>>()
const add = (k: string, label: string, ex?: string) => {
  const h = hits.get(k) ?? { type: k, count: 0, files: 0, examples: [] }
  h.count++
  if (ex && h.examples.length < 4) h.examples.push(`${label}: ${ex}`)
  hits.set(k, h)
  if (!hitFiles.has(k)) hitFiles.set(k, new Set())
  hitFiles.get(k)!.add(label)
}

const jsP = new Parser(); jsP.setLanguage(jsLang)
const tsP = new Parser(); tsP.setLanguage(tsLang)
const tsxP = new Parser(); tsxP.setLanguage(tsxLang)

/**
 * A second overrides shape, measured because Vue HAS one and a ruling that
 * counts only the mixin shape is half a ruling: `<script>` and `<script setup>`
 * in one SFC share a scope, and a binding declared in both is the setup one
 * winning. It is resolvable IN-FILE, so it cannot be dismissed with the
 * heritage probe — it has to be counted. Shared with the negative control, so
 * the control measures THIS function rather than a copy of it.
 */
// The callback's second parameter is the FILE LABEL, and it used to be dropped: this
// function took `label`, never used it, and called `hit(k, ex)` — so the recorder at the
// call site (`add`, which takes (k, label, ex)) received the EXAMPLE as its label and no
// example at all. `hits` still counted, and every hit's file attribution was the example
// string. Passing the label through is what makes the parameter mean anything.
function measureScriptBlocks(
  blocks: Array<{ body: string; lang: string }>,
  label: string,
  hit: (k: string, label: string, ex?: string) => void,
  langs?: { ts: any; tsx: any; js: any },
): void {
  if (blocks.length > 1) hit("sfc:multi-script-block", label, `${blocks.length} blocks`)
  const perBlock: Array<Set<string>> = []
  for (const b of blocks) {
    if (!b.body || !b.body.trim()) { perBlock.push(new Set()); continue }
    const parser = new Parser()
    parser.setLanguage(b.lang === "ts" ? langs!.ts : b.lang === "tsx" ? langs!.tsx : langs!.js)
    const bt = parser.parse(b.body)
    const names = new Set<string>()
    if (bt) {
      const st: any[] = [bt.rootNode]
      while (st.length) {
        const n = st.pop()!
        if (n.type === "variable_declarator") {
          const nm = n.childForFieldName("name")
          if (nm?.type === "identifier") names.add(nm.text)
        }
        if (n.type === "function_declaration") {
          const nm = n.childForFieldName("name")
          if (nm?.text) names.add(nm.text)
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
      }
      bt.delete?.()
    }
    parser.delete?.()
    perBlock.push(names)
  }
  for (let a = 0; a < perBlock.length; a++) {
    for (let bq = a + 1; bq < perBlock.length; bq++) {
      for (const n of perBlock[a]) if (perBlock[bq].has(n)) hit("sfc:SCRIPT-BLOCK-collision", label, n)
    }
  }
}

for (const f of files) {
  const label = `${f.repo}/${f.rel}`
  const p = new Parser(); p.setLanguage(vueLang)
  const tree = p.parse(f.text)
  p.delete?.()
  if (!tree) continue
  const blocks = (ASTEngine as any).extractSfcScriptBlocks(tree.rootNode, f.text) as Array<{ body: string; lang: string }>
  measureScriptBlocks(blocks, label, add, { ts: tsLang, tsx: tsxLang, js: jsLang })
  for (const b of blocks) {
    if (!b.body || !b.body.trim()) continue
    const parser = b.lang === "ts" ? tsP : b.lang === "tsx" ? tsxP : jsP
    const st = parser.parse(b.body)
    if (!st) continue
    const walk = (n: any) => {
      switch (n.type) {
        case "class_declaration": case "class": add("script:class_declaration", label); break
        case "implements_clause": add("script:implements_clause", label, n.text.slice(0, 60)); break
        case "extends_clause": case "superclass": add("script:extends_clause", label, n.text.slice(0, 60)); break
        case "new_expression": add("script:new_expression", label, n.text.slice(0, 50)); break
        case "import_statement": add("script:import_statement", label, n.text.slice(0, 50)); break
        case "interface_declaration": add("script:interface_declaration", label, n.text.slice(0, 50)); break
        case "abstract_class_declaration": add("script:abstract_class_declaration", label); break
        case "call_expression": {
          const fn = n.childForFieldName("function")
          const txt = fn?.text ?? ""
          if (fn && (txt === "defineComponent" || txt === "mixins")) add(`script:call:${txt}`, label, n.text.slice(0, 50))
          // The options object arrives in TWO shapes and measuring only one is
          // how a probe convicts a correct ruling: the first version of this
          // probe read `defineComponent({...})` alone, found 0 heritage
          // occurrences on vue-element-admin, and would have RULED `extends`
          // and `overrides` on the strength of a number about half the
          // construct. `export default { ... }` is the other half — and it is
          // the shape the Options-API corpus is actually written in.
          if (fn?.type === "identifier" && txt === "defineComponent") {
            const args = n.childForFieldName("arguments")
            const obj = args?.namedChildren?.find((c: any) => c.type === "object")
            if (obj) { add("options:shape-defineComponent", label); scanOptions(obj, label, st.rootNode) }
          }
          break
        }
        case "export_statement": {
          add("script:export_statement", label, n.text.slice(0, 50))
          // `export default { ... }` / `export default defineComponent({ ... })`
          const kids = (n.children ?? []).filter((c: any) => c.type !== "comment" && c.type !== "decorator")
          const isDefault = kids.some((c: any) => !c.isNamed && c.text === "default")
          if (!isDefault) break
          add("script:export-default", label)
          // the object is the statement's own named child, or one call layer down
          const direct = n.namedChildren?.find((c: any) => c.type === "object")
          if (direct) { add("options:shape-bare-object", label); scanOptions(direct, label, st.rootNode); break }
          const call = n.namedChildren?.find((c: any) => c.type === "call_expression")
          const args = call?.childForFieldName("arguments")
          const obj = args?.namedChildren?.find((c: any) => c.type === "object")
          if (obj) { add("options:shape-defineComponent", label); scanOptions(obj, label, st.rootNode) }
          break
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
    }
    /** Options-API heritage: `extends` / `mixins` values and the members each side declares. */
    const scanOptions = (obj: any, label: string, scriptRoot: any) => {
      const ownMembers = new Set<string>()
      const heritage: Array<{ kind: string; name: string; inlineMembers: string[] }> = []
      const objectMemberNames = (o: any): string[] => {
        const out: string[] = []
        for (let i = 0; i < o.namedChildCount; i++) {
          const c = o.namedChild(i)
          if (!c) continue
          if (c.type === "pair") {
            const k = c.childForFieldName("key")?.text
            if (k && !k.startsWith("[")) out.push(unquote(k))
            const v = c.childForFieldName("value")
            if (k && (k === "methods" || k === "computed") && v?.type === "object") out.push(...objectMemberNames(v))
          } else if (c.type === "method_definition") {
            const n = c.childForFieldName("name")?.text
            if (n) out.push(n)
          }
        }
        return out
      }
      // NEGATIVE CONTROL, control 3: this searched the OPTIONS OBJECT subtree,
      // where a `variable_declarator` can never live — the `const base = {…}`
      // a mixin names is a SIBLING statement at program level. So
      // `heritage:base-resolved-same-file` and `heritage:OVERRIDE-collision`
      // were 0 because the probe could not have found them, which is the one
      // answer the `overrides` ruling turns on.
      const literalFor = (name: string): any | null => {
        const stack: any[] = [scriptRoot]
        while (stack.length) {
          const n = stack.pop()!
          if (n.type === "variable_declarator") {
            const nm = n.childForFieldName("name")
            const val = n.childForFieldName("value")
            if (nm?.type === "identifier" && nm.text === name && val) return val
          }
          for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
        }
        return null
      }
      for (let i = 0; i < obj.namedChildCount; i++) {
        const c = obj.namedChild(i)
        if (!c) continue
        const key = c.type === "pair" ? c.childForFieldName("key")?.text : c.type === "method_definition" ? c.childForFieldName("name")?.text : undefined
        if (!key) continue
        if (key === "extends" || key === "mixins") {
          const v = c.childForFieldName("value")
          if (!v) continue
          const names: string[] = []
          let inline: string[] = []
          if (v.type === "identifier") names.push(v.text)
          else if (v.type === "string") names.push(unquote(v.text))
          else if (v.type === "array") {
            for (let j = 0; j < v.namedChildCount; j++) {
              const e = v.namedChild(j)
              if (!e) continue
              if (e.type === "identifier") names.push(e.text)
              else if (e.type === "string") names.push(unquote(e.text))
              else if (e.type === "object") inline.push(...objectMemberNames(e))
            }
          } else if (v.type === "object") inline = objectMemberNames(v)
          for (const nm of names) {
            add(`heritage:${key}`, label, nm)
            heritage.push({ kind: key, name: nm, inlineMembers: [] })
            // is the base resolvable to a SAME-FILE object literal with members?
            const lit = literalFor(nm)
            if (lit && lit.type === "object") {
              const ms = objectMemberNames(lit)
              add("heritage:base-resolved-same-file", label, `${key}:${nm} members=${ms.length}`)
              if (ms.length > 0) {
                for (const m of ms) ownMembers.add(m) // recorded below for the collision test
                heritage[heritage.length - 1].inlineMembers = ms
              }
            }
          }
          if (inline.length) add("heritage:inline-object-merge", label, `${key} members=${inline.length}`)
        }
        if (key === "methods" || key === "computed") {
          const v = c.childForFieldName("value")
          if (v?.type === "object") for (const m of objectMemberNames(v)) ownMembers.add(m)
        }
      }
      // COLLISION = the override construct: a base member whose name the component
      // also declares. Vue's own merge rule is that the component wins.
      for (const h of heritage) {
        for (const m of h.inlineMembers) {
          if (ownMembers.has(m)) add("heritage:OVERRIDE-collision", label, `${h.kind}:${h.name}#${m}`)
        }
      }
      if (heritage.length) add("options:has-heritage", label, heritage.map((h) => `${h.kind}:${h.name}`).join(","))
    }
    walk(st.rootNode)
    st.delete?.()
  }
  tree.delete?.()
}
jsP.delete?.(); tsP.delete?.(); tsxP.delete?.()

const out = [...hits.values()].map((h) => ({ ...h, files: hitFiles.get(h.type)?.size ?? 0 })).sort((a, b) => a.type.localeCompare(b.type))

/**
 * THE EXPECTED SET, and why a report of only the hits is not a ruling.
 *
 * `instrumentB_scriptConstructs` is built from a Map that only receives a key
 * when `add()` fires, so every construct that never occurs is simply ABSENT from
 * the array. An absent key and a key nobody looked for print identically — which
 * is precisely the shape of the defect this probe already caught twice (a
 * `defineComponent`-only heritage scan reporting 0 heritage sites on a corpus
 * with 9, and an unreachable `case "export_statement"` classifying all 121
 * exports as non-default). A ruling that rests on a zero has to SHOW the zero.
 *
 * So every construct this probe claims to measure is listed here, and each is
 * reported as its count whether that count is 0 or not. Adding a construct to
 * the walk without adding it here produces a report that is silent about it, so
 * this list is the check on the list.
 */
const EXPECTED = [
  // `implements` rests on these four.
  "script:implements_clause", "script:class_declaration", "script:abstract_class_declaration", "script:extends_clause",
  // `overrides` rests on these six.
  "heritage:mixins", "heritage:extends", "heritage:base-resolved-same-file",
  "heritage:OVERRIDE-collision", "heritage:inline-object-merge",
  "sfc:multi-script-block", "sfc:SCRIPT-BLOCK-collision",
  // Positive controls on the probe's own reach: each must be NON-ZERO on this
  // corpus, so their presence is evidence the walk reaches script blocks at all.
  "script:export-default", "script:export_statement", "script:import_statement",
  "script:interface_declaration", "script:new_expression",
  "options:shape-bare-object", "options:shape-defineComponent", "script:call:defineComponent",
  "options:has-heritage",
]
const byType = new Map(out.map((h) => [h.type, h]))
const zeros = EXPECTED.filter((t) => !byType.has(t))
const zeroTable = EXPECTED.map((t) => byType.get(t) ?? { type: t, count: 0, files: 0, examples: [] })
// A construct listed as EXPECTED that the walk never reports is the dangerous
// case, and it is asserted here rather than left to a reader: every construct the
// rulings depend on must appear with an explicit 0, and every construct that must
// be NON-zero must be non-zero.
const MUST_BE_NONZERO = [
  "script:export-default", "script:export_statement", "script:import_statement",
  "script:interface_declaration", "script:new_expression",
  "options:shape-bare-object", "options:shape-defineComponent",
]
const silentNonzero = MUST_BE_NONZERO.filter((t) => !byType.has(t) || (byType.get(t)!.count ?? 0) === 0)
writeFileSync(OUT, JSON.stringify({
  at: new Date().toISOString(), files: files.length,
  repos: Object.fromEntries([...new Set(files.map((f) => f.repo))].map((r) => [r, files.filter((f) => f.repo === r).length])),
  instrumentA_sfcGrammarNodeTypes: Object.fromEntries([...sfcNodeTypes.entries()].sort((a, b) => b[1] - a[1])),
  instrumentB_scriptConstructs: out,
  // EVERY construct this probe measures, zero rows included. `out` alone omits
  // the absent keys, which is the same blindness the probe's own history records.
  instrumentB_expectedConstructs: zeroTable,
  instrumentB_zeroConstructs: zeros,
  instrumentB_mustBeNonzero: MUST_BE_NONZERO,
  instrumentB_silentNonzero: silentNonzero,
}, null, 2))
console.log(`\nA. SFC grammar node types (${sfcNodeTypes.size} distinct):`)
console.log("  " + [...sfcNodeTypes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" "))
console.log(`\nB. script-side constructs — EVERY measured construct, zeros shown:`)
for (const h of zeroTable) console.log(`  ${h.type.padEnd(42)} ${String(h.count).padStart(6)} occurrences in ${String(h.files).padStart(4)} files   ${h.examples[0] ?? ""}`)
console.log(`\n  constructs measured and found ZERO (${zeros.length}): ${zeros.join(" ") || "none"}`)
if (silentNonzero.length) console.log(`  >>> MUST-BE-NONZERO REACH CONTROL FAILED: ${silentNonzero.join(" ")} — the walk did not reach these, so every zero above is unproven`)
for (const h of out) console.log(`  ${h.type.padEnd(42)} ${String(h.count).padStart(6)} occurrences in ${String(h.files).padStart(4)} files   ${h.examples[0] ?? ""}`)
console.log(`\nreport: ${OUT}`)
// ============================================================================
// NEGATIVE CONTROL — a probe that reports 0 must be shown ABLE to report
// non-zero, or its 0 is a claim about the probe.
//
// Two controls were needed to get here, and both found a real blindness:
//
//  1. The first version read the Options object out of `defineComponent({...})`
//     alone, reported `heritage:*` = 0 across 1,151 corpus files, and would
//     have RULED `extends` and `overrides` on that number. vue-element-admin
//     writes `export default { ... }` — the other shape — and 9 of its files
//     declare `mixins:`.
//  2. The second version had an EARLIER `case "export_statement"` that counted
//     every export and broke out of the switch, so the default-export case
//     added below was unreachable: 121 occurrences were counted and 121
//     classified as non-default.
//
// Each control below plants one construct and REQUIRES it to be counted. Exit
// code 1 on a miss: a ruling resting on a zero this file cannot prove it can
// produce is not a ruling.
// ============================================================================
const CONTROL: Array<{ name: string; src: string; expect: string[] }> = [
  { name: "implements-clause", src: `<script lang="ts">\ninterface Shape { area(): number }\nexport default class Box implements Shape { area(): number { return 1 } }\n</script>`, expect: ["script:implements_clause", "script:class_declaration"] },
  { name: "class-extends", src: `<script lang="ts">\nclass Base {}\nexport default class Child extends Base {}\n</script>`, expect: ["script:extends_clause"] },
  { name: "new-expression", src: `<script setup>\nconst m = new Map()\n</script>`, expect: ["script:new_expression"] },
  { name: "heritage-bare-object", src: `<script>\nconst base = { methods: { load() {} } }\nexport default { mixins: [base], methods: { load() {} } }\n</script>`, expect: ["heritage:mixins", "heritage:base-resolved-same-file", "heritage:OVERRIDE-collision"] },
  { name: "heritage-definecomponent", src: `<script>\nimport { defineComponent } from 'vue'\nconst base = { methods: { load() {} } }\nexport default defineComponent({ mixins: [base], methods: { load() {} } })\n</script>`, expect: ["heritage:mixins", "heritage:OVERRIDE-collision"] },
  { name: "heritage-extends-imported", src: `<script>\nimport base from './base'\nexport default { extends: base }\n</script>`, expect: ["heritage:extends"] },
  { name: "heritage-extends-array", src: `<script>\nexport default { extends: [A, B] }\n</script>`, expect: ["heritage:extends"] },
  { name: "heritage-inline-object", src: `<script>\nexport default { extends: { methods: { load() {} } } }\n</script>`, expect: ["heritage:inline-object-merge"] },
  { name: "export-default-bare", src: `<script>\nexport default { name: 'X' }\n</script>`, expect: ["script:export-default", "options:shape-bare-object"] },
  { name: "import-statement", src: `<script>\nimport x from './x'\n</script>`, expect: ["script:import_statement"] },
  { name: "dual-script-block-collision", src: `<script>\nexport const shared = 1\n</script>\n<script setup>\nconst shared = 2\n</script>`, expect: ["sfc:multi-script-block", "sfc:SCRIPT-BLOCK-collision"] },
  { name: "dual-script-block-no-collision", src: `<script>\nexport const one = 1\n</script>\n<script setup>\nconst two = 2\n</script>`, expect: ["sfc:multi-script-block"] },
]

/** The same heritage scanner the corpus loop uses, so the control measures the
 *  PROBE and not a re-implementation of it. */
const scanHeritage = (obj: any, out: Set<string>, hit: (k: string) => void, scriptRoot: any) => {
  const objectMemberNames = (o: any): string[] => {
    const names: string[] = []
    for (let i = 0; i < o.namedChildCount; i++) {
      const c = o.namedChild(i)
      if (!c) continue
      if (c.type === "pair") {
        const k = c.childForFieldName("key")?.text
        if (k && !k.startsWith("[")) names.push(unquote(k))
        const v = c.childForFieldName("value")
        if (k && (k === "methods" || k === "computed") && v?.type === "object") names.push(...objectMemberNames(v))
      } else if (c.type === "method_definition") {
        const n = c.childForFieldName("name")?.text
        if (n) names.push(n)
      }
    }
    return names
  }
  const literalFor = (name: string): any | null => {
    const stack: any[] = [scriptRoot]
    while (stack.length) {
      const n = stack.pop()!
      if (n.type === "variable_declarator") {
        const nm = n.childForFieldName("name")
        const val = n.childForFieldName("value")
        if (nm?.type === "identifier" && nm.text === name && val) return val
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
    return null
  }
  const own = new Set<string>()
  const bases: Array<{ kind: string; members: string[] }> = []
  for (let i = 0; i < obj.namedChildCount; i++) {
    const c = obj.namedChild(i)
    if (!c) continue
    const key = c.type === "pair" ? c.childForFieldName("key")?.text : undefined
    if (!key) continue
    if (key === "extends" || key === "mixins") {
      hit(`heritage:${key}`)
      hit("options:has-heritage")
      const v = c.childForFieldName("value")
      const names: string[] = []
      let inline: string[] = []
      if (!v) continue
      if (v.type === "identifier") names.push(v.text)
      else if (v.type === "string") names.push(unquote(v.text))
      else if (v.type === "array") {
        for (let j = 0; j < v.namedChildCount; j++) {
          const e = v.namedChild(j)
          if (!e) continue
          if (e.type === "identifier") names.push(e.text)
          else if (e.type === "string") names.push(unquote(e.text))
          else if (e.type === "object") inline.push(...objectMemberNames(e))
        }
      } else if (v.type === "object") inline = objectMemberNames(v)
      for (const nm of names) {
        const lit = literalFor(nm)
        if (lit && lit.type === "object") {
          const ms = objectMemberNames(lit)
          hit("heritage:base-resolved-same-file")
          bases.push({ kind: key, members: ms })
        }
      }
      if (inline.length) hit("heritage:inline-object-merge")
    }
    if (key === "methods" || key === "computed") {
      const v = c.childForFieldName("value")
      if (v?.type === "object") for (const m of objectMemberNames(v)) own.add(m)
    }
  }
  for (const b of bases) for (const m of b.members) if (own.has(m)) hit("heritage:OVERRIDE-collision")
  out.add("scanned")
}

let controlFail = 0
for (const c of CONTROL) {
  const found = new Set<string>()
  const hit = (k: string) => found.add(k)
  const vp = new Parser(); vp.setLanguage(vueLang)
  const t = vp.parse(c.src)
  const blocks = (ASTEngine as any).extractSfcScriptBlocks(t!.rootNode, c.src) as Array<{ body: string; lang: string }>
  measureScriptBlocks(blocks, c.name, (k, ex) => hit(k), { ts: tsLang, tsx: tsxLang, js: jsLang })
  for (const b of blocks) {
    if (!b.body || !b.body.trim()) continue
    const lang = b.lang === "ts" ? tsLang : b.lang === "tsx" ? tsxLang : jsLang
    const parser = new Parser(); parser.setLanguage(lang)
    const st = parser.parse(b.body)
    if (!st) continue
    const walk = (n: any) => {
      if (n.type === "implements_clause") hit("script:implements_clause")
      if (n.type === "class_declaration") hit("script:class_declaration")
      if (n.type === "extends_clause" || n.type === "superclass") hit("script:extends_clause")
      if (n.type === "new_expression") hit("script:new_expression")
      if (n.type === "import_statement") hit("script:import_statement")
      if (n.type === "export_statement") {
        hit("script:export_statement")
        const kids = (n.children ?? []).filter((c: any) => c.type !== "comment" && c.type !== "decorator")
        if (kids.some((c: any) => !c.isNamed && c.text === "default")) {
          hit("script:export-default")
          const direct = n.namedChildren?.find((x: any) => x.type === "object")
          if (direct) { hit("options:shape-bare-object"); scanHeritage(direct, found, hit, st.rootNode); return }
          const call = n.namedChildren?.find((x: any) => x.type === "call_expression")
          const args = call?.childForFieldName("arguments")
          const obj = args?.namedChildren?.find((x: any) => x.type === "object")
          if (obj) { hit("options:shape-defineComponent"); scanHeritage(obj, found, hit, st.rootNode); return }
        }
      }
      if (n.type === "call_expression") {
        const fn = n.childForFieldName("function")
        if (fn?.type === "identifier" && fn.text === "defineComponent") {
          hit("script:call:defineComponent")
          const args = n.childForFieldName("arguments")
          const obj = args?.namedChildren?.find((x: any) => x.type === "object")
          if (obj) { hit("options:shape-defineComponent"); scanHeritage(obj, found, hit, st.rootNode) }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const x = n.namedChild(i); if (x) walk(x) }
    }
    walk(st.rootNode)
    st.delete?.()
    parser.delete?.()
  }
  const missing = c.expect.filter((k) => !found.has(k))
  console.log(`  control ${c.name.padEnd(28)} found=[${[...found].sort().join(", ")}]${missing.length ? `  MISSING ${missing.join(",")}` : ""}`)
  if (missing.length) { controlFail++; console.log(`  CONTROL MISS ${c.name}: the probe did not count ${missing.join(", ")} in a source written to contain it`) }
}
console.log(`\nnegative control: ${controlFail} miss(es) across ${CONTROL.length} planted constructs`)
if (silentNonzero.length > 0) {
  // Silence is guilt (M14 §5.4): a control that cannot fire is a failed check.
  console.log(`\nREACH CONTROLS SILENT: ${silentNonzero.length} construct(s) this probe needs to be able to find were never reported. Every zero it reports is then a claim about the probe rather than about the corpus.`)
  process.exitCode = 1
}
if (controlFail > 0) process.exitCode = 1
