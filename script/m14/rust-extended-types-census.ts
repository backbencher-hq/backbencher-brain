/**
 * rust-extended-types-census.ts — WHOLE-POPULATION CONSTRUCT CENSUS for the four extended types.
 *
 * WHY THIS EXISTS: the arm (incoming-gate.ts) measures the ANALYZER'S rows; this census measures
 * the CONSTRUCTS — the sites in the corpus that carry each relation's shape — so the declaration
 * can publish BOTH and a reader sees whether the emission covers the construct. Every counter is
 * DECLARED (a declared zero, not an absent key), the walk frees every tree (`tree.delete()`), and
 * the run FAILS (exit 6) when filesRead != filesAdmitted — the cpp lane's lesson: a leaked tree
 * silently converts every later file into a failure while the run EXITS 0 printing a
 * complete-looking table.
 *
 * COUNTERS (all declared):
 *   part_of:  include_string_literal (the emission's construct), include_non_literal (refused),
 *             include_str_sites, include_bytes_sites (data-inclusion near misses),
 *             mod_file_declarations, mod_inline (the REJECTED near miss, fleet ruling
 *             L-2026-10-21-06: ownership/split)
 *   decorates: outer_attribute_sites, inner_attribute_sites (refused class), builtin_directive,
 *             applied_callable_candidate (the attributeKind split the analyzer publishes)
 *   mixes_in: derive_sites, derive_args_total, distinct_derived_traits, use_as_clause,
 *             use_as_underscore (the REJECTED alternative — a scope mix, not a type mix)
 *   renders:  render_macro_invocations (the corpus-unexercised check), bare_html_tags_refused,
 *             tag_without_symbol_refused (the two impostor classes)
 *
 * USAGE: bun script/m14/rust-extended-types-census.ts --json=<out>
 */
import { getParser } from "../../src/ast/engine"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, statSync } from "node:fs"
import * as path from "node:path"

const outArg = process.argv.find((a) => a.startsWith("--json="))
const OUT = outArg ? outArg.slice(7) : "validation/m14/measurements/rust-extended-census.json"
const CORPUS = path.resolve(process.cwd(), ".corpus")

const counters: Record<string, number> = {
  // part_of
  include_string_literal: 0,
  include_non_literal: 0,
  include_str_sites: 0,
  include_bytes_sites: 0,
  mod_file_declarations: 0,
  mod_inline: 0,
  // decorates
  outer_attribute_sites: 0,
  inner_attribute_sites: 0,
  builtin_directive: 0,
  applied_callable_candidate: 0,
  // mixes_in
  derive_sites: 0,
  derive_args_total: 0,
  use_as_clause: 0,
  use_as_underscore: 0,
  // renders
  render_macro_invocations: 0,
  bare_html_tags_refused: 0,
  tag_without_symbol_refused: 0,
}
const distinctTraits = new Set<string>()
const renderMacros = new Set(["view", "html", "rsx", "render", "maud", "markup"])
const BUILTIN = new Set(["derive","allow","deny","warn","cfg","cfg_attr","inline","test","repr","doc","path","no_mangle","cold","deprecated","must_use","feature","macro_use","macro_export","should_panic","ignore","bench","global_allocator","no_std","panic_handler","proc_macro","proc_macro_derive","proc_macro_attribute"])
const BARE_HTML = new Set(["div","span","p","a","ul","li","ol","h1","h2","h3","h4","h5","h6","br","hr","img","input","button","form","table","tr","td","th","section","header","footer","nav","main","aside","article","label","select","option","textarea","canvas","svg","path","g","template","slot"])

