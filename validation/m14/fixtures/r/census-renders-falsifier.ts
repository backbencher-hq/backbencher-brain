/**
 * THE RENDERS CENSUS — the render-host construct, counted over the whole admitted population.
 *
 * The `renders` contract is "a component RENDERS another component" — measured population
 * in the fleet: TSX/JSX, Svelte template tags, csharp's type-argument on a render host,
 * dart's `build` method returning a Widget. The R question is whether the language HAS a
 * component model that names a rendered component, and the candidate is Shiny: a Shiny app
 * composes a UI from output widgets (`plotOutput('plot')` inside `shinyUI(basicPage(...))`)
 * wired to render functions (`output$plot <- renderPlot({...})`).
 *
 * This census counts, over the whole admitted population, the gate's admission rule:
 *   - `*Output(...)` UI widget call sites (the rendered COMPONENT the UI names);
 *   - `output$X <- renderY(...)` assignment sites (the render function wiring);
 *   - `renderY(...)` call sites;
 *   - `shinyUI`/`basicPage`/`fluidPage`/`pageWithSidebar`/`navbarPage`/`shinyApp` sites
 *     (the component-model containers).
 * Counted by CHARACTER CODE on the callee name's shape (camelCase prefix/suffix test),
 * never a regex literal — consistent with the fleet's no-regex rule.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { ASTEngine } from "../../../../src/ast/engine"

const T0 = Date.now()
const CR = process.env.BB_CORPUS_ROOT ?? ".corpus"
const EXTS = ["r"]
const SIZE_CAP = 1024 * 1024
function admit(rel: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (EXTS.some((e) => low.endsWith(`.${e}`))) return true
  return EXTS.some((e) => base === e) && detectLanguageFromPath(rel) === "r"
}
interface Admitted { repo: string; rel: string; abs: string }
const admitted: Admitted[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[] = []
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!admit(rel)) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    admitted.push({ repo: e, rel, abs })
  }
}
admitted.sort((a, b) => a.abs.localeCompare(b.abs))
const digest = createHash("sha256").update(admitted.map((c) => c.abs).join("\n")).digest("hex")

function isUpper(c: number) { return c >= 65 && c <= 90 }
function isAlpha(c: number) { return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) }
/** `renderY` / `renderUI` style prefix, or an `xOutput` suffix, by character codes. */
function shapeOf(name: string): "render" | "output" | "container" | "none" {
  // `renderY` and `xOutput` are the two Shiny camelCase families. The boundary capital IS
  // the family letter itself (`render` + `Plot`, `plot` + `Output`), so no additional
  // uppercase test is required — the first version demanded one at position len-7 and
  // read `plotOutput` (the corpus's own spelling) as "none", turning a measured 5 into 0.
  if (name.length > 6 && name.slice(0, 6) === "render" && isUpper(name.charCodeAt(6))) return "render"
  if (name.length > 6 && name.slice(name.length - 6) === "Output") return "output"
  if (["shinyUI", "basicPage", "fluidPage", "pageWithSidebar", "navbarPage", "shinyApp", "fillPage", "bootstrapPage"].includes(name)) return "container"
  return "none"
}

let parsed = 0, failures = 0
const counts = { render: 0, output: 0, container: 0 }
const outputSites: string[] = []
const renderSites: string[] = []
const wireSites: string[] = []  // output$X <- renderY(...)
const filesWith: Set<string> = new Set()
const outputArgShapes = { stringId: 0, identifierSymbol: 0, noArgument: 0, other: 0 }
const TRAP_ATTEMPTS = 3

