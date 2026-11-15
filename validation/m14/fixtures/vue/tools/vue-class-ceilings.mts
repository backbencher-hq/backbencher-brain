/**
 * VUE'S THREE BIGGEST CLASSES, PRICED ON A BOUNDED SAMPLE — Laptop A's first four-clause attempt.
 *
 * Classes are taken from the gate's own marker table on vue's stride row, then traced to their EMISSION
 * SITES rather than inferred from the residual:
 *   `isComponentUsage`   real-vue-analyzer.ts:264-290 — `instantiates`, target is THE TAG AS WRITTEN
 *   `calleeExpression`   real-typescript-analyzer.ts:4658-4667 — delegated TS `calls`, target is the
 *                        callee LEAF, and the marker holds the FULL callee text (binding-resolution.ts
 *                        reads the RECEIVER out of it)
 *   `module` / `isTypeOnly+module` — module specifiers (a file-scoped class)
 *
 * WHAT EACH ARM ASKS
 *   component usage: does a `.vue` FILE with a matching stem exist (kebab/Pascal)?  -> file-claim route
 *                    and, separately, is the tag SVG MARKUP rather than a component?  -> fabricating
 *   calls:           does the callee have a RECEIVER (`a.b()`), and is it `this`?     -> owner route
 *   imports:         does the specifier name an admitted file?                        -> file-claim route
 *
 * A LOWER BOUND LABEL: this is a per-repo stride of 1,155 files. The gate's own note carries the pair
 * (0.4% sampled against 46.8% whole-corpus) for file-scoped quantities, so the population row is what
 * reports a lane number, and it is a lease run.
 *
 *   npx tsx validation/m14/fixtures/vue/tools/vue-class-ceilings.mts --files=200
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const N = Number((process.argv.find((a) => a.startsWith("--files=")) ?? "--files=200").split("=")[1])
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()
const pascal = (s: string) => s.split(/[-_]/).map((w) => w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)).join("")
// SVG filter primitives and other markup the renderer owns; a component it is not.
const SVG_MARKUP = new Set(["feFlood","feColorMatrix","feOffset","feGaussianBlur","feComposite","feBlend","feMerge","feMergeNode","feTurbulence","feDisplacementMap","feDropShadow","feImage","feMorphology","feTile","foreignObject","linearGradient","radialGradient","clipPath","mask","pattern","marker","symbol","use","textPath","animate","animateTransform","filter","stop"])
const HTML_MARKUP = new Set(["div","span","p","a","ul","li","ol","table","thead","tbody","tr","td","th","button","input","form","label","select","option","img","svg","path","g","h1","h2","h3","h4","h5","h6","section","header","footer","nav","main","aside","article","pre","code","em","strong","small","br","hr","template","slot"])

let files = 0, population = 0
const usage = { edges: 0, stemHit: 0, svgMarkup: 0, htmlMarkup: 0, library: 0, other: 0 }
const calls = { edges: 0, withReceiver: 0, thisReceiver: 0, noReceiver: 0 }
const imports = { edges: 0, fileHit: 0, notFound: 0 }
const libTags = new Map<string, number>()
const otherTags = new Map<string, number>()
const callTargets = new Map<string, number>()

for (const name of readdirSync(CR).sort()) {
  const repo = path.join(CR, name)
  try { if (!statSync(repo).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", repo, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", repo, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  const wanted: string[] = []
  const stems = new Set<string>()
  const admitted = new Set<string>()
  for (const rel of tracked) {
    const posix = rel.split("/").join("/")
    const ext = rel.slice(rel.lastIndexOf(".") + 1).toLowerCase()
    const abs = path.join(repo, rel)
    let st: any
    try { st = statSync(abs) } catch { continue }
    if (st.size > SIZE_CAP) continue
    admitted.add(posix)
    if (ext !== "vue") continue
    const base = rel.slice(rel.lastIndexOf("/") + 1, rel.length - 4)
    stems.add(base); stems.add(kebab(base)); stems.add(pascal(base))
    wanted.push(abs)
  }
  if (wanted.length === 0) continue
  population += wanted.length
  wanted.sort()
  let pick = wanted
  if (N > 0 && pick.length > N) {
    const stride = pick.length / N
    const sel: string[] = []
    for (let i = 0; i < N; i++) sel.push(pick[Math.floor(i * stride)])
    pick = [...new Set(sel)].sort()
  }
  for (const abs of pick) {
    files++
    const rel = path.relative(repo, abs).split(path.sep).join("/")
    let res: any
    try { res = await parseFile(abs, repo, { projectRoot: repo } as any) } catch { continue }
    for (const r of res.relationships ?? []) {
      const md = (r.metadata ?? {}) as any
      const t = String(r.target ?? "")
      if (md.isComponentUsage === true) {
        usage.edges++
        if (stems.has(t) || stems.has(kebab(t)) || stems.has(pascal(t))) usage.stemHit++
        else if (SVG_MARKUP.has(t)) usage.svgMarkup++
        else if (HTML_MARKUP.has(t)) usage.htmlMarkup++
        else if (/^[a-z]+-[a-z-]+$/.test(t)) { usage.library++; libTags.set(t, (libTags.get(t) ?? 0) + 1) }
        else { usage.other++; otherTags.set(t, (otherTags.get(t) ?? 0) + 1) }
        continue
      }
      if (String(r.type) === "calls" && typeof md.calleeExpression === "string") {
        calls.edges++
        const full = String(md.calleeExpression)
        if (full.includes(".")) { calls.withReceiver++; if (full.startsWith("this.")) calls.thisReceiver++ }
        else { calls.noReceiver++; callTargets.set(t, (callTargets.get(t) ?? 0) + 1) }
        continue
      }
      if (String(r.type) === "imports" && md.sfcDelegated === true) {
        imports.edges++
        const cand = t.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(rel), t)) : t
        if (admitted.has(cand) || admitted.has(t)) imports.fileHit++
        else imports.notFound++
      }
    }
  }
}
const p = (n: number, d: number) => d > 0 ? `${((100 * n) / d).toFixed(1)}%` : "-"
console.log(`vue CLASS CEILINGS — SAMPLE ${files}/${population} .vue files (LOWER BOUND)`)
console.log(`\nISCOMPONENTUSAGE ${usage.edges} edges:`)
console.log(`  component FILE with a matching stem  ${usage.stemHit} (${p(usage.stemHit, usage.edges)})  <- file-claim route`)
console.log(`  SVG MARKUP tag (not a component)     ${usage.svgMarkup} (${p(usage.svgMarkup, usage.edges)})  <- FABRICATED class`)
console.log(`  HTML MARKUP tag                      ${usage.htmlMarkup} (${p(usage.htmlMarkup, usage.edges)})`)
console.log(`  library component (kebab, no stem)   ${usage.library} (${p(usage.library, usage.edges)})`)
console.log(`  other                                ${usage.other} (${p(usage.other, usage.edges)})`)
console.log(`  top library tags: ${[...libTags].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>`${k}×${v}`).join("  ")}`)
console.log(`  top other tags:   ${[...otherTags].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>`${k}×${v}`).join("  ")}`)
console.log(`\nCALLS with calleeExpression ${calls.edges} edges:`)
console.log(`  ${calls.withReceiver} with a RECEIVER · ${calls.thisReceiver} of those are \`this.\` · ${calls.noReceiver} bare`)
console.log(`  top bare callees: ${[...callTargets].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>`${k}×${v}`).join("  ")}`)
console.log(`\nDELEGATED IMPORTS ${imports.edges} edges: ${imports.fileHit} name an admitted file · ${imports.notFound} do not`)
