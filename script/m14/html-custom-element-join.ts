// HTML_FIX2 — the falsifier for html's `instantiates` ruling.
//
// WHAT THIS SETTLES. The construct census (html-origin-census.ts) measures 2,010
// occurrences of a hyphenated element tag across 1,652 corpus .html files. That
// number is NOT a gap: it is the shape a GAP probe is supposed to find, and if
// html emitted an `instantiates` edge per occurrence it would emit 2,010.
//
// So the count has to be interrogated rather than quoted. A hyphen in a tag name
// makes it a *potential* custom element under the HTML spec's own rule; it does
// not make it a *registered* one. Registration is `customElements.define(name,
// class)` somewhere in a JavaScript file, and that is a cross-file fact this
// analyzer cannot see from an HTML document — which is exactly why the reading
// "a hyphenated tag is an instantiation of a component" is unsafe.
//
// THE MEASUREMENT, and it is the falsifier the ruling names: parse every .js /
// .mjs / .cjs / .ts / .tsx file on the corpus with the JavaScript and
// TypeScript grammars, find every `customElements.define(...)` call, read the
// NAME argument out of the tree, and join that set against the hyphenated tag
// names read out of the HTML trees. If the join is non-empty, html SHOULD emit
// `instantiates` and the ruling is wrong.
//
// It is AST-only. The name is taken from a `string` / `template_string` /
// `string_fragment` NODE, so it cannot be faked by the word appearing in a
// comment or a string in an unrelated position, and a regex over the source text
// could not tell those apart. No regex anywhere (programme rule 1).
//
// It also reports, per corpus, WHERE the tags live — because "2,010 occurrences"
// and "2,010 occurrences across 6 files, 2,004 of them in one generated stress
// fixture" are different claims, and only the second one supports any ruling.
//
// USAGE:
//   bun script/m14/html-custom-element-join.ts
//   BB_REPO=/path/to/worktree bun script/m14/html-custom-element-join.ts
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const REPO = process.env.BB_REPO || process.cwd()
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"

const { ASTEngine } = await import(`${REPO}/src/ast/engine.ts`)

const HTML_EXT = [".html", ".htm"]
const JS_EXT = [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"]
const MAX_BYTES = 2_000_000

function walk(dir: string, exts: string[], out: string[], depth = 0): void {
  if (depth > 24) return
  let ents: any[]
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (e.name === "node_modules" || e.name === ".git") continue
    const p = join(dir, e.name)
    if (e.isDirectory()) { walk(p, exts, out, depth + 1); continue }
    let ok = false
    for (const x of exts) if (e.name.endsWith(x)) { ok = true; break }
    if (!ok) continue
    try { if (statSync(p).size > MAX_BYTES) continue } catch { continue }
    out.push(p)
  }
}

/** tag_name -> { occurrences, files:Set, corpora:Set } */
const tags = new Map<string, { n: number; files: Set<string>; corpora: Set<string>; samples: string[] }>()
/** the name argument of every customElements.define() call found in JS/TS */
const defined = new Map<string, { files: Set<string>; corpora: Set<string>; samples: string[] }>()

function asciiLower(s: string): string {
  let out = ""
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : s[i]
  }
  return out
}

/** Read the FIRST argument's string content out of an argument list node, walking
 *  only grammar nodes. Returns "" when the argument is not a literal string —
 *  `customElements.define(nameVar, …)` registers a computed name, which this
 *  census cannot resolve and says so rather than guessing. */
function firstStringArgOf(args: any): { value: string; dynamic: boolean } {
  if (!args) return { value: "", dynamic: false }
  for (let i = 0; i < args.namedChildCount; i++) {
    const a = args.namedChild(i)
    if (!a) continue
    if (a.type === "comment") continue
    if (a.type === "string" || a.type === "template_string") {
      // string -> string_fragment ; template_string -> string_fragment +
      // template_substitution. A substitution means the name is dynamic.
      let text = ""
      let dynamic = false
      for (let j = 0; j < a.namedChildCount; j++) {
        const c = a.namedChild(j)
        if (!c) continue
        if (c.type === "string_fragment") text += c.text
        else if (c.type === "template_substitution") dynamic = true
        else text += c.text
      }
      if (text.length === 0) text = a.text
      return { value: text, dynamic }
    }
    return { value: "", dynamic: true } // a non-literal first argument
  }
  return { value: "", dynamic: false }
}

const roots: string[] = []
try { for (const e of readdirSync(CORPUS, { withFileTypes: true })) if (e.isDirectory()) roots.push(join(CORPUS, e.name)) } catch {}

