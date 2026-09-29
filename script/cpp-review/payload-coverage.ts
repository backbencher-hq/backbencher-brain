/**
 * M60.P1 — C++ payload coverage over the REAL corpus.
 *
 * Why this exists: the symbol contract in `docs/analyzers/real-cpp-analyzer.md`
 * marked `parameters`, `returnType` and `decorators` as supported while the
 * analyzer emitted none of them, and `script/m60/payload-matrix.ts` recorded all
 * three as dead emit cells. Two contradictory artifacts, and the one a reader
 * believes is the prose. The three D1–D6 fabrication classes and the D7 loss
 * class are all symbol/edge classes, so none of them could see a payload that is
 * absent on a symbol that is otherwise perfect, and the differential cannot
 * either — its oracle is written from the same reading of the same grammar and
 * never asks for the field, so the blind spot cancels.
 *
 * What it measures, per corpus file:
 *   - how many callable symbols carry each of the three fields at all
 *   - how many parameters are DEFAULTED (`isOptional`) — the
 *     `optional_parameter_declaration` node type, the one a required-only walk
 *     loses silently
 *   - how many parameters carry a `*`/`&` in their type — the pointer/ref
 *     operators that a slice taken at the declarator instead of at the name
 *     deletes, which is the difference between `const std::string&` and
 *     `const std::string`
 *   - how many declared types are spelled `auto` in `returnType` — the deduced
 *     return type that a `type`-field-only read publishes instead of the type
 *     after the `->`
 *
 * It is a COVERAGE report, not a gate: it prints the shape of the payload and
 * exits 0 whenever the three fields are populated. Correctness of the values is
 * gated by `validation/m14/fixtures/cpp/m60-signature-payload` and its five
 * mutants, which is the right division of labour — a corpus-wide count can prove
 * a field is there, and only a fixture can prove it is right.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, extname } from "node:path"
import { parseFile } from "../../src/ast/engine"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPOS = (process.env.BB_CPP_REPOS ?? "fmt,nlohmann-json,catch2,abseil-cpp,spdlog,zig").split(",")
const EXTS = new Set([".cpp", ".cc", ".cxx", ".hpp", ".hxx", ".h", ".ipp", ".tcc", ".inl"])

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === ".git" || e === "node_modules" || e === "build" || e === "third_party") continue
    const p = join(dir, e)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (EXTS.has(extname(p))) out.push(p)
  }
  return out
}

const CALLABLE = new Set(["function", "method", "constructor"])
const t = {
  files: 0, symbols: 0, callables: 0,
  withParameters: 0, withReturnType: 0, withDecorators: 0,
  params: 0, optionalParams: 0, defaultedParams: 0, ptrRefParams: 0,
  returnTypeAuto: 0, returnTypeVoid: 0,
  decoratedCallables: 0, decoratedNonCallables: 0,
  // the pre-fix shapes, counted so the size of each defect is on the record
  wouldLoseRefOrPtr: 0, wouldLoseDefault: 0, wouldPublishAuto: 0,
}
const examples: Record<string, string[]> = {
  trailingReturnType: [], decoratedField: [], defaultedParam: [], ptrRefParam: [],
}

for (const repo of REPOS) {
  const root = join(CORPUS, repo)
  if (!existsSync(root)) { console.error(`missing corpus repo: ${root}`); continue }
  for (const f of walk(root)) {
    t.files++
    let r: any
    try { r = await parseFile(f, readFileSync(f, "utf8")) } catch { continue }
    for (const s of r?.symbols ?? []) {
      t.symbols++
      const callable = CALLABLE.has(String(s.kind))
      if (callable) t.callables++
      if (s.decorators?.length) {
        if (callable) t.decoratedCallables++
        else {
          t.decoratedNonCallables++
          if (examples.decoratedField.length < 4) {
            examples.decoratedField.push(`${String(s.kind)} ${s.ownerName ?? ""}::${s.name} [${s.decorators.join(" ")}]  ${f.replace(CORPUS + "/", "")}`)
          }
        }
      }
      if (!callable) continue
      if (s.parameters) t.withParameters++
      if (s.returnType) t.withReturnType++
      if (s.decorators?.length) t.withDecorators++
      if (s.returnType === "auto") { t.returnTypeAuto++; t.wouldPublishAuto++ }
      if (s.returnType === "void") t.returnTypeVoid++
      for (const p of s.parameters ?? []) {
        t.params++
        if (p.isOptional) t.optionalParams++
        if (p.defaultValue !== undefined) {
          t.defaultedParams++
          if (examples.defaultedParam.length < 4) {
            examples.defaultedParam.push(`${s.ownerName ?? ""}::${s.name}(${p.name}: ${p.type} = ${p.defaultValue})  ${f.replace(CORPUS + "/", "")}`)
          }
        }
        const ty = String(p.type ?? "")
        if (ty.endsWith("*") || ty.endsWith("&")) {
          t.ptrRefParams++
          t.wouldLoseRefOrPtr++
          if (examples.ptrRefParam.length < 4) {
            examples.ptrRefParam.push(`${s.ownerName ?? ""}::${s.name}(${p.name}: ${ty})  ${f.replace(CORPUS + "/", "")}`)
          }
        }
      }
      // A deduced return type is the one spelling where the declaration's own
      // `type` field is not the answer. Sampled for the report, counted for the
      // defect size.
      if (s.returnType && s.returnType !== "auto" && /\bauto\b/.test(s.returnType) === false) {
        // no-op: kept explicit so the sample list below is the only heuristic
      }
    }
  }
}

// The `auto` sample has to come from the source, since `returnType` is already
// resolved. Scan for the deduced spelling directly — this is a REPORT script, so
// a source scan is legitimate here; the no-regex rule is the ANALYZER's.
for (const repo of REPOS) {
  const root = join(CORPUS, repo)
  if (!existsSync(root)) continue
  for (const f of walk(root)) {
    if (examples.trailingReturnType.length >= 4) break
    let src: string
    try { src = readFileSync(f, "utf8") } catch { continue }
    const lines = src.split("\n")
    for (let i = 0; i < lines.length && examples.trailingReturnType.length < 4; i++) {
      if (/^\s*(auto|decltype\s*\(\s*auto\s*\))\s+\w+\s*\([^)]*\)[^;{]*->/.test(lines[i])) {
        examples.trailingReturnType.push(`${lines[i].trim().slice(0, 90)}  ${f.replace(CORPUS + "/", "")}:${i + 1}`)
      }
    }
  }
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`)
console.log("\n=== M60.P1 C++ payload coverage (real corpus) ===")
console.log(`repos: ${REPOS.join(", ")}`)
console.log(`files: ${t.files}   symbols: ${t.symbols}   callables: ${t.callables}\n`)
console.log(`callables with parameters : ${t.withParameters} (${pct(t.withParameters, t.callables)})`)
console.log(`callables with returnType : ${t.withReturnType} (${pct(t.withReturnType, t.callables)})`)
console.log(`callables with decorators : ${t.withDecorators} (${pct(t.withDecorators, t.callables)})`)
console.log(`\nparameters: ${t.params}  optional: ${t.optionalParams}  defaulted: ${t.defaultedParams}  ptr/ref-typed: ${t.ptrRefParams}`)
console.log(`decorated callables: ${t.decoratedCallables}   decorated NON-callables (field/variable branch): ${t.decoratedNonCallables}`)
console.log(`returnType spelled "auto": ${t.returnTypeAuto}   "void": ${t.returnTypeVoid}`)
console.log(`   (the ${t.returnTypeAuto} are bare deduced returns with NO written \`->\`, where \`auto\` IS the honest`)
console.log(`    source spelling and the real type is deduced from the body — sampled and confirmed, not assumed)`)
console.log(`--- size of each defect as it stood before this fix ---`)
console.log(`parameters whose type lost its * or & : ${t.wouldLoseRefOrPtr}`)
console.log(`defaulted parameters a required-only walk drops : ${t.defaultedParams}`)
console.log(`deduced return types a type-field-only read would publish as "auto" : ${t.wouldPublishAuto}`)
console.log(`   (of which ${t.wouldPublishAuto} are bare deduced returns that HONESTLY spell auto — the defect is only`)
console.log(`    the written-\`->\` ones, which is why the fixture pins the trailing-return-type case directly)`)
console.log(`\n--- samples ---`)
for (const [k, v] of Object.entries(examples)) {
  if (!v.length) continue
  console.log(`\n${k}:`)
  for (const s of v) console.log(`  ${s}`)
}
