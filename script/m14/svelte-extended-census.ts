#!/usr/bin/env bun
/**
 * SVELTE LANE — THE EXTENDED-TYPES PROVENANCE CENSUS (the population leg of the remedy ladder).
 * Author: Muhammad Ishaq Khan (svelte lane).
 *
 * ## THE QUESTION
 *
 * The four extended values (`decorates`, `renders`, `mixes_in`, `part_of`) plus `overrides` are the
 * campaign's 38-lane gaps. For THIS lane the coverage block declares none of them, so the coverage
 * gate reads five gaps — but a declaration is not a measurement, and three of the five are already
 * emitted by the production path through the JS/TS DELEGATION SEAM (the SFC seam copies every
 * delegate relationship and stamps it `metadata.sfcDelegated` — `real-svelte-analyzer.ts:1207`).
 * A type can therefore be EMITTED while the block says nothing, and a type can be ABSENT while the
 * language can express it. This instrument decides, on the tree, which case each one is.
 *
 * ## THE POPULATION RULE — the fleet's, printed with the number
 *
 * The admitted set is the GIT-TRACKED set, not the disk: for every repository entry at the corpus
 * root, `git ls-files -z -- '*.svelte'`, then the 1 MiB per-file cap. The corpus root is
 * `$PWD/.corpus`; the walk follows symlinked directories and PRINTS how many entries it entered and
 * how many distinct real paths stood behind them, so no number here is comparable to a different
 * rule's number by accident. `--sample=N` and `--filter=` are DECLARED BOUNDED VALIDATION modes,
 * never measurements: the headline prints them as such.
 *
 * ## TWO LEGS, ON THE SAME FILES, AND THE CROSS-CHECK IS THE POINT
 *
 *   1. EMISSION LEG — the PRODUCTION path (`parseFile` from `src/ast/pool-worker.ts`, the pooled
 *      path every lane's verdict is measured through): per-type edge counts, and for every type the
 *      provenance split `sfc` (written by the SFC pass) vs `delegate` (copied from the JS/TS
 *      script-body delegate, `metadata.sfcDelegated === true`). The `instantiates` split is called
 *      out because the SFC template tag is the only real `renders` construct this language has.
 *
 *   2. CONSTRUCT LEG — the AST, on the same files: the SFC tree for component tags, and each
 *      `<script>` body parsed with the grammar its OWN `lang` attribute names (the construct probe's
 *      calibration lesson: parsing a `lang="ts"` block with the javascript grammar reports 0
 *      interfaces and 0 implements). For each candidate construct it records the NODE TYPE it
 *      arrives as and whether the subtree carries ERROR/MISSING — the "REAL NODE rather than
 *      recovery text" test, measured on the tree.
 *
 * The cross-check is printed, not inferred: emission edges vs construct sites for the same relation.
 * They are NOT expected to be equal — the downstream dedupe collapses repeated
 * `(source, target, type)` triples (so edges ≤ sites), and the template tag filter drops builtins —
 * so the two numbers are printed side by side and the reader can see the difference rather than
 * assume a gap. A gap is only claimed when BOTH legs are zero.
 *
 * ## WHAT IT IS NOT
 *
 * Not a differential (no oracle), not a resolution measurement (the Lead instruments own that),
 * and not a ruling. It produces the COUNT and the NODE EVIDENCE a ruling or an implementation
 * decision needs.
 *
 * ## USAGE
 *
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/svelte-extended-census.ts \
 *     --out validation/m14/measurements/svelte-extended-census.json
 *
 *   # bounded instrument validation (declared; NOT a measurement):
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/svelte-extended-census.ts --sample=120
 *   # single-file check of a known construct (the decorator fixture's corpus twin, say):
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/svelte-extended-census.ts --filter=decorator
 *
 * Exit: 0 ok · 5 control failure (population 0, or every file failed to parse).
 */
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const argv = process.argv.slice(2)
const argOf = (flag: string): string | undefined => {
  const i = argv.indexOf(flag)
  if (i >= 0) return argv[i + 1] ?? ""
  for (const a of argv) if (a.startsWith(flag + "=")) return a.slice(flag.length + 1)
  return undefined
}

const CORPUS = argOf("--corpus-root") ?? process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const OUT = argOf("--out") ?? ""
const SAMPLE = Number(argOf("--sample") ?? 0)
const FILTER = argOf("--filter") ?? ""
const JSON_MODE = argv.includes("--json")
const SIZE_CAP = 1024 * 1024
const EXT = ".svelte"
const EXTENDED = ["decorates", "renders", "mixes_in", "part_of", "overrides"] as const