const htmlFiles: { corpus: string; abs: string }[] = []
const jsFiles: { corpus: string; abs: string }[] = []
for (const dir of roots) {
  const corpus = dir.slice(CORPUS.length + 1)
  const hs: string[] = []
  walk(dir, HTML_EXT, hs)
  for (const abs of hs) htmlFiles.push({ corpus, abs })
  const js: string[] = []
  walk(dir, JS_EXT, js)
  for (const abs of js) jsFiles.push({ corpus, abs })
}
console.log(`html-custom-element-join   repo=${REPO}`)
console.log(`POPULATION (readdir-derived): ${htmlFiles.length} html/htm files · ${jsFiles.length} js/ts/mjs/cjs/jsx/tsx files\n`)

let htmlParser: any = null
let jsParser: any = null
let tsParser: any = null
let tsxParser: any = null
for (const l of ["html", "javascript", "typescript", "tsx"]) {
  try { const p = await ASTEngine.getParser(l); if (l === "html") htmlParser = p; else if (l === "javascript") jsParser = p; else if (l === "typescript") tsParser = p; else tsxParser = p } catch {}
}
if (!htmlParser || !jsParser) {
  console.log(`REFUSED: html=${htmlParser ? "ok" : "MISSING"} javascript=${jsParser ? "ok" : "MISSING"} — a join that cannot parse cannot rule.`)
  process.exit(2)
}

