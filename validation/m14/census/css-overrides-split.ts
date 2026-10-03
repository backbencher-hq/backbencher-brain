/**
 * M14 ONTOLOGY — CSS `overrides`: does the 146 replacement-shaped redefinition count
 * survive the question the aggregate count cannot answer?
 *
 * ## Why this second measurement exists
 *
 * `css-ontology-probe.ts` counted 146 second declarations of an already-declared
 * `@keyframes` name in one file, across 33 files. That aggregate cannot decide the
 * type, because a *prefixed pair* is not a redefinition: Font Awesome ships
 * `@-webkit-keyframes fa-spin` beside `@keyframes fa-spin`, those are two animations
 * and the user agent picks the one it implements, and calling the second an override
 * would be a fabricated edge. This file is the measurement that can decide it, by
 * comparing ADJACENT declarations of one name in document order:
 *
 *   1. SAME KEYWORD, twice — `@keyframes fade` and `@keyframes fade`. CSS Animations
 *      L1 §3: the last one wins, the earlier is dead. An override.
 *   2. DIFFERENT KEYWORD — `@keyframes fade` after `@-webkit-keyframes fade`. Not an
 *      override.
 *
 * AND A CORRECTION, because this file's own first version was wrong in the direction
 * that makes a ruling look better than it is. It bucketed a whole NAME-GROUP by whether
 * the group mentioned more than one keyword, so `v-modal-in` in
 * vue-element-admin/src/assets/custom-theme/index.css — spelled three times, once
 * prefixed and twice not — landed in "cross-keyword" on the strength of its first pair
 * and its genuine redefinition was never counted. It reported **1** genuine
 * redefinition in 1,114 files. The correct count is **4**, in 2 files, and the
 * production `parseFile` census agrees at 4. The instrument, not the language, was
 * what was short.
 *
 * ## READ-ONLY. Prints and optionally writes one JSON document.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

const files: { repo: string; rel: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      if (statSync(abs).size === 0) continue
      if (detectLanguageFromPath(abs) !== "css") continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    files.push({ repo: e, rel, text })
  }
}
files.sort((a, b) => (a.repo + a.rel < b.repo + b.rel ? -1 : 1))

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-css.wasm"))))

type Decl = { keyword: string; name: string; line: number; scope: string }
const perFile: { label: string; decls: Decl[] }[] = []
for (const f of files) {
  const t = parser.parse(f.text)
  if (!t) continue
  const label = `${f.repo}/${f.rel}`
  const decls: Decl[] = []
  const walk = (n: any, scope: string[]): void => {
    let next = scope
    if (n.type === "keyframes_statement") {
      const kw = n.namedChildren?.find((c: any) => c.type === "at_keyword")
      // `keyframes_statement` opens with either the anonymous `@keyframes` token or
      // an `at_keyword` aliased from /@[-a-z]+keyframes/, so the vendor prefix is
      // readable ONLY from the at_keyword child. Both spellings are recorded.
      const keyword = kw ? String(kw.text).trim().toLowerCase() : "@keyframes"
      const nm = n.namedChildren?.find(
        (c: any) => c.type === "keyframes_name" || c.type === "identifier" || c.type === "string_value",
      )
      if (nm) {
        decls.push({
          keyword,
          name: String(nm.text).trim().replace(/^["']|["']$/g, ""),
          line: n.startPosition.row + 1,
          scope: scope.join(" > "),
        })
      }
    }
    if (
      n.type === "at_rule" || n.type === "media_statement" || n.type === "supports_statement" ||
      n.type === "scope_statement" || n.type === "layer_statement"
    ) {
      const text = n.text.replace(/\s+/g, " ").trim()
      const head = text.split(/[{;]/)[0].slice(0, 40)
      next = [...scope, head]
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) walk(c, next)
    }
  }
  walk(t.rootNode, [])
  if (decls.length > 0) perFile.push({ label, decls })
}

// ---- classify ---------------------------------------------------------------
//
// PAIRWISE, and the first version of this file was not — which is why its numbers are
// recorded here as a correction rather than deleted. It bucketed a whole NAME-GROUP by
// whether the group mentioned more than one keyword, so `v-modal-in` in
// vue-element-admin/src/assets/custom-theme/index.css — which is
// `@-webkit-keyframes v-modal-in`, `@keyframes v-modal-in`, `@keyframes v-modal-in` —
// landed in "cross-keyword" on the strength of the first pair and its genuine
// same-keyword redefinition was never counted. That reported 1 genuine redefinition
// in 1,114 files where there are 4, and it undercounted in the direction that makes a
// ruling look SOUNDER than it is.
//
// The correct question is adjacent pairs: CSS Animations L1 §3 makes the LAST
// declaration of a name the live one, so whether a declaration overrides something is
// decided against the declaration it replaces, not against the group as a whole.
// Walking each name's declarations in document order and comparing each to the one
// before it is therefore the measurement the analyzer's own rule makes, and the two
// counts then agree by construction rather than by luck.
type Bucket = { count: number; files: Set<string>; examples: string[] }
const bucket = (b: Record<string, Bucket>, k: string): Bucket =>
  (b[k] ??= { count: 0, files: new Set<string>(), examples: [] })
type BucketKey = "same-keyword" | "cross-keyword"
const buckets: Record<string, Bucket> = {}

for (const { label, decls } of perFile) {
  const byName = new Map<string, Decl[]>()
  for (const d of decls) {
    const list = byName.get(d.name) ?? []
    list.push(d)
    byName.set(d.name, list)
  }
  for (const [, list] of byName) {
    if (list.length < 2) continue
    for (let i = 1; i < list.length; i++) {
      const key: BucketKey = list[i].keyword === list[i - 1].keyword ? "same-keyword" : "cross-keyword"
      const row = bucket(buckets, key)
      row.count++
      row.files.add(label)
      if (row.examples.length < 8) {
        row.examples.push(
          `${label}: [${list[i - 1].keyword} ${list[i - 1].name} L${list[i - 1].line}] then [${list[i].keyword} ${list[i].name} L${list[i].line}]`,
        )
      }
    }
  }
}

const total = Object.values(buckets).reduce((a, b) => a + b.count, 0)
const report = {
  tool: "css-overrides-split",
  corpusRoot: CR,
  files: files.length,
  filesWithKeyframes: perFile.length,
  distinctKeyframesNames: perFile.reduce((a, p) => a + new Set(p.decls.map((d) => d.name)).size, 0),
  keyframesDeclarations: perFile.reduce((a, p) => a + p.decls.length, 0),
  totalSecondDeclarations: total,
  buckets,
}
const jsonArg = process.argv.indexOf("--json")
if (jsonArg !== -1 && process.argv[jsonArg + 1]) writeFileSync(process.argv[jsonArg + 1], JSON.stringify(report, null, 2) + "\n")

const w = (s: string, n: number): string => (s + " ".repeat(n)).slice(0, n)
console.log(`css overrides split — same-name @keyframes re-declarations, separated by WHY they repeat`)
console.log(`corpus ${files.length} files; ${perFile.length} carry at least one @keyframes; ${report.keyframesDeclarations} declarations of ${report.distinctKeyframesNames} distinct names`)
console.log(`second declarations of an already-declared name: ${total}`)
console.log("")
for (const [k, v] of Object.entries(buckets)) {
  console.log(`  ${w(k, 34)}${String(v.count).padStart(5)}  in ${v.files.size} files`)
  for (const e of v.examples) console.log(`${" ".repeat(41)}e.g. ${e}`)
}
if (total === 0) console.log(`  (no bucket fired: no file declares one @keyframes name twice)`)