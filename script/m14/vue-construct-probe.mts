/**
 * VUE — THE CONSTRUCT PROBE for `implements` and `overrides`.
 *
 * The workstream's rule: a type with no emission is EMITTED-as-nothing or RULED,
 * and RULED needs "a written reason AND a corpus measurement proving the
 * construct that would produce it never occurs". `overrides` is the type the
 * ontology gate was built for — it was ruled missing for a whole wave on prose
 * and the differential stayed green, because the analyzer omitted it AND the
 * oracle was written after the ruling. So every shape here is counted SEPARATELY
 * on the parse tree through the production wasm, and each carries its own number.
 *
 * `implements` — a TypeScript class heritage clause. A `.vue` `<script lang="ts">`
 * block can carry a `class` exactly as any `.ts` file can, so the format does not
 * forbid it; the question is whether a component SFC ever declares one. Counted:
 * `class_declaration`, `class`, `abstract_class_declaration`, `implements_clause`,
 * `extends_clause`, `interface_declaration`.
 *
 * `overrides` — "this member replaces an inherited member". Four shapes, counted
 * separately because conflating them would overstate:
 *
 *   1 MERGE-THEN-REDECLARE-MEMBER  `mixins: [M]` / `extends: M`, and this
 *                             component declares a member name the base also
 *                             declares. Vue's own merge rule is that the
 *                             component's own value wins, so this is an override
 *                             in the only sense the language has one.
 *   2 MERGE-THEN-REDECLARE-OPTION  the same one level up: the component
 *                             re-declares a whole option (`methods`, `props`, …)
 *                             the base declares. That is a MERGE, not a member
 *                             replacement, so it is reported separately.
 *   3 CLASS-EXTENDS          `class X extends B { m(){} }` where `B` declares `m`.
 *   4 REDECLARATION          two declarations of one name in ONE SCOPE.
 *
 * TWO PARSES, NOT ONE. The base of a mixin lives in a different file, and file
 * order is alphabetical, so a single ordered pass resolves `DataField ->
 * DataFieldEdit` only if the base happens to sort first. Pass 1 records every
 * component's member set; pass 2 collides them. The first version of this probe
 * did it in one pass and reported `memberIndexSize: 0` — i.e. it found NO
 * components at all, because its `export default` reader rejected the exported
 * OBJECT node that follows the `default` keyword. A probe that reports zero for
 * the wrong reason is worse than no probe: it looks like a clean ruling.
 *
 * SHAPE 4 IS HAND-AUDITED, NOT COUNTED, and the file says why. `const x = 1;
 * const x = 2` is a JavaScript early error, but tree-sitter does NOT report it:
 * measured through this repo's own `tree-sitter-javascript.wasm`,
 * `parse("const x = 1\nconst x = 2").rootNode.hasError === false`. So a scope-blind
 * tree count cannot be trusted here, and neither can the grammar. What the tree
 * CAN do is nominate the sites; the audit in the doc disposes of them one by one.
 *
 * CLI: npx tsx script/m14/vue-construct-probe.mts --repo vuejs --dir <a,b,c> [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const REPOS = (argOf("--repo", "vuejs") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const EXTRA = (argOf("--dir", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const OUT = argOf("--out")
const MAX_BYTES = 512 * 1024

const files: Array<{ repo: string; dir: string; rel: string; abs: string; text: string }> = []
const seen = new Set<string>()
for (const dir of [...REPOS.map((e) => path.join(process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories", e)), ...EXTRA]) {
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!rel.endsWith(".vue")) continue
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "vue") continue
    if (seen.has(abs)) continue
    seen.add(abs)
    files.push({ repo: path.basename(dir), dir, rel, abs, text })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
console.log(`vue construct probe — ${files.length} .vue files, repos ${[...new Set(files.map((f) => f.repo))].join(",")}`)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..")
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const load = async (name: string): Promise<any> => { const p = new WSP(); p.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", name)))); return p }
const vueP = await load("tree-sitter-vue.wasm")
const jsP = await load("tree-sitter-javascript.wasm")
const tsP = await load("tree-sitter-typescript.wasm")

const unq = (s: string): string => (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0] ? s.slice(1, -1) : s)
const nodeTypes = new Map<string, number>()
const bump = (k: string): void => nodeTypes.set(k, (nodeTypes.get(k) ?? 0) + 1)

/**
 * A `<script>` block's `lang`, read the way `engine.ts:extractSfcScriptBlocks`
 * reads it: the attribute lives INSIDE `start_tag`, and its name node is
 * `attribute_name`, not the `childForFieldName("name")` a first guess reaches
 * for. Getting this wrong reports `lang = undefined`, hands the body to the
 * javascript grammar, and then reports `extends_clause: 0` on the one repository
 * in the corpus that has a class in a `<script lang="ts">` block — a clean-looking
 * zero produced by a broken instrument, which is the failure this function exists
 * to stop. Verified equal to the engine's own reader by the end-to-end check:
 * `parseFile(...).metadata.hasTypeInference` is true on 774 of 1,011 element-plus
 * + vue-class-component SFCs against 768 `lang="ts"` + 10 `lang="tsx"` blocks
 * written in the corpus text, the 4 differences being EMPTY script bodies, which
 * `extractSfcScriptBlocks` deliberately skips.
 */
