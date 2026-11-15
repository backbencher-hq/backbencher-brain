/**
 * THE PRICE OF THE IN-LANE FIX FOR THE PRIMARY-CONSTRUCTOR HOLE — measured before anything is built.
 *
 * `primary-constructor-hole.ts` established the defect: the grammar returns ERROR nodes for
 * `class Impl(String label) extends Base {`, so the class symbol is lost and — with a heritage
 * clause — its members are recovered at LIBRARY scope (a method republished as a top-level
 * `function`). Upstream cannot fix it: `tree-sitter-dart`'s 3.12/3.13 request (#105) was still open
 * on 2026-10-09 and the grammar chain advertises support through dart 3.11.
 *
 * The one in-lane alternative is to BLANK the parameter list in the analyzer's copy of the source
 * before parsing, length-preserving so every offset, line and column survive. This file prices it
 * WITHOUT touching the analyzer: the same file is parsed twice — as it is, and as the transform
 * would present it — and the two inventories are compared. Both sides are measured on the same
 * files in the same run, so unlike a rotation-sampled A/B the comparison is exact.
 *
 * WHAT IT CANNOT DO, stated here rather than discovered later: the primary constructor's IMPLICIT
 * FIELDS are not recovered (they exist only as parameters). So the price is an upper bound on what
 * the transform buys, and the field loss is part of what the decision compares.
 *
 * Run: npx tsx validation/m14/fixtures/dart/primary-constructor-price.ts [repo,...]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const repos = (process.argv[2] ?? "pb-reference,nvim-treesitter,dart-http,riverpod,proxicall,flutter-packages,dart-sdk").split(",")
const WORK = mkdtempSync(path.join(tmpdir(), "dt-pc-price-"))

/** comments and string literals blanked, positions preserved — the scan machinery the watchdog uses */
function blank(text: string): string {
  const out = text.split("")
  const n = text.length
  let i = 0
  const blankRange = (from: number, to: number) => { for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " " }
  while (i < n) {
    const c = text[i], d = text[i + 1]
    if (c === "/" && d === "/") { const s = i; while (i < n && text[i] !== "\n") i++; blankRange(s, i); continue }
    if (c === "/" && d === "*") { const s = i; i += 2; while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++; i = Math.min(n, i + 2); blankRange(s, i); continue }
    const isRaw = (c === "r" || c === "R") && (d === "'" || d === '"')
    if (c === "'" || c === '"' || isRaw) {
      const q = isRaw ? d : c, s = i
      if (isRaw) i++
      const triple = text[i + 1] === q && text[i + 2] === q
      i += triple ? 3 : 1
      while (i < n) {
        if (text[i] === "\\" && !isRaw) { i += 2; continue }
        if (triple ? text[i] === q && text[i + 1] === q && text[i + 2] === q : text[i] === q) { i += triple ? 3 : 1; break }
        i++
      }
      blankRange(s, i); continue
    }
    i++
  }
  return out.join("")
}

/**
 * Every declaring-constructor parameter list in a file, as [open, close) offsets into the raw text.
 *
 * THE NO-BODY FORM IS EXCLUDED, and that exclusion is the instrument's own correction: the first
 * version blanked `class _ValidatedPackage({ … });` too, which leaves `class _ValidatedPackage;` —
 * not valid dart — and DELETED a class the harness was supposed to repair. The price it printed was
 * therefore the price of a transform with a bug in it. The semicolon form is reported as its own
 * count and handled by nothing, because a length-preserving repair of it needs room for a body that
 * the source does not have.
 */