const t0 = Date.now()
const log = (m: string): void => console.log(m)

// ───────────────────────────────────────────────────────────────── population
type Admitted = { rel: string; abs: string; repo: string }

const topEntries = readdirSync(CORPUS, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
let symlinkedDirEntries = 0
let realDirEntries = 0
let otherEntries = 0
let duplicateRealpaths = 0
const distinctRealpaths = new Set<string>()
const repoDirs: Array<{ name: string; dir: string }> = []

for (const e of topEntries) {
  const p = path.join(CORPUS, e.name)
  let isDir = false
  try {
    const ls = lstatSync(p)
    if (ls.isSymbolicLink()) {
      isDir = statSync(p).isDirectory()
      if (isDir) symlinkedDirEntries++
    } else if (ls.isDirectory()) {
      isDir = true
      realDirEntries++
    }
  } catch {
    otherEntries++
    continue
  }
  if (!isDir) {
    otherEntries++
    continue
  }
  let rp = p
  try {
    rp = realpathSync(p)
  } catch {
    /* unreadable link: still an entry, no real path */
  }
  if (distinctRealpaths.has(rp)) {
    duplicateRealpaths++
    continue // deduplicated: one checkout, one population
  }
  distinctRealpaths.add(rp)
  repoDirs.push({ name: e.name, dir: p })
}

const gitTracked = (repoDir: string): string[] => {
  const BunAny: any = (globalThis as any).Bun
  if (!BunAny?.spawnSync) return []
  try {
    const r = BunAny.spawnSync(["git", "-C", repoDir, "ls-files", "-z", "--", "*" + EXT], { stdout: "pipe", stderr: "pipe" })
    if (r.exitCode !== 0 || !r.stdout) return []
    const text = new TextDecoder().decode(r.stdout)
    return text.split("\0").filter((x: string) => x.length > 0)
  } catch {
    return []
  }
}

const admitted: Admitted[] = []
let trackedTotal = 0
let overCap = 0
let overCapLargest = 0
let trackedButAbsent = 0
let symlinkFileEntries = 0
let reposWithAdmitted = 0

for (const repo of repoDirs) {
  let countForRepo = 0
  for (const rel of gitTracked(repo.dir)) {
    trackedTotal++
    const abs = path.join(repo.dir, rel)
    let size: number
    try {
      const ls = lstatSync(abs)
      size = statSync(abs).size // follows a final-component symlink; the tracked ENTRY is what is admitted
      if (ls.isSymbolicLink()) symlinkFileEntries++
    } catch {
      trackedButAbsent++
      continue
    }
    if (size > SIZE_CAP) {
      overCap++
      if (size > overCapLargest) overCapLargest = size
      continue
    }
    admitted.push({ rel: repo.name + "/" + rel, abs, repo: repo.name })
    countForRepo++
  }
  if (countForRepo > 0) reposWithAdmitted++
}
admitted.sort((a, b) => a.rel.localeCompare(b.rel))

const bounded = SAMPLE > 0 || FILTER.length > 0
let files = admitted
if (FILTER) files = files.filter((f) => f.rel.includes(FILTER))
if (SAMPLE > 0) files = files.slice(0, SAMPLE)

if (admitted.length === 0) {
  log(`CONTROL FAILURE — population 0 admitted from ${CORPUS}. The rule is git-tracked *${EXT} under 1 MiB;`)
  log(`a zero over nothing is not a measurement. Check the corpus root and the repository entries.`)
  process.exit(5)
}

log(`svelte extended-types census — ${CORPUS}`)
log(`population rule: git-tracked *${EXT} per repository entry at the corpus root, then the 1 MiB per-file cap`)
log(
  `population: ${admitted.length} admitted · tracked ${trackedTotal} · repos-with-admitted ${reposWithAdmitted} · ` +
    `over-1MiB ${overCap}${overCap ? ` (largest ${overCapLargest} B)` : ""} · tracked-but-absent ${trackedButAbsent} · ` +
    `symlink-file-entries ${symlinkFileEntries}`,
)
log(
  `corpus root: entries ${topEntries.length} = symlinked-dir entries ${symlinkedDirEntries} + real dirs ${realDirEntries} + other ${otherEntries} · ` +
    `distinct real paths ${distinctRealpaths.size} · duplicate entries deduplicated ${duplicateRealpaths}`,
)
if (bounded) {
  log(
    `*** BOUNDED VALIDATION MODE — sample=${SAMPLE || "all"} filter=${FILTER || "none"} · ${files.length} of ${admitted.length} admitted files. ` +
      `THIS IS NOT A MEASUREMENT: a bounded run can only validate the instrument. ***`,
  )
}

// ─────────────────────────────────────────────────────── AST helper vocabulary
function namedChildren(n: any): any[] {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}
function fieldOf(n: any, name: string): any {
  try {
    return n?.childForFieldName ? n.childForFieldName(name) : null
  } catch {
    return null
  }
}
function findChildByType(n: any, type: string): any {
  for (const c of namedChildren(n)) if (c.type === type) return c
  return null
}
/** The attribute's value, through `quoted_attribute_value` (construct probe WRONG 2). */
function attributeValue(a: any): string {
  const direct = findChildByType(a, "attribute_value")
  if (direct) return direct.text
  const quoted = findChildByType(a, "quoted_attribute_value")
  if (!quoted) return ""
  const inner = findChildByType(quoted, "attribute_value")
  return inner ? inner.text : ""
}
function attributeName(a: any): string {
  const nm = findChildByType(a, "attribute_name")
  return nm ? nm.text : ""
}
function* walk(n: any): Generator<any> {
  const stack: any[] = [n]
  while (stack.length > 0) {
    const m = stack.pop()!
    yield m
    for (let i = m.namedChildCount - 1; i >= 0; i--) {
      const c = m.namedChild(i)
      if (c) stack.push(c)
    }
  }
}
/** REAL NODE vs RECOVERY TEXT: does the subtree contain ERROR or a MISSING node? */
function subtreeHasError(node: any): boolean {
  for (const n of walk(node)) {
    if (n.type === "ERROR") return true
    if (n.isMissing) return true
  }
  return false
}
type ScriptBlock = { body: string; lang: "js" | "ts" | "tsx" }
function scriptBlocksOf(tree: any, content: string): ScriptBlock[] {
  const out: ScriptBlock[] = []
  for (const n of walk(tree.rootNode)) {
    if (n.type !== "script_element") continue
    let lang: ScriptBlock["lang"] = "js"
    const st = findChildByType(n, "start_tag")
    if (st) {
      for (const a of namedChildren(st)) {
        if (a.type !== "attribute") continue
        if (attributeName(a) === "lang") {
          const v = attributeValue(a)
          if (v === "ts" || v === "tsx") lang = v
        }
      }
    }
    let raw: any = null
    for (const c of namedChildren(n)) if (c.type === "raw_text") raw = c
    if (!raw) continue
    const body = content.substring(raw.startIndex, raw.endIndex)
    if (body.trim().length > 0) out.push({ body, lang })
  }
  return out
}

// ─────────────────────────────────────────────────────────── THE CONTROL ARMS
// The construct probe's own calibration lesson applies here: A PROBE THAT RETURNS 0 FOR EVERYTHING
// IS INDISTINGUISHABLE FROM A WORKING ONE. So before any corpus zero is read as a fact, the
// instrument demonstrates, on inline sources it controls, that it can SEE each construct it counts.
// A failing arm is a control failure (exit 6), never a clean run.
type Arm = { name: string; ok: boolean; detail: string }
const selfTest = async (): Promise<Arm[]> => {
  const arms: Arm[] = []

  // 1 · the svelte grammar produces a capitalised template tag (the `renders` construct)
  {
    const t: any = pSvelte.parse("<script></script>\n<Button/>", "control.svelte")
    let tags = 0
    for (const n of walk(t.rootNode)) {
      if (n.type !== "start_tag" && n.type !== "self_closing_tag") continue
      const tn = findChildByType(n, "tag_name")
      if (tn && /^[A-Z]/.test(String(tn.text))) tags++
    }
    t.delete?.()
    arms.push({ name: "svelte-template-tag", ok: tags >= 1, detail: `capitalised start/self-closing tags: ${tags} (expect >=1)` })
  }

  // 2 · the TS grammar produces a decorator node (the `decorates` construct; the delegate emits it)
  {
    const src = "@sealed\nclass Service {\n  @inject('db')\n  pool = 1\n}\n"
    const t: any = pTs.parse(src, "control.ts")
    let decs = 0
    for (const n of walk(t.rootNode)) if (n.type === "decorator") decs++
    t.delete?.()
    arms.push({ name: "ts-decorator", ok: decs >= 1, detail: `decorator nodes: ${decs} (expect >=1)` })
  }

  // 3 · the TS grammar produces CALL-SHAPED heritage (the `mixes_in` construct)
  {
    const src = "class D extends mix(Base) {}\n"
    const t: any = pTs.parse(src, "control.ts")
    let callHeritage = 0
    for (const n of walk(t.rootNode)) {
      if (n.type !== "class_declaration" && n.type !== "class") continue
      const h = findChildByType(n, "class_heritage")
      const e = h ? findChildByType(h, "extends_clause") : null
      const first = e ? namedChildren(e)[0] : null
      if (first && first.type === "call_expression") callHeritage++
    }
    t.delete?.()
    arms.push({ name: "ts-mixin-heritage", ok: callHeritage >= 1, detail: `call-shaped extends clauses: ${callHeritage} (expect >=1)` })
  }

  // 4 · the SERVED TS grammar's shape for a triple-slash directive (the `part_of` construct).
  //     TWO SHAPES ARE POSSIBLE AND THE INSTRUMENT MUST SEE THE ONE THE SERVED BYTES PRODUCE:
  //       patched build (wired 2026-10-23, commit 09b0a45df) -> a `reference_directive` NODE that
  //         carries `role`/`target` fields — the analyzer reads STRUCTURE, never comment text;
  //       unpatched build -> a `comment` node whose text begins `/// <reference`.
  //     A probe that assumed one shape and reported zero would be the field-name defect: the
  //     relation is present, and the instrument looked in the place the other build puts it.
  {
    const src = '/// <reference path="x.d.ts" />\nconst a = 1\n'
    const t: any = pTs.parse(src, "control.ts")
    let directives = 0
    let commentRefs = 0
    for (const n of walk(t.rootNode)) {
      if (n.type === "reference_directive") directives++
      else if (n.type === "comment" && /^\/\/\/\s*<reference\b/.test(String(n.text ?? ""))) commentRefs++
    }
    t.delete?.()
    const shape =
      directives > 0 ? "reference_directive (PATCHED served build)" : commentRefs > 0 ? "comment (UNPATCHED served build)" : "NONE"
    arms.push({
      name: "ts-triple-slash",
      ok: directives + commentRefs >= 1,
      detail: `shape ${shape} · directives ${directives} · comment-refs ${commentRefs} (expect total >=1)`,
    })
  }

  // 5 · the javascript grammar produces a JSX element (the delegate's `renders` construct)
  {
    const t: any = pJs.parse("const el = <Button/>", "control.js")
    let jsx = 0
    for (const n of walk(t.rootNode)) if (n.type === "jsx_element" || n.type === "jsx_self_closing_element") jsx++
    t.delete?.()
    arms.push({ name: "js-jsx-element", ok: jsx >= 1, detail: `jsx elements: ${jsx} (expect >=1)` })
  }

  return arms
}

// ───────────────────────────────────────────────────────────────────── counters
const C = {
  filesRead: 0,
  filesEmpty: 0,
  svelteParseFail: 0,
  productionParseFail: 0,
  productionDegraded: 0,
  productionWrongLanguage: 0,
  relationships: 0,
  scriptBlocks: 0,
  tsScriptBlocks: 0,
  subParseFail: 0,
  // SFC template leg (the `renders` construct in this language)
  componentTags: 0,
  reservedNamespaceTags: 0,
  intrinsicTags: 0,
  componentTagSamples: [] as string[],
  // script leg — constructs
  decorators: 0,
  decoratorsOnClass: 0,
  decoratorsOnMember: 0,
  decoratorsInError: 0,
  decoratorSamples: [] as string[],
  classesTotal: 0,
  classesWithCallHeritage: 0,
  classesWithCallHeritageInError: 0,
  mixinHeritageSamples: [] as string[],
  referenceDirectiveNodes: 0,
  referenceDirectiveInError: 0,
  referenceDirectiveSamples: [] as string[],
  tripleSlashCommentNodes: 0,
  tripleSlashCommentInTs: 0,
  tripleSlashCommentSamples: [] as string[],
  jsxElements: 0,
  jsxSamples: [] as string[],
  commentsTotal: 0,
}

type ProvRow = { sfc: number; delegate: number }
const typeCounts = new Map<string, number>()
const typeProvenance = new Map<string, ProvRow>()
const extendedSamples = new Map<string, string[]>()
const instantiatesSplit = { template: 0, delegate: 0 }

const engine: any = await import(path.join(ROOT, "src/ast/engine.ts"))
const parsers: Record<string, any> = {}
const parserFor = async (lang: string): Promise<any> => {
  if (!parsers[lang]) parsers[lang] = await engine.getParser(lang)
  return parsers[lang]
}
const pSvelte = await parserFor("svelte")
const pJs = await parserFor("javascript")
const pTs = await parserFor("typescript")

/** A grammar citation is the sha256 of the bytes the registry serves, never a path (fleet rule). */
const sha256File = (p: string): string => {
  try {
    return createHash("sha256").update(readFileSync(p)).digest("hex")
  } catch {
    return ""
  }
}
const grammarIdentity = {
  svelte: sha256File(path.join(ROOT, "wasm/tree-sitter-svelte.wasm")),
  javascript: sha256File(path.join(ROOT, "wasm/tree-sitter-javascript.wasm")),
  typescript: sha256File(path.join(ROOT, "wasm/tree-sitter-typescript.wasm")),
}

// THE CONTROL RUNS BEFORE ANY CORPUS NUMBER IS READ (see the arms' rationale above).
log(
  `grammars served from the repo wasm (the registry serves it FIRST — L-11): ` +
    `svelte ${grammarIdentity.svelte.slice(0, 12) || "?"} · javascript ${grammarIdentity.javascript.slice(0, 12) || "?"} · typescript ${grammarIdentity.typescript.slice(0, 12) || "?"}`,
)
const controlArms = await selfTest()
log("CONTROL — the instrument must be shown able to SEE each construct before a corpus zero is a fact:")
for (const a of controlArms) log(`  ${a.ok ? "PASS" : "FAIL"} ${a.name.padEnd(24)} ${a.detail}`)
if (controlArms.some((a) => !a.ok)) {
  log(`CONTROL FAILURE — ${controlArms.filter((a) => !a.ok).length} arm(s) failed. A zero over the corpus would be`)
  log(`indistinguishable from an instrument that cannot see the construct. Fix the instrument; do not read the zero.`)
  process.exit(6)
}
log("")

const pushSample = (list: string[], s: string): void => {
  if (list.length < 8) list.push(s)
}

let consecutiveProductionFails = 0
for (const f of files) {
  let content: string
  try {
    content = readFileSync(f.abs, "utf8")
  } catch {
    continue
  }
  if (content.length === 0) {
    C.filesEmpty++
    continue
  }
  C.filesRead++

  // ── LEG 1: the production path (the emission the lane actually publishes)
  try {
    const res: any = await parseFile(f.abs, path.dirname(f.abs))
    if (!res || res.success === false) {
      C.productionParseFail++
      consecutiveProductionFails++
    } else {
      consecutiveProductionFails = 0
    }
    if (res?.fallback) C.productionDegraded++
    if (res?.language && res.language !== "svelte") C.productionWrongLanguage++
    for (const r of res?.relationships ?? []) {
      const t = String(r.type ?? "")
      if (!t) continue
      C.relationships++
      typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1)
      const prov = typeProvenance.get(t) ?? { sfc: 0, delegate: 0 }
      const isDelegate = r?.metadata?.sfcDelegated === true
      if (isDelegate) prov.delegate++
      else prov.sfc++
      typeProvenance.set(t, prov)
      if (t === "instantiates") {
        if (isDelegate) instantiatesSplit.delegate++
        else instantiatesSplit.template++
      }
      if ((EXTENDED as readonly string[]).includes(t)) {
        const arr = extendedSamples.get(t) ?? []
        pushSample(
          arr,
          `${f.rel}:${r.line_number ?? "?"} ${r.source ?? "?"} -> ${r.target ?? "?"} ` +
            `[${isDelegate ? "delegate" : "sfc"}] conf=${r.confidence ?? "?"} cls=${r.evidenceClass ?? "?"}`,
        )
        extendedSamples.set(t, arr)
      }
    }
  } catch {
    C.productionParseFail++
    consecutiveProductionFails++
  }

  // A WASM TRAP BRICKS THE PARSER (measured on this box 2026-10-23 under memory pressure): after the
  // trap every later file fails, and a run that keeps going PRINTS A FRACTION AS THE POPULATION —
  // the fleet's "a partial number is a wrong number". Stop and say so rather than publish.
  if (consecutiveProductionFails >= 25) {
    log(`CONTROL FAILURE — ${consecutiveProductionFails} CONSECUTIVE production parse failures, last at ${f.rel}.`)
    log(`A wasm trap bricks the parser: the remainder of the run would measure a fraction of the population.`)
    log(`Re-run with the arm token held (the fleet's measured cause is memory pressure), not here.`)
    process.exit(5)
  }

  // ── LEG 2: the AST — constructs the production emission must be read against
  let tree: any
  try {
    tree = pSvelte.parse(content, f.abs)
  } catch {
    C.svelteParseFail++
    continue
  }
  for (const n of walk(tree.rootNode)) {
    if (n.type === "start_tag" || n.type === "self_closing_tag") {
      const tn = findChildByType(n, "tag_name")
      const name = tn ? String(tn.text) : ""
      if (!name) continue
      if (/^svelte:/.test(name)) {
        C.reservedNamespaceTags++
      } else if (/^[A-Z]/.test(name)) {
        C.componentTags++
        pushSample(C.componentTagSamples, `${f.rel}:${n.startPosition?.row ?? "?"} <${name}>`)
      } else {
        C.intrinsicTags++
      }
    }
  }
  const blocks = scriptBlocksOf(tree, content)
  C.scriptBlocks += blocks.length
  for (const b of blocks) {
    if (b.lang !== "js") C.tsScriptBlocks++
    let sub: any
    try {
      sub = (b.lang === "js" ? pJs : pTs).parse(b.body)
    } catch {
      C.subParseFail++
      continue
    }
    for (const n of walk(sub.rootNode)) {
      if (n.type === "reference_directive") {
        // THE PATCHED SERVED BUILD'S SHAPE (wired 2026-10-23): role/target are FIELDS, so the
        // relation is read from structure. Counted either way — the census measures the construct.
        C.referenceDirectiveNodes++
        const inError = subtreeHasError(n)
        if (inError) C.referenceDirectiveInError++
        let role = ""
        let target = ""
        try {
          role = String(n.childForFieldName?.("role")?.text ?? "")
          target = String(n.childForFieldName?.("target")?.text ?? "")
        } catch {
          /* a different build without fields: the NODE is still counted */
        }
        pushSample(
          C.referenceDirectiveSamples,
          `${f.rel}:${n.startPosition?.row ?? "?"} role=${role || "?"} target=${target || "?"} realNode=${!inError} [${b.lang}]`,
        )
      }
      if (n.type === "comment") {
        C.commentsTotal++
        const text = String(n.text ?? "")
        if (/^\/\/\/\s*<reference\b/.test(text)) {
          // THE UNPATCHED BUILD'S SHAPE for the same construct — never added to the field-shaped
          // count; both are printed with the shape that produced them.
          C.tripleSlashCommentNodes++
          if (b.lang !== "js") C.tripleSlashCommentInTs++
          pushSample(C.tripleSlashCommentSamples, `${f.rel}:${n.startPosition?.row ?? "?"} ${text.slice(0, 70)} [${b.lang}]`)
        }
      }
      if (n.type === "jsx_element" || n.type === "jsx_self_closing_element") {
        C.jsxElements++
        pushSample(C.jsxSamples, `${f.rel}:${n.startPosition?.row ?? "?"} [${b.lang}]`)
      }
      if (n.type === "decorator") {
        C.decorators++
        const inError = subtreeHasError(n)
        if (inError) C.decoratorsInError++
        // lineage: what is the decorator attached to?
        let p = n.parent
        let attached = ""
        for (let i = 0; p && i < 4; i++) {
          if (
            p.type === "class_declaration" ||
            p.type === "abstract_class_declaration" ||
            p.type === "class"
          ) {
            attached = "class"
            break
          }
          if (
            p.type === "public_field_definition" ||
            p.type === "property_signature" ||
            p.type === "method_definition" ||
            p.type === "abstract_method_signature"
          ) {
            attached = "member"
            break
          }
          p = p.parent
        }
        if (attached === "class") C.decoratorsOnClass++
        else if (attached === "member") C.decoratorsOnMember++
        pushSample(
          C.decoratorSamples,
          `${f.rel}:${n.startPosition?.row ?? "?"} ${String(n.text ?? "").slice(0, 40)} attached=${attached || "?"} realNode=${!inError} [${b.lang}]`,
        )
      }
      if (
        n.type === "class_declaration" ||
        n.type === "abstract_class_declaration" ||
        n.type === "class" ||
        n.type === "class_expression"
      ) {
        C.classesTotal++
        const heritage = findChildByType(n, "class_heritage")
        const ext = heritage ? findChildByType(heritage, "extends_clause") : null
        if (ext) {
          const kids = namedChildren(ext)
          const first = kids[0]
          if (first && first.type === "call_expression") {
            C.classesWithCallHeritage++
            const inError = subtreeHasError(first)
            if (inError) C.classesWithCallHeritageInError++
            pushSample(
              C.mixinHeritageSamples,
              `${f.rel}:${n.startPosition?.row ?? "?"} extends ${String(first.text ?? "").slice(0, 60)} realNode=${!inError} [${b.lang}]`,
            )
          }
        }
      }
    }
    try {
      sub.delete?.()
    } catch {
      /* tree lifetime is best-effort; parseFile owns the production trees */
    }
  }
  try {
    tree.delete?.()
  } catch {
    /* ditto */
  }
}