// --- the HTML side: every hyphenated element tag -----------------------------
let htmlParsed = 0, htmlFailed = 0
for (const f of htmlFiles) {
  let content = ""
  try { content = readFileSync(f.abs, "utf8") } catch { htmlFailed++; continue }
  let tree: any = null
  try { tree = htmlParser.parse(content, f.abs) } catch { htmlFailed++; continue }
  if (!tree) { htmlFailed++; continue }
  htmlParsed++
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()
    if (n.type === "element" || n.type === "script_element" || n.type === "style_element") {
      for (let i = 0; i < n.childCount; i++) {
        const st = n.child(i)
        if (!st || (st.type !== "start_tag" && st.type !== "self_closing_tag")) continue
        for (let j = 0; j < st.childCount; j++) {
          const g = st.child(j)
          if (!g || g.type !== "tag_name") continue
          const tag = asciiLower(g.text)
          if (tag.indexOf("-") === -1 || tag === "annotation-xml") break
          let row = tags.get(tag)
          if (!row) { row = { n: 0, files: new Set<string>(), corpora: new Set<string>(), samples: [] }; tags.set(tag, row) }
          row.n++
          row.files.add(f.abs)
          row.corpora.add(f.corpus)
          if (row.samples.length < 3) row.samples.push(`${f.corpus}/${f.abs.slice(CORPUS.length + 1)} <${tag}>`)
          break
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
}

// --- the JS/TS side: every customElements.define(<name>, …) ------------------
let jsParsed = 0, jsFailed = 0, dynamicNames = 0
for (const f of jsFiles) {
  const lower = f.abs.toLowerCase()
  const parser = lower.endsWith(".tsx") ? tsxParser : (lower.endsWith(".ts") ? tsParser : jsParser)
  if (!parser) continue
  let content = ""
  try { content = readFileSync(f.abs, "utf8") } catch { jsFailed++; continue }
  // A cheap pre-filter on the RAW TEXT is used only to decide whether the file
  // is worth parsing. It is NOT the measurement: the count below comes from the
  // AST, and a file that mentions the phrase only in a comment or a string is
  // parsed anyway and then contributes whatever the grammar says it contains.
  if (!content.includes("customElements")) continue
  let tree: any = null
  try { tree = parser.parse(content, f.abs) } catch { jsFailed++; continue }
  if (!tree) { jsFailed++; continue }
  jsParsed++
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()
    if (n.type === "call_expression" || n.type === "new_expression") {
      // walk down to member_expression -> <object>.customElements.define
      let isDefine = false
      const parts: string[] = []
      const collect = (x: any, depth: number): void => {
        if (depth > 4) return
        if (x.type === "identifier" || x.type === "property_identifier") { parts.push(x.text); return }
        if (x.type === "member_expression") {
          for (let k = 0; k < x.namedChildCount; k++) { const c = x.namedChild(k); if (c) collect(c, depth + 1) }
          return
        }
        parts.push(x.type)
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) collect(c, 0) }
      isDefine = parts.length >= 2 && parts[parts.length - 1] === "define" && parts[parts.length - 2] === "customElements"
      if (isDefine) {
        let args: any = null
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.type === "arguments") { args = c; break } }
        const got = firstStringArgOf(args)
        if (got.dynamic && got.value.length === 0) dynamicNames++
        const name = asciiLower(got.value.trim())
        if (name.length > 0) {
          let row = defined.get(name)
          if (!row) { row = { files: new Set<string>(), corpora: new Set<string>(), samples: [] }; defined.set(name, row) }
          row.files.add(f.abs)
          row.corpora.add(f.corpus)
          if (row.samples.length < 2) row.samples.push(`${f.corpus}/${f.abs.slice(CORPUS.length + 1)}`)
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
}

console.log(`PARSE ACCOUNTING (the population each count was taken over)`)
console.log(`  html files: ${htmlParsed} parsed, ${htmlFailed} failed, of ${htmlFiles.length} enumerated`)
console.log(`  js/ts files: ${jsFiles.length} enumerated, ${jsParsed} of them parsed (only files whose text mentions "customElements" are parsed)`)
console.log(`  customElements.define() calls with a NON-LITERAL name argument: ${dynamicNames} — each is a registration this census cannot resolve by name\n`)

const occ = [...tags.values()].reduce((a, b) => a + b.n, 0)
const perCorpus = new Map<string, { occ: number; tags: number; files: number }>()
for (const [tag, row] of tags) {
  for (const c of row.corpora) {
    const e = perCorpus.get(c) || { occ: 0, tags: 0, files: 0 }
    e.tags++
    perCorpus.set(c, e)
  }
  // occurrence counts are per-tag, attributed to each corpus the tag appears in
  for (const c of row.corpora) {
    const e = perCorpus.get(c)!
    e.occ += row.n
  }
}
for (const row of tags.values()) {
  const e0 = perCorpus.get([...row.corpora][0])
  if (e0) e0.files = Math.max(e0.files, 0)
}

console.log(`=== TAG SIDE: hyphenated element tags in HTML documents ===`)
console.log(`  ${occ} occurrences · ${tags.size} distinct tag names`)
const topCorpus = [...perCorpus.entries()].sort((a, b) => b[1].occ - a[1].occ)
console.log(`  ${"corpus".padEnd(22)}${"occurrences".padStart(11)}${"distinctTags".padStart(13)}`)
for (const [c, e] of topCorpus) console.log(`  ${c.padEnd(22)}${String(e.occ).padStart(11)}${String(e.tags).padStart(13)}`)

console.log(`\n=== DEFINE SIDE: customElements.define("<name>", …) in JS/TS ===`)
console.log(`  ${defined.size} distinct registered names`)
for (const [name, row] of [...defined.entries()].sort()) {
  console.log(`    ${name}   in ${[...row.corpora].join(",")}   e.g. ${row.samples[0]}`)
}

console.log(`\n=== THE JOIN — the number the ruling rests on ===`)
const joined: string[] = []
for (const [tag, row] of tags) if (defined.has(tag)) joined.push(tag)
console.log(`  hyphenated tags that ANY indexed js/ts file registers: ${joined.length}`)
for (const t of joined.slice(0, 20)) {
  const row = tags.get(t)!
  console.log(`    ${t}  (${row.n} occ in ${row.files.size} files)  defined in ${[...defined.get(t)!.files].map((f) => f.slice(CORPUS.length + 1)).slice(0, 2).join(", ")}`)
}
console.log(`\n  VERDICT INPUT: ${joined.length === 0 ? "0 of " + occ + " hyphenated-tag occurrences name a registered custom element" : joined.length + " of " + tags.size + " distinct tags ARE registered — an `instantiates` edge per tag is a real edge, not a fabrication"}`)
console.log(`  and every one of the ${occ} occurrences sits in one of these files:`)
const fileList: { file: string; tags: number; occ: number }[] = []
for (const row of tags.values()) for (const f of row.files) { const e = fileList.find((x) => x.file === f); if (e) e.tags++; else fileList.push({ file: f, tags: 1, occ: row.n }) }
fileList.sort((a, b) => b.occ - a.occ)
for (const f of fileList.slice(0, 12)) console.log(`    ${String(f.occ).padStart(5)} occ  ${String(f.tags).padStart(4)} tags   ${f.file.slice(CORPUS.length + 1)}`)
console.log(`  files carrying a hyphenated tag: ${fileList.length} of ${htmlParsed} parsed html documents`)
