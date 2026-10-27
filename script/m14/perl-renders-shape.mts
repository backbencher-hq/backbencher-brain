/**
 * PERL RENDERS-SHAPE CENSUS — the discriminator measurement for the lane's
 * `renders` candidate.
 *
 * The extended-type census measured 408 `->render(...)` method-call sites over
 * 101 files (Mojolicious). A render call is only a RENDERS edge when it NAMES a
 * template: `$c->render('name')` and `$c->render(template => 'name')`. The other
 * argument shapes render INLINE content or DATA (`text =>`, `json =>`, `inline`)
 * and name no template, so an emission that published them would invent edges.
 * This census counts every argument shape so the implementation's filter is
 * chosen from measurement, not by name alone — the dart lesson (5,893 `build`
 * methods of which 5,142 name a class) applied to perl.
 *
 * NO REGEX: discrimination by node type, field, and exact text equality only.
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun script/m14/perl-renders-shape.mts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = path.join(ROOT, "validation", "m14", "measurements", "perl-renders-shape.json")

const files: { repo: string; rel: string; abs: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 1024 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    const { detectLanguageFromPath } = await import(path.join(ROOT, "src/ast/language-detection.ts"))
    if (detectLanguageFromPath(abs, text) !== "perl") continue
    files.push({ repo: e, rel, abs })
  }
}

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const parser = await (ASTEngine as any).getParser("perl")

const shapes: Record<string, number> = {}
const namedExamples: string[] = []
const namedRepos: Record<string, number> = {}
let named = 0, total = 0
const namedFiles = new Set<string>()
// The template name as the ARGUMENT is a `string_literal`/`interpolated_string_literal`
// word; a `template => 'name'` pair is an autoquoted_bareword + string pair.
const bump = (k: string) => { shapes[k] = (shapes[k] ?? 0) + 1 }

let parsed = 0
for (const f of files) {
  let tree: any
  try { tree = parser.parse(readFileSync(f.abs, "utf8")); parsed++ } catch { continue }
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    if (String(n.type) === "method_call_expression") {
      const mn = n.childForFieldName("method")
      if (mn && String(mn.text) === "render") {
        total++
        // classify the argument list
        const argList = n.childForFieldName("arguments") ?? n.namedChildren.find((c: any) => c && String(c.type) === "list_expression")
        const kids: any[] = []
        if (argList) { for (let i = 0; i < argList.childCount; i++) kids.push(argList.child(i)) }
        const namedKids = kids.filter((c) => c.isNamed)
        if (namedKids.length === 0) { bump("no-args"); continue }
        const first = namedKids[0]
        const ft = String(first.type)
        if (ft === "string_literal" || ft === "interpolated_string_literal") {
          const t = String(first.text)
          if (t.includes("$")) { bump("name-string-interpolated"); continue }
          named++
          bump("name-string")
          namedFiles.add(f.rel)
          namedRepos[f.repo] = (namedRepos[f.repo] ?? 0) + 1
          if (namedExamples.length < 15) namedExamples.push(`${f.rel}:${n.startPosition.row + 1} ${t}`)
          continue
        }
        if (ft === "autoquoted_bareword" || ft === "bareword") {
          const key = String(first.text)
          if (key === "template") {
            const second = namedKids[1]
            if (second && (String(second.type) === "string_literal" || String(second.type) === "interpolated_string_literal") && !String(second.text).includes("$")) {
              named++
              bump("template-key-value")
              namedFiles.add(f.rel)
              namedRepos[f.repo] = (namedRepos[f.repo] ?? 0) + 1
              if (namedExamples.length < 15) namedExamples.push(`${f.rel}:${n.startPosition.row + 1} template => ${String(second.text)}`)
              continue
            }
            bump("template-key-nonliteral"); continue
          }
          bump(`key:${key === "text" || key === "json" || key === "inline" || key === "data" ? "content:" + key : key}`)
          continue
        }
        bump(`other:${ft}`)
      }
    }
    for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i))
  }
}

console.log(`PERL RENDERS-SHAPE CENSUS — ${parsed} of ${files.length} files parsed`)
console.log(`total ->render() sites: ${total}`)
console.log(`shapes: ${Object.entries(shapes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ")}`)
console.log(`NAMED-TEMPLATE sites (renders candidates): ${named} in ${namedFiles.size} files, repos ${JSON.stringify(namedRepos)}`)
console.log(`examples:`)
for (const e of namedExamples) console.log(`  ${e}`)
writeFileSync(OUT, JSON.stringify({ population: { files: files.length, parsed, root: CR }, total, shapes, named, namedFiles: [...namedFiles].length, namedRepos, examples: namedExamples }, null, 2))
console.log(`wrote ${OUT}`)
