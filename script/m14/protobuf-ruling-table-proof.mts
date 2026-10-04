/**
 * PROVE THE PROTOBUF RULING TABLE — without editing the shared arbiter.
 *
 * ## What this does and why it is not a re-implementation
 *
 * `script/m14/ontology-coverage-gate.ts` is the workstream's arbiter and it is the
 * SUPERVISOR's file. It reads a lane's ruling table from `RULED_BY_LANG`, and
 * `protobuf` is not in that map, so it exits 2 with "no RULING TABLE for protobuf"
 * and this lane's RULED verdicts have never been checked by anything.
 *
 * The wiring is three lines across two files this lane does not own, so this script
 * does not make them. Instead it DERIVES a wired copy of the gate MECHANICALLY —
 * read the shared sources as text, assert each anchor line is present exactly once,
 * splice, run — and then deletes the copies. Nothing hand-written re-implements the
 * gate's algorithm here, because a second implementation of an arbiter is a second
 * opinion nobody arbitrates between: if the two ever disagree, a reader cannot tell
 * which one the supervisor's gate would have said. The only thing this script
 * contributes is the splice, and it refuses to run if any anchor has moved.
 *
 * The wiring the supervisor needs, in full:
 *
 *   script/m14/ontology-coverage-gate.ts
 *     + import { PROTOBUF_RULED } from "./protobuf-ruled"
 *     ~ const RULED_BY_LANG … = { bash: BASH_RULED, json: JSON_RULED, protobuf: PROTOBUF_RULED }
 *
 *   script/m14/differential.ts            (LANGS — also what selects the gate's wasm)
 *     + protobuf: { wasm: "tree-sitter-protobuf.wasm", analyzerFile: "real-protobuf-analyzer",
 *                   className: "RealProtobufAnalyzer", ext: "proto" },
 *
 * The second block is not cosmetic. The gate picks its wasm with
 * `(LANGS as any)[LANG]?.wasm ?? "tree-sitter-bash.wasm"`, so without a `protobuf`
 * entry BOTH instruments are handed the bash grammar and a corpus of `.proto` files.
 * Run B below is that state, and it is reported rather than assumed: instrument A
 * reads "the grammar produced 81 distinct node types" where protobuf's own count is
 * 94, and `calls` comes back FALSIFIED because `function_definition` is a real BASH
 * node type. Run C is the same table with the right grammar.
 *
 * `run-fixtures.ts:91` already carries those four LANGS fields for this lane, so the
 * second block is a copy of a value that exists rather than a new claim.
 *
 * CLI: npx tsx script/m14/protobuf-ruling-table-proof.mts [--only=a|b|c] [--keep]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const GATE = path.join(ROOT, "script/m14/ontology-coverage-gate.ts")
const DIFFERENTIAL = path.join(ROOT, "script/m14/differential.ts")
const DERIVED_GATE = path.join(ROOT, "script/m14/.derived-ontology-gate-for-protobuf.ts")
const DERIVED_DIFF = path.join(ROOT, "script/m14/.derived-differential-for-protobuf.ts")
const KEEP = process.argv.includes("--keep")
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length)

const IMPORT_ANCHOR = 'import { LANGS } from "./differential"'
/**
 * The ruling map is located STRUCTURALLY — the declaration line, then the `}` that
 * closes it — instead of by pinning its whole text. Three lanes have since been
 * wired into it and a pinned string had already gone stale twice, and a stale
 * anchor here throws before the gate runs, which reads as a broken lane rather
 * than as a shared file that grew. Index arithmetic only; no pattern matching.
 */
const MAP_DECL = "const RULED_BY_LANG: Record<string, Ruled[]> = {"
function findMapDecl(src: string): { start: number; close: number } | null {
  const at = src.indexOf(MAP_DECL)
  if (at < 0) return null
  // From the DECLARATION, not from the end of its line: the map's closing brace is
  // the last character of that line, so a search begun at the newline walks PAST it
  // and lands on whichever `}` comes next in the file — which spliced the entry into
  // an unrelated type annotation and produced a table that was still empty.
  const close = src.indexOf("}", at)
  if (close < 0) return null
  return { start: at, close }
}
const LANGS_ANCHOR = '  bash: { wasm: "tree-sitter-bash.wasm", analyzerFile: "real-bash-analyzer", className: "RealBashAnalyzer", ext: "sh,bash" },'
const PROTOBUF_LANGS_ENTRY =
  '  protobuf: { wasm: "tree-sitter-protobuf.wasm", analyzerFile: "real-protobuf-analyzer", className: "RealProtobufAnalyzer", ext: "proto" },'

