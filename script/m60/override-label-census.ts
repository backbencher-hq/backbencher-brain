// java override-key census — R10 conviction, measured at corpus scale.
//
// The conviction (validation/m60-target-spelling-register.json -> java): an
// anonymous LinkedHashMap subclass overriding `removeEldestEntry` publishes
// `removeEldestEntry.Entry)` and `removeEldestEntry.Entry<String, Boolean>)`
// as its override keys, where the honest key is `LinkedHashMap.removeEldestEntry`.
//
// This probe answers the only question that decides the fix's scope: is that
// ONE site, or a CLASS? It drives the REAL analyzer over real corpus files and
// classifies every emitted override source/target as
//   name-shaped      /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/
//   not-a-name       anything else, with the offending characters recorded
//
// Usage:
//   bun script/m14/tmp/java-override-key-census.ts [--limit N] [repo ...]
import * as fs from "fs"
import * as path from "path"
import { RealJavaAnalyzer } from "../../src/ast/real-java-analyzer"

const args = process.argv.slice(2)
const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : 400
// `first` reproduces the pre-fix runs exactly (walk order, first N) so a
// before/after pair is the SAME files; `stride` is the representative draw.
const sampleMode = args.includes("--sample") ? args[args.indexOf("--sample") + 1] : "stride"
const isDigits = (s: string) => s.length > 0 && [...s].every((c) => c >= "0" && c <= "9")
const repos = args.filter((a) => !a.startsWith("--") && !isDigits(a) && a !== "first" && a !== "stride")
const CORPUS = repos.length
  ? repos
  : ["$HOME/fixtures/repositories/grails-core", "$HOME/intellij-community"]

const SKIP_DIR = new Set(["node_modules", ".git", "build", "out", "target", ".gradle", "generated"])

// Char tests, not regex: the R1 standard is read literally on every file this
// project's instruments live in, and its census is the reason to keep it true
// even where the census does not yet look (it scans src/ast).
function isIdentChar(c: number): boolean {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 36
}
function isIdentStart(c: number): boolean {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95 || c === 36
}

/** `A.b.c` — dotted identifier segments, no punctuation, no spaces. */
function isNameShaped(s: string): boolean {
  if (s.length === 0) return false
  let start = true
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 46) {
      if (start) return false
      start = true
      continue
    }
    if (start ? !isIdentStart(c) : !isIdentChar(c)) return false
    start = false
  }
  return !start
}

function walk(dir: string, out: string[] = [], cap = limit * 4): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (out.length >= cap) return out
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue
      walk(p, out, cap)
    } else if (e.isFile() && e.name.endsWith(".java")) out.push(p)
  }
  return out
}

