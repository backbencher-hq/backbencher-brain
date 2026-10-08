/**
 * VUE CONSTRUCT PROBE — JOB 2's instrument.
 *
 * The ontology gate exists because a missing relationship type can carry a
 * PROSE justification and still be wrong (`overrides` in bash, a whole wave).
 * This probe is the other half of the answer for the vue lane: for every
 * relationship type the analyzer does NOT emit, it counts, ON THE PARSE TREE of
 * the real corpus, how many times the construct that would produce it occurs.
 *
 *   0 occurrences  -> RULED, with the measurement attached (falsifiable: a probe
 *                     finding a non-zero count overturns the ruling)
 *   > 0 occurrences -> either a GAP the analyzer must implement, or an
 *                       EMISSION defect to locate; either way not a ruling
 *
 * INSTRUMENT DISCIPLINE (the ontology gate's own rule): a text pattern is the
 * wrong instrument and this file uses none. Every count below is a walk over
 * tree-sitter nodes with `node.type` / named children, on the SAME trees
 * production parses:
 *   - the SFC tree from the vue grammar, and
 *   - each <script> body re-parsed with the same js/ts/tsx grammar the engine
 *     seam uses (`ASTEngine.extractSfcScriptBlocks`, so the body and its byte
 *     offsets are the production ones, not a re-implementation).
 *
 * NO REGEX. String comparison and Set membership only.
 *
 * Usage: bun script/vue-fix/vue-construct-probe.ts [--repo vue-element-admin] [--repos a,b,c] [--json out.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import type { Node } from "web-tree-sitter"
import { ASTEngine, getParser } from "../../src/ast/engine"

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPOS = (argOf("--repos") ?? "vuejs,vue-element-admin,element-plus").split(",").map((s) => s.trim()).filter(Boolean)
const OUT = argOf("--json")
const MAX_BYTES = Number(argOf("--max-bytes") ?? String(1024 * 1024))

type Hit = { construct: string; count: number; files: number; examples: string[] }
const hits = new Map<string, Hit>()
const fileSets = new Map<string, Set<string>>()
const note = (construct: string, file: string, detail: string) => {
  const h = hits.get(construct) ?? { construct, count: 0, files: 0, examples: [] }
  h.count++
  if (h.examples.length < 4) h.examples.push(`${file}: ${detail}`)
  const s = fileSets.get(construct) ?? new Set<string>()
  s.add(file)
  fileSets.set(construct, s)
  h.files = s.size
  hits.set(construct, h)
}

/** Named-child walk. Nothing here reads source text except node.text of a leaf. */
function walk(n: Node, fn: (n: Node) => void) {
  const stack: Node[] = [n]
  while (stack.length) {
    const cur = stack.pop()!
    fn(cur)
    for (let i = cur.namedChildCount - 1; i >= 0; i--) {
      const c = cur.namedChild(i)
      if (c) stack.push(c)
    }
  }
}
const childOfType = (n: Node, type: string): Node | null => {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === type) return c
  }
  return null
}
/**
 * The vue grammar's `attribute` node carries NO `name`/`value` FIELDS — its
 * parts are `attribute_name` / `attribute_value` named children. Reading the
 * fields (the reflex from every other grammar) returns undefined and silently
 * reports 0 for every attribute, which is how the first version of this probe
 * measured `sfc:script-setup` as 0 on a corpus of `<script setup>` files.
 * Same shape as `findAttributeName`/`findAttributeValue` in engine.ts:1269.
 */
