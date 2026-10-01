/**
 * Is the wired C++ wasm the published tree-sitter-cpp@0.23.4, or a LOCAL FORK of
 * it? The answer decides what the pin may honestly claim, so it is measured on the
 * corpus rather than asserted from a version string.
 *
 * `script/m12/cpp-wasm-compare.ts` already made this comparison for the M12
 * grammar swap, but its paths are hardcoded to another machine
 * (`$HOME/...`, `/tmp/ts-cpp-npm/...`). This is the same measurement with
 * the two files supplied as arguments, plus the parse-error counts that decide
 * whether the local rules are LOAD-BEARING (a fork nobody can feel is just a
 * different build; a fork that fixes N files is part of the pin).
 *
 *   bun run script/cpp-review/grammar-provenance.ts <wired.wasm> <upstream.wasm> [repo...]
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { loadWebTreeSitter } from "../../src/util/wasm"

const [, , wiredPath, upstreamPath, ...repoArgs] = process.argv
if (!wiredPath || !upstreamPath) {
  console.error("usage: grammar-provenance.ts <wired.wasm> <upstream.wasm> [repo...]")
  process.exit(2)
}
const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/ishaq/fixtures/repositories"
const REPOS = repoArgs.length ? repoArgs : (process.env.CPP_REPOS ?? "fmt,nlohmann-json,catch2").split(",").filter(Boolean)
const EXTS = [".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".hh", ".h++"]
const SKIP = new Set([".git", "build", "node_modules", ".github", "cmake-build-debug"])
const OUT = process.env.CPP_OUT ?? "/tmp/opencode/cpp-review"

const walk = (d: string, out: string[] = [], depth = 0): string[] => {
  if (depth > 9) return out
  let es: string[]
  try { es = readdirSync(d) } catch { return out }
  for (const e of es) {
    if (SKIP.has(e)) continue
    const p = path.join(d, e)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out, depth + 1)
    else if (EXTS.some((x) => p.endsWith(x)) && st.size > 0) out.push(p)
  }
  return out
}

// The engine's own idiom (script/m14/differential.ts:14932): `Language.load` takes
// the BYTES, not a path, and `Language`/`Parser` may sit on the module or its
// default. Passing a path — as the first cut of this probe did — throws
// "undefined is not an object (evaluating 'C.loadWebAssemblyModule')".
const wts: any = await loadWebTreeSitter()
const Language = wts.Language ?? wts.default?.Language
const ParserClass = wts.Parser ?? wts.default?.Parser ?? wts
// `Language.load` runs the emscripten glue, which needs the CORE wasm located
// first. The differential does exactly this (script/m14/differential.ts:14668) and
// skipping it is what makes `C.loadWebAssemblyModule` undefined at runtime.
const initFn = ParserClass.init
if (initFn) {
  await initFn({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
}
const load = async (p: string) => {
  const lang = await Language.load(readFileSync(p))
  const parser = new ParserClass()
  parser.setLanguage(lang)
  return { parser, lang }
}
const A = await load(wiredPath)
const B = await load(upstreamPath)

const typeIds = (lang: any) => {
  const t = lang.types ?? []
  return t.map((x: any) => x.type).sort()
}
const idsA = typeIds(A.lang), idsB = typeIds(B.lang)
const setB = new Set(idsB)
const onlyFork = idsA.filter((t: string) => !setB.has(t))
const setA = new Set(idsA)
const onlyUpstream = idsB.filter((t: string) => !setA.has(t))

let files = 0, forkClean = 0, upstreamClean = 0, bothClean = 0
let forkBetter = 0, upstreamBetter = 0, sameOutcome = 0
const better: any[] = [], worse: any[] = []
const sampleLimit = 12

for (const repo of REPOS) {
  // a repo argument may be ABSOLUTE (a fixtures dir), not a name under CORPUS
  for (const f of walk(path.isAbsolute(repo) ? repo : path.join(CORPUS, repo))) {
    const content = readFileSync(f, "utf8")
    files++
    const ta: any = A.parser.parse(content)
    const tb: any = B.parser.parse(content)
    const ea = ta.rootNode.hasError, eb = tb.rootNode.hasError
    if (!ea) forkClean++
    if (!eb) upstreamClean++
    if (!ea && !eb) bothClean++
    if (!ea && eb) {
      forkBetter++
      if (better.length < sampleLimit) better.push({ repo, file: f.replace(CORPUS + "/", ""), fork: "clean", upstream: "errors" })
    } else if (ea && !eb) {
      upstreamBetter++
      if (worse.length < sampleLimit) worse.push({ repo, file: path.isAbsolute(repo) ? f : f.replace(CORPUS + "/", ""), fork: "errors", upstream: "clean" })
    } else sameOutcome++
    ta.delete(); tb.delete()
  }
  process.stderr.write(`${repo} done files=${files}\n`)
}

const out = {
  generatedAt: new Date().toISOString(),
  wired: wiredPath, upstream: upstreamPath,
  files, repos: REPOS,
  surface: {
    wiredTypeCount: idsA.length, upstreamTypeCount: idsB.length,
    onlyInFork: onlyFork, onlyInUpstream: onlyUpstream,
  },
  parseErrors: {
    forkErrorFiles: files - forkClean, upstreamErrorFiles: files - upstreamClean,
    forkClean: forkClean, upstreamClean: upstreamClean, bothClean,
    forkBetter, upstreamBetter, sameOutcome,
  },
  forkBetterSamples: better, upstreamBetterSamples: worse,
}
mkdirSync(OUT, { recursive: true })
writeFileSync(path.join(OUT, "grammar-provenance.json"), JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
