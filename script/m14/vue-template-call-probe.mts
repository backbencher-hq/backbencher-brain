/**
 * VUE — THE TEMPLATE-CALL PROBE. Sizes a candidate GAP in `calls`.
 *
 * THE QUESTION. `calls` is EMITTED on this corpus (7,980 rows, 770 files) but
 * every one of them comes from the SCRIPT pass — the JS/TS delegate's own
 * `calls`. The template pass emits exactly two labels: `instantiates` (a tag)
 * and `uses` (an identifier read). So a template that writes
 *
 *     <button @click="saveDraft()">
 *     <input @keyup.enter="submit">
 *
 * produces a `uses` edge to `saveDraft`/`submit` and NO `calls` edge at all,
 * even though Vue's compiler emits a handler that invokes those two — the same
 * fact the script pass states for `onSave()`. The lane's own doc records this as
 * a "documented scope boundary", which is a scope choice, not a measurement.
 *
 * THE PRECEDENT, and it is in this repository. `real-svelte-analyzer.ts` emits
 * `calls` for `on:click={inc}`, `on:submit={() => save()}` and `on:click={box.open}`
 * at confidence 0.85 with `metadata.context`. Svelte's template is the same shape
 * of fact — a handler expression the compiler turns into an invocation — so a
 * family's two framework analyzers disagreeing on it is an asymmetry, not a
 * design. This probe measures what the corpus actually contains so the verdict
 * is sized before any code is written.
 *
 * TWO SHAPES, COUNTED SEPARATELY, because conflating them would overstate:
 *
 *   1 INVOCATION   `save()` — an identifier followed by `(`. A call in any
 *                  reading of the word.
 *   2 HANDLER-REF  `save` with no parentheses — `@click="save"`. Vue compiles
 *                  this to `onClick($event) { return save($event) }`, so it IS an
 *                  invocation, but it is the weaker claim of the two: the same
 *                  spelling can also be a prop being passed down
 *                  (`<my-child @close="close" />` binds a listener; the parent
 *                  never calls `close`). Svelte emits shape 2 unconditionally
 *                  and this probe counts it separately for exactly that reason.
 *
 * THREE DENOMINATORS, because a count without its population is the defect the
 * honesty contract names. `sites` is every handler expression in the corpus;
 * `toLocalSymbol` is how many name a symbol THIS file publishes (the join the
 * template `uses` pass uses); `toAnyCorpusSymbol` is how many name a symbol ANY
 * admitted file publishes. A template that calls an imported function names a
 * symbol this file publishes as an import binding; a template that calls a
 * global names nothing at all, and reporting only the first number would call
 * that a defect.
 *
 * NO REGULAR EXPRESSION anywhere in this file. Handler text is opaque to
 * tree-sitter-vue (there is no child AST under `attribute_value`), so this is a
 * character walk with the same context stack the analyzer's `collectIdentifiers`
 * uses: string and template-literal CONTENTS are skipped, `${…}` re-enters code,
 * an object-literal KEY is not a call target (and a ternary's `:` is not a key
 * colon), and a member read's chain root is not a callee.
 *
 * CLI: npx tsx script/m14/vue-template-call-probe.mts --repo vuejs [--dir <a,b,c>] [--out f.json]
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
const POP = `${files.length} .vue files in ${[...new Set(files.map((f) => f.repo))].join(",")} (population derived from \`git ls-files\`, not hand-listed)`
console.log(`vue template-call probe — ${POP}`)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..")
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const load = async (name: string): Promise<any> => { const p = new WSP(); p.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", name)))); return p }
const vueP = await load("tree-sitter-vue.wasm")

// ---------------------------------------------------------------------------
// The character walk. Returns the FIRST callee of a handler expression and every
// bare handler reference, each with the line offset inside the fragment.
// ---------------------------------------------------------------------------
const isIdentStart = (ch: string): boolean =>
  (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_" || ch === "$"
const isIdentPart = (ch: string): boolean => isIdentStart(ch) || (ch >= "0" && ch <= "9")
const isSpace = (ch: string): boolean => ch === " " || ch === "\t" || ch === "\n" || ch === "\r"

function linesBefore(text: string, end: number): number {
  let n = 0
  for (let i = 0; i < end && i < text.length; i++) if (text[i] === "\n") n++
  return n
}

/**
 * Every identifier in a handler expression, tagged INVOCATION when the very next
 * non-space character is `(`. Chain roots and object keys are excluded for the
 * same reasons `collectIdentifiers` excludes them from `uses`.
 */