// THE CEILING: more than 1% production parse failures (and never fewer than 25) is not a lane defect
// to report — it is a run that must not publish. The 2026-10-16 whole-population run read 0 of 6,147.
const failureCeiling = Math.max(25, Math.floor(C.filesRead * 0.01))
if (C.filesRead === 0 || C.productionParseFail > failureCeiling) {
  log(`CONTROL FAILURE — ${C.filesRead} files read, ${C.productionParseFail} production parses failed (ceiling ${failureCeiling}).`)
  log(`A run with a broken parser measures a fraction and prints it as the population; nothing here is publishable.`)
  process.exit(5)
}

// ──────────────────────────────────────────────────────────────────── summary
const fmt = (n: number): string => n.toLocaleString("en-US")
log("")
log(`files measured ${fmt(C.filesRead)} · production parse failures ${C.productionParseFail} · degraded ${C.productionDegraded} · wrong-language ${C.productionWrongLanguage}`)
log(`SFC parse failures ${C.svelteParseFail} · script blocks ${fmt(C.scriptBlocks)} (ts/tsx ${fmt(C.tsScriptBlocks)}) · sub-parse failures ${C.subParseFail}`)
log(`relationships ${fmt(C.relationships)}`)
log("")
log("EMISSION LEG — per relationship type, with the SEAM PROVENANCE (`delegate` = copied from the JS/TS sub-analyzer):")
for (const [t, n] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
  const p = typeProvenance.get(t)!
  const mark = (EXTENDED as readonly string[]).includes(t) ? " ← extended" : ""
  log(`  ${t.padEnd(14)} ${fmt(n).padStart(8)}   sfc ${fmt(p.sfc).padStart(8)}   delegate ${fmt(p.delegate).padStart(8)}${mark}`)
}
for (const t of EXTENDED) {
  if (!typeCounts.has(t)) log(`  ${t.padEnd(14)} ${"0".padStart(8)}   (no edge produced)${" "} ← extended`)
}
log("")
log(`instantiates split: template(tag) ${fmt(instantiatesSplit.template)} · delegate(script \`new\`) ${fmt(instantiatesSplit.delegate)}`)
log("")
log("CONSTRUCT LEG — sites and the node evidence (REAL NODE = no ERROR/MISSING in the construct's subtree):")
log(`  decorator nodes ................ ${fmt(C.decorators)}  (on class ${fmt(C.decoratorsOnClass)} · on member ${fmt(C.decoratorsOnMember)} · in error subtree ${C.decoratorsInError})`)
log(`  class with CALL-shaped heritage  ${fmt(C.classesWithCallHeritage)}  (in error subtree ${C.classesWithCallHeritageInError})  ← the mixes_in construct`)
log(`  triple-slash DIRECTIVE nodes ... ${fmt(C.referenceDirectiveNodes)}  (role/target FIELDS; in error subtree ${C.referenceDirectiveInError})  ← the part_of construct, PATCHED served build`)
log(`  triple-slash as COMMENT ....... ${fmt(C.tripleSlashCommentNodes)}  (in ts/tsx block ${fmt(C.tripleSlashCommentInTs)})  ← SAME construct on an UNPATCHED build; the two shapes are never added`)
log(`  JSX elements in script ......... ${fmt(C.jsxElements)}  ← the delegate's renders construct (SFC tag is leg 1)`)
log(`  component tags (capitalised) ... ${fmt(C.componentTags)}  · svelte:* reserved ${fmt(C.reservedNamespaceTags)} · intrinsic ${fmt(C.intrinsicTags)}  ← the renders construct`)
log("")
log("CROSS-CHECK — emission vs construct (edges ≤ sites by construction: the downstream dedupe collapses repeated (source,target,type)):")
const xcheck = (label: string, edges: number, sites: number): void => {
  const zeroNote =
    sites === 0 && edges === 0
      ? bounded
        ? "zero in this bounded sample — no claim"
        : "BOTH ZERO — a gap needs the ruling, not an implementation guess"
      : ""
  log(`  ${label.padEnd(26)} edges ${fmt(edges).padStart(8)} · sites ${fmt(sites).padStart(8)}  ${zeroNote}`)
}
xcheck("decorates", typeCounts.get("decorates") ?? 0, C.decorators)
xcheck("mixes_in", typeCounts.get("mixes_in") ?? 0, C.classesWithCallHeritage)
xcheck("part_of", typeCounts.get("part_of") ?? 0, C.referenceDirectiveNodes + C.tripleSlashCommentNodes)
xcheck("renders (delegate JSX)", typeCounts.get("renders") ?? 0, C.jsxElements)
xcheck("renders (SFC tag)", 0, C.componentTags) // the SFC tag currently publishes as instantiates, by design of the old contract
log("")
const sampleBlock = (name: string, list: string[]): void => {
  if (!list.length) return
  log(`  ${name} samples:`)
  for (const s of list) log(`    · ${s}`)
}
for (const t of EXTENDED) sampleBlock(t, extendedSamples.get(t) ?? [])
sampleBlock("decorator", C.decoratorSamples)
sampleBlock("mixin-heritage", C.mixinHeritageSamples)
sampleBlock("triple-slash (directive node, patched build)", C.referenceDirectiveSamples)
sampleBlock("triple-slash (comment, unpatched build)", C.tripleSlashCommentSamples)
sampleBlock("jsx", C.jsxSamples)
sampleBlock("component-tag", C.componentTagSamples)
log("")
log(`elapsed ${Math.round((Date.now() - t0) / 1000)}s${bounded ? " (BOUNDED VALIDATION — not a measurement)" : ""}`)

