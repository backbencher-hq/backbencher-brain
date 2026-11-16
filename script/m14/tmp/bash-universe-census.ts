/**
 * READ-ONLY PROBE — what a widened bash universe would actually reach.
 *
 * The lane is measured on 112 build/CI scripts. Real-world bash lives well outside
 * the router's three extensions and three basenames: `ohmyzsh` holds 547
 * bash-family files of which 17 are reachable, and `nvm`/`rbenv` put their entry
 * points in EXTENSIONLESS executables. Widening the router is the largest
 * remaining recall gap — but routing files the pinned grammar cannot read would
 * inject ERROR-region symbols into the index, which is worse than not routing
 * them. So the measurement comes first, per candidate class, and the decision is
 * made on the numbers rather than on the file count.
 *
 * For each candidate class: how many files exist, what fraction parse with ZERO
 * ERROR/MISSING nodes, and what the analyzer would emit from the ones that do.
 *
 * Writes nothing.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

import { RealBashAnalyzer } from "../../../src/ast/real-bash-analyzer"

import { createRequire } from "node:module"
const require = createRequire(import.meta.url)

const ROOT = process.cwd()
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const REPOS = ["ohmyzsh", "nvm", "rbenv", "otp", "fsharp"]

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-bash.wasm"))))

/** Shebangs that mean "this file is a shell script". */
const SHELL_SHEBANGS = [
  "#!/bin/bash", "#!/usr/bin/bash", "#!/usr/bin/env bash", "#!/bin/sh", "#!/usr/bin/sh",
  "#!/usr/bin/env sh", "#!/bin/zsh", "#!/usr/bin/zsh", "#!/usr/bin/env zsh",
  "#!/bin/dash", "#!/usr/bin/dash", "#!/bin/ksh", "#!/usr/bin/ksh", "#!/usr/bin/env ksh",
]

interface Klass {
  name: string
  match: (rel: string, abs: string) => "yes" | "no" | "unknown"
  /** "always" = route by name; "shebang" = only when the first line says shell */
  routing: string
}
const CLASSES: Klass[] = [
  { name: ".sh / .bash (routed today)", routing: "extension", match: (r) => (/\.(sh|bash)$/.test(r) ? "yes" : "no") },
  { name: ".zsh", routing: "extension", match: (r) => (/\.zsh$/.test(r) ? "yes" : "no") },
  { name: ".zsh-theme", routing: "extension", match: (r) => (/\.zsh-theme$/.test(r) ? "yes" : "no") },
  { name: ".plugin.zsh (counted once, as .zsh)", routing: "extension", match: () => "no" },
  { name: "bashrc/basename family", routing: "basename", match: (r) => {
    const b = r.slice(r.lastIndexOf("/") + 1)
    return /^\.?bash(_|rc|rc\.?$|profile$|_profile$|aliases$|_functions$|Completion$|completion$)/.test(b) || b === ".profile" || b === "profile" ? "yes" : "no"
  } },
  { name: "autoconf `configure`", routing: "basename", match: (r) => (r.slice(r.lastIndexOf("/") + 1) === "configure" ? "yes" : "no") },
  { name: "extensionless + shell shebang", routing: "shebang", match: (r) => {
    const b = r.slice(r.lastIndexOf("/") + 1)
    if (b.includes(".")) return "no"
    try {
      const head = readFileSync(path.join(CORPUS_ROOT, b === "" ? "" : "", ""), { encoding: "utf8" })
      void head
    } catch { /* handled below */ }
    return "unknown"
  } },
]

interface Row {
  files: number
  cleanParse: number
  dirtyParse: number
  parseRate: number
  symbols: number
  relationships: number
  symbolFreeCleanFiles: number
  topErrorShapes: { node: string; count: number }[]
}

const rows = new Map<string, Row>()
const bumpRow = (k: string): Row => {
  let r = rows.get(k)
  if (!r) {
    r = { files: 0, cleanParse: 0, dirtyParse: 0, parseRate: 0, symbols: 0, relationships: 0, symbolFreeCleanFiles: 0, topErrorShapes: [] }
    rows.set(k, r)
  }
  return r
}

