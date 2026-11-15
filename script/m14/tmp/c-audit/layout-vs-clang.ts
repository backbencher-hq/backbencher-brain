/**
 * C audit probe: the analyzer's `memorySize` / `alignment` payload, checked
 * against an INDEPENDENT layout model.
 *
 * Every struct and union symbol the analyzer emits carries two computed numbers.
 * Asserting them against the lane's own fixtures proves nothing, because the
 * fixtures were written from the analyzer's own behaviour -- a payload checked
 * against itself is a payload nobody checked. The M14 contract asks for an
 * independent second opinion, and the lane formula names the one for this
 * language: `clang -Xclang -ast-dump=json`.
 *
 * What it found, on redis/src: 46.9% of comparable types agreed with clang on
 * size AND alignment, while the field SETS the numbers were computed from were
 * 97.1% identical. That split is the whole point of the probe. A total would have
 * said "the layout maths is wrong" and left the question open; asking whether the
 * member SET or the ARITHMETIC was wrong said "the members are right, the
 * arithmetic is not", which is a different and much smaller piece of work.
 * The fixes that followed (#936 primitive widths from the AST, #937 same-file
 * typedef aliases, #938 one shared unknown-member fallback, #939 array dimensions
 * written as a macro) took it to 67.3%.
 *
 * The residue is not all defect, and the probe must not pretend otherwise. Bitfields
 * and `long double` are outside the model by its own section header; a by-value
 * member whose type is declared in another file is C-D2, a declared non-goal. So
 * every miss is classed, the classes are counted, and the rate is published as a
 * MEASURED LIMITATION with its denominator -- never as a clean bill of health.
 *
 * Three harness lessons are baked in, each one paid for in a wrong number:
 *   - a broad `catch` around clang turned a `ReferenceError` in this file into
 *     "0 of 49 types comparable", which reads exactly like a clean result, so a
 *     TypeError/ReferenceError is now RETHROWN and only compilation failures are
 *     counted as "not measurable";
 *   - classifying a miss from a 4000-character window after the type NAME labelled
 *     15 of 22 misses "array member" when the bracket was somewhere else in the
 *     file, so the class is computed from the type's OWN body;
 *   - two references to "the children of a node" mean `inner` in clang's JSON and
 *     `namedChildren` in web-tree-sitter, and reading the wrong one made a walk
 *     terminate at the root and report every body missing.
 *
 *   bun run script/m14/tmp/c-audit/layout-vs-clang.ts [--dir <dir>] [--limit N]
 */
import * as fs from "fs"
import * as path from "path"
import { execFileSync } from "child_process"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..", "..", "..")
const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const DIR = arg("dir", "/home/sano/ishaq/bb_tests/repositories/redis/src")
const LIMIT = Number(arg("limit", "4000"))
const CORPUS_ROOT = "/home/sano/ishaq/bb_tests/repositories"
const repoName = path.basename(path.dirname(DIR))

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserCtor = wts.Parser ?? wts.default ?? wts
const LanguageCtor = wts.Language ?? wts.default?.Language
await ParserCtor.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new ParserCtor()
parser.setLanguage(await LanguageCtor.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm"))))
const { RealCAnalyzer } = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))

const files: string[] = []
const walkFiles = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name === ".git") continue
    const full = path.join(d, e.name)
    if (e.isDirectory()) walkFiles(full)
    else if (e.name.endsWith(".h") && files.length < LIMIT) files.push(full)
  }
}
walkFiles(DIR)

/**
 * The flags a real compile of this corpus would be given.
 *
 * A header that only compiles under its project's `-D` set is not a defect in the
 * header, and calling it "not measurable" without saying so would be a
 * measurement of my own impatience. curl's public headers need
 * `CURL_EXTERN`/`CURL_HIDDEN` defined, which the build system passes and a
 * hand-written probe does not.
 */
