#!/usr/bin/env npx tsx
/**
 * CENSUS — CONSTRUCT SITES over the WHOLE admitted MATLAB population, plus the analyzer's own
 * EMISSIONS per relationship type.
 *
 * A ruling is earned by a measurement, not by prose: the fleet's rule is that every type outside
 * `implemented` carries a COUNT and a cited artifact. Before any rung of the ladder is walked, the
 * population of candidate constructs must be counted — and because this lane's population is three
 * files, every count below is a WHOLE-POPULATION count, not a sample.
 *
 * THE POPULATION IS THE GATE'S, EXACTLY. `script/m14/incoming-gate.ts` admits a tracked path when
 * its spelling is one of the ROUTER TABLE's extensions for the lane (`.m`) AND — for `.m`, which
 * MATLAB shares with Objective-C — the router's own content test agrees (`language-detection.ts:405`:
 * the first 64 KB containing `function `/`classdef ` is MATLAB, anything else is Objective-C), at the
 * 1 MiB engine cap. An extension-only walk is a DIFFERENT population: measured before the content
 * test landed, matlab "admitted" 259 `.m` files and the sampled one parsed with the Objective-C
 * grammar. So this file copies the gate's predicate rather than inventing one, and prints the
 * admitted list's bounds and file set.
 *
 * WHAT IS COUNTED:
 *   emissions   what the ANALYZER actually publishes per type over the whole population (production
 *               parseFile), so `implemented` can say "emitted" with a number instead of a claim.
 *   constructs  the candidate site counts for the ten canonical types and the four extended ones,
 *               with the NEAR MISSES counted separately so a ruling compares like with like:
 *                 imports      `import` COMMAND statements (a command, not a call node), by spelling
 *                 references   `@handle` sites, `?ClassName` sites, `superclass` call qualifiers,
 *                              `indirect_access` sites — references that are not calls
 *                 exports      the file<->function identity: declarations whose name equals the file
 *                              basename, and local functions that do not
 *                 implements   `classdef X < Y & Z`: superclass-list shape (single vs multiple), and
 *                              the base-class spellings (`handle`, `matlab.mixin.*`, user classes)
 *                 overrides    methods declared under a classdef that HAS superclasses (candidate
 *                              sites for shadowing a base method)
 *                 instantiates calls whose callee name is a class declared in the population
 *                 decorates    `attributes`/`attribute` sites and their spellings (SetAccess etc.) —
 *                              PASSIVE METADATA, counted so the ontological ruling has a number
 *                 renders      UI component constructor calls (`uifigure`, `uicontrol`, ...) and
 *                              `.mlapp` files on the corpus tree (a `.mlapp` is a ZIP, never admitted)
 *                 mixes_in     no mixin/trait construct; the `&` superclass-list sites are the
 *                              nearest thing and are counted under implements, not here
 *                 part_of      `+pkg/` folder-namespace membership of the admitted files, and
 *                              `@Class/` class-method folders, and the package count
 *
 * Method: the engine's own `parseTree`/`parseFile` and a named-node walk. No regex literal appears
 * in this instrument (the fleet's no-regex rule), and no name is matched by substring.
 *
 * Run: npx tsx validation/m14/fixtures/matlab/census-constructs.ts
 * Artifact: validation/m14/fixtures/matlab/measurements/matlab-constructs.txt
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { ASTEngine } from "../../../../src/ast/engine"
import { extensionsFor } from "../../../../script/m14/language-extensions"

const T0 = Date.now()
const loadAtStart = os.loadavg()
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ARTIFACT = path.resolve(HERE, "measurements", "matlab-constructs.txt")

// --- THE GATE'S ADMISSION RULE, copied from script/m14/incoming-gate.ts (content-aware `.m`) ----
const LANE = "matlab"
const EXTS = extensionsFor(LANE).map((e) => e.replace(/^\./, "")) // ["m"]
const SIZE_CAP = 1024 * 1024
const HEAD_BYTES = 65536

function readHeadText(absPath: string, bytes: number): string | null {
  try {
    const fd = openSync(absPath, "r")
    try {
      const buf = Buffer.alloc(bytes)
      const n = readSync(fd, buf, 0, bytes, 0)
      return buf.subarray(0, n).toString("utf8")
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }
}

function admit(rel: string, exts: string[], lang: string, absPath: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (!exts.some((e) => low.endsWith(`.${e}`))) return exts.some((e) => base === e) && detectLanguageFromPath(rel) === lang
  if (low.endsWith(".m") && (lang === "matlab" || lang === "objective-c")) {
    const head = readHeadText(absPath, HEAD_BYTES)
    if (head === null) return false
    return detectLanguageFromPath(rel, head) === lang
  }
  return true
}

interface Admitted { repo: string; rel: string; abs: string }
const admitted: Admitted[] = []
let excludedOverCap = 0
let excludedAbsent = 0
let excludedOtherLanguage = 0
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const low = rel.toLowerCase()
    const extensionMatches = EXTS.some((x) => low.endsWith(`.${x}`))
    const baseMatches = EXTS.some((x) => low.slice(low.lastIndexOf("/") + 1) === x)
    if (!extensionMatches && !baseMatches) continue
    const abs = path.join(dir, rel)
    let size: number
    try { size = statSync(abs).size } catch { excludedAbsent++; continue }
    if (size > SIZE_CAP) { excludedOverCap++; continue }
    if (!admit(rel, EXTS, LANE, abs)) { excludedOtherLanguage++; continue }
    admitted.push({ repo: e, rel, abs })
  }
}
const corpusDigest = createHash("sha256").update(admitted.map((c) => c.abs).sort().join("\n")).digest("hex")

// --- counters --------------------------------------------------------------------------------
interface Counter { sites: number; files: Set<string> }
const mk = (): Counter => ({ sites: 0, files: new Set() })
const bump = (c: Counter, key: string) => { c.sites++; c.files.add(key) }

const emitted = new Map<string, Counter>()
const emit = (type: string, key: string) => {
  let c = emitted.get(type)
  if (!c) { c = mk(); emitted.set(type, c) }
  bump(c, key)
}

const constructs = {
  // population shape
  classdef: mk(), functionFile: mk(), scriptFile: mk(), functionsInFunctionsFile: mk(),
  localFunctions: mk(), primaryFunctionMatchesBasename: mk(),
  methodsBlocks: mk(), propertiesBlocks: mk(), eventsBlocks: mk(), enumerationBlocks: mk(),
  propertyDecls: mk(), eventDecls: mk(), enumDecls: mk(), methods: mk(), methodsWithSuperclass: mk(),
  argumentsStatements: mk(),
  // imports: `import` is a COMMAND statement in this grammar
  command: mk(), importCommand: mk(), importCommandWildcard: mk(), importCommandDotted: mk(),
  commandNames: new Map<string, number>(),
  // references that are not calls
  handleOperator: mk(), referenceHandle: mk(), metaclassOperator: mk(), superclassQualifier: mk(),
  indirectAccess: mk(), fieldExpression: mk(),
  // exports: file <-> function identity
  packageDirFiles: mk(), atClassDirFiles: mk(), packageNames: new Set<string>(), atClassNames: new Set<string>(),
  // implements / mixes_in: the superclass-list shape
  classesWithSuperclasses: mk(), superclassEntries: mk(), classesSingleSuper: mk(), classesMultiSuper: mk(),
  superclassSpellings: new Map<string, number>(), mixinBaseSites: mk(), handleBaseSites: mk(),
  // overrides: candidate sites (methods under a classdef that has superclasses)
  methodsUnderSubclass: mk(),
  // instantiates: calls whose callee is a class declared in the population
  classDeclaredNames: new Set<string>(), callToClassSite: mk(),
  // decorates: PASSIVE METADATA attribute lists
  attributeLists: mk(), attributeSites: mk(), attributeSpellings: new Map<string, number>(),
  // renders: UI component constructors
  uiConstructorSites: mk(), uiConstructorNames: new Map<string, number>(),
  // scoping (caveat material, not a relationship type)
  globalOperator: mk(), persistentOperator: mk(),
  // calls: function_call nodes
  functionCall: mk(), commandCall: mk(),
}

const fileKeys: string[] = []

function bumpNamed(map: Map<string, number>, name: string): void {
  map.set(name, (map.get(name) ?? 0) + 1)
}

/** Children of a node with the grammar's own node type name. */
function childrenOfType(node: any, type: string): any[] {
  const out: any[] = []
  for (let i = 0; i < (node?.namedChildCount ?? 0); i++) {
    const ch = node.namedChild(i)
    if (ch && ch.type === type) out.push(ch)
  }
  return out
}

