/**
 * TYPESCRIPT LANE — REACT / TSX COVERAGE CENSUS.
 *
 * The lane owns `.tsx` as well as `.ts`: `language-detection.ts` routes `tsx -> "tsx"`, and
 * `engine.ts` runs THIS analyzer over the tsx grammar (`tree-sitter-tsx.wasm`). The 400-file
 * incoming gate is `.ts`-only, so every number it prints excludes the React corpus by
 * construction. This tool measures that corpus directly, in two layers that are never mixed:
 *
 *   TEXTUAL  — every `.tsx` file on disk: react/react-dom imports, JSX tags, hook calls,
 *              `className=`, `props`/`Props`. Fast, and honest about being a text scan.
 *   ANALYZER — a STRIDE sample put through the production entry (`parseFile`), so the
 *              emission counts are what the lane actually publishes on TSX, not a syntax guess.
 *
 * CLI: bun validation/m14/fixtures/typescript/tools/react-census.mts [--analyzer-sample N]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const sampleArg = argv.includes("--analyzer-sample") ? Number(argv[argv.indexOf("--analyzer-sample") + 1]) : 400
const SAMPLE = Number.isFinite(sampleArg) && sampleArg > 0 ? sampleArg : 400

const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", "coverage", ".next", ".turbo", ".cache", "target", "vendor", "__pycache__", "storybook-static"])

function walk(dir: string, out: string[], visited = new Set<string>()): void {
  let real = dir
  try {
    real = fs.realpathSync(dir)
  } catch {
    return
  }
  // A REPO CAN BE A SYMLINK, and one is: `repositories/proxicall -> ~/ProxiCall` (445 .tsx
  // files). Following it is required for the census to match the gate's `git ls-files`
  // population; the visited set is what keeps a symlink cycle from looping.
  if (visited.has(real)) return
  visited.add(real)
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    // `.git` is the only dot-directory skipped: `.vitepress`, `.storybook` and friends are
    // real source trees and the corpus count must match what `find` sees.
    if (e.name === ".git") continue
    if (SKIP.has(e.name)) continue
    const p = path.join(dir, e.name)
    let isDir = e.isDirectory()
    if (!isDir && e.isSymbolicLink()) {
      try {
        isDir = fs.statSync(p).isDirectory()
      } catch {
        isDir = false
      }
    }
    if (isDir) walk(p, out, visited)
    else if (e.isFile() && e.name.endsWith(".tsx")) out.push(p)
  }
}

const files: string[] = []
walk(CR, files)

/**
 * THE ON-DISK COUNT, beside the admitted one. The production discovery rules skip a path
 * segment named `build`/`dist`/`out` because it is usually an artifact — but a SOURCE tree can
 * carry that segment too, and redwood's does: 17 .tsx test fixtures live under
 * `packages/vite/src/build/__tests__/fixtures/`. The two counts are reported side by side so
 * the corpus number (what exists) and the lane's population (what the indexer reads) are never
 * confused, and the 17 are NAMED rather than silently dropped.
 */
const onDisk: string[] = []
const walkAll = (dir: string, visited = new Set<string>()): void => {
  let real = dir
  try {
    real = fs.realpathSync(dir)
  } catch {
    return
  }
  if (visited.has(real)) return
  visited.add(real)
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    let isDir = e.isDirectory()
    if (!isDir && e.isSymbolicLink()) {
      try {
        isDir = fs.statSync(p).isDirectory()
      } catch {
        isDir = false
      }
    }
    if (isDir) walkAll(p, visited)
    else if (e.isFile() && e.name.endsWith(".tsx")) onDisk.push(p)
  }
}
walkAll(CR)
const excludedBySkip = onDisk.filter((f) => !files.includes(f))

// ── TEXTUAL LAYER ────────────────────────────────────────────────────────────────────────────
const HOOKS = ["useState", "useEffect", "useMemo", "useCallback", "useRef", "useContext", "useReducer", "useLayoutEffect", "useImperativeHandle", "useDeferredValue", "useTransition", "useId"]
const counts = {
  files: 0,
  reactImport: 0,
  reactDomImport: 0,
  jsxTag: 0,
  hookAny: 0,
  useState: 0,
  useEffect: 0,
  className: 0,
  propsWord: 0,
  jsxComponentTag: 0,
}
const perRepo = new Map<string, { files: number; react: number; jsx: number; hooks: number; className: number }>()

/** A JSX-looking tag: `<` immediately followed by a capital letter (component) or a
 *  lowercase tag name, WITHOUT arithmetic/comparison context. Textual and labelled so. */
const looksJSX = (text: string): boolean => {
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] !== "<") continue
    const c = text[i + 1]
    if (c === "/" || c === ">") continue
    if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z")) return true
  }
  return false
}

const hasCall = (text: string, name: string): boolean => {
  const needle = name + "("
  let from = 0
  for (;;) {
    const at = text.indexOf(needle, from)
    if (at < 0) return false
    return true
  }
}