const REPO_DEFINES: Record<string, string[]> = {
  curl: ["-DCURL_EXTERN=extern", "-DCURL_HIDDEN=static", "-DCURL_EXTERN_STATIC=", "-DBUILDING_LIBCURL"],
  libgit2: ["-DGIT_EXTERN=extern", "-DGIT_HIDDEN=static", "-DGIT_DEPRECATED_HARD=0"],
  redis: [],
}

/** Directories offered to clang on the include path, derived from the corpus root. */
const includeRoots = (() => {
  // Deliberately NO `/usr/include` and no `/usr/include/<triple>`. Naming glibc's
  // own directories on the include path breaks its multiarch resolution --
  // `/usr/include/inttypes.h: unknown type name 'intmax_t'` -- because the
  // compiler already searches them, in the right order, on its own. Adding them
  // cost this probe its entire libgit2 and curl coverage: every type was
  // "not measurable" for a reason that had nothing to do with the corpus.
  const out: string[] = []
  for (const sub of ["src", "include", "deps", "lib", "."]) {
    const p = path.join(CORPUS_ROOT, repoName, sub)
    if (fs.existsSync(p)) out.push(p)
  }
  return out
})()

/** Why a type was not measurable. A harness fault and a corpus fact are different things. */
const unmeasurable = new Map<string, number>()
/** Bodies the probe could not locate, recorded rather than counted away. */
const missingBodies: string[] = []

function clangLayout(
  typeName: string,
  headerInclude: string,
  roots: string[],
): { size: number; align: number; fields: string[] } | null {
  const probe = `#include <stdio.h>\n#include <stddef.h>\n${headerInclude}\nint main(void){ printf("%zu %zu\\n", sizeof(${typeName}), _Alignof(${typeName})); return 0; }\n`
  const dir = fs.mkdtempSync("/tmp/opencode/cclang-")
  const f = path.join(dir, "p.c")
  try {
    fs.writeFileSync(f, probe)
    const incs = roots.flatMap((r) => ["-I" + r]).concat(REPO_DEFINES[repoName] ?? [])
    execFileSync("clang", ["-std=c11", "-w", ...incs, "-o", path.join(dir, "p"), f], {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 30000,
    })
    const run = execFileSync(path.join(dir, "p"), [], { timeout: 20000 })
      .toString()
      .trim()
      .split(/\s+/)
      .map(Number)
    if (run.length !== 2 || !Number.isFinite(run[0]) || !Number.isFinite(run[1])) return null

    // clang's own field list, via the AST dump.
    let fields: string[] = []
    try {
      const ast = execFileSync("clang", ["-std=c11", "-w", ...incs, "-Xclang", "-ast-dump=json", "-fsyntax-only", f], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30000,
        maxBuffer: 64 * 1024 * 1024,
      }).toString()
      const j = JSON.parse(ast)
      // A RecordDecl carries NO `fields` array in clang's JSON AST; its FieldDecls
      // are `inner` children OF THE RECORD. An earlier draft looked for a
      // `fields` array, found none, and reported "0 field sets compared" -- a
      // probe that compares nothing while printing a rate.
      const findRecord = (n: any): any => {
        if (!n || typeof n !== "object") return null
        if (n.kind === "RecordDecl" && n.name === typeName && n.completeDefinition) return n
        for (const c of n.inner ?? []) {
          const hit = findRecord(c)
          if (hit) return hit
        }
        return null
      }
      const rec = findRecord(j)
      if (rec) {
        for (const c of rec.inner ?? []) if (c && c.kind === "FieldDecl" && c.name) fields.push(c.name)
        if (fields.length === 0) fields = ["<clang reports no members>"]
      }
    } catch (err: any) {
      // Only the AST dump is optional here; a bad dump costs the field
      // comparison, not the size. A programming error is still not a data point.
      if (err instanceof TypeError || err instanceof ReferenceError) throw err
      unmeasurable.set("clang's AST dump was unavailable (field set not compared)", (unmeasurable.get("clang's AST dump was unavailable (field set not compared)") ?? 0) + 1)
    }
    return { size: run[0], align: run[1], fields }
  } catch (err: any) {
    // A compile rejection is a legitimate "cannot measure this". A TypeError or
    // ReferenceError is a bug in THIS probe, and reporting it as a property of
    // the corpus is how an earlier draft printed "0 of 49 types comparable"
    // while throwing on every call.
    if (err instanceof TypeError || err instanceof ReferenceError) throw err
    const stderr = String(err?.stderr ?? "")
    // The first real diagnostic, kept. A bucket label that cannot be acted on
    // sends the reader back to the harness by hand; the probe should name its own
    // blocker.
    const diag = stderr
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#") && !l.includes("^") && !l.startsWith("In file") && !l.startsWith("clang")) ?? stderr.split("\n")[0]
    const reason = /file not found/.test(stderr)
      ? `the header could not be found on the include path (HARNESS fault) -- ${diag}`
      : /fatal error|error:/.test(stderr)
        ? `clang rejected the translation unit (the corpus needs build configuration) -- ${diag}`
        : `clang or the probe binary failed -- ${diag || err?.message || "no diagnostic"}`
    unmeasurable.set(reason, (unmeasurable.get(reason) ?? 0) + 1)
    return null
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
}