/** All named identifiers under a `superclasses`/`property_name` node, in source order. */
function identifiersUnder(node: any): any[] {
  const out: any[] = []
  const stack: any[] = [node]
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "identifier") { out.push(n); continue }
    for (let i = (n.namedChildCount ?? 0) - 1; i >= 0; i--) {
      const ch = n.namedChild(i)
      if (ch) stack.push(ch)
    }
  }
  return out
}

/** The dotted text of a `property_name` node — `matlab.mixin.Copyable` is ONE superclass. */
function dottedText(node: any): string {
  return identifiersUnder(node).map((n) => n.text).join(".")
}

/** First line of a file whose trimmed text is non-empty (what MATLAB's `function`/`classdef` test sees). */
function isClassdefFile(text: string): boolean {
  const lines = text.split("\n")
  for (const line of lines) {
    const t = line.trim()
    if (t === "" || t.startsWith("%")) continue
    return t.startsWith("classdef")
  }
  return false
}

const UI_CONSTRUCTORS: ReadonlySet<string> = new Set([
  "uifigure", "uicontrol", "uihtml", "uipanel", "uimenu", "uitabgroup", "uitab", "uigridlayout",
  "uilabel", "uibutton", "uieditfield", "uilistbox", "uidropdown", "uislider", "uispinner",
  "uitextarea", "uitree", "uitreenode", "uiimage", "uiprogressdlg", "uiconfirm", "uialert",
])

