// script/m55/verify-action-args.ts — M55.V1 component gate: the hover actions'
// argument core (one entry point, one answer).
//
// FOUND BY THE FRAMES, not by a plan (owner live test, 2026-09-13): flows 4 and
// 5 of the V1 rig captured the toast
//
//     bb_lsp: malformed bb.openGraph link (no symbol target).
//     bb_lsp: malformed bb.openImpact link (no symbol target).
//
// instead of a panel. Cause: VS Code's palette / context-menu invocation
// passes NO arguments, so every symbol-scoped action dead-ended on the
// editor's own command-discovery surface — while the declared rule (issue
// #652) forbids the client from guessing identity. The fix asks the SERVER
// (the same hover request the editor uses) and keeps every decision in one
// pure module (ide/vscode/src/hover-action-args.ts).
//
// What this gate checks:
//
//   A arrival:     link / absent / malformed, over delivery shapes (object,
//                  array, JSON string) and the strict-validation negatives —
//                  and the two must NEVER be confused (corruption is not
//                  absence: a broken link must stay a loud error).
//   B identity:    the server payload -> args extraction, including every
//                  declared-absence shape (no data, no symbol, no
//                  declaration) and non-integer positions.
//   C one answer:  DIFFERENTIAL — the args the hover LINK carries (decoded
//                  from src/lsp/rich_hover.ts's own uri builder) and the args
//                  the cursor fallback produces for the same symbol payload
//                  must be byte-identical. Both entry points, one identity.
//   D one owner:   wiring lint — all three commands route through
//                  hoverActionArgs, no command parses args itself, the pure
//                  module imports nothing from vscode, and the command ids
//                  still match the server's composer.
//   E mutants:     absence-as-corruption, corruption-as-absence, an off-by-one
//                  identity, an invented declaration, a bypassed entry point,
//                  and a vscode import in the pure core must each fail.
//
// Run: npx tsx script/m55/verify-action-args.ts
// Evidence: validation/m55/results/V1-action-args.json (machine-emitted)

import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const CORE = path.join(ROOT, "ide/vscode/src/hover-action-args.ts")
const COMMANDS = path.join(ROOT, "ide/vscode/src/hover-commands.ts")
const SERVER_HOVER = path.join(ROOT, "src/lsp/rich_hover.ts")
const EVIDENCE = path.join(ROOT, "validation/m55/results/V1-action-args.json")

let checks = 0
let passed = 0
const failures: string[] = []
let mutantsCaught = 0
let mutantsTotal = 0
function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}
function mutant(label: string, caught: boolean, detail = ""): void {
  mutantsTotal++
  if (caught) mutantsCaught++
  check(`${label} [mutant]`, caught, detail)
}

const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => l.slice(3))

const core = (await import(pathToFileURL(CORE).href)) as typeof import("../../ide/vscode/src/hover-action-args.ts")
const { classifyActionArgs, identityFromHoverPayload, parseHoverActionArgs, parseHoverLinkArgs, normalizeArgs } = core
const server = (await import(pathToFileURL(SERVER_HOVER).href)) as typeof import("../../src/lsp/rich_hover.ts")

// --- A: which arrival is this invocation? -----------------------------------------
console.log("A: arrival classification (link / absent / malformed)")
const ID = { symbol: "greet", file: "/w/src/greeter.ts", line: 10, character: 2 }