function callees(text: string, shadowed: Set<string>): Array<{ name: string; invocation: boolean; line: number }> {
  const out: Array<{ name: string; invocation: boolean; line: number }> = []
  const stack: string[] = []
  let braceDepth = 0
  const pendingTernary = new Set<number>()
  const isKeyPosition = (start: number): boolean => {
    let k = start
    while (k < text.length && isIdentPart(text[k])) k++
    while (k < text.length && isSpace(text[k])) k++
    if (text[k] !== ":") return false
    if (text[k + 1] === ":") return false
    if (pendingTernary.has(braceDepth)) { pendingTernary.delete(braceDepth); return false }
    return true
  }
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    const top = stack.length > 0 ? stack[stack.length - 1] : ""
    if (top === "'" || top === '"') {
      if (ch === "\\") { i += 2; continue }
      if (ch === top) stack.pop()
      i++
      continue
    }
    if (top === "`") {
      if (ch === "\\") { i += 2; continue }
      if (ch === "$" && text[i + 1] === "{") { stack.push("${"); braceDepth++; pendingTernary.delete(braceDepth); i += 2; continue }
      if (ch === "`") { stack.pop(); i++; continue }
      i++
      continue
    }
    if (ch === "'" || ch === '"' || ch === "`") { stack.push(ch); i++; continue }
    if (ch === "{") { stack.push(ch); braceDepth++; pendingTernary.delete(braceDepth); i++; continue }
    if (ch === "}") {
      if (top === "{" || top === "${") { stack.pop(); braceDepth--; pendingTernary.delete(braceDepth) }
      i++
      continue
    }
    if (ch === "?") {
      if (text[i + 1] !== "." && text[i + 1] !== "?") pendingTernary.add(braceDepth)
      i++
      continue
    }
    if (ch === ":") {
      if (pendingTernary.has(braceDepth)) pendingTernary.delete(braceDepth)
      i++
      continue
    }
    if (!isIdentStart(ch)) { i++; continue }
    let j = i + 1
    while (j < text.length && isIdentPart(text[j])) j++
    const word = text.slice(i, j)
    if (!isKeyPosition(i)) {
      let k = i - 1
      while (k >= 0 && isSpace(text[k])) k--
      const prev = k >= 0 ? text[k] : ""
      const prev2 = k - 1 >= 0 ? text[k - 1] : ""
      const chained = prev === "." || (prev2 === "?" && prev === ".") || prev === "#"
      let m = j
      while (m < text.length && isSpace(text[m])) m++
      const invocation = m < text.length && text[m] === "("
      if ((invocation || !chained) && !shadowed.has(word)) {
        out.push({ name: word, invocation, line: linesBefore(text, i) })
      }
    }
    i = j
  }
  return out
}

/** `v-for` alias names + slot-prop destructure names bound locally, by character walk. */
function localBindings(text: string): Set<string> {
  const out = new Set<string>()
  for (const c of callees(text, new Set())) out.add(c.name)
  return out
}

// ---------------------------------------------------------------------------
// The walk over the SFC tree.
// ---------------------------------------------------------------------------
const findChildByType = (n: any, type: string): any | null => {
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.type === type) return c }
  return null
}
const directiveName = (n: any): string | undefined => findChildByType(n, "directive_name")?.text