function primaryParameterSpans(raw: string): { spans: Array<[number, number]>; noBody: number } {
  const masked = blank(raw)
  const spans: Array<[number, number]> = []
  let noBody = 0
  const form = /\bclass\s+[A-Za-z_$][A-Za-z0-9_$]*(?:\s*<[^;{}()]*?>)?\s*\(/g
  for (const m of masked.matchAll(form)) {
    const open = m.index + m[0].length - 1          // the "(" the form ended on
    let depth = 0
    let i = open
    while (i < masked.length) {
      const c = masked[i]
      if (c === "(") depth++
      else if (c === ")") { depth--; if (depth === 0) break }
      i++
    }
    if (i >= masked.length) continue                // unbalanced in the masked text: refuse, do not guess
    // `({ … });` — a declaration with NO body. Blanking it leaves `class X;`, which is not dart.
    if (/^\s*;/.test(masked.slice(i + 1, i + 40))) { noBody++; continue }
    spans.push([open, i + 1])
  }
  return { spans, noBody }
}

/** THE TRANSFORM. Length-preserving, newline-preserving: every offset the analyzer later reports
 *  still points at the same character of the same line. */
function blankSpans(raw: string, spans: Array<[number, number]>): string {
  if (spans.length === 0) return raw
  const out = raw.split("")
  for (const [from, to] of spans) for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " "
  return out.join("")
}

type Inventory = {
  symbols: number
  classOwned: number
  ownerless: number
  edges: number
  ownedEdges: number
  named: Set<string>
}
async function inventory(file: string, repoRoot: string): Promise<Inventory> {
  const out: any = await parseFile(file, repoRoot, { projectRoot: repoRoot } as any)
  const syms = (out?.symbols ?? []) as any[]
  const rels = (out?.relationships ?? []) as any[]
  const owned = syms.filter((s) => s.ownerName && s.ownerName !== "")
  const ownedEdges = rels.filter((r) => {
    const src = String(r.source ?? "")
    return src.includes(".")     // an edge whose SOURCE names its owner rather than standing alone
  })
  return {
    symbols: syms.length,
    classOwned: owned.length,
    ownerless: syms.filter((s) => !s.ownerName || s.ownerName === "").length,
    edges: rels.length,
    ownedEdges: ownedEdges.length,
    named: new Set(syms.map((s) => `${s.name}|${s.ownerName ?? ""}|${s.kind}`)),
  }
}

// CONTROL — the transform must move nothing it is not aimed at, and must be a no-op on a file with
// no such declaration. Both halves are asserted on a synthetic pair before the population is read.
{
  const plain = "class Ordinary { int m() => 0; }\n"
  if (blankSpans(plain, primaryParameterSpans(plain).spans) !== plain) {
    console.error("CONTROL FAILED: the transform touched a file with no declaring constructor")
    process.exit(3)
  }
  if (primaryParameterSpans("class NoBody({required int a});\n").spans.length !== 0) {
    console.error("CONTROL FAILED: the no-body form was not excluded — blanking it deletes the class")
    process.exit(3)
  }
  if (primaryParameterSpans("class NoBody({required int a});\n").noBody !== 1) {
    console.error("CONTROL FAILED: the no-body form was not COUNTED — a silently skipped shape is an unmeasured one")
    process.exit(3)
  }
  if (primaryParameterSpans("class Named({required int a}) { int m() => a; }\n").spans.length !== 1) {
    console.error("CONTROL FAILED: a body-bearing named form was excluded as no-body")
    process.exit(3)
  }
  const withForm = "class P(int a, [String? b]) extends O {\n  int m() => 0;\n}\n"
  const t = blankSpans(withForm, primaryParameterSpans(withForm).spans)
  if (t.length !== withForm.length || t.split("\n").length !== withForm.split("\n").length) {
    console.error("CONTROL FAILED: the transform changed the file's length or line count")
    process.exit(3)
  }
  if (!/class P\s+extends O \{/.test(t)) {
    console.error(`CONTROL FAILED: the transform did not leave a parseable class header: ${JSON.stringify(t)}`)
    process.exit(3)
  }
  if (/\bString\??\s*b\b/.test(t.replace(/class P\s+extends O/, ""))) {
    console.error("CONTROL FAILED: the parameter list is still present")
    process.exit(3)
  }
  console.log("price control: PASS — the transform is length- and line-preserving, removes the parameter")
  console.log("list, leaves `class P extends O {`, and is a no-op on files without the form.\n")
}

let files = 0
let noBodySpans = 0, noBodyFiles = 0
let symGain = 0, symOwnedGain = 0, edgeGain = 0, edgeOwnedGain = 0
const examples: string[] = []
for (const name of repos) {
  const repoDir = path.join(CR, name)
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", repoDir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean).filter((r) => r.endsWith(".dart")) } catch { continue }
  let repoFiles = 0
  for (const r of tracked) {
    const abs = path.join(repoDir, r)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    const raw = readFileSync(abs, "utf8")
    const { spans, noBody } = primaryParameterSpans(raw)
    if (noBody > 0) { noBodySpans += noBody; noBodyFiles++ }
    if (spans.length === 0) continue
    const transformed = blankSpans(raw, spans)
    if (transformed === raw) continue
    const shadowDir = path.join(WORK, name)
    mkdirSync(path.join(shadowDir, path.dirname(r)), { recursive: true })
    const shadow = path.join(shadowDir, r)
    writeFileSync(shadow, transformed)

    const before = await inventory(abs, repoDir)
    const after = await inventory(shadow, shadowDir)
    repoFiles++; files++
    const dSym = after.symbols - before.symbols
    const dOwned = after.classOwned - before.classOwned
    const dEdge = after.edges - before.edges
    const dOwnedEdge = after.ownedEdges - before.ownedEdges
    symGain += dSym; symOwnedGain += dOwned; edgeGain += dEdge; edgeOwnedGain += dOwnedEdge
    if (examples.length < 6 && (dOwned !== 0 || dOwnedEdge !== 0)) {
      examples.push(`  ${name}/${r}: symbols ${before.symbols} -> ${after.symbols} (+${dSym}), class-owned ${before.classOwned} -> ${after.classOwned} (+${dOwned}), edges ${before.edges} -> ${after.edges} (+${dEdge}), owner-qualified edge sources ${before.ownedEdges} -> ${after.ownedEdges} (+${dOwnedEdge})  [${spans.length} declaration(s)]`)
    }
  }
  if (repoFiles > 0) console.log(`${name.padEnd(18)} ${repoFiles} files transformed and parsed both ways`)
}
console.log(`\n  EXCLUDED (no-body form, ` + "`class X({ … });`" + `): ${noBodySpans} declaration(s) in ${noBodyFiles} file(s) — blanking them leaves \`class X;\``)
console.log(`\nPRICE (upper bound — the implicit fields are NOT recovered):`)
console.log(`  files ${files} · symbols ${symGain >= 0 ? "+" : ""}${symGain} · class-owned symbols ${symOwnedGain >= 0 ? "+" : ""}${symOwnedGain} · edges ${edgeGain >= 0 ? "+" : ""}${edgeGain} · owner-qualified edge sources ${edgeOwnedGain >= 0 ? "+" : ""}${edgeOwnedGain}`)
if (examples.length > 0) { console.log("\n  examples:"); for (const e of examples) console.log(e) }
