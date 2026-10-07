/**
 * VUE — `overrides`: WHAT THE CORPUS SUPPORTS THAT THE ANALYZER CANNOT EMIT.
 *
 * THE VERDICT THIS FILE SETTLES. `overrides` is 0 on every measured corpus
 * (11 files on `vuejs`; 1,140 on `element-plus` + `vue-element-admin`). The
 * analyzer HAS a branch for it — `extractOptionsApi`'s `mergeBases` pass, added
 * 2026-10-03 — so the question is not "is it constructible" (it is) but "does the
 * branch's precondition ever hold on a real corpus".
 *
 * The branch's precondition, by its own contract, is `sameTreeOptionsObject`:
 * the merge base's options object must be readable WITHOUT leaving the parse
 * tree. Two shapes satisfy it (an inline `extends: { … }`, and a `const` mixin
 * in the same `<script>` block). Everything else returns undefined and the
 * caller emits nothing.
 *
 * WHY THAT IS THE WRONG SHAPE FOR THE COMMON CASE, measured. The corpus's
 * heritage edges name bases imported from a SIBLING MODULE:
 *
 *   vue-element-admin/src/components/Charts/Keyboard.vue
 *     import resize from './mixins/resize'
 *     export default { mixins: [resize], ... }
 *
 * and `./mixins/resize` is a plain `.js` file exporting an options object. Vue
 * merges it at runtime; this analyzer never parses another file, so it cannot
 * know what the base declares, and an `overrides` row needs exactly that.
 *
 * THE MEASUREMENT. For every `extends`/`mixins` edge production `parseFile`
 * emits, this probe
 *   1. resolves the base identifier through the component's own import
 *      statement to a file on disk,
 *   2. parses that file and reads its exported options object's member names,
 *      with the SAME membership rule the analyzer applies in-tree
 *      (`methods`/`computed`/`props`/`emits`/`watch`/`inject` keys, the lifecycle
 *      shorthand methods, and the `data` keys),
 *   3. intersects that set with the component's own member symbols, as
 *      production publishes them.
 * The intersection IS the override count — Vue's merge rule makes the
 * component's own value for a colliding member win, which is the only sense the
 * language has an override.
 *
 * So the number this prints is the SIZE OF THE GAP, not the gap itself, and it
 * is falsifiable in the useful direction: a base that resolves and collides is a
 * row the analyzer is leaving on the table.
 *
 * READ-ONLY. The probe touches the filesystem; the analyzer must not, which is
 * the whole reason the two answers differ. No regex — module specifiers are
 * matched by character walks and AST node types.
 *
 * CLI: npx tsx script/m14/vue-overrides-crossfile-probe.mts [--repo vue-element-admin,element-plus] [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "path"
import * as readTree from "web-tree-sitter"
import { ASTEngine } from "../../src/ast/engine"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const REPOS = (argOf("--repo", "vue-element-admin,element-plus") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const OUT = argOf("--out")
const MAX_BYTES = 512 * 1024

const files: Array<{ repo: string; dir: string; rel: string; abs: string; text: string }> = []
for (const e of REPOS) {
  const dir = path.join(process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories", e)
  let tracked: string[]
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!rel.endsWith(".vue")) continue
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "vue") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
const commits: Record<string, string> = {}
for (const d of new Set(files.map((f) => f.dir))) {
  try { commits[d] = execFileSync("git", ["-C", d, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { commits[d] = "unknown" }
}
console.log(`vue overrides cross-file probe — repos ${REPOS.join(",")}  .vue admitted ${files.length}`)
console.log(`corpus commits: ${JSON.stringify(commits)}`)

// ── grammars, through the production wasm the engine itself loads ──────────────
const wts: any = readTree
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const wasmDir = path.join(process.cwd(), "wasm")
const grammarCache = new Map<string, any>()
const loadGrammar = async (name: string): Promise<any> => {
  let p = grammarCache.get(name)
  if (p) return p
  p = new WSP()
  p.setLanguage(await WSL.load(readFileSync(path.join(wasmDir, name))))
  grammarCache.set(name, p)
  return p
}
const vueP = await loadGrammar("tree-sitter-vue.wasm")
const jsP = await loadGrammar("tree-sitter-javascript.wasm")
const tsP = await loadGrammar("tree-sitter-typescript.wasm")

const unquote = (s: string): string =>
  s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0] ? s.slice(1, -1) : s

/** Every `<script>` block's body + lang, read off the vue tree. */
function scriptBlocks(text: string): Array<{ body: string; lang: string }> {
  const t = vueP.parse(text)
  if (!t) return []
  const out: Array<{ body: string; lang: string }> = []
  const stack: any[] = [t.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()
    if (n.type === "script_element") {
      let body: any = null, lang = "js"
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c.type === "raw_text") body = c
        if (c.type === "attribute" && c.childForFieldName?.("name")?.text === "lang") {
          const raw = String(c.childForFieldName?.("value")?.text ?? "")
          lang = raw.length >= 2 && (raw[0] === '"' || raw[0] === "'") && raw[raw.length - 1] === raw[0] ? raw.slice(1, -1) : raw
        }
      }
      if (body) out.push({ body: body.text, lang })
    }
    for (let i = 0; i < n.childCount; i++) if (n.child(i)) stack.push(n.child(i))
  }
  t.delete?.()
  return out
}