let parsed = 0, parseFailures = 0, treeFailures = 0
const failureNames: string[] = []
const TRAP_ATTEMPTS = 3

async function walkOne(f: Admitted) {
  const key = `${f.repo}/${f.rel}`
  fileKeys.push(key)
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { treeFailures++; failureNames.push(`${key} (unreadable)`); return }

  // --- the CONSTRUCT walk, on the engine's own tree -----------------------------------------
  let tree: any = null
  for (let attempt = 1; attempt <= TRAP_ATTEMPTS && !tree; attempt++) {
    try {
      const r = await ASTEngine.parseTree(f.abs, text)
      tree = r?.tree ?? null
    } catch { /* the engine's known intermittent wasm trap: retried, counted below */ }
  }
  if (!tree) { treeFailures++; failureNames.push(`${key} (no tree)`); return }

  if (isClassdefFile(text)) bump(constructs.classdef, key)
  else if (childrenOfType(tree.rootNode, "function_definition").length > 0) bump(constructs.functionFile, key)
  else bump(constructs.scriptFile, key)

  const baseName = f.rel.slice(f.rel.lastIndexOf("/") + 1).replace(/\.m$/i, "")

  // +pkg/ and @Class/ folder membership over the admitted file's own path (the part_of question)
  const segments = f.rel.split("/")
  for (const seg of segments.slice(0, -1)) {
    if (seg.startsWith("+")) { bump(constructs.packageDirFiles, key); constructs.packageNames.add(seg.slice(1)) }
    else if (seg.startsWith("@")) { bump(constructs.atClassDirFiles, key); constructs.atClassNames.add(seg.slice(1)) }
  }

  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    const t = n.type
    if (t === "function_call") {
      bump(constructs.functionCall, key)
      const target = n.childForFieldName?.("name")
      // the `f@SuperClass(...)` qualifier: a SUPERCLASS method call, counted as such
      for (const sc of childrenOfType(n, "superclass")) {
        bump(constructs.superclassQualifier, key)
        void sc
      }
      const name = target?.type === "identifier" ? target.text : ""
      if (name !== "") {
        if (UI_CONSTRUCTORS.has(name)) {
          bump(constructs.uiConstructorSites, key)
          bumpNamed(constructs.uiConstructorNames, name)
        }
        if (constructs.classDeclaredNames.has(name)) bump(constructs.callToClassSite, key)
      }
    } else if (t === "command") {
      bump(constructs.command, key)
      bump(constructs.commandCall, key)
      const nameNode = childrenOfType(n, "command_name")[0]
      const name = (nameNode?.text ?? "").trim()
      if (name !== "") {
        bumpNamed(constructs.commandNames, name)
        if (name === "import") {
          bump(constructs.importCommand, key)
          const arg = childrenOfType(n, "command_argument")[0]
          const argText = (arg?.text ?? "").trim()
          if (argText.endsWith(".*")) bump(constructs.importCommandWildcard, key)
          else if (argText.includes(".")) bump(constructs.importCommandDotted, key)
        }
      }
    } else if (t === "handle_operator") {
      bump(constructs.handleOperator, key)
      bump(constructs.referenceHandle, key)
    } else if (t === "metaclass_operator") {
      bump(constructs.metaclassOperator, key)
    } else if (t === "indirect_access") {
      bump(constructs.indirectAccess, key)
    } else if (t === "field_expression") {
      bump(constructs.fieldExpression, key)
    } else if (t === "global_operator") {
      bump(constructs.globalOperator, key)
    } else if (t === "persistent_operator") {
      bump(constructs.persistentOperator, key)
    } else if (t === "function_definition") {
      const nameNode = n.childForFieldName?.("name")
      const name = nameNode?.text ?? ""
      const inMethods = n.parent?.type === "methods"
      if (inMethods) {
        bump(constructs.methods, key)
      } else if (name !== "" && name === baseName) {
        bump(constructs.primaryFunctionMatchesBasename, key)
      } else if (name !== "") {
        bump(constructs.localFunctions, key)
      }
      // methods under a classdef that HAS superclasses are the overrides CANDIDATE sites
      let anc = n.parent
      let classdef: any = null
      while (anc) { if (anc.type === "class_definition") { classdef = anc; break } anc = anc.parent }
      if (classdef) {
        const supers = childrenOfType(classdef, "superclasses")[0]
        if (supers) bump(constructs.methodsUnderSubclass, key)
      }
    } else if (t === "methods") {
      bump(constructs.methodsBlocks, key)
    } else if (t === "properties") {
      bump(constructs.propertiesBlocks, key)
    } else if (t === "events") {
      bump(constructs.eventsBlocks, key)
      for (const ch of n.namedChildren ?? []) if (ch?.type === "identifier") bump(constructs.eventDecls, key)
    } else if (t === "enumeration") {
      bump(constructs.enumerationBlocks, key)
    } else if (t === "enum") {
      bump(constructs.enumDecls, key)
    } else if (t === "property") {
      bump(constructs.propertyDecls, key)
    } else if (t === "arguments_statement") {
      bump(constructs.argumentsStatements, key)
    } else if (t === "class_definition") {
      const nameNode = n.childForFieldName?.("name")
      if (nameNode?.text) constructs.classDeclaredNames.add(nameNode.text)
      const supers = childrenOfType(n, "superclasses")[0]
      if (supers) {
        bump(constructs.classesWithSuperclasses, key)
        const bases = childrenOfType(supers, "property_name")
        for (const b of bases) {
          bump(constructs.superclassEntries, key)
          const spelling = dottedText(b)
          if (spelling !== "") bumpNamed(constructs.superclassSpellings, spelling)
          if (spelling === "handle" || spelling === "matlab.mixin.Copyable" || spelling === "matlab.mixin.Heterogeneous") bump(constructs.handleBaseSites, key)
          else if (spelling.startsWith("matlab.mixin.")) bump(constructs.mixinBaseSites, key)
        }
        if (bases.length > 1) bump(constructs.classesMultiSuper, key)
        else bump(constructs.classesSingleSuper, key)
      }
    }
    // `attributes` lists live on classdef/properties/methods/events/enumeration/arguments
    if (t === "attributes") {
      bump(constructs.attributeLists, key)
      for (const a of childrenOfType(n, "attribute")) {
        bump(constructs.attributeSites, key)
        const id = identifiersUnder(a)[0]
        const spelling = (id?.text ?? a.text ?? "").trim()
        if (spelling !== "") bumpNamed(constructs.attributeSpellings, spelling)
      }
    }
    for (let i = (n.namedChildCount ?? 0) - 1; i >= 0; i--) {
      const ch = n.namedChild(i)
      if (ch) stack.push(ch)
    }
  }
  try { tree.delete?.() } catch { /* best effort */ }

  // --- the EMISSION census, on production parseFile ----------------------------------------
  try {
    const result = await ASTEngine.parseFile(f.abs, text)
    parsed++
    for (const rel of result.relationships) emit(String(rel.type ?? "unknown"), key)
  } catch {
    parseFailures++
    failureNames.push(`${key} (parseFile)`)
  }
}