/** The offending characters of a target, as a stable class key. */
function offence(s: string): string | null {
  if (isNameShaped(s)) return null
  const classes = new Set<string>()
  for (const ch of s) {
    if (ch === "(") classes.add("open-paren")
    else if (ch === ")") classes.add("close-paren")
    else if (ch === ",") classes.add("comma")
    else if (ch === "<") classes.add("open-angle")
    else if (ch === ">") classes.add("close-angle")
    else if (ch === " ") classes.add("space")
    else if (ch === "[") classes.add("open-bracket")
    else if (ch === "]") classes.add("close-bracket")
    else if (ch === "?") classes.add("wildcard")
    else {
      const c = ch.charCodeAt(0)
      if (!isIdentChar(c) && c !== 46) classes.add("other:" + ch)
    }
  }
  return [...classes].sort().join("+")
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-java.wasm"))
  const parser = new P()
  parser.setLanguage(lang)
  const az = new RealJavaAnalyzer()

  const files: string[] = []
  for (const repo of CORPUS) files.push(...walk(repo, [], 60000))
  // Even stride, not the first N: a DFS walk is alphabetical, so `slice(0, N)`
  // samples one subtree (one plugin, one package prefix) and its file shapes
  // are not the corpus's. The stride spreads the draw across the tree and is
  // deterministic, so two runs are comparable.
  const stride = Math.max(1, Math.floor(files.length / limit))
  const picked: string[] = []
  if (sampleMode === "first") picked.push(...files.slice(0, limit))
  else for (let i = 0; i < files.length && picked.length < limit; i += stride) picked.push(files[i])

  let edges = 0
  let filesOk = 0
  const badSamples: { file: string; side: string; value: string; klass: string }[] = []
  const byClass = new Map<string, number>()
  const byClassSide = new Map<string, number>()
  /** site -> count, so a single file cannot dominate the report */
  const byFile = new Map<string, number>()
  /** distinct offending value -> count, so a DISTINCT class cannot hide behind repeats */
  const byValue = new Map<string, number>()
  /** the same override key on both sides is ONE site, not two */
  const pairKeys = new Set<string>()
  let nameShaped = 0
  let badSides = 0

  for (const file of picked) {
    let source: string
    try {
      source = fs.readFileSync(file, "utf8")
    } catch {
      continue
    }
    let res: any
    try {
      const tree = parser.parse(source)
      res = az.analyze(tree.rootNode, source, file)
    } catch {
      continue
    }
    filesOk++
    for (const r of res.relationships ?? []) {
      const type = String(r.type ?? r.label ?? "")
      if (type.toLowerCase().indexOf("overrid") === -1) continue
      edges++
      {
        const s = offence(String(r.source ?? ""))
        const t = offence(String(r.target ?? ""))
        if (s && t && String(r.source) === String(r.target)) pairKeys.add(`${file}|${r.source}`)
      }
      for (const side of ["source", "target"] as const) {
        const v = String(r[side] ?? "")
        const k = offence(v)
        if (!k) {
          nameShaped++
          continue
        }
        badSides++
        byClass.set(k, (byClass.get(k) ?? 0) + 1)
        byClassSide.set(`${side}|${k}`, (byClassSide.get(`${side}|${k}`) ?? 0) + 1)
        byFile.set(file, (byFile.get(file) ?? 0) + 1)
        byValue.set(v, (byValue.get(v) ?? 0) + 1)
        if (badSamples.length < 40) badSamples.push({ file, side, value: v, klass: k })
      }
    }
  }

  process.stdout.write(`corpora: ${CORPUS.join(", ")}\n`)
  process.stdout.write(`files parsed: ${filesOk} (picked ${picked.length} of ${files.length})\n`)
  const rel = (p: string) => {
    const marker = p.indexOf("/repositories/")
    if (marker >= 0) return p.slice(marker + "/repositories/".length)
    const alt = p.indexOf("/intellij-community/")
    if (alt >= 0) return p.slice(alt + "/intellij-community/".length)
    return p
  }
  process.stdout.write(`override edges: ${edges}; name-shaped sides: ${nameShaped}; not-a-name sides: ${badSides}\n`)
  process.stdout.write(`not-a-name by class: ${JSON.stringify(Object.fromEntries([...byClass].sort((a, b) => b[1] - a[1])))}\n`)
  process.stdout.write(`not-a-name by side|class: ${JSON.stringify(Object.fromEntries([...byClassSide].sort((a, b) => b[1] - a[1])))}\n`)
  process.stdout.write(`distinct offending values: ${byValue.size}; files carrying them: ${byFile.size}\n`)
  process.stdout.write(`sites where BOTH sides are the same non-name (one defect, not two): ${pairKeys.size}\n`)
  process.stdout.write(`by file (top 12):\n`)
  for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    process.stdout.write(`  ${String(n).padStart(4)}  ${rel(f)}\n`)
  }
  process.stdout.write(`by distinct value (top 12):\n`)
  for (const [v, n] of [...byValue].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    process.stdout.write(`  ${String(n).padStart(4)}  ${JSON.stringify(v.slice(0, 110))}\n`)
  }
  process.stdout.write(`first samples:\n`)
  const seen = new Set<string>()
  for (const s of badSamples) {
    if (seen.has(s.value)) continue
    seen.add(s.value)
    process.stdout.write(`  [${s.klass}] ${s.side} = ${JSON.stringify(s.value)}  <- ${rel(s.file)}\n`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