const scriptLang = (scriptElement: any): string => {
  let lang = "js"
  // DESCEND. The first version pushed the `script_element` and `continue`d
  // whenever it was not itself an `attribute`, so it never reached the
  // `start_tag > attribute` two levels down and reported `js` for every block in
  // the corpus — including the 774 element-plus SFCs whose `<script lang="ts">`
  // the engine demonstrably does read (774 of 1,011 files arrive with
  // `metadata.hasTypeInference === true`). A probe that cannot see the grammar's
  // own nesting will report a clean zero for anything downstream of the miss.
  const walk: any[] = [scriptElement]
  while (walk.length) {
    const n = walk.pop()
    if (n.type === "attribute") {
      let name = ""
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.type === "attribute_name") { name = c.text; break } }
      if (name === "lang") {
        let value = ""
        const vs: any[] = []
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) vs.push(c) }
        while (vs.length) {
          const m = vs.pop()
          if (m.type === "attribute_value") { value = m.text; break }
          for (let i = 0; i < m.namedChildCount; i++) { const c = m.namedChild(i); if (c) vs.push(c) }
        }
        value = unq(value)
        if (value === "ts" || value === "tsx") lang = value
      }
      continue
    }
    for (let i = 0; i < n.childCount; i++) if (n.child(i)) walk.push(n.child(i))
  }
  return lang
}

/**
 * The default export's OPTIONS OBJECT, or null. `export default defineComponent({…})`
 * and `export default {…}` both resolve, because the object is searched for as a
 * descendant of the export statement rather than required to be its direct child.
 *
 * The token test is on the two KEYWORDS and tolerates comments and a named node
 * after them: `export default {…}` has children `export`, `default`, `object`, and
 * rejecting the third is how the first version of this probe found zero components
 * in a corpus of 131 Options-API SFCs.
 */