const WORKERS = Number(process.env.BB_MATLAB_WORKERS ?? "2")
let cursor = 0
async function worker() {
  while (cursor < admitted.length) {
    const i = cursor++
    await walkOne(admitted[i])
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

/** `.mlapp` files on the corpus TREE (a `.mlapp` is a ZIP archive; the router admits it to no lane). */
function countMlapp(): number {
  let n = 0
  const visit = (dir: string, depth: number) => {
    if (depth > 6) return
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const e of entries) {
      if (e === ".git" || e === "node_modules") continue
      const p = path.join(dir, e)
      let st: any
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) visit(p, depth + 1)
      else if (e.toLowerCase().endsWith(".mlapp")) n++
    }
  }
  for (const e of readdirSync(CR).sort()) {
    const dir = path.join(CR, e)
    try { if (statSync(dir).isDirectory()) visit(dir, 0) } catch { continue }
  }
  return n
}
const mlappCount = countMlapp()

const out: string[] = []
const line = "=".repeat(78)
out.push(line)
out.push("CENSUS — MATLAB construct sites and per-type EMISSIONS over the WHOLE admitted population")
out.push(line)
out.push(`node ${process.version}   workers ${WORKERS}   cores ${os.cpus().length}`)
out.push(`load at start: ${loadAtStart.map((n) => n.toFixed(2)).join(" ")}`)
out.push(`corpus root: ${CR}`)
out.push(`admission: the GATE's predicate — ROUTER TABLE spelling .${EXTS.join(", .")} AND, for the shared .m, the router's content test (first ${HEAD_BYTES} B containing 'function ' or 'classdef ' = matlab, else objective-c), SIZE_CAP ${SIZE_CAP} B`)
out.push(`admitted files [0,${admitted.length}) of ${admitted.length} — the WHOLE admissible population (no stride, no cap)`)
out.push(`excluded from the population: ${excludedAbsent} tracked-but-absent/unreadable + ${excludedOverCap} over the ${SIZE_CAP} B cap + ${excludedOtherLanguage} .m files the router sends to objective-c`)
out.push(`corpus file set: sha256 ${corpusDigest} (${admitted.length} absolute paths, sorted)`)
out.push(`files walked: ${admitted.length}   tree failures: ${treeFailures}   parseFile failures: ${parseFailures}`)
out.push(`walk wall time: ${Date.now() - T0}ms`)
out.push("")
out.push(`ADMITTED FILES (${admitted.length}):`)
for (const f of admitted) out.push(`  ${f.repo}/${f.rel}`)
for (const n of failureNames) out.push(`  FAILED ${n}`)
out.push("")

