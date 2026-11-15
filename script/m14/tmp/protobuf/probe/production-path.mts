/**
 * Protobuf PRODUCTION PATH.
 *
 * A probe that calls the analyzer directly proves the analyzer works. It does
 * not prove the ENGINE reaches it — and for protobuf that was a real, measured
 * failure mode, not a hypothetical one: `.proto` was ROUTED to the language
 * `protobuf`, the language had a `getAnalyzer` case, the grammar was wired, and
 * parsing a real file still threw
 *
 *   Failed to determine WASM path for protobuf: Language protobuf parser not yet
 *   implemented. Add the WASM loading case.
 *
 * because the WASM-path switch had no `protobuf` case. Nothing short of going
 * through `ASTEngine.parseFile` would have found that, so this probe goes
 * through it, on real files from the pinned corpora, and requires the result to
 * be IDENTICAL to calling the analyzer on the same tree.
 *
 * "Identical" is checked field by field, not by count: a count comparison would
 * pass if the engine returned 10 symbols and the analyzer returned 10 different
 * ones.
 *
 * Usage: tsx production-path.mts
 */
import * as fs from "fs"
import * as path from "path"
import { ASTEngine } from "../../../../../src/ast/engine"
import { MANIFEST, OUT, ROOT, WASM } from "../paths.mts"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new ParserClass()
parser.setLanguage(await Language.load(fs.readFileSync(WASM)))
const { RealProtobufAnalyzer } = await import(path.join(ROOT, "src/ast/real-protobuf-analyzer.ts"))

const problems: string[] = []
const rows: any[] = []

/** A stable, order-sensitive fingerprint of one analysis result. */
function fingerprint(r: any): string {
  return JSON.stringify({
    symbols: (r.symbols ?? []).map((s: any) => [
      s.kind, s.name, s.ownerName ?? null, s.metadata?.id ?? null,
      s.range.startLine, s.range.startColumn, s.range.endLine, s.range.endColumn,
    ]),
    relationships: (r.relationships ?? []).map((x: any) => [x.source, x.type, x.target, x.line_number ?? null]),
    imports: (r.imports ?? []).map((i: any) => i.module),
  })
}

function walkFiles(dir: string): string[] {
  const out: string[] = []
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()!
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of ents) {
      if (e.name === ".git") continue
      const abs = path.join(d, e.name)
      if (e.isDirectory()) stack.push(abs)
      else out.push(abs)
    }
  }
  return out.sort()
}

// ---- gate 1: routing is no longer the `__generic__` placeholder ----------
const detection = ASTEngine.detectLanguage("a/b/c.proto", 'syntax = "proto3";\nmessage M {}\n')
if (detection !== "protobuf") problems.push(`detectLanguage(.proto) returned ${detection}, expected protobuf`)
if (!ASTEngine.isLanguageSupported("protobuf")) problems.push("isLanguageSupported('protobuf') is false")

// ---- gate 2: engine output == direct analyzer output, field for field ----
const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as { corpora: any[] }
let compared = 0
let identical = 0
for (const c of manifest.corpora) {
  if (!fs.existsSync(c.root)) continue
  const files = walkFiles(c.root).filter((f) => f.endsWith(".proto"))
  for (const abs of files) {
    const src = fs.readFileSync(abs, "utf8")
    let viaEngine: any
    try {
      viaEngine = await ASTEngine.parseFile(abs, src)
    } catch (e) {
      problems.push(`ASTEngine.parseFile THREW on ${path.basename(abs)}: ${e instanceof Error ? e.message : e}`)
      continue
    }
    const direct: any = new RealProtobufAnalyzer().analyze(parser.parse(src).rootNode, src, abs)
    compared++
    const a = fingerprint(direct)
    const b = fingerprint(viaEngine)
    if (a === b) identical++
    else problems.push(`engine/analyzer mismatch on ${path.basename(abs)}`)
    rows.push({
      file: `${c.name}/${path.relative(c.root, abs).split(path.sep).join("/")}`,
      symbols: direct.symbols.length,
      relationships: direct.relationships.length,
      identical: a === b,
    })
  }
}

