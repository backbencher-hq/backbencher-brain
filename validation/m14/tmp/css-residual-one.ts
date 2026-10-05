/**
 * SINGLE-FILE EVIDENCE for the `:has()` case cited in `selectorGroupKey`'s comment.
 *
 * `validation/m14/census/css-emitted-coverage.ts` explains that the analyzer NORMALISES a
 * selector group before publishing it, and cites `pico/css/pico.classless.indigo.min.css` as
 * the case where the normalisation lands INSIDE a nested functional. This prints both sides
 * for that one file so the citation can be checked rather than taken on trust.
 *
 * The larger probe is `validation/m14/tmp/css-contains-endpoints.ts`; this exists because that
 * one prints only the published side of a match, which is enough to find the case and not
 * enough to show the grammar side of it.
 *
 * PRODUCTION parseFile. Zero regular expressions.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const p = new WSP()
p.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-css.wasm"))))
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const F = `${CR}/pico/css/pico.classless.indigo.min.css`
const text = readFileSync(F, "utf8")
const r: any = await parseFile(F, "css")
const t = p.parse(text)
const raw: string[] = []
const walk = (n: any): void => {
  const kn: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) kn.push(c) }
  if (n.type === "rule_set") {
    for (const c of kn) if (c.type === "selectors") { raw.push(c.text); break }
  }
  for (const c of kn) walk(c)
}
walk(t.rootNode)
const tg: string[] = []
for (const rel of r.relationships) {
  const md = rel.metadata ?? {}
  if (rel.type === "contains" && ["isMediaScope","isSupportsScope","isLayerScope","isContainerScope","isScopeScope"].some(k => md[k] === true)) tg.push(String(rel.target))
}
console.log("grammar rule_set selectors nodes:", raw.length, " published scope edges:", tg.length)
console.log("\n--- grammar selector node TEXTS containing ':has(' (first 4) ---")
let shown = 0
for (const s of raw) {
  if (s.indexOf(":has(") < 0) continue
  console.log(JSON.stringify(s.slice(0, 240)))
  if (++shown >= 4) break
}
console.log("\n--- published targets containing ':has(' (first 4) ---")
shown = 0
for (const s of tg) {
  if (s.indexOf(":has(") < 0) continue
  console.log(JSON.stringify(s.slice(0, 240)))
  if (++shown >= 4) break
}
console.log("\n--- do the two sets contain the same ':has(' strings? ---")
const rawHas = raw.filter(s => s.indexOf(":has(") >= 0)
const tgtHas = tg.filter(s => s.indexOf(":has(") >= 0)
console.log("grammar:", rawHas.length, " published:", tgtHas.length)
for (const s of tgtHas) {
  const strip = (t: string): string => { let o = ""; for (const c of t) { if (c !== " ") o += c } return o }
  const hit = raw.find(r => strip(r) === strip(s))
  console.log("  matchIgnoringSpaces:", hit !== undefined, JSON.stringify(s.slice(0, 100)))
}