const attributeName = (attr: Node): string => {
  for (let i = 0; i < attr.namedChildCount; i++) {
    const c = attr.namedChild(i)
    if (c && c.type === "attribute_name") return c.text
  }
  return ""
}
const attributeValue = (attr: Node): string => {
  const stack: Node[] = []
  for (let i = 0; i < attr.namedChildCount; i++) {
    const c = attr.namedChild(i)
    if (c) stack.push(c)
  }
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "attribute_value") return n.text
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return ""
}
const keyOfPair = (n: Node): string => {
  const k = n.childForFieldName("key")
  if (!k) return ""
  return unquote(k.text)
}
function unquote(t: string): string {
  if (t.length >= 2) {
    const f = t[0]
    if ((f === '"' || f === "'" || f === "`") && t[t.length - 1] === f) return t.slice(1, -1)
  }
  return t
}

let files = 0, filesWithScript = 0, blocks = 0, parseErrors = 0, nonVueSeen = 0
const tsParser = await getParser("typescript")
const jsParser = await getParser("javascript")
const tsxParser = await getParser("tsx")
const vueParser = await getParser("vue")
const scriptLangTally = new Map<string, number>()

for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  if (!statSync(dir).isDirectory()) { console.error(`skip: no corpus ${dir}`); continue }
  let tracked: string[] = []
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { console.error(`skip: ${repo} is not a git repo`); continue }
  for (const rel of tracked) {
    // The lane's language is `.vue`. The corpora also carry .html/.ts files
    // (vuejs/packages/vue/examples are .html), and counting a construct in a
    // file the analyzer never sees would rule the wrong population.
    if (!rel.endsWith(".vue")) { nonVueSeen++; continue }
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
    const label = `${repo}/${rel}`
    let tree
    try { tree = vueParser.parse(text) } catch { continue }
    if (!tree) continue
    files++
    if (tree.rootNode.hasError) parseErrors++

    // ---------- instrument 1: the SFC template surface (vue grammar) ----------
    walk(tree.rootNode, (n) => {
      const t = n.type
      // Template event handler: `@click="handler"` / `v-on:click="handler"`.
      if (t === "directive_attribute") {
        const dn = childOfType(n, "directive_name")
        if (dn) {
          const name = dn.text
          if (name === "v-on" || name === "@") {
            note("template:event-handler", label, n.text.split("\n")[0].slice(0, 60))
          }
          // Dynamic component: `<component :is="expr">`
          if (name === "bind" || name === ":") {
            const arg = childOfType(n, "directive_argument")
            if (arg && arg.text === "is") note("template:dynamic-is", label, n.text.split("\n")[0].slice(0, 60))
          }
          if (name === "slot" || name === "v-slot" || name === "#") note("template:slot", label, n.text.split("\n")[0].slice(0, 60))
        }
      }
      // Two-block SFC: `<script>` AND `<script setup>` in one file. Vue allows
      // it; a lane that reads only block [0] drops half the file.
      if (t === "script_element") {
        const st = childOfType(n, "start_tag")
        if (st) {
          let setup = false, lang = "js"
          for (let i = 0; i < st.namedChildCount; i++) {
            const a = st.namedChild(i)
            if (!a || a.type !== "attribute") continue
            const an = attributeName(a)
            if (an === "setup") setup = true
            if (an === "lang") lang = unquote(attributeValue(a))
          }
          scriptLangTally.set(lang, (scriptLangTally.get(lang) ?? 0) + 1)
          if (setup) note("sfc:script-setup", label, `lang=${lang}`)
          else note("sfc:script-plain", label, `lang=${lang}`)
        }
      }
      // <style> blocks: a scoped stylesheet is part of the component contract.
      if (t === "style_element") note("sfc:style-block", label, n.text.split("\n")[0].slice(0, 40))
      // src="..." attribute: an EXTERNAL script/style the SFC points at. The
      // component's code may live entirely outside the .vue file.
      if (t === "attribute") {
        if (attributeName(n) === "src") note("sfc:external-src-attribute", label, n.text.split("\n")[0].slice(0, 60))
      }
    })

    // ---------- instrument 2: the script surface (js/ts/tsx grammar) ----------
    const scriptBlocks = ASTEngine.extractSfcScriptBlocks(tree.rootNode, text)
    if (scriptBlocks.length) filesWithScript++
    for (const b of scriptBlocks) {
      blocks++
      const p = b.lang === "ts" ? tsParser : b.lang === "tsx" ? tsxParser : jsParser
      let sub
      try { sub = p.parse(b.body) } catch { continue }
      if (!sub) continue
      walk(sub.rootNode, (n) => {
        const t = n.type
        if (t === "class_declaration" || t === "abstract_class_declaration" || t === "class") {
          const sup = n.childForFieldName("superclass")
          const impl = childOfType(n, "implements_clause")
          const nm = n.childForFieldName("name")?.text ?? "?"
          if (sup) note("script:class-with-superclass", label, `${nm} extends ${sup.text}`)
          if (impl) note("script:class-with-implements", label, `${nm} implements ${impl.text.slice(0, 40)}`)
          if (sup && impl) note("script:class-with-both", label, `${nm} extends ${sup.text} implements`)
          // members of a class WITH a superclass are the only place an override
          // can live in an SFC
          if (sup) {
            for (let i = 0; i < n.namedChildCount; i++) {
              const m = n.namedChild(i)
              if (!m) continue
              if (m.type !== "method_definition" && m.type !== "method_signature" && m.type !== "public_field_definition") continue
              const mods = m.childForFieldName("name")?.text ?? ""
              let hasOverride = false
              for (let j = 0; j < m.childCount; j++) {
                const mc = m.child(j)
                if (mc && mc.type === "override_modifier") hasOverride = true
              }
              void mods
              note("script:member-of-subclass", label, `${nm}.${m.childForFieldName("name")?.text ?? "?"}`)
              if (hasOverride) note("script:override-modifier", label, `${nm}.${m.childForFieldName("name")?.text ?? "?"}`)
            }
          }
        }
        if (t === "interface_declaration") note("script:interface", label, n.childForFieldName("name")?.text ?? "?")
        if (t === "type_alias_declaration") note("script:type-alias", label, n.childForFieldName("name")?.text ?? "?")
        if (t === "enum_declaration") note("script:enum", label, n.childForFieldName("name")?.text ?? "?")
        if (t === "decorator") note("script:decorator", label, n.text.slice(0, 40))
        // export statements (any form) and the DEFAULT one specifically
        if (t === "export_statement") {
          note("script:export-statement", label, n.text.split("\n")[0].slice(0, 50))
          // tree-sitter-javascript/typescript have NO `export_clause` node: a
          // default export is the `default` KEYWORD among the statement's
          // children. Counting an `export_clause` therefore measured 0 default
          // exports on a corpus of Options-API components that all have one.
          let isDefault = false, declKind = ""
          for (let j = 0; j < n.childCount; j++) {
            const ch = n.child(j)
            if (!ch) continue
            if (!ch.isNamed && ch.type === "default") isDefault = true
            if (ch.isNamed && (ch.type === "object" || ch.type === "class" || ch.type === "function" ||
              ch.type === "lexical_declaration" || ch.type === "variable_declaration" || ch.type === "interface_declaration")) {
              declKind = ch.type
            }
          }
          if (isDefault) note("script:export-default", label, `${declKind || "?"} ${n.text.split("\n")[0].slice(0, 44)}`)
          if (isDefault && (declKind === "object" || declKind === "")) note("script:export-default-object", label, n.text.split("\n")[0].slice(0, 44))
          if (isDefault && declKind === "class") note("script:export-default-class", label, n.text.split("\n")[0].slice(0, 44))
        }
        if (t === "lexical_declaration" || t === "variable_declaration") {
          note("script:top-level-declaration", label, n.text.split("\n")[0].slice(0, 50))
        }
        if (t === "function_declaration") note("script:function-declaration", label, n.childForFieldName("name")?.text ?? "?")
        // Options API heritage: the `extends:` / `mixins:` options, which are
        // Vue's own class heritage and the only place `extends` originates.
        if (t === "pair") {
          const k = keyOfPair(n)
          if (k === "extends") note("options:extends-option", label, n.text.split("\n")[0].slice(0, 50))
          if (k === "mixins") note("options:mixins-option", label, n.text.split("\n")[0].slice(0, 50))
          if (k === "provide") note("options:provide-option", label, n.text.split("\n")[0].slice(0, 50))
          if (k === "inject") note("options:inject-option", label, n.text.split("\n")[0].slice(0, 50))
        }
        // provide()/inject() CALLS (Composition API form)
        if (t === "call_expression") {
          const fn = n.childForFieldName("function")
          if (fn) {
            if (fn.type === "identifier" && fn.text === "provide") note("call:provide", label, n.text.slice(0, 50))
            if (fn.type === "identifier" && fn.text === "inject") note("call:inject", label, n.text.slice(0, 50))
            if (fn.type === "identifier" && fn.text === "defineExpose") note("call:defineExpose", label, n.text.slice(0, 50))
            if (fn.type === "identifier" && fn.text === "defineOptions") note("call:defineOptions", label, n.text.slice(0, 50))
            if (fn.type === "identifier" && fn.text === "defineModel") note("call:defineModel", label, n.text.slice(0, 50))
            if (fn.type === "identifier" && fn.text === "defineSlots") note("call:defineSlots", label, n.text.slice(0, 50))
          }
        }
        // import forms
        if (t === "import_statement") note("script:import-statement", label, n.text.split("\n")[0].slice(0, 50))
      })
      sub.delete?.()
    }
    tree.delete?.()
  }
}