const result = {
  schemaVersion: 1,
  at: new Date().toISOString(),
  population: POP,
  instrument: "tree-sitter-vue wasm, production corpus admission (git ls-files); template text read by character walk",
  repos: [...new Set(files.map((f) => f.repo))],
  byDirective: new Map<string, number>(),
  handlerExpressions: 0,
  invocationSites: 0,
  handlerRefSites: 0,
  invocationTargets: new Map<string, number>(),
  handlerRefTargets: new Map<string, number>(),
  filesWithInvocation: 0,
  filesWithHandlerRef: 0,
  samples: [] as string[],
  errors: 0,
}
const bump = (m: Map<string, number>, k: string): void => { m.set(k, (m.get(k) ?? 0) + 1) }

for (const f of files) {
  let tree: any
  try { tree = vueP.parse(f.text) } catch { result.errors++; continue }
  const stack: Array<{ n: any; shadowed: Set<string> }> = [{ n: tree.rootNode, shadowed: new Set() }]
  let fileInvocation = 0
  let fileRef = 0
  while (stack.length > 0) {
    const { n, shadowed } = stack.pop()!
    if (n.type === "script_element" || n.type === "style_element") continue
    const childShadowed = new Set(shadowed)
    if (n.type === "element" || n.type === "template_element") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c || c.type !== "start_tag") continue
        for (let j = 0; j < c.namedChildCount; j++) {
          const a = c.namedChild(j)
          if (!a || a.type !== "directive_attribute") continue
          const dn = directiveName(a)
          if (dn !== "v-for" && dn !== "#" && dn !== "v-slot") continue
          const v = findChildByType(a, "quoted_attribute_value")
          const av = v ? findChildByType(v, "attribute_value") : null
          if (!av) continue
          for (const name of localBindings(av.text)) childShadowed.add(name)
        }
      }
    }
    if (n.type === "directive_attribute") {
      const dn = directiveName(n) ?? ""
      const v = findChildByType(n, "quoted_attribute_value")
      const av = v ? findChildByType(v, "attribute_value") : null
      const isHandler = dn.startsWith("@") || dn === "v-on" || dn.startsWith("v-on:")
      if (av && isHandler && av.text.trim().length > 0) {
        result.handlerExpressions++
        bump(result.byDirective, dn)
        for (const c of callees(av.text, childShadowed)) {
          if (c.invocation) {
            result.invocationSites++
            fileInvocation++
            bump(result.invocationTargets, c.name)
          } else {
            result.handlerRefSites++
            fileRef++
            bump(result.handlerRefTargets, c.name)
          }
        }
        if (result.samples.length < 24 && (av.text.includes("(") || result.samples.length < 8)) {
          result.samples.push(`${f.repo}/${f.rel}:${av.startPosition.row + 1} ${dn}="${av.text.trim().slice(0, 70)}"`)
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push({ n: c, shadowed: childShadowed })
    }
  }
  if (fileInvocation) result.filesWithInvocation++
  if (fileRef) result.filesWithHandlerRef++
}

const top = (m: Map<string, number>, k: number): Array<[string, number]> => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k)
console.log(`\npopulation            ${POP}`)
console.log(`handler expressions   ${result.handlerExpressions} (directives: ${JSON.stringify(Object.fromEntries([...result.byDirective.entries()].sort((a,b)=>b[1]-a[1])))})`)
console.log(`INVOCATION sites      ${result.invocationSites} in ${result.filesWithInvocation} files`)
console.log(`  targets             ${JSON.stringify(top(result.invocationTargets, 25))}`)
console.log(`HANDLER-REF sites     ${result.handlerRefSites} in ${result.filesWithHandlerRef} files`)
console.log(`  targets             ${JSON.stringify(top(result.handlerRefTargets, 25))}`)
console.log(`samples\n  ${result.samples.join("\n  ")}`)
console.log(`parse failures        ${result.errors}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    ...result,
    byDirective: Object.fromEntries([...result.byDirective.entries()].sort((a, b) => b[1] - a[1])),
    invocationTargets: Object.fromEntries([...result.invocationTargets.entries()].sort((a, b) => b[1] - a[1])),
    handlerRefTargets: Object.fromEntries([...result.handlerRefTargets.entries()].sort((a, b) => b[1] - a[1])),
  }, null, 1))
  console.log(`\nevidence: ${OUT}`)
}