check("A1: undefined is ABSENCE (the palette invocation)", classifyActionArgs(undefined).kind === "absent")
check("A2: null is ABSENCE", classifyActionArgs(null).kind === "absent")
check("A3: the link object parses to the exact identity", JSON.stringify(classifyActionArgs({ ...ID })) === JSON.stringify({ kind: "link", args: ID }))
check(
  "A4: array delivery (VS Code's command-URI shape) parses",
  JSON.stringify(classifyActionArgs([{ ...ID }])) === JSON.stringify({ kind: "link", args: ID }),
)
check(
  "A5: JSON-string delivery parses",
  JSON.stringify(classifyActionArgs(JSON.stringify([{ ...ID }]))) === JSON.stringify({ kind: "link", args: ID }),
)
// Corruption must NEVER be softened into absence (that would silently apply
// the fallback to a broken link and open the wrong symbol).
const malformed: Array<[string, unknown]> = [
  ["an empty object", {}],
  ["an empty symbol name", { ...ID, symbol: "" }],
  ["an empty file", { ...ID, file: "" }],
  ["a negative line", { ...ID, line: -1 }],
  ["a fractional line", { ...ID, line: 1.5 }],
  ["a string line", { ...ID, line: "10" }],
  ["a symbol-only payload", { symbol: "greet" }],
  ["a JSON string that is not JSON", "not json"],
  ["a bare number", 42],
  ["an array of null", [null]],
  ["a boolean", true],
]
for (const [what, raw] of malformed) {
  const got = classifyActionArgs(raw).kind
  check(`A6: ${what} is MALFORMED (never absence, never a silent fallback)`, got === "malformed", got)
}
check(
  "A7: every malformed payload also fails the strict parse (one rule, no second opinion)",
  malformed.every(([, raw]) => parseHoverActionArgs(raw) === null),
)
check("A8: the location parser is unchanged and still strict", parseHoverLinkArgs({ file: "/w/a.ts", line: 0, character: 0 }) !== null && parseHoverLinkArgs({ file: "/w/a.ts", line: 0 }) === null)
check(
  "A9: normalizeArgs still accepts the three delivery shapes (and nulls a bad one)",
  normalizeArgs(JSON.stringify([{ ...ID }])) !== null &&
    normalizeArgs([[{ ...ID }]]) !== null &&
    normalizeArgs({ ...ID }) !== null &&
    normalizeArgs(7) === null &&
    // An empty array unwraps to undefined — absence of a payload, not an object.
    normalizeArgs("[]") === null,
  String(normalizeArgs("[]")),
)

// --- B: the server payload -> identity --------------------------------------------
console.log("\nB: identity out of the server's hover payload")
const payload = { provenance: { source: "bb_index" }, data: { symbol: { name: "greet", filePath: "/w/src/greeter.ts", definition: { line: 10, character: 2 } } } }
check("B1: the server's payload yields the identity triple", JSON.stringify(identityFromHoverPayload(payload)) === JSON.stringify(ID), JSON.stringify(identityFromHoverPayload(payload)))
const absences: Array<[string, unknown]> = [
  ["a null response (server answered absence)", null],
  ["a non-object response", "nope"],
  ["a response with no data slot", { contents: {} }],
  ["a data slot that is not an object", { data: 7 }],
  ["no symbol slot", { data: { provenance: {} } }],
  ["an empty symbol name", { data: { symbol: { name: "", filePath: "/w/a.ts", definition: { line: 0, character: 0 } } } }],
  ["an empty filePath", { data: { symbol: { name: "greet", filePath: "", definition: { line: 0, character: 0 } } } }],
  ["no definition (nothing clickable — §12.1)", { data: { symbol: { name: "greet", filePath: "/w/a.ts", definition: null } } }],
  ["a definition that is not an object", { data: { symbol: { name: "greet", filePath: "/w/a.ts", definition: "10:2" } } }],
  ["a string line", { data: { symbol: { name: "greet", filePath: "/w/a.ts", definition: { line: "10", character: 2 } } } }],
  ["a negative line", { data: { symbol: { name: "greet", filePath: "/w/a.ts", definition: { line: -1, character: 2 } } } }],
  ["a fractional character", { data: { symbol: { name: "greet", filePath: "/w/a.ts", definition: { line: 10, character: 2.5 } } } }],
]
for (const [what, hover] of absences) {
  check(`B2: ${what} -> declared absence (null), never an invented location`, identityFromHoverPayload(hover) === null)
}