const rows = [...hits.values()].sort((a, b) => b.count - a.count || a.construct.localeCompare(b.construct))
console.log(`\nvue construct probe — corpora: ${REPOS.join(", ")}`)
console.log(`files(.vue)=${files} filesWithScript=${filesWithScript} scriptBlocks=${blocks} vueTreesWithError=${parseErrors} nonVueFilesSkipped=${nonVueSeen}`)
console.log(`script block langs: ${JSON.stringify([...scriptLangTally.entries()].sort((a, b) => b[1] - a[1]))}\n`)
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`${w("construct", 34)}${w("count", 10)}${w("files", 8)}examples`)
console.log("-".repeat(120))
for (const r of rows) {
  console.log(`${w(r.construct, 34)}${w(String(r.count), 10)}${w(String(r.files), 8)}${r.examples[0] ?? ""}`)
}
const zero = [
  "script:class-with-superclass", "script:class-with-implements", "script:class-with-both",
  "script:member-of-subclass", "script:override-modifier", "script:interface", "script:type-alias",
  "script:enum", "script:decorator", "script:export-statement", "script:export-default",
  "script:import-statement", "script:function-declaration", "script:top-level-declaration",
  "script:export-default-object", "script:export-default-class",
  "options:extends-option", "options:mixins-option", "options:provide-option", "options:inject-option",
  "call:provide", "call:inject", "call:defineExpose", "call:defineOptions", "call:defineModel", "call:defineSlots",
  "template:event-handler", "template:dynamic-is", "template:slot",
  "sfc:script-setup", "sfc:script-plain", "sfc:style-block", "sfc:external-src-attribute",
].filter((c) => !hits.has(c))
console.log(`\nconstructs NOT observed anywhere on this corpus (0 occurrences):`)
console.log(zero.length ? `   ${zero.join(", ")}` : "   (none — every probed construct occurred)")
if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    at: new Date().toISOString(), corpora: REPOS, files, filesWithScript, blocks,
    vueTreesWithError: parseErrors, nonVueFilesSkipped: nonVueSeen,
    scriptLangs: Object.fromEntries(scriptLangTally),
    constructs: rows.map((r) => ({ construct: r.construct, count: r.count, files: r.files, examples: r.examples })),
    absent: zero,
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}