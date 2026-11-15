// Why does M12.06 claim 0/400 grails-core files with grammar errors while the
// W17 census measures 59.0% of 6564? This measures the EXACT M12 sample list
// (validation/m12/results/groovy-corpus-sample.txt) under the pinned wasm, and
// reports the top-level directory distribution of the sample vs the corpus so
// the sampling rule itself can be judged.
//
// Usage: bun run script/m14/tmp/groovy-sample-bias.ts
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const REPO = "/home/ishaq2321/bb_tests/repositories/grails-core"
const SAMPLE = ROOT + "/validation/m12/results/groovy-corpus-sample.txt"

function walkAll(dir: string, out: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walkAll(full, out)
    else if (e.isFile() && e.name.endsWith(".groovy")) out.push(full)
  }
}

function census(root: any): { err: boolean; miss: boolean; firstErr: string } {
  const st = { err: false, miss: false, firstErr: "" }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (n.type === "ERROR") {
      st.err = true
      if (!st.firstErr) st.firstErr = "ERROR @" + n.startPosition.row
    }
    if (n.isMissing) {
      st.miss = true
      if (!st.firstErr) st.firstErr = "MISSING " + n.type + " @" + n.startPosition.row
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  return st
}

function topDir(rel: string): string {
  const parts = rel.split("/")
  return parts.length > 1 ? parts[0] : "(root)"
}

async function main() {
  const wts: any = WTS
  const Parser = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const grammar = await Language.load(fs.readFileSync(ROOT + "/wasm/tree-sitter-groovy.wasm"))
  const P = new Parser()
  P.setLanguage(grammar)

  const sampleRels = fs
    .readFileSync(SAMPLE, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  console.log("=== corpus-wide (all .groovy) ===")
  const all: string[] = []
  walkAll(REPO, all)
  console.log("corpus files:", all.length)

  // Top-level distribution: sample vs corpus
  const sampleDirs: Record<string, number> = {}
  for (const r of sampleRels) {
    const d = topDir(r)
    sampleDirs[d] = (sampleDirs[d] ?? 0) + 1
  }
  const corpusDirs: Record<string, number> = {}
  for (const f of all) {
    const d = topDir(path.relative(REPO, f))
    corpusDirs[d] = (corpusDirs[d] ?? 0) + 1
  }
  const dirs = Object.keys(corpusDirs).sort()
  console.log("\n=== top-level dir: sample vs corpus ===")
  for (const d of dirs) {
    const s = sampleDirs[d] ?? 0
    const c = corpusDirs[d] ?? 0
    console.log(
      "  " + d.padEnd(28) + " sample " + String(s).padStart(4) + " / corpus " + String(c).padStart(5) +
        (s === 0 ? "   <-- NOT SAMPLED" : ""),
    )
  }

  console.log("\n=== measuring the EXACT M12 sample (" + sampleRels.length + " files) ===")
  let sFiles = 0, sErr = 0, sMiss = 0, sEither = 0
  const failExamples: { file: string; why: string }[] = []
  for (const rel of sampleRels) {
    const full = path.join(REPO, rel)
    let src: string
    try {
      src = fs.readFileSync(full, "utf8")
    } catch {
      console.log("  MISSING FILE IN CORPUS: " + rel)
      continue
    }
    let root: any
    try {
      root = P.parse(src).rootNode
    } catch {
      sErr++; sEither++; sFiles++;
      failExamples.push({ file: rel, why: "parse threw" })
      continue
    }
    const st = census(root)
    sFiles++
    if (st.err) sErr++
    if (st.miss) sMiss++
    if (st.err || st.miss) {
      sEither++
      if (failExamples.length < 10) failExamples.push({ file: rel, why: st.firstErr })
    }
  }
  console.log(
    "sample: files " + sFiles + " | ERROR " + sErr + " | MISSING " + sMiss + " | either " + sEither +
      "  (" + ((sEither / Math.max(1, sFiles)) * 100).toFixed(1) + "%)",
  )
  if (failExamples.length > 0) {
    console.log("  examples:")
    for (const e of failExamples) console.log("    " + e.file + "  ->  " + e.why)
  }

  console.log("\n=== same measurement, whole corpus (for contrast) ===")
  let cFiles = 0, cErr = 0, cMiss = 0, cEither = 0
  for (const f of all) {
    let src: string
    try {
      src = fs.readFileSync(f, "utf8")
    } catch {
      continue
    }
    let root: any
    try {
      root = P.parse(src).rootNode
    } catch {
      cErr++; cEither++; cFiles++
      continue
    }
    const st = census(root)
    cFiles++
    if (st.err) cErr++
    if (st.miss) cMiss++
    if (st.err || st.miss) cEither++
  }
  console.log(
    "corpus: files " + cFiles + " | ERROR " + cErr + " | MISSING " + cMiss + " | either " + cEither +
      "  (" + ((cEither / Math.max(1, cFiles)) * 100).toFixed(1) + "%)",
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