const optionsObject = (root: any): any | null => {
  const s: any[] = [root]
  while (s.length) {
    const n = s.pop()
    if (n.type === "export_statement") {
      let phase: 0 | 1 | 2 = 0
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (!c || c.type === "comment" || c.type === "decorator") continue
        if (phase === 0) { if (!c.isNamed && c.text === "export") phase = 1; else if (c.isNamed) break }
        else if (phase === 1) { if (!c.isNamed && c.text === "default") phase = 2; else break }
        else break
      }
      if (phase === 2) {
        const o: any[] = [n]
        while (o.length) {
          const m = o.pop()
          if (m.type === "object") return m
          for (let i = 0; i < m.childCount; i++) if (m.child(i)) o.push(m.child(i))
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) if (n.child(i)) s.push(n.child(i))
  }
  return null
}

type Opts = { declaredName?: string; optionKeys: Set<string>; members: Map<string, string[]>; bases: string[] }
/** Option key -> every member name it declares, IN ORDER (duplicates kept, so a
 *  same-object duplicate is visible rather than deduped away). */
const readOptions = (opts: any): Opts => {
  const o: Opts = { optionKeys: new Set(), members: new Map(), bases: [] }
  for (const c of opts.namedChildren as any[]) {
    // A lifecycle hook is written as a SHORTHAND METHOD in the options object
    // (`mounted() { … }`), not as a `pair` — and a shorthand method whose name is a
    // lifecycle hook is exactly the member a mixin's own `mounted()` gets replaced
    // by. Reading only `pair` children therefore misses every lifecycle override,
    // which is most of them: measured, `Keyboard.vue` declares
    // `mixins: [resize]`, `mounted()` and `beforeDestroy()`, and
    // `./mixins/resize.js` declares `mounted()` and `beforeDestroy()` too.
    if (c?.type === "method_definition") {
      const mk = c.childForFieldName?.("name")?.text
      if (mk) { o.optionKeys.add(mk); if (!o.members.has(mk)) o.members.set(mk, [mk]) }
      continue
    }
    if (c?.type !== "pair") continue
    const k = c.childForFieldName?.("key")?.text
    if (!k) continue
    o.optionKeys.add(k)
    if (k === "name") { const v = c.childForFieldName?.("value"); if (v?.type === "string") o.declaredName = unq(v.text); continue }
    if (k === "mixins" || k === "extends") {
      const v = c.childForFieldName?.("value")
      const push = (x: any): void => { if (x?.type === "identifier") o.bases.push(x.text); else if (x?.type === "string") { const s = unq(x.text); if (s) o.bases.push(s) } }
      if (!v) continue
      if (v.type === "array") { for (const x of v.namedChildren as any[]) push(x) } else push(v)
      continue
    }
    const v = c.childForFieldName?.("value")
    const names: string[] = []
    if (v?.type === "object") {
      for (const m of v.namedChildren as any[]) {
        if (!m || (m.type !== "pair" && m.type !== "method_definition" && m.type !== "shorthand_property_identifier")) continue
        const mk = m.type === "pair" ? m.childForFieldName?.("key")?.text : m.type === "method_definition" ? m.childForFieldName?.("name")?.text : m.text
        if (mk && !mk.startsWith("[")) names.push(unq(mk))
      }
    } else if (v?.type === "array") {
      for (const m of v.namedChildren as any[]) if (m?.type === "string") names.push(unq(m.text))
    } else if (v?.type === "string") names.push(unq(v.text))
    o.members.set(k, names)
  }
  return o
}
const MEMBER_OPTIONS = new Set(["methods", "computed", "watch", "props", "emits", "inject"])

type Comp = { label: string; self: string; opts: Opts; imports: Map<string, string>; repoDir: string; rel: string }
const comps: Comp[] = []
const classExtends: Array<{ file: string; detail: string }> = []
const dupMember: Array<{ file: string; detail: string }> = []
const redeclCandidates: Array<{ file: string; detail: string }> = []
const templateShadowFiles = new Set<string>()
/** Every `mixins`/`extends` base and WHERE it is defined, by extension. This is the
 *  decisive measurement for `overrides`, and the reason the type cannot be emitted
 *  from inside an SFC parse: Vue's options-merge base is, by convention, a plain
 *  module — `import ResizeMixin from './mixin/ResizeHandler'` — so its member list
 *  is in a file this analyzer never parses. Measured, not assumed; the first
 *  version of this probe reported `mergeEdgesWithABaseResolvableInTheCorpus: 0`
 *  without saying WHY, which is indistinguishable from "the construct never
 *  occurs" — the exact confusion the ontology gate was created to catch. */
const baseOrigin = new Map<string, number>()
const baseExamples: Array<{ file: string; detail: string }> = []

for (const f of files) {
  const label = `${f.repo}/${f.rel}`
  const t = vueP.parse(f.text)
  if (!t) continue
  const bodies: Array<{ text: string; lang: string | undefined }> = []
  const w: any[] = [t.rootNode]
  while (w.length) {
    const n = w.pop()
    if (n.type === "script_element") {
      let body: any = null
      for (let i = 0; i < n.childCount; i++) if (n.child(i)?.type === "raw_text") body = n.child(i)
      if (body) bodies.push({ text: body.text, lang: scriptLang(n) })
    }
    if (n.type === "directive_attribute") {
      const dn = n.namedChildren.find((c: any) => c.type === "directive_name")?.text
      if (dn === "v-for" || dn === "#" || dn === "v-slot") templateShadowFiles.add(label)
    }
    for (let i = 0; i < n.childCount; i++) if (n.child(i)) w.push(n.child(i))
  }
  t.delete?.()

  for (const b of bodies) {
    const p = b.lang === "ts" || b.lang === "tsx" ? tsP : jsP
    const st = p.parse(b.text)
    if (!st) continue
    const v = (n: any): void => { bump(n.type); for (let i = 0; i < n.childCount; i++) if (n.child(i)) v(n.child(i)) }
    v(st.rootNode)
    const optsNode = optionsObject(st.rootNode)
    // This file's OWN import bindings, so a merge base can be traced to the module
    // it comes from. Read from the tree — no filesystem access.
    const imports = new Map<string, string>()
    {
      const imp: any[] = [st.rootNode]
      while (imp.length) {
        const n = imp.pop()
        if (n.type === "import_statement") {
          const src = (n.namedChildren as any[]).find((c) => c.type === "string")
          const mod = src ? unq(src.text) : ""
          const clause = (n.namedChildren as any[]).find((c) => c.type === "import_clause")
          for (const c of (clause?.namedChildren ?? []) as any[]) {
            if (!c) continue
            if (c.type === "identifier") imports.set(c.text, mod)
            else if (c.type === "named_imports") for (const sp of c.namedChildren as any[]) {
              if (!sp) continue
              const nm = sp.childForFieldName?.("name")?.text
              const al = sp.childForFieldName?.("alias")?.text
              if (nm) imports.set(al ?? nm, mod)
            }
          }
        }
        for (let i = 0; i < n.childCount; i++) if (n.child(i)) imp.push(n.child(i))
      }
    }
    if (optsNode) {
      const o = readOptions(optsNode)
      const stem = path.basename(f.rel, ".vue")
      comps.push({ label, self: o.declaredName ?? stem, opts: o, imports, repoDir: f.dir, rel: f.rel })
      // the same-object duplicate: `methods: { save(){}, save(){} }`
      for (const [k, names] of o.members) {
        const seen = new Set<string>()
        for (const nm of names) { if (seen.has(nm) && MEMBER_OPTIONS.has(k)) dupMember.push({ file: label, detail: `option \`${k}\` declares \`${nm}\` twice in one object` }); seen.add(nm) }
      }
      for (const base of o.bases) {
        const mod = imports.get(base)
        let kind: string
        if (!mod) kind = "declared-nowhere-in-this-file (globally registered, or declared in another <script> block)"
        else if (!mod.startsWith(".") && !mod.startsWith("/") && !mod.startsWith("@") && !mod.startsWith("~")) kind = `bare package specifier (${mod})`
        else {
          const ext = mod.includes(".") ? "." + mod.split(".").pop() : "(no extension — resolved by bundler)"
          kind = ext.startsWith(".vue") ? `SFC ${ext}` : `non-SFC module ${ext} (${mod})`
        }
        baseOrigin.set(kind, (baseOrigin.get(kind) ?? 0) + 1)
        if (baseExamples.length < 20) baseExamples.push({ file: label, detail: `\`${base}\` <- ${mod ?? "(no import)"} : ${kind}` })
      }
    }
    // shape 3: a class with extends/implements. The heritage clauses are NOT direct
    // children of `class_declaration` — the shape is
    // `class_declaration > class_heritage > (extends_clause | implements_clause)`,
    // so a direct-child lookup reports 0 on a repository whose only class in an SFC
    // is `export default class Hello extends Vue`. Measured, and the fix is here.
    const cls: any[] = [st.rootNode]
    while (cls.length) {
      const n = cls.pop()
      if (n.type === "class_declaration" || n.type === "abstract_class_declaration" || n.type === "class") {
        const nm = n.childForFieldName?.("name")?.text
        const kids = n.namedChildren as any[]
        const heritage = kids.find((c) => c.type === "class_heritage")
        const ex = heritage ? (heritage.namedChildren as any[]).find((c) => c.type === "extends_clause") : undefined
        const im = heritage ? (heritage.namedChildren as any[]).find((c) => c.type === "implements_clause") : undefined
        if (ex || im) {
          const members = new Set<string>()
          for (const c of kids) if (c?.type === "class_body") for (const m of c.namedChildren as any[]) {
            const mk = m?.type === "method_definition" ? m.childForFieldName?.("name")?.text : m?.type === "public_field_definition" ? m.childForFieldName?.("name")?.text : undefined
            if (mk) members.add(mk)
          }
          classExtends.push({ file: label, detail: `class ${nm ?? "(anonymous)"}${ex ? " extends " + (ex.namedChildren as any[]).map((c) => c.text).join(" ") : ""}${im ? " implements " + (im.namedChildren as any[]).map((c) => c.text).join(" ") : ""}; members [${[...members].join(",")}]` })
        }
      }
      for (let i = 0; i < n.childCount; i++) if (n.child(i)) cls.push(n.child(i))
    }
    // shape 4 nominations only — the audit disposes of them (see the header)
    {
      const seenInScope = new Map<string, Map<string, number>>()
      const at = (scope: string): Map<string, number> => {
        let m = seenInScope.get(scope)
        if (!m) { m = new Map(); seenInScope.set(scope, m) }
        return m
      }
      /**
       * A SCOPE-CORRECT walk. The scope key is the byte offset of the innermost
       * enclosing function/arrow/method/`class_body`/`statement_block`, so two
       * `const x` in two handlers are two keys and two `const x` in ONE block are
       * one key counted twice.
       *
       * The first version of this probe reported 13 "program-scope" redeclarations
       * on element-plus and every one was wrong: `const cfg` twice in
       * cascader-panel/src/index.vue is two different arrow functions, `const kls`
       * twice in carousel.vue is two event handlers, and `CSSProperties` is an
       * `import type` plus two type ANNOTATIONS, which are not declarations at all.
       * Hand-audited all 13. That is why the scope key exists.
       */
      const FUNCTIONISH = new Set(["function_declaration", "function_expression", "arrow_function", "method_definition", "generator_function", "generator_function_declaration"])
      const walk = (n: any, scope: string): void => {
        if (n.type === "lexical_declaration" || n.type === "variable_declaration" || n.type === "function_declaration" || n.type === "class_declaration") {
          for (const d of n.namedChildren as any[]) {
            const nm = d?.childForFieldName?.("name")?.text
            if (!nm || nm.startsWith("[")) continue
            const m = at(scope)
            const c = (m.get(nm) ?? 0) + 1
            m.set(nm, c)
            if (c === 2) redeclCandidates.push({ file: label, detail: `scope@${scope}: \`${nm}\` declared twice in ONE scope (${n.type}) — a JS early error, confirm by reading the file` })
          }
        }
        // A new scope for every function-ish node and every block, because `let`
        // and `const` are block-scoped and a redeclaration inside two sibling
        // branches of one `if` is legal.
        const next = FUNCTIONISH.has(n.type) || n.type === "class_body" || n.type === "statement_block"
          ? `${scope}>${n.type}@${n.startIndex}`
          : scope
        for (let i = 0; i < n.childCount; i++) if (n.child(i)) walk(n.child(i), next)
      }
      walk(st.rootNode, "program")
    }
    st.delete?.()
  }
}

// ── PASS 2: collide the recorded components against each other ────────────────
const bySelf = new Map<string, { members: Set<string>; optionKeys: Set<string>; label: string }>()
for (const c of comps) {
  const members = new Set<string>()
  for (const [k, names] of c.opts.members) if (MEMBER_OPTIONS.has(k)) for (const n of names) members.add(n)
  const prev = bySelf.get(c.self)
  if (prev) { for (const m of members) prev.members.add(m); for (const k of c.opts.optionKeys) prev.optionKeys.add(k) }
  else bySelf.set(c.self, { members, optionKeys: new Set(c.opts.optionKeys), label: c.label })
}
const shape1: Array<{ file: string; detail: string }> = []
const shape2: Array<{ file: string; detail: string }> = []
const basesResolvable: string[] = []
for (const c of comps) {
  const own = bySelf.get(c.self)
  if (!own) continue
  const ownMembers = new Set<string>()
  for (const [k, names] of c.opts.members) if (MEMBER_OPTIONS.has(k)) for (const n of names) ownMembers.add(n)
  for (const base of c.opts.bases) {
    const bm = bySelf.get(base)
    if (!bm) continue
    basesResolvable.push(`${c.self} -> ${base}`)
    for (const m of ownMembers) if (bm.members.has(m)) shape1.push({ file: c.label, detail: `${c.self} ${base.includes("Mixin") || base.includes("mixin") ? "mixins" : "extends"} ${base}: member \`${m}\` declared by both` })
    for (const k of own.optionKeys) if (bm.optionKeys.has(k) && MEMBER_OPTIONS.has(k)) shape2.push({ file: c.label, detail: `${c.self} vs ${base}: option \`${k}\` declared by both` })
  }
}

// ── HOW MANY `overrides` EDGES THE LANGUAGE WOULD SUPPORT ON THIS CORPUS ───────
// The ruling above is that this lane cannot EMIT the edge, because the base's
// member list is in a file the SFC parse never reads. That is a statement about
// reach, not about the world, and the two are easy to confuse — so this measures
// the world's number: read the base module off disk (A PROBE MAY DO I/O; the
// analyzer may not, which is the whole point) and collide its member set against
// the mixing component's. This is the number a reader needs to judge the cost of
// the gap, and it is also what makes shape 1/2 a measurement rather than a zero:
// `Keyboard.vue` re-declares `mounted` and `beforeDestroy`, both of which
// `./mixins/resize.js` also declares, so the override is real.
const realOverrides: Array<{ component: string; base: string; member: string; kind: string }> = []
{
  const LIFECYCLE = new Set(["beforeCreate", "created", "beforeMount", "mounted", "beforeUpdate", "updated", "beforeUnmount", "unmounted", "activated", "deactivated", "errorCaptured", "renderTracked", "renderTriggered", "beforeDestroy", "destroyed", "serverPrefetch"])
  for (const c of comps) {
    for (const base of c.opts.bases) {
      const spec = c.imports.get(base)
      if (!spec) continue
      if (!spec.startsWith(".")) continue
      // Resolve the specifier the way a bundler would, against the SFC's dir, and
      // try the extension set a Vue project uses. Read-only, and only for bases
      // this file actually imports.
      const dir = path.dirname(path.join(c.label.split("/")[0] === c.label ? "" : "", ""))
      void dir
      const baseDir = path.dirname(c.label.replace(/^[^/]+\//, ""))
      void baseDir
      const repoDir = c.repoDir
      const candidates = ["", ".js", ".ts", ".mjs", ".cjs", "/index.js", "/index.ts", ".vue"]
      let text: string | null = null
      let chosen = ""
      for (const ext of candidates) {
        const abs = path.resolve(repoDir, path.dirname(c.rel), spec + ext)
        try { text = readFileSync(abs, "utf8"); chosen = abs; break } catch { }
      }
      if (!text) continue
      const lang = chosen.endsWith(".vue") ? "vue" : (chosen.endsWith(".ts") ? "ts" : "js")
      const p = lang === "vue" ? vueP : lang === "ts" ? tsP : jsP
      const t = p.parse(text)
      if (!t) continue
      const baseMembers = new Set<string>()
      const bopts = optionsObject(t.rootNode)
      if (bopts) {
        const bo = readOptions(bopts)
        for (const [k, names] of bo.members) if (MEMBER_OPTIONS.has(k)) for (const n of names) baseMembers.add(n)
        for (const k of bo.optionKeys) if (LIFECYCLE.has(k)) baseMembers.add(k)
      }
      t.delete?.()
      const own = new Set<string>()
      for (const [k, names] of c.opts.members) if (MEMBER_OPTIONS.has(k)) for (const n of names) own.add(n)
      for (const k of c.opts.optionKeys) if (LIFECYCLE.has(k)) own.add(k)
      for (const m of own) if (baseMembers.has(m)) realOverrides.push({ component: c.self, base, member: m, kind: path.relative(repoDir, chosen) })
    }
  }
}

const out = {
  schemaVersion: 1,
  at: new Date().toISOString(),
  corpus: {
    files: files.length,
    repos: [...new Set(files.map((f) => f.repo))],
    commits: Object.fromEntries([...new Set(files.map((f) => f.dir))].map((d) => { let c = "unknown"; try { c = execFileSync("git", ["-C", d, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { } return [path.basename(d), c] })),
    rule: "sorted git ls-files, .vue only, <=512KB, detected as vue",
  },
  scriptNodeTypeInventory: {
    distinctNodeTypes: nodeTypes.size,
    implements_clause: nodeTypes.get("implements_clause") ?? 0,
    class_declaration: nodeTypes.get("class_declaration") ?? 0,
    abstract_class_declaration: nodeTypes.get("abstract_class_declaration") ?? 0,
    class: nodeTypes.get("class") ?? 0,
    extends_clause: nodeTypes.get("extends_clause") ?? 0,
    interface_declaration: nodeTypes.get("interface_declaration") ?? 0,
    method_definition: nodeTypes.get("method_definition") ?? 0,
    new_expression: nodeTypes.get("new_expression") ?? 0,
    lexical_declaration: nodeTypes.get("lexical_declaration") ?? 0,
    function_declaration: nodeTypes.get("function_declaration") ?? 0,
    export_statement: nodeTypes.get("export_statement") ?? 0,
    scriptElementBodies: comps.length > 0 ? undefined : undefined,
  },
  componentsWithAnOptionsObject: comps.length,
  componentsWithAMemberSet: bySelf.size,
  implements: {
    constructsThatWouldEmitIt: { class_declaration: nodeTypes.get("class_declaration") ?? 0, class: nodeTypes.get("class") ?? 0, abstract_class_declaration: nodeTypes.get("abstract_class_declaration") ?? 0, implements_clause: nodeTypes.get("implements_clause") ?? 0 },
    classHeritageClauses: classExtends.length,
    examples: classExtends.slice(0, 10),
  },
  overrides: {
    shape1MergeThenRedeclareMember: { occurrences: shape1.length, files: new Set(shape1.map((h) => h.file)).size, examples: shape1.slice(0, 12) },
    shape2MergeThenRedeclareOption: { occurrences: shape2.length, files: new Set(shape2.map((h) => h.file)).size, examples: shape2.slice(0, 12) },
    shape3ClassExtends: { occurrences: classExtends.length, files: new Set(classExtends.map((h) => h.file)).size, examples: classExtends.slice(0, 12) },
    shape3bSameObjectDuplicateMember: { occurrences: dupMember.length, files: new Set(dupMember.map((h) => h.file)).size, examples: dupMember.slice(0, 12) },
    shape4RedeclarationNOMINATIONS_NEEDING_A_SCOPE_AUDIT: { occurrences: redeclCandidates.length, files: new Set(redeclCandidates.map((h) => h.file)).size, examples: redeclCandidates.slice(0, 20) },
    mergeEdgesWithABaseResolvableInTheCorpus: basesResolvable.length,
    mergeEdgesWithABaseResolvable: [...new Set(basesResolvable)].slice(0, 20),
    mergeBaseOriginHistogram: Object.fromEntries([...baseOrigin.entries()].sort((a, b) => b[1] - a[1])),
    mergeBaseOriginExamples: baseExamples,
    mergeBasesTotal: [...baseOrigin.values()].reduce((a, b) => a + b, 0),
    overridesTheCorpusSUPPORTSButThisLaneCannotEmit: {
      occurrences: realOverrides.length,
      byKind: [...realOverrides.reduce((m, r) => m.set(r.kind, (m.get(r.kind) ?? 0) + 1), new Map<string, number>())].map(([k, v]) => [k, v]).sort((a, b) => (b[1] as number) - (a[1] as number)),
      examples: realOverrides.slice(0, 14),
      note: "read off disk by the PROBE; an analyzer that emitted these rows would have to do the same, which is the boundary this lane's contract sets",
    },
  },
  consideredAndNotAnOverride: {
    templateLocalShadow: { files: templateShadowFiles.size, reason: "a lexical scope is not a redefinition; the analyzer implements this as a NON-edge (V4)" },
  },
}
console.log("\n" + "=".repeat(100))
console.log(`corpus ${out.corpus.files} .vue files — components with an Options object: ${out.componentsWithAnOptionsObject}, with a member set: ${out.componentsWithAMemberSet}`)
console.log("SCRIPT NODE-TYPE INVENTORY (the denominator every '0 occurrences' below is measured against")
console.log("=".repeat(100))
console.log(JSON.stringify(out.scriptNodeTypeInventory, null, 1))
console.log("\n" + "=".repeat(100))
console.log("CONSTRUCTS THAT WOULD PRODUCE `implements`")
console.log("=".repeat(100))
console.log(JSON.stringify(out.implements, null, 1))
console.log("\n" + "=".repeat(100))
console.log("CONSTRUCTS THAT WOULD PRODUCE `overrides`")
console.log("=".repeat(100))
console.log(JSON.stringify(out.overrides, null, 1))
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`\nevidence: ${OUT}`) }
