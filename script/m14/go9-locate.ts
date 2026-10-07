// VERIFY_GO9 locator — finds the exact AST site behind each census finding.
// Walks the production path, then for a named relationship type prints every
// row whose endpoint fails a stated test, with the file and line.
//
//   NFILES=200 TYPE=uses CHECK=placeholder bun script/m14/go9-locate.ts
//   NFILES=200 TYPE=contains CHECK=src-unresolved bun script/m14/go9-locate.ts
//   NFILES=200 TYPE=uses CHECK=noreason bun script/m14/go9-locate.ts
//
// CHECK is a bare word compared with string equality. No regular expression.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const REPO = process.env.BB_REPO || "/tmp/opencode/wt/VERIFY_GO9"
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const DIR = join(CORPUS, process.env.BB_DIR || "go-stdlib")
const NFILES = Number(process.env.NFILES || 200)
const WANT_TYPE = process.env.TYPE || ""
const CHECK = process.env.CHECK || "all"
const LIMIT = Number(process.env.LIMIT || 25)
const SIGNALS = ["func ", "package "]

function pickFiles(dir: string, want: number): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number) => {
    if (out.length >= want || depth > 20) return
    let ents: any[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (out.length >= want) return
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === ".git" || e.name === "node_modules") continue
        walk(p, depth + 1)
      } else if (e.name.endsWith(".go")) {
        try {
          if (statSync(p).size >= 400_000) continue
          const src = readFileSync(p, "utf8")
          if (!SIGNALS.some((s) => src.includes(s))) continue
          out.push(p)
        } catch {}
      }
    }
  }
  walk(dir, 0)
  return out.slice(0, want)
}

const PLACEHOLDERS = new Set([
  "unknown", "Unknown", "<unknown>", "?", "TODO", "todo", "TBD", "tbd",
  "placeholder", "PLACEHOLDER", "xxx", "XXX", "nil", "null", "undefined",
  "unknown_type", "unknownName", "unknown_name", "unresolved", "N/A", "n/a",
])
function isPlaceholder(s: string): boolean {
  if (PLACEHOLDERS.has(s)) return true
  if (s.length >= 2) {
    const a = s.charCodeAt(0), b = s.charCodeAt(s.length - 1)
    if ((a === 60 && b === 62) || (a === 123 && b === 125) || (a === 91 && b === 93)) return true
  }
  return false
}

const { getParser } = await import(`${REPO}/src/ast/engine.ts`)
const { RealGoAnalyzer } = await import(`${REPO}/src/ast/real-go-analyzer.ts`)

const files = pickFiles(DIR, NFILES)
let hits = 0, shown = 0
const byLabel = new Map<string, number>()

for (const f of files) {
  let res: any
  try {
    const content = readFileSync(f, "utf8")
    const parser = await getParser("go")
    const pr = await parser.parse(content, f)
    res = new RealGoAnalyzer().analyze(pr.rootNode, content, f)
  } catch { continue }
  const short = f.slice(DIR.length + 1)
  const byName = new Set<string>(), qualified = new Set<string>()
  for (const s of res.symbols || []) {
    const n = String(s.name ?? "")
    if (!n) continue
    byName.add(n)
    const owner = s.ownerName ?? s.containerName ?? s.metadata?.receiverType
    if (typeof owner === "string" && owner) qualified.add(`${owner}.${n}`)
  }
  for (const r of res.relationships || []) {
    const t = String(r.relationshipType ?? r.type ?? "")
    if (WANT_TYPE && t !== WANT_TYPE) continue
    const src = String(r.source ?? r.from ?? "")
    const tgt = String(r.target ?? r.to ?? "")
    const md = r.metadata || {}
    const label = String(md.relationshipType ?? "<none>")
    const conf = typeof r.confidence === "number" ? r.confidence : -1
    let why = ""
    if (CHECK === "placeholder") {
      if (isPlaceholder(src) || isPlaceholder(tgt)) why = "placeholder"
    } else if (CHECK === "src-unresolved") {
      if (t !== "imports" && !byName.has(src) && !qualified.has(src)) why = "src-unresolved"
    } else if (CHECK === "tgt-unresolved") {
      if (t !== "imports" && !byName.has(tgt) && !qualified.has(tgt)) why = "tgt-unresolved"
    } else if (CHECK === "noreason") {
      if (conf < 1.0 && !(typeof md.reasonCode === "string" && md.reasonCode.length)) why = "no-reasonCode"
    } else if (CHECK === "all") {
      why = "all"
    } else why = "all"
    if (!why) continue
    hits++
    byLabel.set(label, (byLabel.get(label) || 0) + 1)
    if (shown < LIMIT) {
      shown++
      console.log(
        `${short}:${r.line_number ?? "?"}  [${t}] ${src} -> ${tgt}  conf=${conf}  label=${label}` +
        (md.reasonCode ? `  reasonCode=${md.reasonCode}` : "  reasonCode=<none>"),
      )
    }
  }
}
console.log(`\nTOTAL ${hits} rows of type ${WANT_TYPE || "(any)"} failing CHECK=${CHECK}`)
console.log("by label: " + [...byLabel.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join("  "))