const report = {
  instrument: "script/m14/svelte-extended-census.ts",
  generatedAt: new Date().toISOString(),
  bounded: bounded ? { sample: SAMPLE || null, filter: FILTER || null, filesMeasured: files.length, admitted: admitted.length } : null,
  controlArms,
  grammars: {
    rule: "sha256 of the repo wasm files, which the registry serves FIRST (L-11: a grammar citation is the bytes, never a path and never a log line)",
    svelte: grammarIdentity.svelte,
    javascript: grammarIdentity.javascript,
    typescript: grammarIdentity.typescript,
  },
  population: {
    rule: `git-tracked *${EXT} per repository entry at the corpus root, then the 1 MiB per-file cap`,
    corpusRoot: CORPUS,
    topEntries: topEntries.length,
    symlinkedDirEntries,
    realDirEntries,
    otherEntries,
    distinctRealPaths: distinctRealpaths.size,
    duplicateEntriesDeduplicated: duplicateRealpaths,
    reposWithAdmitted,
    trackedTotal,
    admitted: admitted.length,
    over1MiB: overCap,
    over1MiBLargestBytes: overCapLargest || null,
    trackedButAbsent,
    symlinkFileEntries,
  },
  emission: {
    filesMeasured: C.filesRead,
    productionParseFailures: C.productionParseFail,
    degraded: C.productionDegraded,
    wrongLanguage: C.productionWrongLanguage,
    relationships: C.relationships,
    typeCounts: Object.fromEntries([...typeCounts.entries()].sort((a, b) => b[1] - a[1])),
    provenanceByType: Object.fromEntries([...typeProvenance.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    instantiatesSplit,
    extendedSamples: Object.fromEntries(extendedSamples),
  },
  construct: {
    sfcParseFailures: C.svelteParseFail,
    scriptBlocks: C.scriptBlocks,
    tsScriptBlocks: C.tsScriptBlocks,
    subParseFailures: C.subParseFail,
    decorators: { total: C.decorators, onClass: C.decoratorsOnClass, onMember: C.decoratorsOnMember, inErrorSubtree: C.decoratorsInError, samples: C.decoratorSamples },
    mixesIn: { callShapedHeritageClasses: C.classesWithCallHeritage, inErrorSubtree: C.classesWithCallHeritageInError, samples: C.mixinHeritageSamples },
    partOf: {
      referenceDirectiveNodes: C.referenceDirectiveNodes,
      inErrorSubtree: C.referenceDirectiveInError,
      tripleSlashCommentNodes: C.tripleSlashCommentNodes,
      inTsBlock: C.tripleSlashCommentInTs,
      samples: C.referenceDirectiveSamples,
      commentSamples: C.tripleSlashCommentSamples,
    },
    jsx: { elements: C.jsxElements, samples: C.jsxSamples },
    template: { componentTags: C.componentTags, reservedNamespaceTags: C.reservedNamespaceTags, intrinsicTags: C.intrinsicTags, samples: C.componentTagSamples },
    classesTotal: C.classesTotal,
    commentsTotal: C.commentsTotal,
  },
}

if (OUT) {
  const abs = path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT)
  writeFileSync(abs, JSON.stringify(report, null, 2) + "\n")
  log(`wrote ${path.relative(ROOT, abs)}`)
}
if (JSON_MODE) console.log(JSON.stringify(report, null, 2))
