// #925: what the `expression_statement > MISSING ";"` class actually IS at HEAD.
//
// #925 says the class is "a bare macro invocation standing as a whole statement"
// and names three spellings (FMT_END_NAMESPACE, NLOHMANN_JSON_NAMESPACE_END,
// JSON_TRY). Before a grammar spelling is designed, the SITES have to be
// classified by shape, not by the three examples someone happened to read: the
// rule a wave writes must cover the species that exist and touch nothing else.
//
// For every MISSING ";" whose parent is an expression_statement this records:
//   * the expression node type and its source text (the thing that lost its ";")
//   * the NEXT SIBLING of the expression_statement (a macro-declared body leaves
//     the block as a sibling — #919's shape — and that is a different fix)
//   * whether the site sits inside a preprocessor conditional region
// and aggregates the species per corpus with the same deterministic hash-ordered
// sample rule as M14.0.F10 / c743-class-census.ts.
//
// Run: bun script/m14/tmp/c925-species.ts
import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"

// Run from the repo root (`bun script/m60/probe-macro-statement-species.ts`): the
// pinned wasm and web-tree-sitter are resolved against the CWD, as the sibling
// m60 probes do.
const ROOT = process.cwd()
const CORPUS = "$HOME/fixtures/repositories"
const CAP = 400

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })

const SKIP = new Set([".git", "node_modules", "dist", "build", "out", "target", "vendor", "third_party", "__pycache__"])

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  let entries: string[] = []
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return out
  }
  for (const e of entries) {
    if (out.length >= CAP * 4) break
    if (SKIP.has(e)) continue
    const p = path.join(dir, e)
    let st
    try {
      st = fs.statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(p, exts, out)
    else if (exts.includes(path.extname(e)) && st.size > 0 && st.size <= 400_000) out.push(p)
  }
  return out
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex")

const PAREN_REGION = new Set(["preproc_if", "preproc_ifdef", "preproc_else", "preproc_elif"])

async function species(label: string, repo: string, exts: string[], wasm: string) {
  const files = walk(path.join(CORPUS, repo), exts)
    .map((f) => ({ f, h: hash(path.relative(CORPUS, f)) }))
    .sort((a, b) => (a.h < b.h ? -1 : 1))
    .slice(0, CAP)
    .map((x) => x.f)

  const lang = await (L as any).load(fs.readFileSync(path.join(ROOT, "wasm", wasm)))
  const parser = new P()
  parser.setLanguage(lang)

  const bySpecies = new Map<string, { sites: number; files: Set<string>; samples: string[] }>()
  const byExpr = new Map<string, number>()
  let total = 0
  const damaged: string[] = []

  for (const f of files) {
    const rel = path.relative(CORPUS, f)
    const src = fs.readFileSync(f, "utf8")
    const root = parser.parse(src).rootNode
    const st: any[] = [root]
    let fileSites = 0
    while (st.length) {
      const n = st.pop()!
      if (n.isMissing && n.type === ";" && n.parent && n.parent.type === "expression_statement") {
        const expr = n.parent.firstChild
        const exprType = expr && expr.type !== ";" ? expr.type : "(none)"
        const stmt = n.parent
        const next = stmt.nextSibling
        // Is this site inside a preprocessor conditional region?
        let inPreproc = false
        for (let a: any = stmt; a; a = a.parent) if (PAREN_REGION.has(a.type)) { inPreproc = true; break }
        const text = (exprType !== "(none)" ? expr!.text : "").replace(/\s+/g, " ").trim()
        const caps = /^[A-Z][A-Z0-9_]*$/.test(text.split(/[(<\[ ]/)[0] ?? "")
        const sp = `${exprType}${next ? ` + next:${next.type}` : " + next:(none)"}${inPreproc ? " [preproc]" : ""}`
        const cur = bySpecies.get(sp) ?? { sites: 0, files: new Set<string>(), samples: [] }
        cur.sites++
        cur.files.add(rel)
        if (cur.samples.length < 3) cur.samples.push(`${rel}: ${text.slice(0, 60)}`)
        bySpecies.set(sp, cur)
        byExpr.set(`${exprType}${caps ? " (ALLCAPS)" : ""}`, (byExpr.get(`${exprType}${caps ? " (ALLCAPS)" : ""}`) ?? 0) + 1)
        fileSites++
        total++
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) st.push(c)
      }
    }
    if (fileSites) damaged.push(`${rel} ${fileSites}`)
  }

  console.log(`\n### ${label} — ${files.length} files sampled, ${damaged.length} carry expression_statement MISSING ";" — ${total} sites`)
  for (const [sp, v] of [...bySpecies.entries()].sort((a, b) => b[1].sites - a[1].sites)) {
    console.log(`  ${String(v.sites).padStart(5)} sites / ${String(v.files.size).padStart(3)} files — ${sp}`)
    for (const s of v.samples) console.log(`          e.g. ${s}`)
  }
  console.log("  --- expression node types ---")
  for (const [k, v] of [...byExpr.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(v).padStart(5)}  ${k}`)
}

await species("cpp / nlohmann-json", "nlohmann-json", [".hpp", ".cpp", ".h", ".cc", ".hxx"], "tree-sitter-cpp.wasm")
await species("cpp / fmt", "fmt", [".h", ".cpp", ".cc", ".hpp"], "tree-sitter-cpp.wasm")
await species("c / sqlite", "sqlite", [".c", ".h"], "tree-sitter-c.wasm")
await species("c / jq", "jq", [".c", ".h"], "tree-sitter-c.wasm")
