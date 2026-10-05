/**
 * VUE `overrides` CONSTRUCT PROBE — the measurement a ruling needs.
 *
 * WHY THIS IS A SEPARATE FILE. The census (vue-ontology-census.ts) measures what
 * the analyzer EMITS and whether each label's edges resolve. `overrides` emits
 * nothing, and per the workstream an emission of nothing is exactly the case the
 * ontology gate exists to catch — `overrides` was missing from bash for a whole
 * wave and the differential stayed green, because the analyzer omitted it and the
 * oracle was written after the ruling. "Nothing agrees with nothing perfectly."
 *
 * So the question is not "does the analyzer emit it" (it does not) but "CAN A .vue
 * FILE EXPRESS ONE", measured on the parse tree through the production wasm.
 * Three candidate constructs, in descending order of how much they deserve the
 * name:
 *
 *   1 OPTIONS MERGE      `mixins: [M]` / `extends: M` then a same-named option.
 *                        Vue documents `extends` as "like class inheritance" and
 *                        `mixins` as an options merge; in both, a member the
 *                        component declares itself REPLACES the base's. This is
 *                        the strongest reading — a genuine override of an
 *                        inherited member.
 *   2 REDECLARATION      `const x = 1` twice, or `methods: { save(){}, save(){} }`.
 *                        JS executes the LAST binding, so the second replaces the
 *                        first. This is the same mechanism bash's `overrides`
 *                        ruling was falsified by, and the analyzer already encodes
 *                        it as a SYMBOL ruling ("M49 dup-key ruling (Option A):
 *                        last-wins") without ever emitting the relationship.
 *   3 TEMPLATE SHADOW    `v-for="x in xs"` shadowing a member named `x`. The
 *                        analyzer already implements this as a NON-edge (V4
 *                        shadowing), and it is recorded here so the ruling can say
 *                        it was considered and why it is not an override: a
 *                        template-local binding is a lexical scope, and a scope is
 *                        not a redefinition.
 *
 * Instrument B throughout: none of these has a keyword, so a grammar inventory is
 * blind to all three by construction. The counts are on the tree.
 *
 * CLI: npx tsx script/m14/vue-overrides-probe.mts [--dir <abs>] [--repo <name>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "path"

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
const collect = (dir: string, repo: string, onlyVue: boolean) => {
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { return }
  for (const rel of tracked) {
    if (onlyVue && !rel.endsWith(".vue")) continue
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (seen.has(abs)) continue
    seen.add(abs)
    files.push({ repo, dir, rel, abs, text })
  }
}
for (const e of REPOS) collect(path.join(process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories", e), e, true)
for (const d of EXTRA) collect(d, path.basename(d), true)
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
console.log(`vue overrides probe — ${files.length} .vue files from ${[...new Set(files.map((f) => f.repo))].join(",")}`)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..")
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const load = async (name: string) => { const p = new WSP(); p.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", name)))); return p }
const vueP = await load("tree-sitter-vue.wasm")
const jsP = await load("tree-sitter-javascript.wasm")
const tsP = await load("tree-sitter-typescript.wasm")

type Hit = { file: string; detail: string }
const optionsMergeKeys = new Map<string, number>()   // mixins | extends, as an OPTION key
const optionsMergeHits: Hit[] = []
const redecTopLevel = new Map<string, number>()     // second top-level binding of a name
const redecTopLevelHits: Hit[] = []
const redecObjectKeys = new Map<string, number>()   // duplicate key inside an options object
const redecObjectHits: Hit[] = []
const shadowHits: Hit[] = []

for (const f of files) {
  const label = `${f.repo}/${f.rel}`
  const t = vueP.parse(f.text)
  if (!t) continue
  // Locate every <script> body with the vue grammar, exactly as engine.ts does.
  const bodies: Array<{ text: string; lang: string | undefined }> = []
  const walk: any[] = [t.rootNode]
  while (walk.length) {
    const n = walk.pop()
    if (n.type === "script_element") {
      let body: any = null, lang: string | undefined
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c.type === "raw_text") body = c
        if (c.type === "attribute" && c.childForFieldName?.("name")?.text === "lang") lang = String(c.childForFieldName?.("value")?.text ?? "").replace(/^["']|["']$/g, "")
      }
      if (body) bodies.push({ text: body.text, lang })
    }
    for (let i = 0; i < n.childCount; i++) if (n.child(i)) walk.push(n.child(i))
  }
  // Construct 3: template-local shadowing, counted on the VUE tree.
  const shadowStack: any[] = [t.rootNode]
  let sawVFor = 0, sawSlotProps = 0
  while (shadowStack.length) {
    const n = shadowStack.pop()
    if (n.type === "directive_attribute") {
      const dn = n.namedChildren.find((c: any) => c.type === "directive_name")?.text
      if (dn === "v-for") sawVFor++
      if (dn === "#" || dn === "v-slot") sawSlotProps++
    }
    for (let i = 0; i < n.childCount; i++) if (n.child(i)) shadowStack.push(n.child(i))
  }
  if (sawVFor || sawSlotProps) shadowHits.push({ file: label, detail: `v-for x${sawVFor}, slot-props x${sawSlotProps}` })
  t.delete?.()

  for (const b of bodies) {
    const p = b.lang === "ts" || b.lang === "tsx" ? tsP : jsP
    const st = p.parse(b.text)
    if (!st) continue
    // ---- Construct 1: the options merge, read off the default-export object ----
    const findDefault = (root: any): any | null => {
      const s: any[] = [root]
      while (s.length) {
        const n = s.pop()
        if (n.type === "export_statement") {
          const kids: any[] = []
          for (let i = 0; i < n.childCount; i++) if (n.child(i)) kids.push(n.child(i))
          const seenExport = kids.some((c) => !c.isNamed && c.text === "export")
          const seenDefault = kids.some((c) => !c.isNamed && c.text === "default")
          if (seenExport && seenDefault) return n
        }
        for (let i = 0; i < n.childCount; i++) if (n.child(i)) s.push(n.child(i))
      }
      return null
    }
    const def = findDefault(st.rootNode)
    if (def) {
      // the options object: first `object` under the default export
      const os: any[] = [def]
      let opts: any = null
      while (os.length && !opts) {
        const n = os.pop()
        if (n.type === "object") { opts = n; break }
        for (let i = 0; i < n.childCount; i++) if (n.child(i)) os.push(n.child(i))
      }
      if (opts) {
        const optionKeys: string[] = []
        for (let i = 0; i < opts.namedChildCount; i++) {
          const c = opts.namedChild(i)
          if (c?.type !== "pair") continue
          const k = c.childForFieldName?.("key")?.text
          if (k) optionKeys.push(k)
        }
        for (const key of ["mixins", "extends"]) {
          const n = optionKeys.filter((k) => k === key).length
          if (n > 0) {
            optionsMergeKeys.set(key, (optionsMergeKeys.get(key) ?? 0) + n)
            optionsMergeHits.push({ file: label, detail: `${key}: appears ${n}x in the Options-API default export` })
          }
        }
        // ---- Construct 2b: duplicate keys inside one options object ----
        for (const c of opts.namedChildren as any[]) {
          if (c?.type !== "pair") continue
          const k = c.childForFieldName?.("key")?.text
          if (!k) continue
          const v = c.childForFieldName?.("value")
          if (v?.type !== "object") continue
          const seenKeys = new Set<string>()
          for (const m of v.namedChildren as any[]) {
            if (m?.type !== "pair" && m?.type !== "method_definition") continue
            const mk = m.type === "pair" ? m.childForFieldName?.("key")?.text : m.childForFieldName?.("name")?.text
            if (!mk) continue
            if (seenKeys.has(mk)) {
              redecObjectKeys.set(k, (redecObjectKeys.get(k) ?? 0) + 1)
              if (redecObjectHits.length < 40) redecObjectHits.push({ file: label, detail: `option \`${k}\` declares \`${mk}\` more than once` })
            }
            seenKeys.add(mk)
          }
        }
      }
    }
    // ---- Construct 2a: a second TOP-LEVEL binding of a name ----
    {
      const seenTop = new Map<string, number>()
      for (let i = 0; i < st.rootNode.namedChildCount; i++) {
        const st2 = st.rootNode.namedChild(i)
        if (!st2) continue
        const decls: any[] = st2.type === "lexical_declaration" || st2.type === "variable_declaration"
          ? (st2.namedChildren.filter((c: any) => c.type === "variable_declarator") as any[])
          : st2.type === "function_declaration" || st2.type === "class_declaration"
            ? [st2]
            : st2.type === "interface_declaration" || st2.type === "type_alias_declaration" ? [st2] : []
        for (const d of decls) {
          const nm = d.childForFieldName?.("name")?.text
          if (!nm) continue
          const c = (seenTop.get(nm) ?? 0) + 1
          seenTop.set(nm, c)
          if (c === 2) {
            redecTopLevel.set(st2.type, (redecTopLevel.get(st2.type) ?? 0) + 1)
            if (redecTopLevelHits.length < 40) redecTopLevelHits.push({ file: label, detail: `top-level \`${nm}\` declared twice (${st2.type})` })
          }
        }
      }
    }
    st.delete?.()
  }
}

const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)
const out = {
  schemaVersion: 1,
  at: new Date().toISOString(),
  corpus: { files: files.length, repos: [...new Set(files.map((f) => f.repo))] },
  construct1OptionsMerge: { occurrences: total(optionsMergeKeys), byKey: Object.fromEntries(optionsMergeKeys), files: optionsMergeHits.length, examples: optionsMergeHits.slice(0, 10) },
  construct2RedecTopLevel: { occurrences: total(redecTopLevel), byNodeType: Object.fromEntries(redecTopLevel), files: redecTopLevelHits.length, examples: redecTopLevelHits.slice(0, 10) },
  construct2bDuplicateOptionKeys: { occurrences: total(redecObjectKeys), byOption: Object.fromEntries(redecObjectKeys), files: redecObjectHits.length, examples: redecObjectHits.slice(0, 10) },
  construct3TemplateShadow: { files: shadowHits.length, examples: shadowHits.slice(0, 5) },
}
console.log(JSON.stringify(out, null, 2))
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`evidence: ${OUT}`) }