#!/usr/bin/env bun
/**
 * THE `decorates` DISCRIMINATOR (cpp lane, 2026-10-22) — WHOLE POPULATION, NO SAMPLING, NO NAME LIST.
 *
 * ## THE CELL IT DECIDES
 *
 * `decorates` is the contract's row for an APPLIED CALLABLE:
 * `src/ast/types.ts:120-129` — a decorator is APPLIED TO a declaration. The csharp lane's
 * ONTOLOGICAL test is: does the construct APPLY a callable, or MARK the declaration? A C# attribute
 * is PASSIVE METADATA, and csharp measured 7,248 attribute sites, 5,489 arguments, 110 carrying a
 * call and **0 applied callables**.
 *
 * ## THE BUG THIS INSTRUMENT EXISTS TO NOT REPEAT
 *
 * The lane's FIRST discriminator compared the callee's name against the attribute's own marker name
 * and reported **3,308 "distinct callables" over 23,237 files** — while displaying ten samples that
 * were plainly the markers (`visibility`, `aligned`, `optimize`, `no_sanitize`, `mode`, `format`,
 * `__ext_vector_type__`). THE CAUSE: the GNU form `__attribute__((visibility("default")))` nests the
 * marker inside the `argument_list` of an `attribute` child, so the marker-name extraction read the
 * wrong tokens and the callee never matched. **A DISCRIMINATOR THAT REPORTS THOUSANDS OF THE THING IT
 * IS LOOKING FOR, WHILE ITS OWN SAMPLES SHOW THE OPPOSITE, IS A BROKEN DISCRIMINATOR — not a finding.**
 * ⇒ AND THE FIX IS NOT A LONGER NAME LIST: a hand-written name list is the SECOND TABLE that will
 * diverge, which is the exact defect `script/m14/shape-agreement-scan.ts` was built to find.
 *
 * ## THE STRUCTURAL TEST, WHICH NEEDS NO LIST
 *
 * In C++ an attribute is spelled in one of two ways and the call is always the MARKER's own syntax,
 * never a callable applied to the declaration:
 *
 *     __attribute__((aligned(32)))       the marker `aligned` IS the call
 *     [[gnu::visibility("default")]]     the marker is `visibility`, scoped
 *
 * So the question is what the callee's FUNCTION node is. An `identifier` is the marker's own name
 * written by the compiler's attribute syntax. A callee that names a callable through a PATH —
 * `field_expression` (`obj::fn(...)`) or `qualified_identifier` (`ns::fn(...)`) — is the only shape
 * that would have to RESOLVE, and it is the only shape that could make the argument an APPLIED
 * CALLABLE rather than the marker. Zero of those is zero applied callables.
 *
 * ## RUN
 *
 *   bun run script/m14/cpp-decorates-discriminator.ts [--json=out.json]
 *
 * POPULATION: `extensionsFor("cpp")` from the ONE table (`script/m14/language-extensions.ts`) — NOT a
 * hand-written list. `tree.delete()` after every parse, because the WASM module aborts at roughly
 * 7,600 parses and a census that leaks trees reports a truncated population with a success exit code.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { extensionsFor } from "./language-extensions"
const ROOT = process.cwd()
const EXTS = extensionsFor("cpp").map((e) => (e.startsWith(".") ? e.slice(1) : e)), CAP = 1024 * 1024
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const files: string[] = []
for (const n of readdirSync(CR).sort()) {
  const d = path.join(CR, n)
  try { if (!statSync(d).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", d, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let t: string[] = []
  try { t = execFileSync("git", ["-C", d, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of t) {
    const i = rel.lastIndexOf("."); if (i < 0) continue
    if (!EXTS.includes(rel.slice(i + 1).toLowerCase())) continue
    const abs = path.join(d, rel)
    let s = 0
    try { s = statSync(abs).size } catch { continue }
    if (s > CAP) continue
    files.push(abs)
  }
}
const { Parser, Language } = await import("web-tree-sitter")
await Parser.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang: any = await Language.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-cpp.wasm")) as any)
const p = new Parser(); p.setLanguage(lang)
let sites = 0, withArgs = 0, sitesWithCall = 0, distinctCallable = 0
const distinct: string[] = []
const walk = (n: any, v: (x: any) => void): void => { v(n); for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, v) } }
for (const f of files) {
  let src = ""; try { src = readFileSync(f, "utf8") } catch { continue }
  let tree: any; try { tree = p.parse(src) } catch { continue }
  walk(tree.rootNode, (n: any) => {
    if (n.type !== "attribute_specifier" && n.type !== "attribute") return
    sites++
    const argList = (n.namedChildren ?? []).find((c: any) => c.type === "argument_list")
    if (!argList) return
    withArgs++
    // THE STRUCTURAL TEST, AND IT NEEDS NO HAND-WRITTEN NAME LIST (a name list is the second table
    // that diverges). In C++ an attribute is spelled in ONE of two ways and the CALL is always the
    // MARKER's own syntax, not a callable applied to the declaration:
    //   __attribute__((aligned(32)))      the marker `aligned` IS the call
    //   [[gnu::visibility("default")]]    the marker is `visibility`, scoped
    // So the question is what the callee's FUNCTION node is: an `identifier` (the marker's own name,
    // written by the compiler's attribute syntax) is NOT a project callable. Anything that names a
    // callable through a path — `field_expression` (`obj::fn(...)`) or a `qualified_identifier`
    // (`ns::fn(...)`) — WOULD be a name that has to resolve, and that is the only shape that could
    // make the argument an APPLIED CALLABLE rather than the marker.
    let hasCall = false
    for (const a of (argList.namedChildren ?? [])) {
      const call = a.type === "call_expression" ? a : (a.namedChildren ?? []).find((c: any) => c.type === "call_expression")
      if (!call) continue
      hasCall = true
      const fn = call.childForFieldName?.("function")
      const kind = String(fn?.type ?? "")
      if (kind !== "identifier") {
        distinctCallable++
        if (distinct.length < 10) distinct.push(`${kind}: ${String(fn?.text ?? "")}  in  ${String(n.text).slice(0, 50)}`)
      }
    }
    if (hasCall) sitesWithCall++
  })
  tree.delete()
}
const out = { files: files.length, attributeSites: sites, sitesWithArgumentList: withArgs,
  sitesWhoseArgumentCarriesACall: sitesWithCall,
  sitesWhoseArgumentCallsThroughAPathNotTheMarkerSyntax: distinctCallable,
  distinctSamples: distinct,
  reading: "THE ANSWERING COUNT IS `sitesWhoseArgumentCallsThroughAPathNotTheMarkerSyntax`. It counts attribute-argument calls whose callee is a PATH (`field_expression`/`qualified_identifier`) rather than an `identifier` — i.e. a callable that would have to RESOLVE rather than the attribute's own marker syntax. ZERO means ZERO APPLIED CALLABLES: the construct `decorates` names does not exist for this language, and the ruling is `ontological` on a WHOLE-POPULATION discriminator rather than on samples.",
}
console.log(JSON.stringify(out, null, 2))
const argOf = (f: string): string | null => {
  const j = process.argv.find((a) => a.startsWith(`${f}=`))
  return j ? j.slice(f.length + 1) : null
}
const js = argOf("--json")
if (js) (await import("node:fs")).writeFileSync(js, JSON.stringify(out, null, 2))
