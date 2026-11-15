// Review instrument (NOT a gate): dump the exact tree for the two constructs
// whose analyzer behaviour the probe battery could not explain, so the review
// states a ROOT CAUSE rather than a symptom.
//
//   bun script/m14/tmp/css-rootcause.ts

import { loadWebTreeSitter, Language, Parser } from "web-tree-sitter"
import { readFileSync } from "fs"

const CASES: { label: string; src: string }[] = [
  { label: "@supports (display: grid)", src: "@supports (display: grid) { .a { display: grid; } }\n" },
  { label: "@supports selector(:has(a))", src: "@supports selector(:has(a)) { .a { color: red; } }\n" },
  { label: "@media not print", src: "@media not print { .a { color: red; } }\n" },
  { label: "@media selector(.a)", src: "@media selector(.a) { .b { color: red; } }\n" },
  { label: "@media (max-width: 700px)", src: "@media (max-width: 700px) { .a { color: red; } }\n" },
  { label: "@container (min-width: 400px)", src: "@container (min-width: 400px) { .a { color: red; } }\n" },
  { label: "@keyframes \"fade\"", src: "@keyframes \"fade\" { from { opacity: 0; } to { opacity: 1; } }\n" },
  { label: ".a { & { color: red } }", src: ".a { & { color: red; } }\n" },
  { label: ".a { composes: b; }", src: ".a { composes: b; }\n" },
  { label: ".a [href] { color: red }", src: ".a [href] { color: red; }\n" },
]

async function main() {
  await Parser.init()
  const lang = await Language.load(readFileSync("wasm/tree-sitter-css.wasm"))
  const p = new Parser()
  p.setLanguage(lang)

  // Reproduce the analyzer's own findChild predicates exactly.
  const child = (n: any, i: number) => n.child(i)
  const findChild = (n: any, pred: (c: any) => boolean): any => {
    for (let i = 0; i < n.childCount; i++) {
      const c = child(n, i)
      if (c && pred(c)) return c
    }
    return null
  }

  for (const c of CASES) {
    const tree = p.parse(c.src)
    console.log(`\n${"=".repeat(78)}\n${c.label}\n  src: ${JSON.stringify(c.src)}`)
    const dump = (n: any, d = 0) => {
      const ind = "  ".repeat(d + 1)
      const named = n.isNamed ? "" : " (anonymous)"
      const miss = n.isMissing ? " MISSING" : ""
      console.log(`${ind}${n.type}${named}${miss}  ${JSON.stringify(n.text.length > 46 ? n.text.slice(0, 46) + "…" : n.text)}`)
      if (d < 5) for (let i = 0; i < n.childCount; i++) { const k = n.child(i); if (k) dump(k, d + 1) }
    }
    dump(tree.rootNode)

    // Now ask: what do the analyzer's two literal findChild predicates select?
    // INSTRUMENT CORRECTION: the analyzer calls findChild ON THE STATEMENT NODE,
    // not on the stylesheet root. The first version of this instrument searched
    // from the root and so reported `processMedia -> NULL` even for the shapes
    // that DO work — a wrong instrument makes every number it produces
    // meaningless.
    const findNamed = (n: any, ty: string): any => {
      let hit: any = null
      const w = (x: any) => {
        if (hit) return
        if (x.type === ty) { hit = x; return }
        for (let i = 0; i < x.namedChildCount; i++) { const k = x.namedChild(i); if (k) w(k) }
      }
      w(n)
      return hit
    }
    const root0 = tree.rootNode
    const stmt = findNamed(root0, "media_statement") || findNamed(root0, "at_rule")
    const mediaNode = stmt ?? root0
    const mediaQ = findChild(mediaNode, (k: any) => k && (k.type === "media_query_list" || k.type === "keyword_query" || k.type === "binary_query" || k.type === "feature_query" || k.type === "parenthesized_query"))
    console.log(`  from node: ${mediaNode.type} = ${JSON.stringify(mediaNode.text.slice(0, 40))}`)
    console.log(`  processMedia findChild -> ${mediaQ ? `${mediaQ.type} = ${JSON.stringify(mediaQ.text.slice(0, 50))}` : "NULL  <-- SCOPE LOST"}`)
    const miss: string[] = []
    const w2 = (x: any) => {
      if (x.type === "unary_query" || x.type === "selector_query") miss.push(`${x.type}=${JSON.stringify(x.text.slice(0, 30))}`)
      for (let i = 0; i < x.namedChildCount; i++) { const k = x.namedChild(i); if (k) w2(k) }
    }
    w2(root0)
    if (miss.length) console.log(`  grammar shapes the literal union MISSES: ${miss.join(" | ")}`)
    const supNode = findNamed(root0, "supports_statement")
    const sup = supNode ? findChild(supNode, (k: any) => k && k.type !== "at_keyword" && k.type !== "block") : null
    console.log(`  processSupports findChild(from supports_statement) -> ${sup ? `${sup.type}${sup.isNamed ? "" : " (ANONYMOUS)"} = ${JSON.stringify(sup.text.slice(0, 50))}` : "NULL"}`)
    tree.delete?.()
  }
  p.delete?.()
}
main().catch((e) => { console.error(e); process.exit(1) })
