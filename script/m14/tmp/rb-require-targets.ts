/**
 * RUBY LANE — is the `references` resolution rate a DEFECT or a FACT? (M60)
 *
 * The reachability measurement said `references` resolves at 2.9%: 1,194 edges
 * emitted, stored, and returnable by no graph query. That number was reported as
 * the sharpest remaining case, and a fix was proposed — join the graph to
 * `brain_import` so a require can be followed to the file it names.
 *
 * Before building that join, this asks the question that decides whether it is
 * even correct to build: does a `require` target NAME A FILE IN THE PROJECT?
 *
 * A require has two shapes, and conflating them is the whole risk:
 *
 *   require_relative "./foo"  — a path RELATIVE TO THE REQUIRING FILE. It
 *                               names a file in the project, or nothing. An
 *                               unresolvable one is a broken edge worth fixing.
 *   require "rails/all"       — a LOAD-PATH name. It names a GEM, which is not
 *                               in this repository. No amount of joining turns
 *                               `rails/all` into an in-project symbol, and
 *                               resolving it to some same-named local would be
 *                               FABRICATION — the exact defect this round has
 *                     spent twelve fixes removing from the parser.
 *
 * So the measurement is per-shape, and the output is a claim about which slice
 * is actionable rather than a single rate.
 *
 * Usage:
 *   npx tsx script/m14/tmp/rb-require-targets.ts <corpus-root>... [--limit N]
 */
import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"
import { RealRubyAnalyzer } from "../../../src/ast/real-ruby-analyzer"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..", "..")

function listRubyFiles(root: string): string[] {
  const out: string[] = []
  const skip = new Set([".git", "node_modules", "vendor", "tmp", "log"])
  const walk = (d: string) => {
    let ents: fs.Dirent[]
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (e.name.startsWith(".")) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (!skip.has(e.name)) walk(p) }
      else if (e.isFile() && e.name.endsWith(".rb")) out.push(p)
    }
  }
  walk(root)
  return out.sort()
}

type Shape = "relative" | "absolute" | "bare" | "empty"

const shapeOf = (t: string): Shape =>
  !t ? "empty"
  : t.startsWith("./") || t.startsWith("../") ? "relative"
  : t.startsWith("/") ? "absolute"
  : "bare"

