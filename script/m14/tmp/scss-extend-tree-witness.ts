/**
 * Is an unresolved `@extend` target DECLARED in the same file? — answered on the PARSE
 * TREE, because the text-based witness tried first is not an instrument: it searched the
 * file's characters for the target string, `@extend .btn-sm;` contains `.btn-sm`, and the
 * probe therefore reported 351 of 414 unresolved edges as "declared here but
 * unpublished" — a number produced by the very statement under investigation.
 *
 * The tree answer is unambiguous. For each `@extend` in the file — in BOTH shapes, the
 * `extend_statement` node and the recovered `ERROR > "@extend", …` — take the target name
 * and ask whether any `rule_set` in the SAME file has a `selectors` node containing a
 * `placeholder`, `class_selector` or `tag_name` with that name. Three outcomes:
 *
 *   declared-here   the file writes the selector ⇒ the lane SHOULD publish it, so an
 *                   unresolved edge is a lane defect.
 *   cross-file      the file only names it ⇒ correct silence under SCSS-L7.
 *   absent          named but written nowhere, e.g. the target is an interpolated prefix.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
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
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "scss") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
files.sort((a, b) => `${a.repo}/${a.rel}`.localeCompare(`${b.repo}/${b.rel}`))

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-scss.wasm"))))

const kids = (n: any): any[] => { const o: any[] = []; for (let i = 0; i < n.childCount; i++) o.push(n.child(i)); return o }
const named = (n: any): any[] => kids(n).filter((c) => c.isNamed)
const kidOf = (n: any, t: string): any | null => named(n).find((c) => c.type === t) ?? null
const collapse = (t: string): string => t.replace(/\s+/g, " ").trim()

const out = { total: 0, declaredHere: 0, crossFile: 0, unreadableTarget: 0, byTarget: {} as Record<string, { total: number; declaredHere: number; crossFile: number }> }
const examples: string[] = []
for (const f of files) {
  const t = parser.parse(f.text)
  if (!t) continue
  const root = t.rootNode
  // every selector name this file WRITES
  const written = new Set<string>()
  const collect = (n: any) => {
    if (n.type === "rule_set") {
      const sels = kidOf(n, "selectors")
      if (sels) {
        const v = (x: any) => {
          if (x.type === "placeholder") written.add(collapse(x.text))
          if (x.type === "class_selector") written.add(collapse(x.text))
          if (x.type === "id_selector") written.add(collapse(x.text))
          if (x.type === "tag_name") written.add(collapse(x.text))
          for (const c of named(x)) v(c)
        }
        for (const c of named(sels)) v(c)
      }
    }
    for (const c of kids(n)) collect(c)
  }
  collect(root)
  const targets: Array<{ name: string; line: number }> = []
  const scan = (n: any) => {
    if (n.type === "extend_statement") {
      const sel = kidOf(n, "class_selector") ?? kidOf(n, "id_selector") ?? kidOf(n, "plain_value")
      const ph = deep(n, "placeholder")
      const name = sel ? collapse(sel.text) : ph ? collapse(ph.text) : null
      if (name) targets.push({ name, line: n.startPosition.row + 1 })
      else out.unreadableTarget++
    } else if (n.type === "ERROR") {
      let kw = false
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c?.type === "@extend") { kw = true; break } if (c && c.isNamed && c.type !== "comment") break }
      if (kw) {
        const sel = deep(n, "class_selector") ?? deep(n, "id_selector") ?? deep(n, "plain_value")
        const ph = deep(n, "placeholder")
        const name = sel ? collapse(sel.text) : ph ? collapse(ph.text) : null
        if (name) targets.push({ name, line: n.startPosition.row + 1 })
        else out.unreadableTarget++
      }
    }
    for (const c of kids(n)) scan(c)
  }
  scan(root)
  for (const tg of targets) {
    out.total++
    const bucket = (out.byTarget[tg.name.startsWith("%") ? "%placeholder" : "class/id/type"] ??= { total: 0, declaredHere: 0, crossFile: 0 })
    bucket.total++
    const ok = written.has(tg.name)
    if (ok) { out.declaredHere++; bucket.declaredHere++ }
    else { out.crossFile++; bucket.crossFile++; if (examples.length < 12) examples.push(`${f.repo}/${f.rel}:${tg.line} ${tg.name}`) }
  }
  t.delete?.()
}
function deep(n: any, type: string): any | null {
  const stack = [n]
  while (stack.length) { const c = stack.pop(); if (!c) continue; if (c.type === type) return c; for (const k of named(c)) stack.push(k) }
  return null
}
console.log(JSON.stringify(out, null, 1))
console.log("cross-file examples:")
for (const e of examples) console.log("  " + e)