function errorNodes(root: any): { node: string; count: number }[] {
  const found = new Map<string, number>()
  const st: any[] = [root]
  while (st.length > 0) {
    const n: any = st.pop()
    if (!n) continue
    if (n.type === "ERROR" || n.isMissing) {
      const key = n.isMissing ? `MISSING ${JSON.stringify(n.text ?? "")}` : "ERROR"
      found.set(key, (found.get(key) ?? 0) + 1)
    }
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) st.push(c) }
  }
  return [...found.entries()].map(([node, count]) => ({ node, count })).sort((a, b) => b.count - a.count)
}

for (const repo of REPOS) {
  const dir = path.join(CORPUS_ROOT, repo)
  if (!existsSync(path.join(dir, ".git"))) continue
  const tracked = execFileSyncSafe(dir)
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let st: any
    try { st = statSync(abs) } catch { continue }
    if (!st.isFile()) continue
    const base = rel.slice(rel.lastIndexOf("/") + 1)

    // classify
    for (const k of CLASSES) {
      if (k.name === "extensionless + shell shebang") continue
      if (k.match(rel, abs) !== "yes") continue
      const r = bumpRow(k.name)
      r.files++
      measure(abs, r)
    }
    // extensionless + shell shebang, decided by CONTENT
    if (!base.includes(".")) {
      let head = ""
      try { head = readFileSync(abs, "utf8").slice(0, 200) } catch { continue }
      const first = head.split("\n")[0]?.trim() ?? ""
      if (SHELL_SHEBANGS.some((sb) => first === sb || first.startsWith(`${sb} `))) {
        const r = bumpRow("extensionless + shell shebang")
        r.files++
        measure(abs, r)
      }
    }
  }
}

function execFileSyncSafe(dir: string): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execFileSync } = require("node:child_process")
    return execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
      .trim().split("\n").filter(Boolean)
  } catch {
    return []
  }
}

function measure(abs: string, r: Row) {
  let text: string
  try { text = readFileSync(abs, "utf8") } catch { r.files--; return }
  if (text.length > 512 * 1024) { r.files--; return } // the corpus tools measure size-bounded files too
  const tree = parser.parse(text)
  if (!tree) { r.files--; return }
  const errs = errorNodes(tree.rootNode)
  if (errs.length === 0) {
    r.cleanParse++
    const res: any = new RealBashAnalyzer().analyze(tree.rootNode, text, abs)
    r.symbols += res.symbols.length
    r.relationships += res.relationships.length
    if (res.symbols.length <= 1) r.symbolFreeCleanFiles++ // 1 == the module symbol only
  } else {
    r.dirtyParse++
    r.topErrorShapes.push({ node: `${errs[0].node} x${errs[0].count}`, count: errs[0].count })
  }
  tree.delete?.()
}

console.log(`=== what a widened bash universe would reach (${REPOS.join(", ")}) ===\n`)
for (const k of CLASSES) {
  const r = rows.get(k.name)
  if (!r || r.files === 0) {
    console.log(`${k.name.padEnd(34)} files=0`)
    continue
  }
  const rate = ((100 * r.cleanParse) / r.files).toFixed(1)
  console.log(
    `${k.name.padEnd(34)} files=${String(r.files).padStart(5)}  cleanParse=${String(r.cleanParse).padStart(5)} (${rate}%)  ` +
      `symbols=${String(r.symbols).padStart(6)}  rels=${String(r.relationships).padStart(6)}  module-only=${r.symbolFreeCleanFiles}`,
  )
  const shapes = new Map<string, number>()
  for (const s of r.topErrorShapes) shapes.set(s.node, (shapes.get(s.node) ?? 0) + 1)
  const top = [...shapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
  if (top.length) console.log(`${" ".repeat(36)}top damage: ${top.map(([n, c]) => `${n} (${c} files)`).join(", ")}`)
}