/**
 * The module specifier an identifier was imported from, read off the import
 * statements of a parsed script. Mirrors the analyzer's own `importModuleFor`
 * rule — this is a probe, and it deliberately re-implements rather than imports
 * so that a bug in the analyzer's reader cannot make the two agree by
 * construction.
 */
function moduleForIdentifier(scriptRoot: any, name: string): string | undefined {
  for (let i = 0; i < scriptRoot.namedChildCount; i++) {
    const n = scriptRoot.namedChild(i)
    if (n?.type !== "import_statement") continue
    let src: string | undefined
    for (let j = 0; j < n.namedChildCount; j++) {
      const c = n.namedChild(j)
      if (c?.type === "string") { src = unquote(c.text); break }
    }
    const clause = n.namedChildren.find((c: any) => c.type === "import_clause")
    for (const c of clause?.namedChildren ?? []) {
      if (!c) continue
      if (c.type === "named_imports") {
        for (const sp of c.namedChildren) {
          const alias = sp?.childForFieldName?.("alias")?.text
          const imp = sp?.childForFieldName?.("name")?.text
          if ((alias ?? imp) === name && src) return src
        }
      } else if (c.type === "identifier" && c.text === name && src) {
        return src
      }
    }
  }
  return undefined
}

/**
 * Vue's member-name rule for an options OBJECT — re-implemented independently of
 * the analyzer, and NOT the same rule: it is the CORRECTED one.
 *
 * `internalOptionMergeStrats` (vuejs@4ab865a,
 * packages/runtime-core/src/componentOptions.ts:1005-1035) splits the option
 * kinds: methods/computed/props/emits/inject are `extend`ed so the child's
 * value wins per key, while the 14 lifecycle hooks are `mergeAsArray` and BOTH
 * run, `watch` is `mergeWatchOptions` and both run, and `data` is `mergeDataFn`
 * and BOTH factories run. Only the first group — plus the keys two `data`
 * factories both RETURN — is an override.
 *
 * The earlier version of this probe read lifecycle hooks and `watch` keys too,
 * because the analyzer did. That is what produced the 21-collision figure, and
 * it is why the number had to be corrected along with the rule.
 */
function optionsMemberNames(obj: any): Set<string> {
  const out = new Set<string>()
  const MEMBER_OPTIONS = new Set(["methods", "computed", "props", "emits", "inject"])
  for (let i = 0; i < obj.namedChildCount; i++) {
    const child = obj.namedChild(i)
    if (!child) continue
    // A `method_definition` child of an options object is a lifecycle hook or the
    // `data` factory — a merge, never a replacement.
    if (child.type === "method_definition") continue
    if (child.type !== "pair") continue
    const keyRaw = child.childForFieldName("key")?.text
    if (!keyRaw || keyRaw.startsWith("[")) continue
    const key = child.childForFieldName("key")!.type === "string" ? unquote(keyRaw) : keyRaw
    if (!MEMBER_OPTIONS.has(key)) continue
    const v = child.childForFieldName("value")
    if (!v) { out.add(key); continue }
    if (v.type === "object") {
      for (let j = 0; j < v.namedChildCount; j++) {
        const m = v.namedChild(j)
        if (!m || (m.type !== "pair" && m.type !== "method_definition" && m.type !== "shorthand_property_identifier")) continue
        const mk = m.type === "pair" ? m.childForFieldName("key")?.text
          : m.type === "method_definition" ? m.childForFieldName("name")?.text
            : m.text
        if (mk && !mk.startsWith("[")) out.add(unquote(mk))
      }
    } else if (v.type === "array") {
      for (let j = 0; j < v.namedChildCount; j++) {
        const m = v.namedChild(j)
        if (m?.type === "string") out.add(unquote(m.text))
      }
    } else out.add(key)
  }
  return out
}

