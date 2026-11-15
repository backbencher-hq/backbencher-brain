/** The lane documented this gap as "cargo's str![[...]] double-bracket delimiter
 *  syntax". That is wrong. `str![...]` fails with EITHER bracket count, while
 *  `Str![...]`, `xstr![...]`, `vec![...]` all parse: `str` lexes as the PRIMITIVE
 *  TYPE keyword in tree-sitter-rust, so it can never be a macro name. `str!` is the
 *  single most common macro in modern cargo code, so this one token costs a third
 *  of the lane's audited edges. The repair is same-length and therefore
 *  offset-preserving: `str!` -> `Str!` are both 3 characters. */
import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = "/home/sano/ishaq/backbencher-brain"
const CORPUS = "/home/sano/ishaq/bb_rust_corpora"
// same-length, and only where `str` really is the macro name (followed by `!`)
// TWO same-length substitutions, applied in this order:
//   1. `str!` -> `Str!`  (3 chars either way) — the keyword collision, which is the
//      real cause; the lane had documented this gap as double-bracket syntax.
//   2. the CLOSE of a double-bracket macro: `]]` -> `] ` (2 chars either way),
//      bracket-matched forward from each `Str![[`. The open needs no change because
//      step 1 already made it `Str![` at exactly the same width.
const rewrite = (t: string): string => {
  let out = t.replace(/\bstr!/g, "Str!")
  let n = 0
  for (;;) {
    const open = out.indexOf("Str![[")
    if (open < 0) break
    let depth = 1, j = open + 5
    for (; j < out.length && depth > 0; j++) {
      const c = out[j]
      if (c === "[") depth++
      else if (c === "]") { depth--; if (depth === 0) { if (out[j + 1] === "]") { out = out.slice(0, j) + "] " + out.slice(j + 2); n++ } break } }
    }
    // one pass is not enough for nesting, but each rewrite removes the marker, so
    // re-scanning from the same place would loop; advance past what we just handled
    const next = out.indexOf("Str![[", open + 5)
    if (next < 0) break
    if (j === open + 5) break
  }
  return out
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts, L = wts.Language ?? (wts.default as any)?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-rust.wasm")))
  const p = new P(); p.setLanguage(g)
  const files: string[] = []
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if ([".git", "target", "node_modules", "vendor"].includes(e.name)) continue; const q = path.join(d, e.name); if (e.isDirectory()) walk(q); else if (e.name.endsWith(".rs")) files.push(q) } }
  for (const r of ["cargo", "tokio", "serde", "hyper", "ripgrep"]) walk(path.join(CORPUS, r))
  let usesStr = 0, errB = 0, errA = 0, fixed = 0, lengthDrift = 0
  const fixedEx: string[] = [], stillEx: string[] = []
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8")
    if (!/\bstr!/.test(text)) continue
    usesStr++
    const out = rewrite(text)
    if (out.length !== text.length) { lengthDrift++; continue }
    const t1 = p.parse(text); const e1 = t1.rootNode.hasError; (t1 as any).delete?.()
    const t2 = p.parse(out); const e2 = t2.rootNode.hasError; (t2 as any).delete?.()
    if (e1) errB++
    if (e2) { errA++; if (stillEx.length < 5) stillEx.push(path.relative(CORPUS, f)) }
    else if (e1) { fixed++; if (fixedEx.length < 6) fixedEx.push(`${path.relative(CORPUS, f)}  (${(text.match(/\bstr!/g) ?? []).length} site(s))`) }
  }
  console.log(`\n#### the real cause: \`str\` is a primitive-type keyword, so \`str!\` cannot parse`)
  console.log(`   files scanned:                          ${files.length}`)
  console.log(`   files using str!:                       ${usesStr}`)
  console.log(`   rewrites that changed length:            ${lengthDrift}   (str! -> Str! is 3 chars either way)`)
  console.log(`   files with a parse error BEFORE:         ${errB}`)
  console.log(`   files with a parse error AFTER:          ${errA}`)
  console.log(`   files FIXED by the same-length rewrite:  ${fixed}`)
  for (const e of fixedEx) console.log(`      fixed: ${e}`)
  for (const e of stillEx) console.log(`      still error: ${e}`)
}
main().catch((e) => { console.error("ERR", String(e).slice(0, 180)); process.exit(1) })