async function main(): Promise<void> {
  // THE POPULATION RULE: git-tracked per checkout, .rs, present, <= 1 MiB — same as the arm.
  const files: string[] = []
  const repos: string[] = []
  for (const e of execFileSync("ls", ["-1", CORPUS], { encoding: "utf8" }).split("\n").map((s) => s.trim()).filter(Boolean)) {
    const d = path.join(CORPUS, e)
    try { execFileSync("git", ["-C", d, "rev-parse", "--is-inside-work-tree"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", d, "ls-files", "-z", "--", "*.rs"], { encoding: "utf8" })
        .split("\0").map((f) => f.trim()).filter(Boolean).map((f) => path.join(d, f))
    } catch { continue }
    const present = tracked.filter((f) => { try { return statSync(f).size <= 1024 * 1024 } catch { return false } })
    if (present.length > 0) repos.push(e)
    files.push(...present)
  }
  const admitted = files.length
  const parser: any = await getParser("rust")
  let filesRead = 0
  for (const f of files) {
    let src = ""
    try { src = readFileSync(f, "utf8") } catch { continue }
    const tree = await parser.parse(src)
    filesRead++
    const walk = (n: any): void => {
      const t = String(n?.type ?? "")
      if (t === "macro_invocation") {
        const mn = n.namedChild(0)
        const name = mn ? String(mn.text) : ""
        if (name === "include") {
          const tt = n.namedChild(1)
          let lit = false
          if (tt) for (let k = 0; k < tt.namedChildCount; k++) { const c = tt.namedChild(k); if (c && String(c.type) === "string_literal") { lit = true; break } }
          if (lit) counters.include_string_literal++
          else if (tt) counters.include_non_literal++
        } else if (name === "include_str") counters.include_str_sites++
        else if (name === "include_bytes") counters.include_bytes_sites++
        else if (renderMacros.has(name)) {
          counters.render_macro_invocations++
          const tt = n.namedChild(1)
          if (tt) {
            const flat: { text: string; type: string }[] = []
            for (let k = 0; k < tt.childCount; k++) { const c = tt.child(k); if (c) flat.push({ text: String(c.text), type: String(c.type) }) }
            for (let k = 0; k + 1 < flat.length; k++) {
              if (flat[k].text === "<" && flat[k + 1].type === "identifier") {
                const tag = flat[k + 1].text
                if (BARE_HTML.has(tag.toLowerCase())) counters.bare_html_tags_refused++
                else counters.tag_without_symbol_refused++ // same-file symbol test needs ctx; census counts the shape
                k++
              }
            }
          }
        }
      } else if (t === "attribute_item") {
        counters.outer_attribute_sites++
        const attr = n.namedChild(0)
        const nameNode = attr ? (attr.childForFieldName?.("path") ?? attr.namedChild(0)) : null
        const name = nameNode ? String(nameNode.text) : ""
        if (BUILTIN.has(name)) counters.builtin_directive++
        else if (name.length > 0) counters.applied_callable_candidate++
        if (name === "derive") {
          counters.derive_sites++
          const tt = attr ? (attr.childForFieldName?.("arguments") ?? attr.namedChild(1)) : null
          if (tt) {
            const flat: { text: string; isIdent: boolean }[] = []
            for (let k = 0; k < tt.childCount; k++) { const c = tt.child(k); if (c) flat.push({ text: String(c.text), isIdent: String(c.type) === "identifier" }) }
            let k2 = 0
            while (k2 < flat.length) {
              if (!flat[k2].isIdent) { k2++; continue }
              let pEnd = k2
              while (pEnd + 2 < flat.length && flat[pEnd + 1].text === "::" && flat[pEnd + 2].isIdent) pEnd += 2
              counters.derive_args_total++
              distinctTraits.add(flat[pEnd].text)
              k2 = pEnd + 1
            }
          }
        }
      } else if (t === "inner_attribute_item") {
        counters.inner_attribute_sites++
      } else if (t === "mod_item") {
        const hasDeclList = (() => { for (let k = 0; k < n.namedChildCount; k++) { const c = n.namedChild(k); if (c && String(c.type) === "declaration_list") return true } return false })()
        if (hasDeclList) counters.mod_inline++
        else counters.mod_file_declarations++
      } else if (t === "use_as_clause") {
        counters.use_as_clause++
        if (String(n.text).includes("as _")) counters.use_as_underscore++
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(tree.rootNode)
    tree.delete() // ★ THE LEAK GUARD: cpp lost 15,223 files to a missing delete.
  }
  if (filesRead !== admitted) {
    console.error(`CENSUS REFUSED: filesRead ${filesRead} != filesAdmitted ${admitted}`)
    process.exit(6)
  }
  const result = {
    population: { admitted, filesRead, repos: repos.length, string: `parsed=${admitted}/${admitted} admitted=${admitted} exts=rs index=no` },
    counters,
    distinct_derived_traits: [...distinctTraits].sort(),
    instrument: "rust-extended-types-census.ts",
  }
  writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n")
  console.log(`rust-extended-types-census: ${admitted} files, ${repos.length} repos -> ${OUT}`)
  for (const k of Object.keys(counters)) console.log(`  ${k}: ${counters[k]}`)
  console.log(`  distinct_derived_traits: ${distinctTraits.size}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