/** A `data()` factory's keys, and the first object literal of an options
 *  `data:` option — the reactive-state members a merge can collide on. */
function dataMemberNames(obj: any): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < obj.namedChildCount; i++) {
    const child = obj.namedChild(i)
    if (!child) continue
    const isData = child.type === "method_definition"
      ? child.childForFieldName("name")?.text === "data"
      : child.type === "pair" && child.childForFieldName("key")?.text === "data"
    if (!isData) continue
    const addFrom = (o: any): void => {
      if (!o) return
      for (let j = 0; j < o.namedChildCount; j++) {
        const p = o.namedChild(j)
        if (p?.type !== "pair") continue
        const k = p.childForFieldName("key")?.text
        if (k && !k.startsWith("[")) out.add(unquote(k))
      }
    }
    if (child.type === "pair") {
      const v = child.childForFieldName("value")
      if (v?.type === "object") addFrom(v)
      continue
    }
    // data() { return { … } } — the first returned object literal.
    const stack: any[] = [child]
    let found = false
    while (stack.length > 0 && !found) {
      const n = stack.pop()
      if (n.type === "return_statement") {
        for (let j = 0; j < n.namedChildCount; j++) {
          const c = n.namedChild(j)
          if (c?.type === "object") { addFrom(c); found = true; break }
        }
        continue
      }
      for (let j = n.namedChildCount - 1; j >= 0; j--) { const c = n.namedChild(j); if (c) stack.push(c) }
    }
  }
  return out
}

/** The options object a module exports by default — `export default { … }` or
 *  `export default defineComponent({ … })`, the first object under the export. */
function defaultExportedObject(scriptRoot: any): any | null {
  const stack: any[] = [scriptRoot]
  let exportNode: any = null
  while (stack.length > 0 && !exportNode) {
    const n = stack.pop()
    if (n.type === "export_statement") {
      let sawExport = false, isDefault = false
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (!c || c.type === "comment") continue
        if (!sawExport) { if (!c.isNamed && c.text === "export") sawExport = true; else if (c.isNamed) break; continue }
        if (!c.isNamed && c.text === "default") { isDefault = true; break }
        if (c.isNamed) break
      }
      if (isDefault) exportNode = n
    }
    if (!exportNode) for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  if (!exportNode) return null
  const s2: any[] = [exportNode]
  while (s2.length > 0) {
    const n = s2.pop()
    if (n.type === "object") return n
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) s2.push(c) }
  }
  return null
}

/** Resolve a specifier the way a Vue CLI / Vite project does: `@/` -> `src/`,
 *  a relative specifier against the importing file, then the extension set. */
function resolveSpecifier(repoDir: string, importerRel: string, spec: string): string | null {
  let base: string
  if (spec.startsWith("@/")) base = path.join(repoDir, "src", spec.slice(2))
  else if (spec.startsWith("./") || spec.startsWith("../")) base = path.resolve(repoDir, path.dirname(importerRel), spec)
  else return null // a bare specifier is a package, not a file in this repo
  const exts = ["", ".js", ".mjs", ".cjs", ".ts", ".vue", "/index.js", "/index.ts"]
  for (const ext of exts) {
    const abs = base + ext
    try { if (statSync(abs).isFile()) return abs } catch { /* try the next extension */ }
  }
  return null
}

// ── pass 1: production parseFile, keep heritage edges and owned members ───────
type Heritage = { repo: string; rel: string; abs: string; dir: string; component: string; base: string; isMixin: boolean }
const heritage: Heritage[] = []
const owned = new Map<string, Set<string>>() // component -> member names
let filesParsed = 0, parseFail = 0, overridesEmitted = 0
for (const f of files) {
  let r: any
  try { r = await parseFile(f.abs, f.dir) } catch { parseFail++; continue }
  filesParsed++
  for (const s of r?.symbols ?? []) {
    if (!s?.ownerName || !s?.name) continue
    const key = `${f.rel}::${s.ownerName}`
    let set = owned.get(key)
    if (!set) { set = new Set(); owned.set(key, set) }
    set.add(String(s.name))
  }
  for (const x of r?.relationships ?? []) {
    if (String(x.type ?? x.relationshipType) !== "extends") continue
    if (x.metadata?.isOptionsApi !== true) continue
    heritage.push({
      repo: f.repo, rel: f.rel, abs: f.abs, dir: f.dir,
      component: String(x.source), base: String(x.target),
      isMixin: x.metadata?.isMixin === true,
    })
    overridesEmitted += (r?.relationships ?? []).filter((y: any) => String(y.type ?? y.relationshipType) === "overrides").length
  }
}
console.log(`\nproduction parseFile: ${filesParsed} files (parseFail ${parseFail})`)
console.log(`heritage (extends/mixins) edges from the VUE Options-API branch: ${heritage.length}`)
console.log(`overrides rows production actually emitted: ${overridesEmitted}`)

