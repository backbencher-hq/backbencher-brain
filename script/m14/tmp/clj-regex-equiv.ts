// CLJ-D4 — the clojure lane's LAST regex, proved equivalent before it is gone.
//
// `/^%(\d+|&)?$/` decides whether an `anon_fn_lit`'s head symbol is one of
// Clojure's anonymous-argument shorthands (`%`, `%1`..`%N`, `%&`) — a
// PARAMETER reference, never a callee. `reviews/regex-policy.md` registered
// it as the lane's only `needs_review` row with the note "mechanically
// convertible to a structural symbol-name check".
//
// This probe is that conversion's PROOF, not its claim. It runs the regex and
// the char scan over:
//   1. every `sym_lit` NAME the corpora actually contain (4,900+ files), and
//   2. an adversarial battery of near-miss strings (empty, lone `%`, `%&x`,
//      `%%`, `%a`, `%0`, `%00`, `%999999999`, unicode digits, whitespace),
// and reports every disagreement. 0 mismatches is the evidence the R2 census
// drop and the policy-doc row removal are safe.
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"

// The replacement, written exactly as it lands in the analyzer.
const isAnonArgShorthand = (s: string): boolean => {
  if (s.length === 0) return false
  if (s.charCodeAt(0) !== 37) return false // '%'
  if (s.length === 1) return true          // "%"
  const c1 = s.charCodeAt(1)
  if (c1 === 38) return s.length === 2     // "%&" exactly
  if (c1 < 48 || c1 > 57) return false     // then digits only
  for (let i = 2; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  return true
}

const ADVERSARIAL = [
  "", "%", "%&", "%%", "%&x", "%%1", "%a", "%0", "%00", "%1", "%9", "%10",
  "%99", "%999999999", "%-1", "%+1", "% 1", "% ", " %", "%1 ", "%1\t", "%1\n",
  "%１", "%٣", "map", "%map", "a%", "%%&", "%&%", "%0a", "%1a", "%a1", "%!",
  "%*", "%.", "%/", "%:", "%%1%", "%12345678901234567890", "%%&1",
]

async function main() {
  const engine: any = await import(path.join(ROOT, "src/ast/engine.ts"))
  const parser = await engine.ASTEngine.getParser("clojure")

  const repos = (process.argv[2] ?? "clojure,clj-kondo,core.async").split(",")
  const names = new Set<string>(ADVERSARIAL)
  let filesChecked = 0, symsChecked = 0
  for (const repo of repos) {
    const dir = path.join(CORPUS_ROOT, repo)
    let tracked: string[] = []
    try { tracked = execSync(`git -C ${JSON.stringify(dir)} ls-files`, { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean) } catch { continue }
    for (const f of tracked.filter(f => /\.(clj|cljc|cljs)$/i.test(f))) {
      let content: string
      try { content = readFileSync(path.join(dir, f), "utf8") } catch { continue }
      if (content.length > 400_000) continue
      let root: any
      try { root = parser.parse(content).rootNode } catch { continue }
      filesChecked++
      const st: any[] = [root]
      while (st.length > 0) {
        const n = st.pop()!
        if (n.type === "sym_lit") { const nm = n.childForFieldName("name"); names.add(nm ? nm.text : n.text); symsChecked++ }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
      }
    }
  }

  let mismatches = 0
  for (const s of names) {
    const a = /^%(\d+|&)?$/.test(s)
    const b = isAnonArgShorthand(s)
    if (a !== b) { mismatches++; console.log(`MISMATCH ${JSON.stringify(s)}: regex=${a} scan=${b}`) }
  }
  const short = [...names].filter(s => isAnonArgShorthand(s)).sort()
  console.log(`corpora: ${repos.join(",")} — ${filesChecked} files, ${symsChecked} sym_lit nodes`)
  console.log(`distinct symbol names tested (corpus + adversarial): ${names.size}`)
  console.log(`accepted as an anon-arg shorthand: ${short.length} — ${short.join(" ")}`)
  console.log(`MISMATCHES: ${mismatches}`)
  if (mismatches > 0) process.exit(1)
  console.log("EQUIVALENT — the regex can be removed with the scan as its replacement")
}

main().catch((e) => { console.error(e); process.exit(1) })