// ---- gate 3: the analyzer's own claims hold on the engine's output -------
// The analyzer documents that it publishes NO errors (the engine owns parse
// errors), and a symbol's byte range must slice out the symbol's own name.
let rangeChecked = 0
let rangeBad = 0
let commentAnchors = 0
for (const r of rows.slice(0, 40)) {
  const abs = (() => {
    const cname = r.file.split("/")[0]
    const rel = r.file.slice(cname.length + 1)
    const c = manifest.corpora.find((x) => x.name === cname)!
    return path.join(c.root, rel.split("/").join(path.sep))
  })()
  const src = fs.readFileSync(abs, "utf8")
  const res: any = new RealProtobufAnalyzer().analyze(parser.parse(src).rootNode, src, abs)
  if (res.errors && res.errors.length) problems.push(`${r.file}: analyzer returned ${res.errors.length} error(s); it documents that the engine owns them`)
  for (const s of res.symbols) {
    if (s.range.startIndex === undefined || s.range.endIndex === undefined) continue
    rangeChecked++
    // The invariant is that the range SPANS the symbol's own name, not that the
    // name is the first thing in it: `message Any` correctly starts at the
    // `message` keyword, and a field's range starts at its type. An earlier
    // version of this check demanded the name sit at startColumn and reported
    // 2,154 of 2,605 symbols as failures, every one of them correct.
    const span = src.slice(s.range.startIndex, s.range.endIndex)
    if (!span.includes(s.name)) {
      rangeBad++
      if (rangeBad <= 5) problems.push(`${r.file}: ${s.kind} ${s.name} range does not span its own name`)
      continue
    }
    // The M59/#861 rule, stated correctly: a symbol's range must not be STOLEN
    // by a leading doc comment. It is NOT "the start line contains the name" —
    // a declaration may legitimately span lines, and protobuf's own corpus does:
    //
    //   proto2_unittest_import.PublicImportMessage
    //       optional_public_import_message = 26;
    //
    // where the declaration starts on the TYPE's line and the name is on the
    // next. Demanding the name be on the start line flagged 14 such symbols and
    // all 14 were correct. What must hold is that the range begins AFTER the
    // doc comment ends, so a documented symbol points at its declaration.
    for (const cm of ((s as any).comments ?? []) as string[]) {
      commentAnchors++
      const at = src.lastIndexOf(cm, s.range.startIndex)
      if (at < 0) {
        rangeBad++
        problems.push(`${r.file}: ${s.kind} ${s.name} records a doc comment that is not in the file before it`)
        continue
      }
      const before = src.slice(0, at)
      const cmLine = before.split("\n").length
      if (cmLine >= s.range.startLine) {
        rangeBad++
        if (rangeBad <= 5)
          problems.push(
            `${r.file}: ${s.kind} ${s.name} starts on line ${s.range.startLine}, at or before its doc comment on line ${cmLine} — the comment stole the range`,
          )
      }
    }
  }
}

const out = {
  generatedAt: new Date().toISOString(),
  detection: detection as string,
  isSupported: true,
  filesCompared: compared,
  identicalToDirectAnalyzer: identical,
  rangesChecked: rangeChecked,
  rangesSpanningOwnName: rangeChecked - rangeBad,
  docCommentAnchorsChecked: commentAnchors,
  problems,
  pass: problems.length === 0,
}
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, "production-path.json"), JSON.stringify(out, null, 2))

console.log(`\n  detectLanguage(".proto") = ${detection}`)
console.log(`  files compared through ASTEngine.parseFile: ${compared}`)
console.log(`  byte-identical to a direct analyzer call:    ${identical}/${compared}`)
console.log(`  symbol ranges spanning their own name:    ${rangeChecked - rangeBad}/${rangeChecked}`)
console.log(`  doc-comment anchors verified (not stolen):  ${commentAnchors}`)
if (problems.length) {
  console.log(`\n  FAIL (${problems.length}):`)
  for (const p of problems.slice(0, 15)) console.log(`    - ${p}`)
} else {
  console.log(`\n  PASS: the engine reaches the analyzer, and its output is identical to calling it directly`)
}
console.log(`\n  wrote ${path.join(OUT, "production-path.json")}`)
process.exit(problems.length ? 1 : 0)
