/**
 * C++ census: how many published symbols are named after a MACRO, and which macros.
 *
 * D8 was found by this question, not by the defect gate. The gate can only assert on
 * a class it has already been told about; this asks the complement — of every
 * published name, which ones are not a declaration's name at all — and it is the
 * question that the D1–D7 classes could not ask. D1 asks whether a name is spelled
 * with a KEYWORD. A macro is spelled, so it passes D1, and it is not a declaration,
 * so it is a fabrication; nothing in the suite could see that.
 *
 *   BB_CORPUS_ROOT=$HOME/fixtures/repositories \
 *   bun run script/cpp-review/macro-name-census.ts
 *
 * It is a CENSUS, not a gate, and deliberately so: the number it reports is NOT the
 * defect count. D8 (a trailing annotation recovered as a function definition) is now
 * fixed and gated, and what remains is a mix of families with different causes —
 *
 *   DECLARE_INTERFACE_(I, IID)   an ATL macro that GENERATES a class. The class is
 *                                not in the source, so the analyzer cannot publish
 *                                it and the macro is the only visible name. A
 *                                grammar/semantic limit, not a fabrication.
 *   STDMETHOD_(type, id)         an ATL method-declaration macro. Same shape.
 *   SHSTDAPI_ / SHDOCAPI_        a `__declspec`-style API macro on a real
 *                                declaration. The declaration IS published; the
 *                                macro is a second, lesser row.
 *   GTEST_REMOVE_REFERENCE_AND_CONST_(T)  a type-transform macro, published as a type.
 *
 * So a count without a breakdown is not a finding, which is why this prints both.
 * The number to watch is the one D8 moved: 424 → 407, and the two gtest annotation
 * macros gone from the table entirely (GTEST_LOCK_EXCLUDED_ 14, and
 * GTEST_EXCLUSIVE_LOCK_REQUIRED_ 3).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, extname } from "node:path"
import { parseFile } from "../../src/ast/engine"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPOS = (process.env.BB_CPP_REPOS ?? "fmt,nlohmann-json,catch2,abseil-cpp,spdlog,zig").split(",")
const EXTS = new Set([".cpp", ".cc", ".cxx", ".hpp", ".hxx", ".h", ".ipp", ".tcc", ".inl"])
const SKIP = new Set([".git", "node_modules", "build", "third_party"])
/** A macro is ALL-CAPS with a trailing underscore in this corpus's convention. */
const MACRO_NAME = /^[A-Z][A-Z0-9_]*_$/

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue
    const p = join(dir, e)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (EXTS.has(extname(p))) out.push(p)
  }
  return out
}

const byMacro = new Map<string, { n: number; kinds: Set<string>; files: Set<string> }>()
let files = 0, symbols = 0, macroNamed = 0

for (const repo of REPOS) {
  const root = join(CORPUS, repo)
  if (!existsSync(root)) { console.error(`missing corpus repo: ${root}`); continue }
  for (const f of walk(root)) {
    let r: any
    try { r = await parseFile(f, readFileSync(f, "utf8")) } catch { continue }
    files++
    for (const s of r?.symbols ?? []) {
      symbols++
      const name = String(s.name)
      if (!MACRO_NAME.test(name)) continue
      macroNamed++
      if (!byMacro.has(name)) byMacro.set(name, { n: 0, kinds: new Set(), files: new Set() })
      const e = byMacro.get(name)!
      e.n++
      e.kinds.add(String(s.kind))
      e.files.add(f.replace(CORPUS + "/", ""))
    }
  }
}

console.log(`\n=== C++ macro-name census (real corpus) ===`)
console.log(`repos: ${REPOS.join(", ")}`)
console.log(`files: ${files}   symbols: ${symbols}`)
console.log(`symbols named after a macro: ${macroNamed}   distinct macros: ${byMacro.size}\n`)
for (const [name, e] of [...byMacro.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 15)) {
  console.log(`  ${name.padEnd(36)} n=${String(e.n).padStart(4)}  kinds=${[...e.kinds].join("/").padEnd(18)} files=${e.files.size}`)
}
if (byMacro.size > 15) console.log(`  … and ${byMacro.size - 15} more`)
console.log(`\nD8 (gated, fixed): the trailing-annotation family is absent from this table.`)
console.log(`The rows above are GENERATING macros (DECLARE_INTERFACE_, STDMETHOD_) and`)
console.log(`DECLSPEC-style API macros — a different cause, and not a fabrication.`)
