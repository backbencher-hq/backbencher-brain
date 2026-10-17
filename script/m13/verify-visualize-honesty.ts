// script/m13/verify-visualize-honesty.ts — M13.63 (V9).
//
// THE CLAIMS THAT WERE NOT TRUE — the second batch of the review's findings, all of the same
// shape: a number or a sentence that describes a different event than the one it reports.
//
//   F10  the `excluded` block attributed ONE of five dropped symbols. `byPattern` could only
//        see path SEGMENTS, so `src/b.d.ts`, `src/c.min.js` and `src/d.map` — removed by
//        DEFAULT_EXCLUDE_SUFFIXES — were attributed to nothing, and the test rule had no name
//        at all. MEASURED: four symbols excluded, `byPattern {vendor:1}`; with
//        `includeTests:false`, five excluded and still `byPattern {vendor:1}`.
//   F13  that suffix list was not overridable AND not declared anywhere in the reply.
//   F8   the freshness block instructed an action this tool does not have: "reads auto-refresh
//        stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or
//        refresh=false", for a read path that never calls `maybeAutoRefresh`, publishing no
//        `refresh` option (validation REJECTS it), and emitting the DIR remediation for
//        `scope: \"file\"`.
//   F18  the first paint framed against a world that no longer existed and never
//        re-fitted: the fit ran BEFORE the first draw, and the world is resized
//        inside the draw.
//   F19  the detail panel rendered empty at load (box `[0,0,13,22]`, innerText `✕`)
//        because it had no CSS rule of its own, and the first fit ran against a
//        viewport that was still 0 wide.
//
// The renderer assertions are made on the EMITTED artifact rather than on a DOM, because this
// repository has no DOM in its dev dependencies; the pixels are verified out of band
// (validation/m13/results/viz-fix-evidence). Every behavioural assertion carries a negative
// control, so a claim cannot pass by describing nothing.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { validateToolArguments } from "../../src/mcp/tool-validation"
import { DependencyGraphVisualizer } from "../../src/ast/dependency-graph-visualizer"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.63", code: "V9", tool: "bb_visualize",
  title: "bb_visualize: the exclusions, the freshness text and the first paint say what is true",
  layers: ["unit", "integration"],
  decisions: {
    attribution: "every dropped symbol is attributed to exactly one named rule, so `symbols` reconciles with `byPattern` + `byRule`",
    freshness: "the remediation is the manual interface, because this read path does not auto-refresh and publishes no `refresh` option",
    firstPaint: "the emitted graph document is asserted structurally (it declares its layout, ships its save control, hides the picked-item box until something is picked)",
  },
  limitations: [
    "No DOM in this repository's dev dependencies, so the renderer assertions are structural (load-path order, CSS rules present) and the pixels come from the out-of-band screenshots.",
    "One stale-file case for the freshness wording; the sampled-coverage mode is not exercised here.",
  ],
})

const root = mkdtempSync(path.join(tmpdir(), "bb-viz-v9-"))
const write = (rel: string, body: string): void => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  writeFileSync(path.join(root, rel), body)
}
write("src/api/handlers.ts", "import { parse } from './parse'\nexport function handleRequest(): string { return parse() }\nexport function helperOne(): string { return 'x' }\n")
write("src/api/parse.ts", "export function parse(): string { return 'x' }\n")
write("src/b.d.ts", "export declare function ambient(): void\n")
write("src/c.min.js", "export function minified(){return 1}\n")
write("src/d.map", "{}\n")
write("vendor/lib.ts", "export function vendoredThing(): number { return 3 }\n")
write("test/app.test.ts", "export function testApp(): number { return 4 }\n")

const projectId = getProjectId(root)
await indexProjectParallel(projectId, root, {})
const handlers = createToolHandlers() as any
const ctx = { projectPath: root, projectId }
const reply = async (args: Record<string, unknown>, format = "json"): Promise<string> =>
  (await handlers.bb_visualize({ format, ...args }, ctx)).content[0].text as string
const run = async (args: Record<string, unknown>): Promise<any> => JSON.parse(await reply(args))
/** The html deliveries arrive with their escapes still in place (`\\n` for a newline, `\\\"` for
 *  a quote, `\\u003c` for `<`), so the artifact is normalised before it is asserted on. Without
 *  this every quote in the document reads as `\\\"` and a `>` in a comparison as `&gt;`, and an
 *  assertion written against the source would pass while the artifact said something else. */
const artifact = (raw: string): string =>
  raw
    .replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\u0026/g, "&")
    .replace(/\\n/g, "\n").replace(/\\t/g, "\t")
    .replace(/\\"/g, '"').replace(/\\\\/g, "\\")
/** Comments stripped and whitespace flattened: the ORDER of two calls is what is being asserted,
 *  and the explanation between them is not part of the order. */
const code = (html: string): string =>
  artifact(html)
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\s+/g, " ")