for (const f of files) {
  let text = ""
  try {
    text = fs.readFileSync(f, "utf8")
  } catch {
    continue
  }
  counts.files++
  const rel = f.slice(CR.length + 1)
  const repo = rel.split(path.sep)[0] ?? "(unknown)"
  const stat = perRepo.get(repo) ?? { files: 0, react: 0, jsx: 0, hooks: 0, className: 0 }
  stat.files++
  const reactImport = text.includes(`from "react"`) || text.includes("from 'react'") || text.includes(`from "react-dom"`) || text.includes("from 'react-dom'")
  const hasJsx = looksJSX(text)
  const hasHook = HOOKS.some((h) => hasCall(text, h))
  const hasClass = text.includes("className=")
  if (reactImport) { counts.reactImport++; stat.react++ }
  if (text.includes(`from "react-dom"`) || text.includes("from 'react-dom'")) counts.reactDomImport++
  if (hasJsx) { counts.jsxTag++; stat.jsx++ }
  if (hasHook) { counts.hookAny++; stat.hooks++ }
  if (hasCall(text, "useState")) counts.useState++
  if (hasCall(text, "useEffect")) counts.useEffect++
  if (hasClass) { counts.className++; stat.className++ }
  if (text.includes("props.") || text.includes("Props")) counts.propsWord++
  perRepo.set(repo, stat)
}

console.log(`REACT / TSX — TEXTUAL LAYER (every .tsx under ${CR}; labelled textual)`)
console.log(`  .tsx files ON DISK (excluding .git/node_modules): ${onDisk.length}`)
console.log(`  .tsx files ADMITTED by the indexer's skip list:   ${counts.files}   (${excludedBySkip.length} skipped, named below)`)
for (const f of excludedBySkip) console.log(`    SKIPPED-BY-RULE ${f.slice(CR.length + 1)}`)
console.log(`  imports react or react-dom:               ${counts.reactImport}  (react-dom alone: ${counts.reactDomImport})`)
console.log(`  contains a JSX-shaped tag (<Tag / </Tag>): ${counts.jsxTag}`)
console.log(`  calls a React hook:                       ${counts.hookAny}`)
console.log(`    useState(                              ${counts.useState}`)
console.log(`    useEffect(                             ${counts.useEffect}`)
console.log(`  contains className=:                      ${counts.className}`)
console.log(`  mentions props./Props:                    ${counts.propsWord}`)
console.log(`\n  per repository (files · react import · jsx · hooks · className):`)
for (const [repo, s] of [...perRepo.entries()].sort((a, b) => b[1].files - a[1].files)) {
  console.log(`    ${repo.padEnd(24)} ${String(s.files).padStart(5)} · ${String(s.react).padStart(5)} · ${String(s.jsx).padStart(5)} · ${String(s.hooks).padStart(5)} · ${String(s.className).padStart(5)}`)
}

// ── ANALYZER LAYER (stride sample through the production entry) ─────────────────────────────
const stride = files.length <= SAMPLE ? 1 : Math.ceil(files.length / SAMPLE)
const sample = files.filter((_, i) => i % stride === 0).slice(0, SAMPLE)
const a = {
  files: 0,
  parsed: 0,
  failed: 0,
  symbols: 0,
  rels: 0,
  jsxUsesEdges: 0,
  filesWithJsxUses: 0,
  hookCalls: 0,
  filesWithHookCalls: 0,
  componentTargets: new Set<string>(),
  hookTargets: new Map<string, number>(),
  relByType: new Map<string, number>(),
  resolvedJsx: 0,
}
for (const f of sample) {
  a.files++
  const r: any = await parseFile(f, f.slice(0, f.lastIndexOf("/")))
  if (!r?.success) { a.failed++; continue }
  a.parsed++
  a.symbols += (r.symbols ?? []).length
  const rels = (r.relationships ?? []) as any[]
  a.rels += rels.length
  let jsx = 0
  let hooks = 0
  for (const x of rels) {
    const t = String(x.type)
    a.relByType.set(t, (a.relByType.get(t) ?? 0) + 1)
    const jsxEl = (x.metadata as any)?.jsxElement
    if (t === "uses" && typeof jsxEl === "string") {
      a.jsxUsesEdges++
      jsx++
      if (/^[A-Z]/.test(jsxEl)) a.componentTargets.add(jsxEl)
    }
    if (t === "calls") {
      const tgt = String(x.target ?? "")
      if (tgt.startsWith("use") && tgt.length > 3 && tgt[3] === tgt[3].toUpperCase() && tgt[3] !== tgt[3].toLowerCase()) {
        a.hookCalls++
        hooks++
        a.hookTargets.set(tgt, (a.hookTargets.get(tgt) ?? 0) + 1)
      }
    }
  }
  if (jsx > 0) a.filesWithJsxUses++
  if (hooks > 0) a.filesWithHookCalls++
}
console.log(`\nANALYZER LAYER — stride ${stride}, ${a.files} of ${files.length} .tsx files through parseFile (tsx grammar)`)
console.log(`  parsed: ${a.parsed} · failed: ${a.failed}`)
console.log(`  symbols: ${a.symbols} · relationships: ${a.rels}`)
console.log(`  uses edges carrying jsxElement: ${a.jsxUsesEdges} over ${a.filesWithJsxUses} files`)
console.log(`  distinct JSX component targets: ${a.componentTargets.size}`)
console.log(`  hook calls emitted (calls -> useX): ${a.hookCalls} over ${a.filesWithHookCalls} files`)
console.log(`  top hook targets: ${[...a.hookTargets.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => `${k}:${v}`).join(" · ")}`)
console.log(`  relationship types emitted: ${[...a.relByType.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}:${v}`).join(" · ")}`)
process.exit(0)
