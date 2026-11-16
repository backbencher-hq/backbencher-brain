// Review instrument (NOT a gate): classify the CSS lane's second-corpus parse
// failures into grammar limitation vs analyzer consequence.
//
//   bun script/m14/tmp/css-parse-classes.ts [--out <path>]
//
// Why this exists. The M12 manifest records `grammarErrorFiles: 14` for CSS and
// the corpus-claims gate H1 agrees 14==14, so the lane reads green — but that
// number is measured on `svelte`, which this lane's own measurement shows is
// CSS's EASIEST corpus (7.57%). A second independent corpus (`grails-core`)
// measures **29.32%**, with 3,418 ERROR nodes in one file. The W17 lesson is
// explicit that a one-corpus rate cannot distinguish "weak grammar" from "one
// unusual repository", and it was never run for CSS.
//
// So: per failing file, the FIRST error region's source line, classified into a
// NAMED class so the residue is a work list rather than a mood. Every class
// records the pinned grammar's verdict on a minimal reproduction, so a class
// that the grammar can actually represent is separated from one it cannot.

import { loadWebTreeSitter, Language, Parser } from "web-tree-sitter"
import { readFileSync, readdirSync, statSync } from "fs"
import { join } from "path"

const ROOT = "<corpus-root>/bb_tests/repositories"
const argv = process.argv.slice(2)
const OUT = argv[argv.indexOf("--out") + 1]
const REPOS = ["svelte", "grails-core"]

function walk(dir: string, out: string[], d = 0): void {
  if (d > 10) return
  let es: string[]
  try { es = readdirSync(dir) } catch { return }
  for (const e of es) {
    if (e === "node_modules" || e === ".git" || e === "target" || e === "dist") continue
    const p = join(dir, e)
    let st: import("fs").Stats
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out, d + 1)
    else if (e.endsWith(".css") && st.size > 0) out.push(p)
  }
}

/** Named classes. `grammarVerdict` is MEASURED per class below against the
 *  pinned wasm on a minimal reproduction, not asserted. */