async function walkOne(f: Admitted) {
  const key = `${f.repo}/${f.rel}`
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { failures++; return }
  let tree: any = null
  for (let attempt = 1; attempt <= TRAP_ATTEMPTS && !tree; attempt++) {
    try { const r: any = await ASTEngine.parseTree(f.abs, text); tree = r?.tree ?? null } catch { if (attempt === TRAP_ATTEMPTS) failures++ }
  }
  if (!tree) return
  parsed++
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop(); if (!n) continue
    if (n.type === "binary_operator") {
      const op = n.childForFieldName("operator")?.text
      if (op === "<-") {
        const rhs = n.childForFieldName("rhs")
        if (rhs?.type === "call") {
          const fn = rhs.namedChild?.(0)
          const nm = fn?.type === "identifier" ? fn.text : (fn?.type === "namespace_operator" ? fn.namedChild?.(1)?.text : "")
          if (shapeOf(String(nm)) === "render") {
            // the LHS must be output$X (extract_operator)
            const lhs = n.childForFieldName("lhs")
            const lh = lhs?.type === "extract_operator" ? lhs.childForFieldName("lhs")?.text : lhs?.text
            if (String(lh) === "output") { wireSites.push(key); filesWith.add(key) }
          }
        }
      }
    }
    if (n.type === "call") {
      const fn = n.namedChild?.(0)
      const nm = String(fn?.type === "identifier" ? fn.text : (fn?.type === "namespace_operator" ? fn.namedChild?.(1)?.text : ""))
      const sh = shapeOf(nm)
      if (sh === "render") { counts.render++; renderSites.push(`${key}: ${nm}`); filesWith.add(key) }
      else if (sh === "output") {
        counts.output++; outputSites.push(`${key}: ${nm}`); filesWith.add(key)
        // THE DISCRIMINATOR (the csharp render-host test): does the widget NAME A COMPONENT?
        // A string argument is an OUTPUT ID the server wires at runtime (`output$plot <-
        // renderPlot(...)`); an identifier would be a component symbol, the thing a renders
        // row needs as its target. Counted so the ruling's decisive number is in the artifact.
        const args = n.namedChild?.(1)
        let first: any = null
        for (let i = 0; i < (args?.namedChildCount ?? 0); i++) {
          const a = args.namedChild(i)
          if (!a || a.type === "comma") continue
          if (a.type === "argument") { if (!a.childForFieldName("name")) first = a.childForFieldName("value"); break }
          first = a; break
        }
        if (!first) outputArgShapes.noArgument++
        else if (first.type === "string") outputArgShapes.stringId++
        else if (first.type === "identifier") outputArgShapes.identifierSymbol++
        else outputArgShapes.other++
      }
      else if (sh === "container") { counts.container++; filesWith.add(key) }
    }
    for (let i = (n.namedChildCount ?? 0) - 1; i >= 0; i--) { const ch = n.namedChild(i); if (ch) stack.push(ch) }
  }
  try { tree.delete?.() } catch {}
}
let cur = 0
const WORKERS = Number(process.env.BB_R_WORKERS ?? "4")
async function worker() { while (cur < admitted.length) { const i = cur++; await walkOne(admitted[i]) } }
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

const out: string[] = []
const line = "=".repeat(78)
out.push(line)
out.push("RENDERS CENSUS — the Shiny component model's construct sites, whole admitted R population")
out.push(line)
out.push(`corpus root: ${CR}`)
out.push(`admission: the GATE's predicate — .${EXTS.join(", .")} + bare basename clause, SIZE_CAP ${SIZE_CAP} B`)
out.push(`admitted files [0,${admitted.length}) of ${admitted.length}`)
out.push(`corpus file set: sha256 ${digest}`)
out.push(`files parsed: ${parsed}   failures: ${failures}`)
out.push(``)
out.push(`renderY(...) call sites: ${counts.render}`)
for (const s of renderSites) out.push(`  ${s}`)
out.push(`output$X <- renderY(...) wiring sites: ${wireSites.length}`)
out.push(`*Output(...) UI-widget call sites (the rendered component the UI names): ${counts.output}`)
for (const s of outputSites) out.push(`  ${s}`)
out.push(`component-model container sites (shinyUI/basicPage/fluidPage/...): ${counts.container}`)
out.push(`DISTINCT FILES carrying any of the above: ${filesWith.size} of ${parsed}`)
out.push(``)
out.push(`THE DISCRIMINATOR — does an *Output widget NAME A COMPONENT (a renders row needs a target):`)
out.push(`  first argument is a STRING (an output ID the server wires at runtime): ${outputArgShapes.stringId}`)
out.push(`  first argument is an IDENTIFIER (a component symbol): ${outputArgShapes.identifierSymbol}`)
out.push(`  no argument / other shape: ${outputArgShapes.noArgument + outputArgShapes.other}`)
out.push(line)
import { writeFileSync } from "node:fs"
const ARTIFACT = new URL("./measurements/r-renders-falsifier.txt", import.meta.url).pathname
try { writeFileSync(ARTIFACT, out.join("\n") + "\n") } catch (e: any) { process.stderr.write(`ARTIFACT WRITE FAILED: ${e?.message ?? e}\n`) }
process.stderr.write(out.join("\n") + "\n")
process.stderr.write(`EXIT after ${Date.now() - T0}ms\n`)