/**
 * Why a type misses, from the type's OWN body. The first version used a window
 * onto the file and reported 15 of 22 misses as "array member" because a bracket
 * appeared somewhere in the next 4000 characters -- a label about the file, not
 * the type, and it would have sent the fix to the wrong place.
 */
function missClass(body: string): string {
  if (!body) return "BODY NOT LOCATED -- the class would be about the file, not the type"
  if (/\b__int128\b|\blong double\b|\b_complex\b|_Atomic|__attribute__\s*\(\s*\(\s*packed/.test(body))
    return "platform/extension type the model refuses (width deliberately unknown)"
  if (/\bu?int\s+\w+\s*:\s*\d/.test(body)) return "bitfield (declared outside the model)"
  if (/\b(?:struct|union|enum)\s+\w+|\w+\s*\*/.test(body))
    return "by-value member of a named/other type whose width the per-file model cannot know (declared limit, C-D2)"
  if (/\[/.test(body)) return "array member (element width now AST-derived; recheck the padding rule)"
  return "UNCLASSIFIED -- the type has only primitive members, so this is a real defect"
}

let compared = 0
let agree = 0
let alignOnly = 0
let sizeOnly = 0
let bothWrong = 0
let unmeasurableCount = 0
/**
 * Agreement split by whether the analyzer KNEW the answer.
 *
 * `layoutUnknownMembers` (#940) marks a type whose payload was partly invented --
 * a named type declared in another file (C-D2), or a width deliberately refused
 * (`long double`). Before the flag existed, those were indistinguishable from
 * computed sizes, so a single rate conflated "our arithmetic is wrong" with "we
 * refused and guessed". The split is the number worth publishing: the first row
 * is the accuracy of the model on the types it claims to model, and the second
 * is the honest measure of how often it declines.
 */
let exactCompared = 0
let exactAgree = 0
let guessedCompared = 0
let guessedAgree = 0
let fieldSetsComparable = 0
let fieldSetsAgree = 0
let fieldSetsDiffer = 0
const fieldMisses: Array<{ file: string; type: string; onlyOurs: string[]; onlyClang: string[] }> = []
interface MissRow {
  file: string
  type: string
  ours: number
  clang: number
  oursAlign: number
  clangAlign: number
  class: string
}
const misses: MissRow[] = []
/** Misses on types the analyzer CLAIMS to model -- the ones a fix can move. */
const actionableMisses: MissRow[] = []
/** Misses on types it marked as partly guessed -- declared limits, not defects. */
const guessedMisses: MissRow[] = []
const byClass: Record<string, number> = {}

for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  // The header is INCLUDED, not pasted, so the preprocessor handles guards,
  // conditionals and feature macros and clang sees the header a compiler sees.
  //
  // It is included by its path RELATIVE TO THE SCAN ROOT, and the scan root is
  // what goes on `-I` -- the header's own directory is deliberately NOT added.
  // libgit2 ships `include/git2/stdint.h`, a compatibility shim, and putting that
  // directory on the include path made it shadow the real `<stdint.h>`:
  // clang's `inttypes.h` then failed with `unknown type name 'intmax_t'` and all
  // 55 libgit2 types became "not measurable" for a reason that had nothing to do
  // with libgit2. A quoted include inside the header still resolves against the
  // header's own directory, which is C's own rule, so its internals are fine.
  const headerInclude = `#include "${path.relative(DIR, f).split(path.sep).join("/")}"`
  const roots = includeRoots.concat([DIR, repoName ? path.join(CORPUS_ROOT, repoName) : DIR])

  let res: any
  let root: any
  try {
    root = parser.parse(src).rootNode
    res = new RealCAnalyzer().analyze(root, src, f)
  } catch {
    continue
  }

  /** The type's own definition body, handling both spellings. */
  const bodyOf = (typeName: string): string | null => {
    let named: string | null = null
    let viaTypedef: string | null = null
    const walk = (n: any) => {
      if (!n || typeof n !== "object") return
      if (n.type === "struct_specifier" || n.type === "union_specifier") {
        const body = n.childForFieldName("body")
        if (body) {
          if (n.childForFieldName("name")?.text === typeName) named = body.text
          // `typedef struct { ... } foo;` leaves the specifier ANONYMOUS and puts
          // the name on the type_definition's declarator.
          const owner: any = n.parent
          const decl = owner?.childForFieldName?.("declarator")
          if (owner?.type === "type_definition" && decl?.type === "type_identifier" && decl.text === typeName)
            viaTypedef = body.text
        }
      }
      // `namedChildren`, not `inner`: `inner` is clang's JSON spelling, and
      // reading it here made this walk terminate at the root.
      for (const c of (n.namedChildren ?? []) as any[]) walk(c)
    }
    walk(root)
    if (!named && !viaTypedef) missingBodies.push(`${path.basename(f)} ${typeName}`)
    return named ?? viaTypedef
  }

  for (const s of res.symbols ?? []) {
    if (s.kind !== "struct" && s.kind !== "type") continue
    const md = s.metadata ?? {}
    if (typeof md.memorySize !== "number" || typeof md.alignment !== "number") continue
    if (s.name === "anonymous_struct" || s.name === "anonymous_union") continue

    const got = clangLayout(s.name, headerInclude, roots)
    if (!got) {
      unmeasurableCount++
      continue
    }
    compared++

    // The decisive question first: is the wrong size a LAYOUT defect or a
    // MEMBER-EXTRACTION defect? They look identical in a total.
    const ours = (res.symbols ?? [])
      .filter((x: any) => x.ownerName === s.name && x.kind === "property")
      .map((x: any) => String(x.name))
    if (got.fields.length > 0) {
      fieldSetsComparable++
      const onlyOurs = ours.filter((n) => !got.fields.includes(n))
      const onlyClang = got.fields.filter((n: string) => !ours.includes(n))
      if (onlyOurs.length === 0 && onlyClang.length === 0) fieldSetsAgree++
      else {
        fieldSetsDiffer++
        if (fieldMisses.length < 20) fieldMisses.push({ file: path.basename(f), type: s.name, onlyOurs, onlyClang })
      }
    }

    const sizeOk = md.memorySize === got.size
    const alignOk = md.alignment === got.align
    const guessed = (md.layoutUnknownMembers ?? 0) > 0
    if (guessed) guessedCompared++
    else {
      exactCompared++
      if (sizeOk && alignOk) exactAgree++
    }
    if (guessed && sizeOk && alignOk) guessedAgree++
    if (sizeOk && alignOk) {
      agree++
      continue
    }
    if (sizeOk) alignOnly++
    else if (alignOk) sizeOnly++
    else bothWrong++

    const cls = missClass(bodyOf(s.name) ?? "")
    byClass[cls] = (byClass[cls] ?? 0) + 1
    // The ACTIONABLE misses are the ones the analyzer claims to have computed:
    // a marked guess is a declared limit, and no amount of fixing the arithmetic
    // will move it. They are listed first and separately for that reason.
    const row = {
      file: path.basename(f),
      type: s.name,
      ours: md.memorySize,
      clang: got.size,
      oursAlign: md.alignment,
      clangAlign: got.align,
      class: cls,
    }
    if (guessed) guessedMisses.push(row)
    else if (actionableMisses.length < 25) actionableMisses.push(row)
    if (misses.length < 25) misses.push(row)
  }
}

const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "n/a (denominator 0 -- report this, do not read it as success)")
console.log(`# layout vs clang -- ${path.basename(DIR)}`)
console.log(`files scanned: ${files.length}`)
console.log(`types compared: ${compared}   (${unmeasurableCount} not measurable)`)
console.log(`agree on size AND alignment: ${agree}  (${pct(agree, compared)})`)
console.log(`size right, alignment wrong: ${alignOnly}`)
console.log(`alignment right, size wrong: ${sizeOnly}`)
console.log(`both wrong: ${bothWrong}`)

console.log(`\n## agreement split by whether the analyzer KNEW the answer`)
console.log(
  `  types it claims to model (layoutUnknownMembers == 0): ${exactCompared} compared, ${exactAgree} agree (${pct(exactAgree, exactCompared)})`,
)
console.log(
  `  types it partly guessed (layoutUnknownMembers > 0):   ${guessedCompared} compared, ${guessedAgree} agree (${pct(guessedAgree, guessedCompared)})`,
)

if (unmeasurable.size) {
  console.log(`\nwhy types were not measurable:`)
  for (const [r, n] of unmeasurable) console.log(`  ${String(n).padStart(4)}x  ${r}`)
}

console.log(`\n## the decisive split: is the wrong SIZE a layout defect or a member-extraction defect?`)
console.log(`field sets compared: ${fieldSetsComparable}   identical: ${fieldSetsAgree}   DIFFERENT: ${fieldSetsDiffer} (${pct(fieldSetsAgree, fieldSetsComparable)} identical)`)
if (fieldMisses.length) {
  console.log("field-set differences (onlyOurs = a member the analyzer invents, onlyClang = one it misses):")
  for (const d of fieldMisses) console.log(`  ${d.file} ${d.type}: onlyOurs=[${d.onlyOurs.join(", ")}] onlyClang=[${d.onlyClang.join(", ")}]`)
}

if (missingBodies.length) {
  console.log(`\nbodies not located (${missingBodies.length}) -- shown, not counted away:`)
  for (const m of missingBodies.slice(0, 10)) console.log(`  ${m}`)
}

console.log(`\n## ACTIONABLE misses: the analyzer claimed to model these (layoutUnknownMembers == 0)`)
if (actionableMisses.length === 0) console.log("  none -- every type it claims to model matches clang")
for (const m of actionableMisses) console.log(`  ${m.file} ${m.type}: ours ${m.ours}B/${m.oursAlign}A  clang ${m.clang}B/${m.clangAlign}A   [${m.class}]`)
console.log(`\n## misses on types it MARKED as guessed (declared limits; listed, not fixed)`)
console.log(`  ${guessedMisses.length} such types`)
for (const m of guessedMisses.slice(0, 8)) console.log(`  ${m.file} ${m.type}: ours ${m.ours}B/${m.oursAlign}A  clang ${m.clang}B/${m.clangAlign}A   [${m.class}]`)

console.log(`\nmiss classes (a class is a MEASUREMENT, not an excuse -- the rows are listed):`)
for (const [c, n] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}x  ${c}`)
console.log(`\nsamples:`)
for (const m of misses) console.log(`  ${m.file} ${m.type}: ours ${m.ours}B/${m.oursAlign}A  clang ${m.clang}B/${m.clangAlign}A   [${m.class}]`)