const gateSrc = readFileSync(GATE, "utf8")
const diffSrc = readFileSync(DIFFERENTIAL, "utf8")

const need = (haystack: string, needle: string, what: string, file: string): void => {
  const n = haystack.split(needle).length - 1
  if (n !== 1) {
    throw new Error(`anchor moved or duplicated (${n}x): ${what} in ${file}. Refusing to splice a file whose shape I do not recognise.`)
  }
}

/** `withTable` wires the ruling table; `withLang` also wires the LANGS entry, which is what selects the wasm. */
const splice = (withTable: boolean, withLang: boolean): string => {
  let s = gateSrc
  need(s, IMPORT_ANCHOR, "the differential import", path.relative(ROOT, GATE))
  const map = findMapDecl(s)
  if (!map) {
    throw new Error(`anchor missing: RULED_BY_LANG in ${path.relative(ROOT, GATE)}. Refusing to splice a file whose shape I do not recognise.`)
  }
  if (withTable) {
    s = s.replace(IMPORT_ANCHOR, `${IMPORT_ANCHOR}\nimport { PROTOBUF_RULED } from "./protobuf-ruled"`)
    const at = findMapDecl(s)!
    s = `${s.slice(0, at.close)}, protobuf: PROTOBUF_RULED ${s.slice(at.close)}`
  }
  if (withLang) {
    need(diffSrc, LANGS_ANCHOR, "the bash LANGS entry", path.relative(ROOT, DIFFERENTIAL))
    writeFileSync(DERIVED_DIFF, diffSrc.replace(LANGS_ANCHOR, `${LANGS_ANCHOR}\n${PROTOBUF_LANGS_ENTRY}`))
    // The gate imports `./differential` by RELATIVE path, so the derived
    // differential must sit beside it AND be named by the derived gate. The QUOTED
    // form is the needle and the replacement carries its own pair of quotes: an
    // earlier version replaced the bare `./differential` inside `"./differential"`
    // and left the original's closing quote behind, producing `…protobuf""`.
    s = s.replace(IMPORT_ANCHOR, `import { LANGS } from "./.derived-differential-for-protobuf"`)
  }
  return s
}

const NOISE_PREFIX = "[INFO]"
const NOISE_TOKENS = ["BB-PARSE-ERR", "BB-HANG"]
const clean = (s: string): string =>
  s
    .split("\n")
    .filter((l) => !l.startsWith(NOISE_PREFIX) && !NOISE_TOKENS.some((t) => l.includes(t)))
    .join("\n")

const run = (label: string, code: string, tailOnly = false): string => {
  writeFileSync(DERIVED_GATE, code)
  try {
    const out = execFileSync("npx", ["tsx", DERIVED_GATE, "protobuf"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const noise = clean(out)
    return `${label}\n${tailOnly ? noise.split("\n").slice(-6).join("\n") : noise}`
  } catch (e: any) {
    const noise = clean(`${e.stdout ?? ""}${e.stderr ?? ""}`)
    return `${label} (exit ${e.status})\n${tailOnly ? noise.split("\n").slice(-6).join("\n") : noise}`
  } finally {
    if (!KEEP) {
      rmSync(DERIVED_GATE, { force: true })
      rmSync(DERIVED_DIFF, { force: true })
    }
  }
}

const bar = "=".repeat(120)
const want = (k: string): boolean => !ONLY || ONLY === k

if (want("a")) {
  console.log(bar)
  console.log("A. THE SHARED GATE, UNTOUCHED — what it says about protobuf today")
  console.log(bar)
  console.log(run("(a) npx tsx script/m14/ontology-coverage-gate.ts protobuf", gateSrc, true))
  console.log("")
}

if (want("b")) {
  console.log(bar)
  console.log("B. RULING TABLE WIRED, LANGS UNTOUCHED — both instruments read the BASH grammar")
  console.log(bar)
  console.log(run("(b) derived gate, protobuf-ruled wired, protobuf absent from LANGS", splice(true, false)))
  console.log("")
}

if (want("c")) {
  console.log(bar)
  console.log("C. RULING TABLE WIRED AND protobuf ADDED TO LANGS — both instruments read the protobuf grammar")
  console.log(bar)
  console.log(run("(c) derived gate, protobuf-ruled wired, protobuf present in LANGS", splice(true, true)))
}

if (!KEEP) {
  rmSync(DERIVED_GATE, { force: true })
  rmSync(DERIVED_DIFF, { force: true })
} else {
  console.log(`\n(kept the derived copies because --keep was passed)`)
}