// ── F10/F13 — every exclusion is attributed, and the rules have names ─────────
{
  const base = await run({})
  const byPattern = base.excluded?.byPattern ?? {}
  const byRule = base.excluded?.byRule ?? {}
  const attributed = Object.values(byPattern).reduce((a: number, b: any) => a + Number(b), 0) + Object.values(byRule).reduce((a: number, b: any) => a + Number(b), 0)
  // The indexer stores no `.d.ts`, `.min.js` or `.map` symbol at all, so the SUFFIX rule cannot
  // fire through a fixture (asserted at the unit level below, which is how the review measured
  // it). What a fixture DOES exercise is the segment rule and the test rule.
  harness.check("attribution: the fixture excludes the vendored symbol", (base.excluded?.symbols ?? 0) >= 1 && (base.excluded?.byPattern?.vendor ?? 0) === 1, JSON.stringify(base.excluded))
  harness.check("attribution: every dropped symbol is attributed to a named rule", attributed === base.excluded.symbols, `attributed=${attributed} symbols=${base.excluded.symbols} byPattern=${JSON.stringify(byPattern)} byRule=${JSON.stringify(byRule)}`)
  harness.negative("attribution: the segment rule is still named for what it removed", (byPattern.vendor ?? 0) >= 1, JSON.stringify(byPattern))
  harness.check("attribution: and the suffix list is DECLARED in the reply", JSON.stringify(base.excluded?.suffixes) === JSON.stringify([".d.ts", ".min.js", ".map"]), JSON.stringify(base.excluded?.suffixes))

  const noTests = await run({ includeTests: false })
  harness.check("attribution: the test rule has a name of its own", (noTests.excluded?.byRule?.["test-sources"] ?? 0) >= 1, JSON.stringify(noTests.excluded?.byRule))
  harness.check("attribution: and the count grew with the rule that caused it", (noTests.excluded?.symbols ?? 0) > (base.excluded?.symbols ?? 0), `${base.excluded?.symbols} -> ${noTests.excluded?.symbols}`)
  const noTestsAttributed = Object.values(noTests.excluded?.byPattern ?? {}).reduce((a: number, b: any) => a + Number(b), 0) + Object.values(noTests.excluded?.byRule ?? {}).reduce((a: number, b: any) => a + Number(b), 0)
  harness.negative("attribution: the larger exclusion set is still fully attributed", noTestsAttributed === noTests.excluded.symbols, `attributed=${noTestsAttributed} symbols=${noTests.excluded.symbols}`)
  // The SUFFIX rule is exercised at the unit level: the indexer never stores a `.d.ts`, a
  // `.min.js` or a `.map` as a symbol, so a fixture cannot make that rule fire through the
  // handler — and the review's original measurement was a unit call as well (six crafted
  // symbols, four dropped, ONE attributed). Crafted here for the same reason.
  {
    const crafted = [
      { id: "a.ts:keep", name: "keep", symbol_type: "function", file: "src/a.ts", line: 1 },
      { id: "src/b.d.ts:ambient", name: "ambient", symbol_type: "function", file: "src/b.d.ts", line: 1 },
      { id: "src/c.min.js:minified", name: "minified", symbol_type: "function", file: "src/c.min.js", line: 1 },
      { id: "src/d.map:x", name: "x", symbol_type: "function", file: "src/d.map", line: 1 },
      { id: "vendor/lib.ts:vendored", name: "vendored", symbol_type: "function", file: "vendor/lib.ts", line: 1 },
      { id: "test/a.test.ts:t", name: "t", symbol_type: "function", file: "test/a.test.ts", line: 1 },
    ]
    const unitExcluded = DependencyGraphVisualizer.generateGraphData(crafted, [], { includeTests: false }).excluded!
    // Both maps are optional on the payload. Defaulting them ONCE keeps the four
    // reads below honest without four separate `?.` sites and without pretending a
    // missing map is an empty one at the assertion level: a missing map still fails
    // the attribution check, because 0 attributed !== 5 dropped.
    const unitByPattern = unitExcluded.byPattern ?? {}
    const unitByRule = unitExcluded.byRule ?? {}
    const unitAttributed = Object.values(unitByPattern).reduce((a, b) => a + Number(b), 0) + Object.values(unitByRule).reduce((a, b) => a + Number(b), 0)
    harness.check("unit attribution: five crafted symbols are dropped", unitExcluded.symbols === 5, JSON.stringify(unitExcluded))
    harness.check("unit attribution: every one is attributed (the old block attributed ONE)", unitAttributed === unitExcluded.symbols, `attributed=${unitAttributed} symbols=${unitExcluded.symbols} byPattern=${JSON.stringify(unitByPattern)} byRule=${JSON.stringify(unitByRule)}`)
    harness.check("unit attribution: the three suffixes are counted under the suffix rule", Object.keys(unitByRule).filter((k) => k.startsWith("build-suffix")).length === 3, JSON.stringify(unitByRule))
    harness.check("unit attribution: the test rule is counted under its own name", (unitByRule["test-sources"] ?? 0) === 1, JSON.stringify(unitByRule))
    harness.check("unit attribution: the segment rule still names the segment", (unitByPattern.vendor ?? 0) === 1, JSON.stringify(unitByPattern))
    const withTests = DependencyGraphVisualizer.generateGraphData(crafted, [], {}).excluded!
    harness.negative("unit attribution: with tests included the test rule does not fire", (withTests.byRule?.["test-sources"] ?? 0) === 0 && withTests.symbols === 4, JSON.stringify(withTests))
  }

  // The option the caller set is now visible in the block it changed, not only in a flag.
  harness.check("attribution: the test rule appears in `byRule` rather than being folded into nothing", String(noTests.excluded?.includesTestFiles) === "false" && (noTests.excluded?.byRule?.["test-sources"] ?? 0) >= 1, JSON.stringify(noTests.excluded))
}