async function main() {
  await Parser.init()
  const parser = new Parser()
  const lang = await Language.load(path.join(ROOT, "wasm", "tree-sitter-ruby.wasm"))
  parser.setLanguage(lang as any)

  const limitAt = process.argv.indexOf("--limit")
  const LIMIT = limitAt >= 0 ? parseInt(process.argv[limitAt + 1]) : Infinity
  const roots = process.argv.slice(2).filter((a, i) => !a.startsWith("--") && !(i > 0 && process.argv[i - 1] === "--limit"))
  if (roots.length === 0) { console.error("usage: rb-require-targets.ts <corpus-root>... [--limit N]"); process.exit(2) }
  let allFiles: string[] = []
  for (const r of roots) allFiles = allFiles.concat(listRubyFiles(path.resolve(r)))
  const corpusTotal = allFiles.length

  // The index of files that EXIST is built from the WHOLE corpus, before any
  // striding. Built from the sample instead — the obvious place to build it,
  // since the sample is the list in hand — every require pointing at a file
  // outside the sample scores as "no file in the project carries this name",
  // and the probe reports its own sampling as a language fact. It did: a
  // verified `require_relative "action_cable/version"` in actioncable/lib was
  // scored unresolvable while the file sat in the corpus. The DENOMINATOR here
  // is the corpus; only the PARSING is sampled.
  const relIndex = new Set<string>()
  const dirsByRoot = new Map<string, string[]>()
  for (const r of roots) {
    const abs = path.resolve(r)
    const rel = allFiles.filter((f) => f.startsWith(abs + path.sep)).map((f) => path.relative(abs, f))
    dirsByRoot.set(abs, rel)
    for (const p of rel) relIndex.add(p.split(path.sep).join("/"))
  }

  let files = allFiles
  if (Number.isFinite(LIMIT) && files.length > LIMIT) {
    const stride = files.length / LIMIT
    const picked: string[] = []
    for (let i = 0; i < LIMIT; i++) picked.push(files[Math.floor(i * stride)])
    files = picked
  }
  // `require "foo/bar"` resolves against a LOAD PATH. Rails and most gems put
  // `lib/` on it, so a bare name is tested against lib/ as well as the root —
  // otherwise a genuine in-project `lib/foo` reads as external.
  const LOAD_PATHS = ["", "lib/", "app/"]

  const byMethodShape = new Map<string, number>()
  const hits = { inProject: 0, notInProject: 0 }
  const perMethod = new Map<string, { n: number; inProject: number }>()
  const examples: { inProject: string[]; external: string[] } = { inProject: [], external: [] }
  let refs = 0, errs = 0, done = 0

  for (const f of files) {
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    let tree: any
    try { tree = parser.parse(content) } catch { errs++; continue }
    let res: any
    try { res = new RealRubyAnalyzer().analyze(tree.rootNode, content, f) } catch { errs++; continue }
    const dir = path.dirname(f)
    for (const r of res.relationships ?? []) {
      if (String(r.type ?? "") !== "references") continue
      const target = String(r.target ?? "")
      const method = String(r.metadata?.requireMethod ?? "(none)")
      const shape = shapeOf(target)
      refs++
      const mk = `${method} / ${shape}`
      byMethodShape.set(mk, (byMethodShape.get(mk) ?? 0) + 1)
      const st = perMethod.get(method) ?? { n: 0, inProject: 0 }
      st.n++

      // Does this target name a file that exists?
      let resolved: string | null = null
      // `require_relative` is RELATIVE TO THE REQUIRING FILE whatever it looks
      // like. First run resolved it only when the target began `./` or `../`, so
      // the 146 `require_relative "action_cable/version"` edges — bare names that
      // are the single largest in-project shape in a gem — were tested against
      // the LOAD PATH and scored 0. A bare name under `require_relative` is the
      // single most in-project shape there is; reading it as a gem name is the
      // same category error this probe exists to avoid, made by the probe.
      if (method === "require_relative") {
        const base = path.normalize(path.join(dir, target))
        for (const cand of [base, base + ".rb", path.join(base, "index.rb")]) {
          const rootAbs = [...dirsByRoot.keys()].find((r) => cand.startsWith(r + path.sep))
          if (!rootAbs) continue
          const rel = path.relative(rootAbs, cand).split(path.sep).join("/")
          if (relIndex.has(rel)) { resolved = rel; break }
        }
      } else if (shape === "relative") {
        // Ruby appends .rb when the name omits it.
        const base = path.normalize(path.join(dir, target))
        for (const cand of [base, base + ".rb", path.join(base, "index.rb")]) {
          const rel = path.relative(roots.map((r) => path.resolve(r)).find((r) => cand.startsWith(r + path.sep)) ?? dir, cand)
          if (relIndex.has(rel.split(path.sep).join("/"))) { resolved = rel; break }
        }
      } else if (shape === "absolute") {
        const base = path.normalize(target)
        for (const cand of [base, base + ".rb", path.join(base, "index.rb")]) {
          for (const rootAbs of dirsByRoot.keys()) {
            const rel = path.relative(rootAbs, cand)
            if (!rel.startsWith("..") && relIndex.has(rel.split(path.sep).join("/"))) { resolved = rel; break }
          }
          if (resolved) break
        }
      } else {
        const bare = target.endsWith(".rb") ? target.slice(0, -3) : target
        for (const lp of LOAD_PATHS) {
          const rel = lp + bare + ".rb"
          if (relIndex.has(rel)) { resolved = rel; break }
          if (relIndex.has(lp + bare + "/index.rb")) { resolved = lp + bare + "/index.rb"; break }
        }
      }

      if (resolved) {
        hits.inProject++
        st.inProject++
        if (examples.inProject.length < 6) examples.inProject.push(`${path.relative(dir, f)} -> ${target} => ${resolved}`)
      } else {
        hits.notInProject++
        if (examples.external.length < 6) examples.external.push(`${method} "${target}"`)
      }
      perMethod.set(method, st)
    }
    if (++done % 2000 === 0) process.stderr.write(`  ${done}/${files.length}\r`)
  }

  const pct = (n: number, d: number) => d === 0 ? "0.0%" : ((n / d) * 100).toFixed(1) + "%"
  console.log("=".repeat(90))
  console.log("M60 — RUBY `references` TARGETS: actionable slice or language fact?")
  console.log("=".repeat(90))
  console.log(`corpus: ${corpusTotal} .rb files, ${files.length} read (even stride)`)
  console.log(`references edges: ${refs}   parse errors: ${errs}\n`)

  console.log("by require method x target shape")
  for (const k of [...byMethodShape.keys()].sort()) {
    console.log(`  ${k.padEnd(30)} ${String(byMethodShape.get(k)).padStart(6)}  ${pct(byMethodShape.get(k)!, refs)}`)
  }

  console.log("\ndoes the target name a file that EXISTS in the corpus?")
  console.log(`  in-project      ${String(hits.inProject).padStart(6)}  ${pct(hits.inProject, refs)}`)
  console.log(`  not in-project  ${String(hits.notInProject).padStart(6)}  ${pct(hits.notInProject, refs)}`)

  console.log("\nper require method (the decision-relevant split)")
  console.log("  " + "method".padEnd(18) + "edges".padStart(8) + "in-project".padStart(12) + "rate".padStart(9))
  for (const [m, v] of [...perMethod.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${m.padEnd(18)}${String(v.n).padStart(8)}${String(v.inProject).padStart(12)}${pct(v.inProject, v.n).padStart(9)}`)
  }

  console.log("\nexamples — resolvable to a real file:")
  for (const e of examples.inProject) console.log("  " + e)
  console.log("examples — no file in the project carries this name:")
  for (const e of examples.external) console.log("  " + e)

  fs.mkdirSync(path.join(ROOT, "validation", "m60", "results"), { recursive: true })
  fs.writeFileSync(path.join(ROOT, "validation", "m60", "results", "ruby-require-targets.json"), JSON.stringify({
    at: new Date().toISOString(), corpusTotal, filesRead: files.length, references: refs, parseErrors: errs,
    byMethodShape: Object.fromEntries(byMethodShape), hits, perMethod: Object.fromEntries(perMethod), examples,
  }, null, 2))
  console.log("\nevidence: validation/m60/results/ruby-require-targets.json")
}

main()