// --- C: one answer (differential against the server's own link builder) ------------
console.log("\nC: the link's args and the cursor fallback's args are the same identity")
for (const [name, uri] of [
  ["openGraph", server.openGraphUri(ID)],
  ["openImpact", server.openImpactUri(ID)],
  ["showCallHierarchy", server.showCallHierarchyUri(ID)],
] as const) {
  const q = uri.indexOf("?")
  const decoded = JSON.parse(decodeURIComponent(uri.slice(q + 1))) as unknown
  const fromLink = parseHoverActionArgs(decoded)
  const fromCursor = identityFromHoverPayload(payload)
  check(
    `C1: ${name} — decoded link args === cursor-fallback args (byte-identical)`,
    fromLink !== null && fromCursor !== null && JSON.stringify(fromLink) === JSON.stringify(fromCursor),
    `${JSON.stringify(fromLink)} vs ${JSON.stringify(fromCursor)}`,
  )
  check(`C2: ${name} — the link's args survive the arrow the client uses`, fromLink !== null && fromLink.symbol === ID.symbol && fromLink.line === ID.line && fromLink.character === ID.character)
}
// The command ids must not drift apart: the server composes them, the client
// registers them (the ids are the contract between the two).
const commandSource = readFileSync(COMMANDS, "utf8")
check(
  "C3: the client's registered ids are the server's composed ids",
  commandSource.includes(`OPEN_GRAPH = "${server.OPEN_GRAPH_COMMAND}"`) &&
    commandSource.includes(`OPEN_IMPACT = "${server.OPEN_IMPACT_COMMAND}"`) &&
    commandSource.includes(`SHOW_CALL_HIERARCHY = "${server.SHOW_CALL_HIERARCHY_COMMAND}"`),
)