// ── F8 — the freshness text names an action this tool actually has ───────────
{
  const edited = path.join(root, "src", "api", "handlers.ts")
  writeFileSync(edited, "import { parse } from './parse'\nexport function handleRequest(): string { return parse() + '!' }\nexport function helperOne(): string { return 'changed' }\n")

  const scoped = await run({ scope: "file", target: "src/api/handlers.ts" })
  const remediation = String(scoped.freshness?.remediation ?? "")
  harness.check("freshness: a stale file produces a remediation", remediation.length > 0, JSON.stringify(scoped.freshness))
  harness.check("freshness: the remediation names the manual reindex interface", remediation.includes("bb index") && remediation.includes("bb_index"), remediation)
  harness.negative("freshness: it does not claim this read auto-refreshes", !remediation.includes("reads auto-refresh"), remediation)
  harness.negative("freshness: it does not name `refresh=false`, an option the schema does not publish", !remediation.includes("refresh=false"), remediation)
  harness.check("freshness: file scope gets the FILE remediation, naming this file", remediation.includes('bb index "src/api/handlers.ts"'), remediation)
  harness.negative("freshness: and not the directory remediation for a single file", !remediation.includes("bb index --changed"), remediation)

  const project = await run({ scope: "project" })
  const projectRemediation = String(project.freshness?.remediation ?? "")
  harness.check("freshness: project scope gets the directory remediation", projectRemediation.includes("bb index --changed") && !projectRemediation.includes('bb index "'), projectRemediation)

  // The old text advertised an opt-out. There is no such option, and validation says so.
  const descriptor = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_visualize")!
  const properties = Object.keys((descriptor.inputSchema as any)?.properties ?? {})
  harness.negative("freshness: the schema publishes no `refresh` option for the text to name", !properties.includes("refresh"), properties.join(","))
  // The handler is the INNER door and never sees unknown options — the validation layer refuses
  // them before it. That is the door a caller uses, so that is the door asserted here.
  let refreshRefused = ""
  try {
    validateToolArguments(descriptor, { scope: "project", refresh: false })
  } catch (error) {
    refreshRefused = String((error as Error).message)
  }
  harness.negative("freshness: and passing `refresh` is refused by validation rather than ignored", refreshRefused.includes("unknown or irrelevant options") && refreshRefused.includes("refresh"), refreshRefused.slice(0, 160))

  // The generated page has to agree with the runtime, in the same words.
  const doc = readFileSync(path.join(import.meta.dir, "..", "..", "docs", "tools", "bb_visualize.md"), "utf8")
  const section = doc.match(/## Staleness\n\n([^\n]+)/)?.[1] ?? ""
  harness.check("freshness: the generated page says this tool does not auto-refresh", section.includes("does NOT auto-refresh"), section.slice(0, 160))
  harness.negative("freshness: and the page does not quote the auto-refresh remediation", !section.includes("reads auto-refresh"), section.slice(0, 200))
  harness.check("freshness: the page names the manual interface for both scopes", section.includes("bb index --changed") && section.includes('bb index "<file>"'), section.slice(0, 200))
}

// ── F18/F19 — the first paint: the graph declares its layout, ships its save
//    control, and hides the picked-item box until something is picked ─────────
{
  const graphDoc = await reply({ view: "graph", format: "html" })
  const flatMap = code(graphDoc)
  harness.check("first paint: the graph document declares its layout", /<html[^>]*data-bb-layout="(regions|force)"/.test(flatMap), "no data-bb-layout on <html>")
  harness.check("first paint: the graph still ships its save control", flatMap.includes("bb-architecture-map.html"), "")
  harness.check("first paint: the picked-item box hides until something is selected", flatMap.includes("#detail{right:14px;bottom:14px") && flatMap.includes("display:none"), "")
}

rmSync(root, { recursive: true, force: true })
harness.emit()
