// M59 (#825): does a java symbol's range start at its leading ANNOTATION (as
// scala's did before the fix)? scala settled the contract (the declaration line
// is where the declaration is written; an annotation is a modifier), but java
// must be MEASURED rather than assumed to share it — and java's ~40 fixtures pin
// no symbol start line at all, so the question is what real code says.
import * as fs from "fs"
import * as path from "path"

const REPOS = "<corpus-root>/bb_tests/repositories"

function walk(dir: string, out: string[], limit: number): void {
  if (out.length >= limit) return
  let ents: fs.Dirent[]
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of ents) {
    if (out.length >= limit) return
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "target") continue
      walk(p, out, limit)
    } else if (e.name.endsWith(".java")) out.push(p)
  }
}

async function main(): Promise<void> {
  const { ASTEngine } = await import(path.join(ROOT_CONST, "src/ast/engine.ts"))
  const files: string[] = []
  walk(REPOS, files, 300)
  let annotated = 0
  let onAnnotation = 0
  let membersWithLine = 0
  const samples: string[] = []
  for (const f of files) {
    if (annotated >= 12) break
    let src: string
    try {
      src = fs.readFileSync(f, "utf8")
    } catch {
      continue
    }
    if (!src.includes("@")) continue
    const lines = src.split("\n")
    let res: any
    try {
      res = await ASTEngine.parseFile(f, src)
    } catch {
      continue
    }
    for (const s of res?.symbols ?? []) {
      const ln = s.range?.startLine
      if (typeof ln !== "number" || ln < 1 || ln > lines.length) continue
      membersWithLine++
      const text = (lines[ln - 1] ?? "").trim()
      if (!text.startsWith("@")) continue
      annotated++
      onAnnotation++
      if (samples.length < 8) {
        samples.push(`${path.basename(f)}:${ln} ${s.kind} ${s.name} :: ${text.slice(0, 60)} | next line: ${(lines[ln] ?? "").trim().slice(0, 50)}`)
      }
    }
  }
  console.log(`files scanned: ${files.length}`)
  console.log(`symbols with a line: ${membersWithLine}`)
  console.log(`symbol lines landing ON an annotation: ${onAnnotation}`)
  for (const s of samples) console.log("  " + s)
}

const ROOT_CONST = "<corpus-root>/mcp/backbencher-brain"
main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
