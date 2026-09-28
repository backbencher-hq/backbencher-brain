// M49 W21 (#850) — the `.gradle` surface, measured rather than assumed.
//
// `.gradle` had no language-registry entry, so detectLanguage rejected every
// build script before a grammar was chosen. Registering it (`gradle: "groovy"`)
// activates a surface whose grammar behaviour was unmeasured, so this script
// answers the issue's own question: what does the product actually produce for
// a Gradle build script?
//
// It measures through the PRODUCTION pipeline (parseFile), not a raw parser, and
// counts four things the issue asks about: parse-failure files, missing tokens,
// crashes, and the shape of what the analyzer emits (symbols, relationship
// types, script-level attribution, and whether every relationship carries a
// line — the M59 contract).
//
// Usage: bun script/m59/measure-gradle-surface.ts [--repo NAME] [--limit N]
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"

const REPOS: Record<string, string> = {
  "grails-core": "$HOME/fixtures/repositories/grails-core",
  geb: "$HOME/fixtures/repositories/geb",
}
const args = process.argv.slice(2)
const only = args.includes("--repo") ? args[args.indexOf("--repo") + 1] : null
const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : Infinity
// #850 asks what the newly-exposed surface actually contains, so the first
// failing line of the first N error files can be printed rather than inferred
// from a signature histogram.
const SHOW_ERRORS = args.includes("--show-errors") ? parseInt(args[args.indexOf("--show-errors") + 1]) : 0
let shown = 0

type Row = {
  files: number
  errorFiles: number
  // W17's lesson, applied to my own instrument: a MISSING token and an ERROR node
  // are DIFFERENT failures (the grammar inventing a token vs failing to parse),
  // and conflating them is how the #742 census produced a wrong headline. Counted
  // separately here.
  missingTokens: Map<string, number>
  errorNodes: number
  errorSignatures: Map<string, number>
  crashes: { file: string; error: string }[]
  symbols: number
  rels: number
  relTypes: Map<string, number>
  callTargets: Map<string, number>
  noLine: number
  scriptAttributed: number
  filesWithSymbols: number
}

async function measure(name: string, repo: string): Promise<Row> {
  const revision = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  let files = execFileSync("git", ["-C", repo, "ls-files", "*.gradle"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort()
  if (Number.isFinite(limit)) files = files.slice(0, limit)

  const r: Row = {
    files: 0,
    errorFiles: 0,
    missingTokens: new Map(),
    errorNodes: 0,
    errorSignatures: new Map(),
    crashes: [],
    symbols: 0,
    rels: 0,
    relTypes: new Map(),
    callTargets: new Map(),
    noLine: 0,
    scriptAttributed: 0,
    filesWithSymbols: 0,
  }

  for (const file of files) {
    let src: string
    try {
      src = readFileSync(`${repo}/${file}`, "utf8")
    } catch {
      continue
    }
    r.files++
    const parser = await ASTEngine.getParser("groovy" as any)
    const root = parser.parse(src)?.rootNode
    if (!root) {
      r.crashes.push({ file, error: "no root node" })
      continue
    }
    // Missing tokens are counted from the tree (the m12 instrument's method):
    // a MISSING anonymous node is a token the grammar had to invent.
    if (root.hasError) {
      r.errorFiles++
      const stack: any[] = [root]
      let firstError: string | null = null
      let firstErrorShown = false
      while (stack.length > 0) {
        const n = stack.pop()!
        if (n.isMissing) {
          r.missingTokens.set(n.type, (r.missingTokens.get(n.type) ?? 0) + 1)
          if (!firstError) firstError = `missing:${n.type}`
        }
        if (n.type === "ERROR") {
          r.errorNodes++
          const line = src.split("\n")[n.startPosition.row] ?? ""
          const sig = line.replace(/"(?:[^"\\]|\\.)*"/g, "STR").replace(/[A-Za-z_$][A-Za-z0-9_$]*/g, "ID").trim().slice(0, 60)
          r.errorSignatures.set(sig, (r.errorSignatures.get(sig) ?? 0) + 1)
          if (!firstError) firstError = `error:${sig}`
          if (SHOW_ERRORS > 0 && !firstErrorShown && shown < SHOW_ERRORS) {
            firstErrorShown = true
            shown++
            console.log(`  [error] ${file}:${n.startPosition.row + 1}  ${line.trim().slice(0, 90)}`)
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
      }
      if (firstError) r.errorSignatures.set(`FIRST ${firstError}`, 1)
    }
    try {
      const res: any = await ASTEngine.parseFile(`${repo}/${file}`, src)
      r.symbols += (res.symbols ?? []).length
      if ((res.symbols ?? []).length > 0) r.filesWithSymbols++
      for (const rel of res.relationships ?? []) {
        r.rels++
        const t = String(rel.type ?? rel.relationshipType)
        r.relTypes.set(t, (r.relTypes.get(t) ?? 0) + 1)
        if (rel.line_number === undefined || rel.line_number === null) r.noLine++
        if (rel.source === "(script)") r.scriptAttributed++
        if (t === "calls") r.callTargets.set(String(rel.target), (r.callTargets.get(String(rel.target)) ?? 0) + 1)
      }
    } catch (error: any) {
      r.crashes.push({ file, error: String(error?.message ?? error).slice(0, 160) })
    }
  }

  const top = (m: Map<string, number>, n = 8) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}=${v}`).join(" ")
  const pct = (x: number) => `${((x / Math.max(1, r.files)) * 100).toFixed(1)}%`
  console.log(`\n=== ${name} @ ${revision.slice(0, 12)} — ${r.files} *.gradle files ===`)
  console.log(`parse-failure files : ${r.errorFiles}/${r.files} (${pct(r.errorFiles)})`)
  console.log(`  true ERROR nodes  : ${r.errorNodes}`)
  console.log(`  missing tokens    : ${top(r.missingTokens, 6) || "(none)"}`)
  console.log(`  first-error shapes: ${top(r.errorSignatures, 5) || "(none)"}`)
  console.log(`crashes             : ${r.crashes.length}${r.crashes.length ? " -> " + JSON.stringify(r.crashes.slice(0, 3)) : ""}`)
  console.log(`symbols             : ${r.symbols} across ${r.filesWithSymbols}/${r.files} files`)
  console.log(`relationships       : ${r.rels}  types: ${top(r.relTypes) || "(none)"}`)
  console.log(`  without a line    : ${r.noLine} (M59 contract: must be 0)`)
  console.log(`  source "(script)" : ${r.scriptAttributed}`)
  console.log(`  top call targets  : ${top(r.callTargets, 10)}`)
  return r
}

async function main(): Promise<void> {
  const names = only ? [only] : Object.keys(REPOS)
  for (const n of names) {
    if (!REPOS[n]) throw new Error(`unknown repo ${n}; known: ${Object.keys(REPOS).join(", ")}`)
    await measure(n, REPOS[n])
  }
}
main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