// --- D: one owner ------------------------------------------------------------------
console.log("\nD: wiring (one argument source, one pure core)")
const coreSource = readFileSync(CORE, "utf8")
/** The lint, as a pure function so a mutant can be run through it. */
function lintWiring(commandsSrc: string, coreSrc: string): string[] {
  const v: string[] = []
  for (const id of ["OPEN_GRAPH", "OPEN_IMPACT", "SHOW_CALL_HIERARCHY"]) {
    if (!commandsSrc.includes(`await hoverActionArgs(raw, deps, ${id})`)) v.push(`${id}: does not resolve its args through hoverActionArgs (a second entry-point answer is a fork)`)
  }
  // A command body that parses args itself would answer only the link path.
  const registerFn = commandsSrc.slice(commandsSrc.indexOf("function register("))
  for (const body of registerFn.split("vscode.commands.registerCommand(").slice(1)) {
    const head = body.slice(0, body.indexOf("\n    }),"))
    if (/parseHoverActionArgs\(raw\)\s*$/.test(head.trim())) v.push("a command parses its own args (must route through hoverActionArgs)")
  }
  if (!/classifyActionArgs\(raw\)/.test(commandsSrc)) v.push("hoverActionArgs does not classify the arrival (absence would be treated as corruption or vice versa)")
  if (!/identityFromHoverPayload\(hover\)/.test(commandsSrc)) v.push("the cursor fallback does not read identity through the pure core")
  if (!/client\.sendRequest<unknown>\("textDocument\/hover"/.test(commandsSrc)) v.push("the cursor fallback does not ask the SERVER for the identity (issue #652: no client-side guessing)")
  if (!/put the cursor on an indexed symbol/.test(commandsSrc)) v.push("the no-symbol answer is not declared to the user")
  // The pure core must stay pure: a vscode import makes it ungated-able.
  if (/from "vscode"/.test(coreSrc) || /require\("vscode"\)/.test(coreSrc)) v.push("the args core imports vscode (not headless-gateable)")
  if (!/export function classifyActionArgs/.test(coreSrc)) v.push("the args core does not own the arrival decision")
  return v
}
const wiring = lintWiring(commandSource, coreSource)
check("D1: every symbol-scoped command routes through the one argument source", wiring.length === 0, wiring.join("; "))

// --- E: mutants --------------------------------------------------------------------
console.log("\nE: mutants (each planted defect must fail the suite)")
async function withCore(name: string, from: string, to: string, caught: (m: typeof core) => boolean): Promise<void> {
  if (!coreSource.includes(from)) {
    check(`M: ${name} (SKIP — anchor not found)`, false, from.slice(0, 70))
    return
  }
  const dir = mkdtempSync(path.join(tmpdir(), "m55-v1-aaa-mut-"))
  const target = path.join(dir, "mutant.ts")
  writeFileSync(target, coreSource.replace(from, to))
  try {
    const m = (await import(pathToFileURL(target).href)) as typeof core
    mutant(name, caught(m))
  } catch (e) {
    mutant(name, true, `mutant failed to load: ${String(e).slice(0, 80)}`)
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
}

// M1: absence treated as corruption — the palette dead end comes back.
await withCore(
  "M1: absence treated as corruption (the palette dead end returns)",
  '  if (raw === undefined || raw === null) return { kind: "absent" }',
  '  if (raw === undefined || raw === null) return { kind: "malformed" }',
  (m) => m.classifyActionArgs(undefined).kind !== "absent",
)
// M2: corruption treated as absence — a broken link silently falls back to
// whatever the cursor happens to be on.
await withCore(
  "M2: corruption treated as absence (a broken link opens the wrong symbol)",
  '  if (raw === undefined || raw === null) return { kind: "absent" }\n  return { kind: "malformed" }',
  '  return { kind: "absent" }',
  (m) => m.classifyActionArgs({ symbol: "" }).kind === "absent",
)
// M3: an off-by-one identity — the panel would open one line off (and would
// disagree with the very link the hover rendered).
await withCore(
  "M3: off-by-one declaration line (the fallback disagrees with the link)",
  "  return { symbol: name, file: filePath, line, character }",
  "  return { symbol: name, file: filePath, line: line + 1, character }",
  (m) => {
    const got = m.identityFromHoverPayload(payload)
    return got === null || got.line !== ID.line
  },
)
// M4: an invented declaration — a symbol without a resolvable location gets
// a fabricated 0:0 (nothing unclickable becomes clickable).
await withCore(
  "M4: an invented declaration (a symbol with no location gets 0:0)",
  '  if (typeof definition !== "object" || definition === null) return null',
  "  if (typeof definition !== \"object\" || definition === null) return { symbol: name, file: filePath, line: 0, character: 0 }",
  (m) => m.identityFromHoverPayload({ data: { symbol: { name: "greet", filePath: "/w/a.ts", definition: null } } }) !== null,
)
// M5: a command bypasses the one argument source (the fork this issue closed).
{
  const mutated = commandSource.replace("await hoverActionArgs(raw, deps, OPEN_GRAPH)", "parseHoverActionArgs(raw)")
  const v = lintWiring(mutated, coreSource)
  mutant("M5: one command bypasses hoverActionArgs (the fork returns)", v.length > 0, v.join("; ").slice(0, 120))
}
// M6: the pure core starts importing vscode — the gate can no longer run it.
{
  const mutated = coreSource.replace("export interface HoverLinkArgs {", 'import * as vscode from "vscode"\nexport interface HoverLinkArgs {')
  const v = lintWiring(commandSource, mutated)
  mutant("M6: a vscode import in the args core (not headless-gateable)", v.length > 0, v.join("; ").slice(0, 120))
}
// M7: the fallback stops asking the server and guesses locally.
{
  const mutated = commandSource.replace('client.sendRequest<unknown>("textDocument/hover"', 'Promise.resolve(null) as never')
  const v = lintWiring(mutated, coreSource)
  mutant("M7: the fallback stops asking the index (guessing is back)", v.length > 0, v.join("; ").slice(0, 120))
}

// --- Evidence -----------------------------------------------------------------------
const status = failures.length === 0 ? "verified" : "known-gap"
const result = {
  issue: "V1-component",
  code: "V1-action-args",
  milestone: "M55",
  title: "The hover actions' argument core (one entry point, one answer)",
  status,
  passed,
  failed: failures.length,
  checks,
  mutantsCaught,
  mutantsTotal,
  negatives: malformed.length + absences.length,
  currentCommit,
  ...fingerprintFields(["m55.V1-action-args"], ROOT),
  workingTreeRelevantChanges: dirty.filter((f) => f.startsWith("ide/vscode/") || f.startsWith("script/m55/")),
  foundBy: "the V1 rig's own frames (flows 4 and 5 captured the error toast: validation/m55/frames/live-6/4-open-in-graph.png, 5-impact.png)",
  owner: "ide/vscode/src/hover-action-args.ts (pure) + ide/vscode/src/hover-commands.ts (IO)",
  verifierCommand: "npx tsx script/m55/verify-action-args.ts",
  evidenceFile: "V1-action-args.json",
  generatedAt: new Date().toISOString(),
  failures,
}
mkdirSync(path.dirname(EVIDENCE), { recursive: true })
writeSealed(EVIDENCE, result)
console.log(`\nV1-action-args: ${status.toUpperCase()} (${passed}/${checks} passed, ${mutantsCaught}/${mutantsTotal} mutants)`)
console.log(`Evidence: ${EVIDENCE}`)
if (failures.length > 0) {
  console.log("Failures:")
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