const show = (label: string, c: Counter) =>
  out.push(`  ${label.padEnd(52)} ${String(c.sites).padStart(6)} sites   ${String(c.files.size).padStart(5)} files`)
const named = (label: string, m: Map<string, number>) => {
  const entries = [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  out.push(`  ${label}${entries.length === 0 ? ": (none)" : ""}`)
  for (const [name, count] of entries) out.push(`      ${name.padEnd(40)} ${count}`)
}

out.push("ANALYZER EMISSIONS — production parseFile over the population (the `implemented` numbers):")
const EMIT_ORDER = ["calls", "uses", "contains", "imports", "references", "exports", "extends",
  "implements", "overrides", "instantiates", "decorates", "renders", "mixes_in", "part_of"]
for (const t of EMIT_ORDER) {
  const c = emitted.get(t)
  out.push(`  ${t.padEnd(14)} ${String(c?.sites ?? 0).padStart(6)} edges   ${String(c?.files.size ?? 0).padStart(3)} files${c ? "" : "   (SILENT — no site, no emission)"}`)
}
out.push("")
out.push("POPULATION SHAPE — what these three files ARE:")
show("classdef files", constructs.classdef)
show("function files (no classdef, has function)", constructs.functionFile)
show("script files (neither classdef nor function file)", constructs.scriptFile)
show("primary function whose name == file basename", constructs.primaryFunctionMatchesBasename)
show("local functions (name != basename, not in methods)", constructs.localFunctions)
show("methods blocks", constructs.methodsBlocks)
show("properties blocks", constructs.propertiesBlocks)
show("events blocks", constructs.eventsBlocks)
show("enumeration blocks", constructs.enumerationBlocks)
show("property declarations", constructs.propertyDecls)
show("event declarations", constructs.eventDecls)
show("enum entries", constructs.enumDecls)
show("function definitions inside methods blocks", constructs.methods)
show("arguments validation blocks", constructs.argumentsStatements)
out.push("")
out.push("imports — `import` is a COMMAND statement in this grammar (command/command_name nodes):")
show("command statements (all names)", constructs.command)
show("command statements named `import`", constructs.importCommand)
show("  import ...* (wildcard spelling)", constructs.importCommandWildcard)
show("  import a.b (dotted spelling)", constructs.importCommandDotted)
out.push("command names (all command statements on the population):")
named("  ", constructs.commandNames)
out.push("")
out.push("references — the non-call reference constructs:")
show("@handle_operator sites (function handles)", constructs.handleOperator)
show("?metaclass_operator sites (class references)", constructs.metaclassOperator)
show("`f@SuperClass(...)` superclass qualifiers", constructs.superclassQualifier)
show("indirect_access `(...)` sites", constructs.indirectAccess)
show("field_expression sites (receiver.member)", constructs.fieldExpression)
out.push("")
out.push("exports — the file<->function identity (MATLAB: one primary function per file):")
show("primary function name == file basename", constructs.primaryFunctionMatchesBasename)
show("local functions (also callable in-file only)", constructs.localFunctions)
show("files under a +pkg/ folder", constructs.packageDirFiles)
show("files under an @Class/ folder", constructs.atClassDirFiles)
out.push(`  package folders: ${[...constructs.packageNames].sort().join(", ") || "(none)"}`)
out.push(`  @Class folders: ${[...constructs.atClassNames].sort().join(", ") || "(none)"}`)
out.push("")
out.push("implements / mixes_in — the superclass-list shape (`classdef X < Y & Z`):")
show("classes with a superclasses node", constructs.classesWithSuperclasses)
show("superclass entries (one per base, & separates)", constructs.superclassEntries)
show("  classes with exactly ONE base", constructs.classesSingleSuper)
show("  classes with TWO OR MORE bases (& sites)", constructs.classesMultiSuper)
show("  bases spelled `handle` or a mixin class", constructs.handleBaseSites)
show("  bases spelled `matlab.mixin.*` (beyond the three common)", constructs.mixinBaseSites)
named("  superclass spellings:", constructs.superclassSpellings)
out.push("")
out.push("overrides — candidate sites only (the grammar has no override marker):")
show("function definitions inside a classdef WITH superclasses", constructs.methodsUnderSubclass)
out.push("")
out.push("instantiates — calls whose callee is a class declared IN THE POPULATION:")
show("call sites to a declared class name", constructs.callToClassSite)
out.push(`  class names declared: ${[...constructs.classDeclaredNames].sort().join(", ") || "(none)"}`)
out.push("")
out.push("decorates — PASSIVE METADATA, the near miss (attribute lists):")
show("attributes lists (classdef/properties/methods/events/enumeration/arguments)", constructs.attributeLists)
show("attribute entries", constructs.attributeSites)
named("  attribute spellings:", constructs.attributeSpellings)
out.push("")
out.push("renders — UI component constructors (App Designer / uifigure family):")
show("UI component constructor calls", constructs.uiConstructorSites)
named("  UI constructor names:", constructs.uiConstructorNames)
out.push(`  .mlapp files on the corpus tree (never admitted: a ZIP, not source): ${mlappCount}`)
out.push("")
out.push("scoping constructs (not relationship types; recorded so caveats can cite them):")
show("global_operator statements", constructs.globalOperator)
show("persistent_operator statements", constructs.persistentOperator)

const text = out.join("\n") + "\n"
writeFileSync(ARTIFACT, text)
console.log(text)
console.log(`artifact: ${ARTIFACT}`)