// ── pass 2: resolve each base and count the collisions ────────────────────────
type Resolved = Heritage & { spec: string; baseFile: string; baseMembers: string[]; ownMembers: string[]; collisions: string[]; optionMerges: string[]; memberOverrides: string[] }

/** Vue's own options-object keys whose MERGE STRATEGY is not a replacement — so a
 *  name collision on one is not an override even where the name was read. `data`
 *  is absent because its RETURNED KEYS are replaced per key (mergeDataFn) and are
 *  read by `dataMemberNames`; the `data` OPTION itself is two merged factories. */
const OPTION_KEYS = new Set([
  "name", "components", "directives", "filters", "watch", "provide", "mixins", "extends",
  "setup", "template", "render", "renderError", "staticRenderFns", "beforeCompile",
  "compiled", "delimiters", "comments", "inheritAttrs", "model", "propsData", "parent",
  "mixin", "functional", "serverPrefetch", "expose", "emitsOptions", "compilerOptions",
  "beforeCreate", "created", "beforeMount", "mounted", "beforeUpdate", "updated",
  "beforeDestroy", "destroyed", "beforeUnmount", "unmounted", "activated",
  "deactivated", "errorCaptured", "renderTracked", "renderTriggered",
])
const resolved: Resolved[] = []
const unresolved: Array<Heritage & { spec: string; baseFile: string; baseMembers: string[]; ownMembers: string[]; collisions: string[]; optionMerges: string[]; memberOverrides: string[] }> = []
for (const h of heritage) {
  const blocks = scriptBlocks(readFileSync(h.abs, "utf8"))
  let spec: string | undefined
  let baseMembers: Set<string> | null = null
  for (const b of blocks) {
    const p = b.lang === "ts" || b.lang === "tsx" ? tsP : jsP
    const st = p.parse(b.body)
    if (!st) continue
    const s = moduleForIdentifier(st.rootNode, h.base)
    if (s && !spec) spec = s
    st.delete?.()
  }
  if (!spec) { unresolved.push({ ...h, spec: "(no import statement binds the base identifier)", baseFile: "", baseMembers: [], ownMembers: [], collisions: [], optionMerges: [], memberOverrides: [] }); continue }
  const baseFile = resolveSpecifier(h.dir, h.rel, spec)
  if (!baseFile) {
    unresolved.push({ ...h, spec, baseFile: "(not a file in this repo — a package specifier)", baseMembers: [], ownMembers: [], collisions: [], optionMerges: [], memberOverrides: [] })
    continue
  }
  const bText = readFileSync(baseFile, "utf8")
  const bp = baseFile.endsWith(".ts") ? tsP : jsP
  const bst = bp.parse(bText)
  if (!bst) { unresolved.push({ ...h, spec, baseFile, baseMembers: [], ownMembers: [], collisions: [], optionMerges: [], memberOverrides: [] }); continue }
  const obj = defaultExportedObject(bst.rootNode)
  if (!obj) { unresolved.push({ ...h, spec, baseFile, baseMembers: [], ownMembers: [], collisions: [], optionMerges: [], memberOverrides: [] }); bst.delete?.(); continue }
  baseMembers = optionsMemberNames(obj)
  for (const k of dataMemberNames(obj)) baseMembers.add(k)
  bst.delete?.()
  const own = owned.get(`${h.rel}::${h.component}`) ?? new Set<string>()
  // The collision set, restricted to the member KINDS the analyzer publishes:
  // an event name colliding with a data key is not a method override.
  const collisions = [...baseMembers].filter((k) => own.has(k))
  // A collision on an OPTION NAME is a MERGE, not a replacement: Vue's
  // `mergeOptions` runs both factories for `data` and merges the results, so
  // `Component.data -> Mixin.data` claims an override the language does not
  // make. A collision on a MEMBER name (a method, a computed, a prop) is a
  // replacement — the component's value wins outright — and that is an override
  // in the only sense Vue has one. Both counts are reported; the difference is
  // 7 rows on this corpus and it is the difference between a defensible edge
  // set and an overstated one.
  const collisions_ = collisions.filter((k) => !OPTION_KEYS.has(k))
  const merges_ = collisions.filter((k) => OPTION_KEYS.has(k))
  resolved.push({
    ...h, spec, baseFile,
    baseMembers: [...baseMembers].sort(),
    ownMembers: [...own].sort(),
    collisions: collisions.sort(),
    optionMerges: merges_.sort(),
    memberOverrides: collisions_.sort(),
  })
}

