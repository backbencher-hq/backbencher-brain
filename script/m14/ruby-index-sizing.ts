/**
 * ruby-index-sizing — Phase 1 sizing for a ruby PROJECT INDEX (task-22, charter-first, NO heavy run).
 * Reads the ruby ARM-A dump (the gate's own residual rows; no second population) and a TEXT-LEVEL
 * declaration scan of the .rb trees of the SAME repos, then answers: how many residual rows per type would
 * a project-wide declaration space be able to decide, split STRONG (unique declaration in the row's repo) /
 * WEAK (multiple declarations — ambiguity a name-only space cannot pick) / NONE (no declaration anywhere:
 * gem/DSL/platform or dynamic — an index does NOT fix these), with named not-fixable classes counted apart.
 *
 * LIMIT stated: the declaration scan is text-level (line-leading `def`/`class`/`module`/`attr_*`/
 * `alias`/constant assignment/`include|prepend|extend`), not a parse; STRONG means a unique SPELLING per
 * repo, which is the upper bound of what a name-only declaration space would supply. No analyzer change.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { createReadStream, readdirSync, statSync } from "node:fs"
import { createInterface } from "node:readline"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const FILE = process.argv[2] ?? "validation/m14/fixtures/ruby/measurements/gate-ruby-cap0-dump.txt"
const isWord = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95
const isAlpha = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95

// ── pass 1: collect residual rows (label, outcome, target, file, line) + the repos they live in ─────
type Row = { label: string; outcome: string; target: string; file: string; line: number }
const rows: Row[] = []
const repos = new Set<string>()
const rl = createInterface({ input: createReadStream(FILE, "utf8"), crlfDelay: Infinity })
for await (const line of rl) {
  if (!line.startsWith("DUMP\t")) continue
  const p = line.split("\t")
  if (p.length < 6) continue
  const where = String(p[4] ?? "")
  const cut = where.lastIndexOf(":")
  if (cut <= 0) continue
  const file = where.slice(0, cut)
  const rel = file.startsWith(CR + path.sep) ? file.slice(CR.length + 1) : file
  const parts = rel.split(path.sep)
  if (parts.length > 1) repos.add(parts[0])
  rows.push({ label: p[1], outcome: p[2], target: String(p[3]).trim(), file: rel, line: Number(where.slice(cut + 1)) })
}
const repoFiles = new Map<string, string[]>() // repo -> .rb abs paths (text scan population)
for (const repo of repos) {
  const out: string[] = []
  const walk = (dir: string): void => {
    let es: any[]
    try { es = readdirSync(dir, { withFileTypes: true }) as any } catch { return }
    for (const e of es as any[]) {
      if (e.name === ".git") continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) { walk(full); continue }
      if (e.name.endsWith(".rb")) out.push(full)
    }
  }
  walk(path.join(CR, repo))
  repoFiles.set(repo, out)
}

// ── pass 2: text-level declaration scan — name -> number of declaring sites PER REPO ───────────────
const declSites = new Map<string, Map<string, number>>() // repo -> name -> sites
const localAssigns = new Map<string, Set<string>>()       // repo -> names that appear as locals anywhere
const bump = (repo: string, name: string): void => {
  if (!name) return
  let m = declSites.get(repo)
  if (!m) { m = new Map(); declSites.set(repo, m) }
  m.set(name, (m.get(name) ?? 0) + 1)
}
const scanTokens = (text: string, fn: (tok: string, at: number) => void): void => {
  let i = 0
  while (i < text.length) {
    if (!isAlpha(text.charCodeAt(i))) { i++; continue }
    let j = i + 1
    while (j < text.length && isWord(text.charCodeAt(j))) j++
    fn(text.slice(i, j), i)
    i = j
  }
}
let scannedFiles = 0
for (const [repo, files] of repoFiles) {
  const locals = new Set<string>()
  for (const abs of files) {
    let src = ""
    try { src = fs.readFileSync(abs, "utf8") } catch { continue }
    scannedFiles++
    // declaration lines: take the FIRST token of each line, so `def foo`, `class Foo`, `module M`,
    // `attr_reader :x`, `alias a b`, `CONST = ...`, `include M` are read; nesting/owner is NOT modelled
    // (a name-only space does not need it — stated limit).
    for (const rawLine of src.split("\n")) {
      const line = rawLine.trimStart()
      if (line.startsWith("#")) continue
      let k = 0
      while (k < line.length && isAlpha(line.charCodeAt(k))) k++
      const kw = line.slice(0, k)
      if (kw === "def") {
        let t = k
        while (t < line.length && line[t] === " ") t++
        // `def self.m` / `def Foo.m` -> m ; `def m?` / `def m=` keep the suffix as written
        const start = t
        while (t < line.length && line[t] !== " " && line[t] !== "(" && line[t] !== ";") t++
        const full = line.slice(start, t)
        const dot = full.lastIndexOf(".")
        bump(repo, dot >= 0 ? full.slice(dot + 1) : full)
      } else if (kw === "class" || kw === "module") {
        let t = k + 1
        const start = t
        while (t < line.length && /[A-Za-z0-9_:]/.test(line[t])) t++
        const full = line.slice(start, t)
        bump(repo, full.slice(full.lastIndexOf(":") + 1))
      } else if (kw === "attr_reader" || kw === "attr_writer" || kw === "attr_accessor" || kw === "attr") {
        for (const seg of line.slice(k).split(":")) {
          let t = 0
          while (t < seg.length && !isAlpha(seg.charCodeAt(t))) t++
          let u = t
          while (u < seg.length && isWord(seg.charCodeAt(u))) u++
          if (u > t) bump(repo, seg.slice(t, u))
        }
      } else if (kw === "alias") {
        const toks: string[] = []
        scanTokens(line.slice(k), (tok) => toks.push(tok))
        if (toks.length >= 1) bump(repo, toks[0])
      } else if (kw === "include" || kw === "prepend" || kw === "extend") {
        const toks: string[] = []
        scanTokens(line.slice(k), (tok) => toks.push(tok))
        for (const t of toks) bump(repo, t)
      } else if (kw.length === 0 || line[k] === undefined || line[k] === "=" || line[k] === " ") {
        // constant assignment: `NAME = ...` or `NAME ||= ...`
        let t = 0
        while (t < line.length && (line[t] === " " || line[t] === "&" || line[t] === "*")) t++
        const start = t
        while (t < line.length && isWord(line.charCodeAt(t))) t++
        const name = line.slice(start, t)
        if (name.length > 0 && name[0] >= "A" && name[0] <= "Z") {
          let u = t
          while (u < line.length && line[u] === " ") u++
          if (line.startsWith("=", u) || line.startsWith("||=", u)) bump(repo, name)
        }
      }
    }
    // locals: assignment LHS words and parameter-ish tokens (approximate by assignment lines)
    scanTokens(src, (tok, at) => {
      let p = at + tok.length
      while (p < src.length && (src[p] === " " || src[p] === "\t")) p++
      if (p < src.length && (src[p] === "=" || (src[p] === "|" && src[p + 1] === "|")) && src[p + 1] !== "=") {
        if (tok[0] >= "a" && tok[0] <= "z") locals.add(tok)
      }
    })
  }
  localAssigns.set(repo, locals)
}

// ── pass 3: classify each residual row against the repo's declaration space ───────────────────────
const byType = new Map<string, Record<string, number>>()
const notFixable: Record<string, number> = {}
const dynamicTargets = new Set(["send", "__send__", "public_send", "method_missing", "respond_to?", "instance_eval", "class_eval", "module_eval"])
const isIvar = (t: string) => t.startsWith("@")
let localBindRows = 0
for (const row of rows) {
  const parts = row.file.split(path.sep)
  const repo = parts[0]
  const decl = declSites.get(repo) ?? new Map<string, number>()
  const sites = decl.get(row.target) ?? 0
  const b = byType.get(row.label) ?? {}
  byType.set(row.label, b)
  const add = (k: string) => { b[k] = (b[k] ?? 0) + 1 }
  const key = `${row.label}:${row.outcome}`
  notFixable[`${key}:outcome`] = (notFixable[`${key}:outcome`] ?? 0) + 1
  // OVERRIDES: the row's target is `Base.method`; the index question is whether the BASE class is declared
  // in the repo (a verified base turns the analyzer's first-parent GUESS into a checked relation), so the
  // base — not the dotted target — must be looked up.
  if (row.label === "overrides") {
    const base = row.target.split(".")[0]
    const baseSites = decl.get(base) ?? 0
    if (baseSites >= 1) add("DECIDABLE (base class declared in repo)")
    else add("NONE (base not declared in repo — gem/platform)")
    continue
  }
  // LOCAL-BINDING census (secondary): a calls row whose target also appears as a local assignment word
  // somewhere in the repo. Text-level over-approximation; the analyzer's own per-method `locals` set is the
  // real evidence (it suppresses bound names), so a nonzero candidate count means binding gaps to inspect.
  if ((row.label === "calls" || row.label === "uses") && (localAssigns.get(repo)?.has(row.target) ?? false)) {
    localBindRows++
  }
  if (isIvar(row.target)) { notFixable["ivar-sigil"] = (notFixable["ivar-sigil"] ?? 0) + 1; add("NOT-FIXABLE (ivar sigil)"); continue }
  if (dynamicTargets.has(row.target)) { notFixable["dynamic-dispatch"] = (notFixable["dynamic-dispatch"] ?? 0) + 1; add("NOT-FIXABLE (dynamic dispatch)"); continue }
  if (row.label === "imports" || (row.label === "references" && (row.target.includes("/") || row.target.includes(".") && !decl.has(row.target)))) {
    notFixable["load-path"] = (notFixable["load-path"] ?? 0) + 1; add("NOT-FIXABLE (load path)"); continue
  }
  if (sites === 1) add("STRONG (unique declaration in repo)")
  else if (sites > 1) add("WEAK (ambiguous declaration space)")
  else add("NONE (no declaration in repo — gem/DSL/external)")
}
const out = {
  instrument: "script/m14/ruby-index-sizing.ts", dump: FILE, residualRows: rows.length,
  repos: repos.size, scannedRbFiles: scannedFiles,
  byType: Object.fromEntries([...byType.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
  notFixable,
  localBindingCandidatesTextLevel: localBindRows,
}
console.log(JSON.stringify(out, null, 2))
