/**
 * THE CLAIM-SHAPES PROBE — what the analyzer ACTUALLY emits for the three `imports`
 * target shapes, so the expectation file is a MEASUREMENT and not a prediction.
 *
 * ## Why this file exists
 *
 * The lane's five remaining unresolved `imports` edges are all BARE NAMES, and the reason
 * they are not "fixed" is the shape rule: a bare name has no shape to check, so it never
 * receives a claim. **That refusal — the thing that stops a bare fixture name being promoted
 * to a verified external — was pinned by NO fixture.** A guard that no fixture pins is a guard
 * that a future change can remove without a red test.
 *
 * The expectation file is therefore written FROM this probe's output, not from a prediction
 * about the key space (R4: a lane's probe must ask the instrument what it says).
 *
 * ## THE HARNESS'S OWN CALL, not a near-miss of it
 *
 * This probe calls `analyzer.analyze(tree.rootNode, content, "fixtures/toml/<src>", undefined)`
 * — **exactly** what `script/m14/run-fixtures.ts:1023` calls for a plain toml fixture, with
 * **no `analyzeContext`** (a toml fixture has no `crossFileOverride` and no `sub`, so the
 * harness hands it `undefined`).
 *
 * THAT MATTERS, AND NOT COSMETICALLY. `analyzeContext` is what carries `projectRoot`, and
 * `projectRoot` is what carries the DOCUMENT SCOPE: `real-toml-analyzer.ts:797-798` derives
 * the module name as `applyDocumentScope(stem, documentDirScope(filePath, projectRoot))`, and
 * with no project root the scope is "" and the name is the bare stem. The analyzer's own
 * comment says it: *"A root-level file has no directory chain, so its scope is "" and its name
 * is unchanged — which is why the fixtures, which are handed no project root, spell exactly as
 * before."* **A probe that passed a project root would measure a DIFFERENT key space and would
 * have written an expectation the harness could never match** — which is why the first version
 * of this probe was discarded rather than corrected in place.
 *
 * It also matters for the CLAIM: with no project root there is no admitted file list, so no
 * `importProjectFile` claim is computable — the bare-name refusal is measured in the state
 * the harness actually runs.
 *
 * READ-ONLY. Prints; writes nothing.
 *
 *   npx tsx validation/m14/fixtures/toml/tools/claim-shapes-probe.mts
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = (import.meta as any).dir ?? path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..", "..", "..", "..")
const SRC = "bare-name-and-claim-shapes.toml"
const FIXTURE = path.resolve(HERE, "..", SRC)

const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-toml.wasm")))
const parser = new ParserClass()
parser.setLanguage(grammar)

const mod: any = await import("../../../../../src/ast/real-toml-analyzer")
const analyzer = new mod.RealTomlAnalyzer()

const content = fs.readFileSync(FIXTURE, "utf8")
const tree = parser.parse(content)
// THE HARNESS'S OWN CALL — run-fixtures.ts:1023, with analyzeContext undefined.
const result: any = await analyzer.analyze(tree.rootNode, content, `fixtures/toml/${SRC}`, undefined)

console.log(`FIXTURE   fixtures/toml/${SRC}`)
console.log(`analyzeContext: undefined  (the harness's own call for a plain toml fixture)`)
console.log(`\nSYMBOLS (${(result.symbols ?? []).length}):`)
for (const s of result.symbols ?? []) {
  console.log(`  ${s.kind}\t${s.name}\tline ${s.startLine ?? s.line_number ?? "?"}`)
}
console.log(`\nRELATIONSHIPS (${(result.relationships ?? []).length}):`)
for (const e of result.relationships ?? []) {
  console.log(`  ${e.type}\t${e.source} -> ${e.target}\tline ${e.line_number}`)
  console.log(`    metadata: ${JSON.stringify(e.metadata)}`)
}
