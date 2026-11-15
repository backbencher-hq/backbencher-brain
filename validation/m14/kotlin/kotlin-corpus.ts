// Shared corpus picker for the VERIFY_KOTLIN lane.
// NO REGEX anywhere in this lane's scripts (hard rule 1): every test on a path
// is indexOf / endsWith / charCodeAt. A regular expression over file NAMES is
// only a smell, but the rule is the rule and the point is that the same
// discipline which forbids regex over SOURCE also keeps the sample honest.
import { readdirSync, statSync, existsSync } from "node:fs"
import { join } from "node:path"

export const KOTLIN_CORPUS = "/home/ishaq2321/bb_tests/repositories/kotlin"
export const KOTLIN_CORPUS_PIN = "9b80c8ff99f3a63fcf578010bb2712697f4886aa"

// Directory names never walked. Compared with exact equality after lowercasing
// so `Build` and `build` are the same skip (no case-insensitive regex).
const SKIP_DIRS = [
  ".git", ".gradle", ".idea", "node_modules", "build", "out", "dist", "target",
  "bazel-out", "bazel-bin", "bazel-testlogs", "testdata", "test-data", "fixtures",
  "third-party", "intellij.yaml", ".kotlin",
]

function skipDir(name: string): boolean {
  const low = name.toLowerCase()
  for (const s of SKIP_DIRS) if (low === s.toLowerCase()) return true
  return false
}

export function isKt(p: string): boolean { return p.endsWith(".kt") }
export function isKts(p: string): boolean { return p.endsWith(".kts") }

export interface CorpusFile {
  path: string
  rel: string
  bytes: number
  lines: number
  isScript: boolean
}

/** Whole-tree walk, collecting .kt/.kts files. Iterative (no recursion limit). */
export function walkKotlin(root: string, opts?: { minBytes?: number; maxBytes?: number }): CorpusFile[] {
  const min = opts?.minBytes ?? 0
  const max = opts?.maxBytes ?? 400000
  const out: CorpusFile[] = []
  const stack: string[] = [root]
  while (stack.length) {
    const d = stack.pop() as string
    let ents: any[]
    try { ents = readdirSync(d, { withFileTypes: true }) as any } catch { continue }
    for (const e of ents) {
      if (e.isDirectory()) {
        if (skipDir(e.name)) continue
        stack.push(join(d, e.name))
      } else if (e.isFile()) {
        const p = join(d, e.name)
        if (!isKt(p) && !isKts(p)) continue
        let st: any
        try { st = statSync(p) } catch { continue }
        if (st.size < min || st.size > max) continue
        out.push({
          path: p,
          rel: p.startsWith(root) ? p.slice(root.length + 1) : p,
          bytes: st.size,
          lines: 0,
          isScript: isKts(p),
        })
      }
    }
  }
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  return out
}

/**
 * Deterministic stratified sample. Sorted by path, then every STRIDE-th file,
 * which spreads the sample across every top-level module instead of taking the
 * first N in readdir order (which is what the shared firing-check does and is
 * why its answer is a statement about whichever directory happened to sort
 * first).
 */
export function stratify(files: CorpusFile[], want: number): CorpusFile[] {
  if (files.length <= want) return files.slice()
  const stride = files.length / want
  const out: CorpusFile[] = []
  for (let i = 0; i < want; i++) out.push(files[Math.floor(i * stride)])
  return out
}

/** How many top-level corpus modules the sample touches — a coverage number. */
export function moduleSpread(files: CorpusFile[]): { modules: number; perModule: Record<string, number> } {
  const perModule: Record<string, number> = {}
  for (const f of files) {
    const slash = f.rel.indexOf("/")
    const m = slash === -1 ? "." : f.rel.slice(0, slash)
    perModule[m] = (perModule[m] || 0) + 1
  }
  const keys = Object.keys(perModule).sort()
  const out: Record<string, number> = {}
  for (const k of keys) out[k] = perModule[k]
  return { modules: keys.length, perModule: out }
}

export function corpusExists(): boolean { return existsSync(KOTLIN_CORPUS) }