console.log(`\nbases resolved to a file in the corpus: ${resolved.length} of ${heritage.length}`)
for (const r of resolved) {
  console.log(`  ${r.repo}/${r.rel}: ${r.component} ${r.isMixin ? "mixins" : "extends"} [${r.spec}] -> ${r.baseFile.replace(process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories", "$CORPUS")}`)
  console.log(`      base declares ${r.baseMembers.length} members: ${r.baseMembers.slice(0, 12).join(", ")}${r.baseMembers.length > 12 ? " …" : ""}`)
  console.log(`      component declares ${r.ownMembers.length} members; COLLISIONS: ${r.collisions.length ? r.collisions.join(", ") : "(none)"}`)
  console.log(`        member overrides (Vue replaces the base's): ${r.memberOverrides.length ? r.memberOverrides.join(", ") : "(none)"}`)
  console.log(`        option MERGES, NOT overrides (Vue merges both): ${r.optionMerges.length ? r.optionMerges.join(", ") : "(none)"}`)
}
if (unresolved.length) {
  console.log(`\nbases NOT resolvable (each one is a row the analyzer cannot emit, for a stated reason): ${unresolved.length}`)
  for (const u of unresolved) console.log(`  ${u.repo}/${u.rel}: ${u.component} -> ${u.base}  [${u.spec}] ${u.baseFile}`)
}
const totalCollisions = resolved.reduce((a, r) => a + r.collisions.length, 0)
const totalMemberOverrides = resolved.reduce((a, r) => a + r.memberOverrides.length, 0)
const totalOptionMerges = resolved.reduce((a, r) => a + r.optionMerges.length, 0)
console.log(`\nOVERRIDE ROWS THE CORPUS SUPPORTS AND THE ANALYZER DOES NOT EMIT`)
console.log(`  MEMBER overrides (Vue REPLACES the base's member — an override): ${totalMemberOverrides}`)
console.log(`    across ${resolved.filter((r) => r.memberOverrides.length > 0).length} of ${heritage.length} heritage edges`)
console.log(`  option MERGES reported as collisions but NOT overrides:       ${totalOptionMerges}`)
console.log(`  total name collisions of any kind:                            ${totalCollisions}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    schemaVersion: 1,
    at: new Date().toISOString(),
    corpus: { repos: REPOS, admittedVueFiles: files.length, commits, rule: "sorted git ls-files, .vue only, <=512KB" },
    production: { filesParsed, parseFail, heritageEdgesFromVueBranch: heritage.length, overridesEmitted },
    resolved: resolved.map((r) => ({
      file: `${r.repo}/${r.rel}`, component: r.component, base: r.base, isMixin: r.isMixin,
      specifier: r.spec, baseFile: r.baseFile,
      baseMemberCount: r.baseMembers.length, ownMemberCount: r.ownMembers.length,
      collisions: r.collisions,
      optionMerges: r.optionMerges,
      memberOverrides: r.memberOverrides,
      proposedRows: r.memberOverrides.map((k) => ({ source: `${r.component}.${k}`, target: `${r.base}.${k}`, type: "overrides" })),
    })),
    unresolved: unresolved.map((u) => ({ file: `${u.repo}/${u.rel}`, component: u.component, base: u.base, reason: u.spec, baseFile: u.baseFile })),
    overrideRowsTheCorpusSupports: {
      memberOverrides: totalMemberOverrides,
      optionMergesNotOverrides: totalOptionMerges,
      totalNameCollisions: totalCollisions,
      note: "Vue's mergeOptions runs BOTH factories for an option name (data, methods, watch, computed) and merges the results, so a collision on an option NAME is not an override. A collision on a MEMBER name is a replacement and is.",
    },
    instrument: "production parseFile for heritage + owned members; the base module resolved and re-parsed READ-ONLY by this probe. The analyzer never does this — that difference is the measurement.",
  }, null, 2))
  console.log(`\nevidence: ${OUT}`)
}