const CLASSES: { id: string; match: (line: string, text: string) => boolean; note: string }[] = [
  { id: "spaced-equals-in-value", match: (l) => /=\s/.test(l) || /\s=/.test(l) || l.includes("progid:"), note: "A `name = value` pair in a DECLARATION VALUE position. NOT an IE hack: `css-residue-pinning.ts` reduces the 37-file `progid:` class to `X { foo: a = b; }` — the load-bearing character is the SPACE BEFORE `=`. `a=1` and `a= 1` both parse; `a = 1` does not. The 37 grails-core files are simply where the form is common (legacy `filter: progid:...gradient(startColorStr = '#aaa', …)`)." },
  { id: "attr-case-flag", match: (l) => /\[[^\]]*[\s'\"][is]\s*\]/.test(l), note: "`[attr value i]` / `[attr value s]` case-sensitivity flags (CSS Selectors 4)." },
  { id: "range-media-query", match: (l) => /@media[^{]*\((\d|\w)[^)]*(>=|<=|<|>)[^)]*\)/.test(l), note: "range media queries `@media (width >= 600px)` (Media Queries 4)." },
  { id: "named-container-query", match: (l) => /@container\s+[-\w]+\s*\(/.test(l), note: "named container queries `@container name (min-width: …)`." },
  { id: "page-pseudo", match: (l) => /@page\s+:[a-z-]+/.test(l), note: "`@page :left` / `@page :right` named pages (CSS Paged Media 3)." },
  { id: "html-comment", match: (l) => l.trim().startsWith("<!--") || l.includes("-->"), note: "legacy HTML comment wrappers in a stylesheet." },
  { id: "nesting-amp-forms", match: (l) => /&\s*&/.test(l) || /&[a-z-]+\s*\{/.test(l), note: "CSS nesting forms `& &`, `&&`, `&div`." },
  { id: "float-keyframe-step", match: (l) => /^\s*\d+\.\d+%\s*\{/.test(l), note: "fractional keyframe steps `33.3%`." },
  { id: "braces-in-string-value", match: (l) => /content:\s*["'][^"']*[{}[\];][^"']*["']/.test(l), note: "special characters inside a `content` string value." },
  { id: "double-semicolon", match: (l) => /;\s*;\s*$/.test(l), note: "a stray second `;` terminating a declaration." },
  { id: "unicode-escape-selector", match: (l) => /#\\\\/.test(l), note: "escaped unicode identifiers in a selector." },
  { id: "non-http-import-url", match: (l) => /@import[^;]*\b(chrome|about|data|moz-extension):/.test(l), note: "non-http `@import` URL schemes." },
  { id: "selectedcontent-pseudo", match: (l) => l.includes("::selectedcontent") || l.includes("::picker"), note: "`::selectedcontent` / `::picker(select)` (CSS Selectors 4)." },
  { id: "keyframes-from-to-keyword", match: (l) => /^\s*(from|to)\s*[,{]/.test(l), note: "a `from`/`to` keyframe selector (grammar-dependent)." },
  { id: "empty-custom-property-value", match: (l) => /--[\w-]+\s*:\s*;/.test(l), note: "an empty custom-property value `--foo: ;`." },
  { id: "unterminated-block", match: (_l, t) => t.includes("{") && !t.includes("}"), note: "an unterminated block — a SOURCE defect, not a grammar gap." },
]

async function main() {
  await Parser.init()
  const lang = await Language.load(readFileSync("wasm/tree-sitter-css.wasm"))

  // Per class, a minimal reproduction and the pinned grammar's verdict on it.
  const REPRO: Record<string, string> = {
    // The REAL corpus form (spaces around `=`), not the tight form: the tight one
    // parses clean, which is what refuted the first attribution of this class.
    "spaced-equals-in-value": "X { foo: a = b; }\n",
    "attr-case-flag": "p[type='B' i] { color: red; }\n",
    "range-media-query": "@media (width >= 600px) { .a { color: red; } }\n",
    "named-container-query": "@container test (min-width: 410px) { .a { color: red; } }\n",
    "page-pseudo": "@page :left { margin: 1in; }\n",
    "html-comment": "<!-- /* c */ -->\n.a { color: red; }\n",
    "nesting-amp-forms": ".a { & & { color: red; } }\n",
    "float-keyframe-step": "@keyframes f { 33.3% { color: yellow } }\n",
    "braces-in-string-value": ".a::after { content: \"{};[]\"; }\n",
    "double-semicolon": ".a { font-family: a, b;; }\n",
    "unicode-escape-selector": "#\\31 .x { color: red; }\n",
    "non-http-import-url": "@import url(chrome://communicator/skin/);\n",
    "selectedcontent-pseudo": "::selectedcontent { color: red; }\n",
    "keyframes-from-to-keyword": "@keyframes f { from { opacity: 0; } }\n",
    "empty-custom-property-value": ":root { --foo: ; }\n",
  }

  const grammarVerdict: Record<string, { parses: boolean; errorNodes: number }> = {}
  {
    const p = new Parser(); p.setLanguage(lang)
    for (const [id, src] of Object.entries(REPRO)) {
      const t = p.parse(src)
      let n = 0
      const w = (x: any) => { if (x.type === "ERROR") n++; for (let i = 0; i < x.namedChildCount; i++) { const c = x.namedChild(i); if (c) w(c) } }
      w(t.rootNode)
      // A `hasError` file with no ERROR node is the ZERO-WIDTH PHANTOM third
      // state (the groovy W21 finding): rootNode.hasError is still the criterion
      // and is still correct, but a named-children walk cannot see the cause, so
      // it is reported as its own state rather than folded into either count.
      grammarVerdict[id] = { parses: !t.rootNode.hasError, errorNodes: n, phantom: t.rootNode.hasError && n === 0 }
      t.delete?.()
    }
    p.delete?.()
  }

  const perRepo: any[] = []
  for (const repo of REPOS) {
    const p = new Parser(); p.setLanguage(lang)
    const files: string[] = []
    walk(join(ROOT, repo), files)
    files.sort()
    const byClass: Record<string, number> = {}
    const unclassified: { file: string; line: string }[] = []
    let failing = 0
    for (const f of files) {
      const text = readFileSync(f, "utf8")
      const t = p.parse(text)
      if (!t.rootNode.hasError) { t.delete?.(); continue }
      failing++
      // first ERROR node's first source line
      let firstLine = ""
      let found = false
      const w = (x: any): boolean => {
        if (found) return true
        if (x.type === "ERROR") {
          firstLine = (text.split("\n")[x.startPosition.row] ?? "").trim()
          found = true
          return true
        }
        for (let i = 0; i < x.namedChildCount; i++) { const c = x.namedChild(i); if (c && w(c)) return true }
        return false
      }
      w(t.rootNode)
      const hit = CLASSES.find((c) => c.match(firstLine, text))
      if (hit) byClass[hit.id] = (byClass[hit.id] ?? 0) + 1
      else unclassified.push({ file: f.replace(ROOT + "/", ""), line: firstLine.slice(0, 100) })
      t.delete?.()
    }
    p.delete?.()
    perRepo.push({
      repo, files: files.length, failingFiles: failing,
      failingPct: Math.round((failing / Math.max(1, files.length)) * 10000) / 100,
      byClass: Object.entries(byClass).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, files: n, note: CLASSES.find((c) => c.id === id)?.note, grammarVerdict: grammarVerdict[id] })),
      unclassifiedCount: unclassified.length,
      unclassified: unclassified.slice(0, 20),
    })
  }

  const artifact = {
    instrument: "css-parse-classes",
    purpose:
      "Classify the CSS lane's parse failures into named classes, each with the pinned grammar's MEASURED verdict on a minimal reproduction. Separates a grammar limitation (nothing to fix in the analyzer) from a source defect (not the analyzer's problem either) and from anything left over (unclassified — the only rows that are actionable).",
    wasm: "wasm/tree-sitter-css.wasm",
    grammarLimitations: Object.entries(grammarVerdict).filter(([, v]) => !v.parses).map(([id]) => ({ id, note: CLASSES.find((c) => c.id === id)?.note, ...grammarVerdict[id] })),
    zeroWidthPhantoms: Object.entries(grammarVerdict).filter(([, v]) => v.phantom).map(([id]) => ({ id, note: CLASSES.find((c) => c.id === id)?.note, why: "rootNode.hasError is true but a named-children walk finds no ERROR node — the criterion is still hasError, the cause is simply not visible to that walk." })),
    grammarAccepts: Object.entries(grammarVerdict).filter(([, v]) => v.parses).map(([id]) => ({ id, note: CLASSES.find((c) => c.id === id)?.note })),
    repos: perRepo,
  }
  const text = JSON.stringify(artifact, null, 2)
  if (OUT && OUT !== "undefined") { (await import("fs")).writeFileSync(OUT, text + "\n"); process.stderr.write(`wrote ${OUT}\n`) }
  console.log(text)
}
main().catch((e) => { console.error(e); process.exit(1) })
