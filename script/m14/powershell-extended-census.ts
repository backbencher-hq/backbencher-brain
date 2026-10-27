#!/usr/bin/env bun
/**
 * POWERSHELL EXTENDED-TYPE CONSTRUCT CENSUS — the lane's own instrument.
 *
 * Measures, over the WHOLE ADMITTED POPULATION, the construct families behind the
 * two extended relationship types this lane has open (`renders`, `mixes_in`), so
 * that each disposition is a COUNT with a falsifier rather than an absence.
 *
 * WHY IT IS A TRACKED FILE AND NOT A `.tmp-` PROBE: a ruling's corpus half is only
 * checkable if its evidence survives. The fleet's citation rule says a citation to
 * an untracked or ephemeral path is a claim with a local witness and no durable
 * evidence, so this instrument and the JSON it writes are both committed.
 *
 * THE POPULATION RULE, copied from the lane's own census instruments
 * (`validation/m14/fixtures/powershell/census.ts`, `decorates-census.mts`): for
 * every repository under the corpus root that is a git work tree, the files the
 * repository TRACKS (`git ls-files`), at or under the 512 KiB cap this lane's
 * instruments use, whose routed language is `powershell`. The denominator is
 * printed with the result, and an empty population is a REFUSAL, not a zero.
 *
 * THE TWO FAMILIES AND WHAT EACH COUNTER MEANS.
 *
 *   renders — the vocabulary's construct is "a component RENDERS another component:
 *             source = the rendering symbol, target = the rendered component", and
 *             the contract says the host renderer constructs the element. PowerShell
 *             is a shell and an automation language: it has no component model, no
 *             declaration that denotes a component, and no host renderer attributable
 *             to a declaration. The counters are the four nearest real constructs,
 *             each counted rather than argued:
 *               ConvertTo-Html   converts OBJECTS to HTML text (a serializer)
 *               Out-GridView     displays objects in a GUI grid (a host displays
 *                                DATA; the target is the data, not a component)
 *               Show-Command     displays a cmdlet's parameter UI
 *               XamlReader       a WPF reader that constructs UI from XAML text
 *             A fifth, `format data files` (.ps1xml `<View>`), is named but NOT
 *             counted here because those files do not route to this lane — the
 *             census reports that as a routing fact, not a zero.
 *             The FALSIFIER it publishes: a site whose target is a DECLARED
 *             COMPONENT. The vocabulary has no component symbol kind, so this is
 *             counted as "candidate sites whose target names a declaration of any
 *             kind" — and a non-zero there would not make them renders, it would
 *             make them `uses`/`calls`, which is what the analyzer already emits.
 *
 *   mixes_in — the vocabulary's construct is member-set COMPOSITION: source = the
 *              composing type, target = the composed member set, with no conformance
 *              declared (go struct embedding, zig `usingnamespace`, dart `with`).
 *              PowerShell has exactly one declaration-level composition construct —
 *              the class base list — and it IS conformance (`extends` + `implements`,
 *              already emitted). The runtime member-attachment cmdlets are the
 *              impostor class and each is counted:
 *                Add-Member        attaches members to an OBJECT VALUE at runtime
 *                Update-TypeData   attaches members to a TYPE NAME at runtime
 *                Update-FormatData attaches view definitions at runtime
 *                Add-Type          compiles C#/VB source at runtime
 *              The FALSIFIER: a site where the composed member set is a NAMED
 *              DECLARATION (a symbol the population declares) rather than an inline
 *              script block or value. Members attached to a VALUE are not a
 *              composition of a member set into a type; they are mutation of one
 *              object, and the contract's source is a DECLARATION.
 *
 * NO REGEX. Every classifier reads node types, fields and a hash-set membership
 * test; command names are compared as exact strings after a lowercase fold.
 *
 * Usage:
 *   bun script/m14/powershell-extended-census.ts [--out <artifact.json>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import type { Node } from "web-tree-sitter"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { getParser } from "../../src/ast/engine"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const LANG = "powershell"
/** The cap this lane's census instruments use. Stated, not assumed: a different cap is a different population. */
const SIZE_CAP = 512 * 1024

const argv = process.argv.slice(2)
const argOf = (f: string): string | null => {
  const i = argv.indexOf(f)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null
}
const OUT = argOf("--out") ?? path.join(ROOT, "validation/m14/measurements/powershell-extended-census.json")

// ───────────────────────────── population ─────────────────────────────
type Admitted = { repo: string; rel: string; abs: string; text: string }
const admitted: Admitted[] = []
const repos = new Set<string>()
let absent = 0
let overCap = 0

for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let size: number
    try {
      size = statSync(abs).size
    } catch {
      absent++
      continue
    }
    if (size > SIZE_CAP) {
      overCap++
      continue
    }
    let text: string
    try {
      text = readFileSync(abs, "utf8")
    } catch {
      absent++
      continue
    }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    admitted.push({ repo: e, rel, abs, text })
    repos.add(e)
  }
}

if (admitted.length === 0) {
  console.error(`CONTROL FAILURE: the admitted population is EMPTY (root ${CR}). A zero measured here would be a zero about nothing.`)
  process.exit(5)
}

const parser = await getParser(LANG as any)
const probe = parser.parse("class A : B { }").rootNode
if (probe.type !== "program") {
  console.error("CONTROL FAILURE: the powershell parser did not load; every count below would be a false zero.")
  process.exit(2)
}

// ───────────────────────────── helpers ─────────────────────────────
const firstChild = (n: Node, type: string): Node | null => {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && c.type === type) return c
  }
  return null
}
const walk = (root: Node, visit: (n: Node) => void): void => {
  const stack: Node[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    visit(n)
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}
/** The command's own name, lowercased, from the grammar's `command_name` child — never from source text. */
const commandName = (n: Node): string | null => {
  if (n.type !== "command") return null
  const cn = firstChild(n, "command_name")
  if (!cn) return null
  return cn.text.trim().toLowerCase()
}

// ────────────── pass 1: what the population DECLARES ──────────────
// The falsifier for both types asks whether a candidate's target names a
// DECLARATION. So the declaration set is built from the trees, case-folded
// (PowerShell is case-insensitive), before any candidate is classified.
const declared = new Map<string, Set<string>>() // lower name -> kinds
const addDeclared = (name: string, kind: string): void => {
  const k = name.trim().toLowerCase()
  if (k === "") return
  let s = declared.get(k)
  if (!s) {
    s = new Set()
    declared.set(k, s)
  }
  s.add(kind)
}
let filesParsed = 0
let filesFailed = 0
const trees: Node[] = []

for (const a of admitted) {
  let root: Node
  try {
    root = parser.parse(a.text).rootNode
    filesParsed++
  } catch {
    filesFailed++
    continue
  }
  trees.push(root)
  walk(root, (n) => {
    if (n.type === "class_statement") {
      const nm = firstChild(n, "simple_name")
      if (nm) addDeclared(nm.text, "class")
    } else if (n.type === "function_statement") {
      const nm = firstChild(n, "function_name") ?? firstChild(n, "simple_name")
      if (nm) addDeclared(nm.text, "function")
    } else if (n.type === "enum_statement") {
      const nm = firstChild(n, "simple_name")
      if (nm) addDeclared(nm.text, "enum")
    }
  })
}

// ────────────── pass 2: the candidate sites ──────────────
const RENDER_COMMANDS = new Set(["convertto-html", "out-gridview", "show-command", "show-controlpanelitem"])
const MIXIN_COMMANDS = new Set(["add-member", "update-typedata", "update-formatdata", "add-type"])

const counters = {
  renders: {
    convertToHtml: 0,
    outGridView: 0,
    showCommand: 0,
    xamlReaderTypeMentions: 0,
    candidateSites: 0,
    /** Candidate sites whose rendered TARGET names a declaration of this population (see the falsifier note). */
    sitesWhoseTargetNamesADeclaration: 0,
    filesWithAnyCandidate: 0,
    exampleSites: [] as { file: string; line: number; command: string }[],
  },
  mixes_in: {
    classStatements: 0,
    classBaseListEntries: 0,
    addMember: 0,
    updateTypeData: 0,
    updateFormatData: 0,
    addType: 0,
    candidateSites: 0,
    /**
     * WHAT THE MEMBER-SET ARGUMENT IS, by grammar shape — this is the falsifier, and it is the
     * argument of `-Value`/`-MemberName`/`-Name` rather than any name anywhere in the command.
     * The contract's target is a member set that is a DECLARATION; these cmdlets take an inline
     * script block or a string, so the honest question is which shape actually arrives.
     */
    memberSetArgumentShapes: {} as Record<string, number>,
    /** Sites whose member-set argument is a DECLARATION (a name resolving to one of this population's symbols). */
    memberSetNamesADeclaration: 0,
    /** EVERY such site, in full, so the falsifier is inspectable rather than a number. */
    memberSetDeclaredSites: [] as { file: string; line: number; command: string; param: string; argument: string; declarationKinds: string[] }[],
    /** The HOST: `-TypeName`, counted separately so a host name is never read as a member set. */
    hostTypeArgumentSites: 0,
    hostTypeIsPrimitiveOrWildcard: 0,
    filesWithAnyCandidate: 0,
    exampleSites: [] as { file: string; line: number; command: string }[],
  },
  /** Members declared INSIDE a class body — containment, not composition. Reported so the two are not confused. */
  classMembers: { methods: 0, properties: 0 },
}

let fileIndex = -1
for (const root of trees) {
  fileIndex++
  const a = admitted[fileIndex]
  let renderInFile = false
  let mixinInFile = false

  walk(root, (n) => {
    if (n.type === "class_method_definition") counters.classMembers.methods++
    if (n.type === "class_property_definition") counters.classMembers.properties++

    if (n.type === "class_statement") {
      counters.mixes_in.classStatements++
      // The base list: `class C : Base, IFoo`. Everything after the first `:`
      // token up to `{` is a conformance entry — the construct that is ALREADY
      // extends/implements, counted so a mixin reading cannot claim it silently.
      let seenColon = false
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (!c) continue
        if (!seenColon) {
          if (c.type === ":") seenColon = true
          continue
        }
        if (c.type === "{" || c.type === "class_body") break
        if (c.type === "simple_name" || c.type === "type_name" || c.type === "generic_type_name" || c.type === "type_identifier") {
          counters.mixes_in.classBaseListEntries++
        }
      }
      return
    }

    if (n.type === "member_access" || n.type === "type_literal" || n.type === "generic_type_name") {
      if (n.text.includes("XamlReader")) counters.renders.xamlReaderTypeMentions++
    }

    const cmd = commandName(n)
    if (cmd === null) return

    if (RENDER_COMMANDS.has(cmd)) {
      renderInFile = true
      counters.renders.candidateSites++
      if (cmd === "convertto-html") counters.renders.convertToHtml++
      else if (cmd === "out-gridview") counters.renders.outGridView++
      else counters.renders.showCommand++
      if (counters.renders.exampleSites.length < 12) {
        counters.renders.exampleSites.push({ file: `${a.repo}/${a.rel}`, line: n.startPosition.row + 1, command: cmd })
      }
      // FALSIFIER HALF: does the command's own arguments name a DECLARED thing?
      // A `-InputObject $x` / a pipeline value is a VALUE, not a declaration.
      walk(n, (m) => {
        if (m.type === "simple_name" || m.type === "type_name" || m.type === "type_identifier") {
          if (declared.has(m.text.trim().toLowerCase())) counters.renders.sitesWhoseTargetNamesADeclaration++
        }
      })
      return
    }

    if (MIXIN_COMMANDS.has(cmd)) {
      mixinInFile = true
      counters.mixes_in.candidateSites++
      if (cmd === "add-member") counters.mixes_in.addMember++
      else if (cmd === "update-typedata") counters.mixes_in.updateTypeData++
      else if (cmd === "update-formatdata") counters.mixes_in.updateFormatData++
      else counters.mixes_in.addType++
      if (counters.mixes_in.exampleSites.length < 12) {
        counters.mixes_in.exampleSites.push({ file: `${a.repo}/${a.rel}`, line: n.startPosition.row + 1, command: cmd })
      }
      // FALSIFIER HALF — read the PARAMETER, not the whole command. `-TypeName` is
      // the HOST the members are attached to; the member set is whatever follows
      // `-Value` / `-MemberName` / `-Name`. Classifying the argument's own subtree
      // is what makes the number mean "the composed set is X" rather than "some
      // name in this line is declared".
      // THE GRAMMAR PUTS PARAMETERS AND THEIR ARGUMENTS INSIDE `command_elements`,
      // in source order, alternating `command_parameter` and the argument node:
      //   (command_elements (command_argument_sep) (command_parameter) (generic_token) …
      //                     (command_parameter) (array_literal_expression (… script_block_expression)))
      // So the pairing is a scan of THAT node, not of the command's own children (which
      // are only `command_name` and `command_elements` — the first version of this read
      // the wrong level and measured 0 member-set arguments over 326 sites).
      const elements = firstChild(n, "command_elements")
      if (!elements) return
      let pending: string | null = null
      for (let i = 0; i < elements.childCount; i++) {
        const c = elements.child(i)
        if (!c) continue
        if (c.type === "command_parameter") {
          pending = c.text.trim().toLowerCase()
          continue
        }
        if (c.type === "command_argument_sep" || c.type === "command_name") continue
        if (pending === null) continue
        const param = pending
        pending = null
        // Only the parameters that carry the HOST or the MEMBER SET are classified.
        // `-MemberType ScriptMethod` names a member KIND, not a member set, so it is
        // consumed and not counted either way.
        if (param !== "-typename" && param !== "-value" && param !== "-membername" && param !== "-name") continue
        const isHost = param === "-typename"
        let shape = c.type
        let namesADeclaration = false
        let sawBlock = false
        let sawString = false
        if (c.type === "generic_token" && declared.has(c.text.trim().toLowerCase())) namesADeclaration = true
        walk(c, (m) => {
          if (m.type === "script_block" || m.type === "script_block_expression") sawBlock = true
          else if (
            m.type === "string_literal" ||
            m.type === "expandable_string_literal" ||
            m.type === "expandable_here_string_literal" ||
            m.type === "verbatim_string_characters"
          )
            sawString = true
          else if (
            (m.type === "simple_name" || m.type === "type_name" || m.type === "type_identifier") &&
            declared.has(m.text.trim().toLowerCase())
          )
            namesADeclaration = true
        })
        if (sawBlock) shape = "script_block"
        else if (sawString) shape = "string_literal"
        else if (namesADeclaration) shape = "declared_name"
        if (isHost) {
          counters.mixes_in.hostTypeArgumentSites++
          if (shape !== "declared_name") counters.mixes_in.hostTypeIsPrimitiveOrWildcard++
        } else {
          counters.mixes_in.memberSetArgumentShapes[shape] = (counters.mixes_in.memberSetArgumentShapes[shape] ?? 0) + 1
          if (shape === "declared_name") {
            counters.mixes_in.memberSetNamesADeclaration++
            if (counters.mixes_in.memberSetDeclaredSites.length < 40) {
              const key = c.text.trim().toLowerCase()
              counters.mixes_in.memberSetDeclaredSites.push({
                file: `${a.repo}/${a.rel}`,
                line: n.startPosition.row + 1,
                command: cmd,
                param,
                argument: c.text.slice(0, 120),
                declarationKinds: [...(declared.get(key) ?? [])],
              })
            }
          }
        }
      }
    }
  })

  if (renderInFile) counters.renders.filesWithAnyCandidate++
  if (mixinInFile) counters.mixes_in.filesWithAnyCandidate++
}

// ───────────────────────────── controls ─────────────────────────────
// A counter that a synthetic site cannot trip is a counter that would report 0
// over any corpus. Each control below is the shape its counter exists to find.
const controlText = [
  "$o = [pscustomobject]@{ A = 1 }",
  "$o | Add-Member -MemberType ScriptMethod -Name M -Value { 1 }",
  "Update-TypeData -TypeName Foo -MemberType ScriptProperty -MemberName P -Value { 1 }",
  "Update-FormatData -PrependPath ./x.format.ps1xml",
  "Add-Type -TypeDefinition 'public class C { }'",
  "ConvertTo-Html -InputObject $o",
  "$o | Out-GridView",
  "Show-Command Get-ChildItem",
  "class Base { }",
  "class Derived : Base { [void] M() { } [int]$P }",
].join("\n")
const cRoot = parser.parse(controlText).rootNode
const control = {
  addMember: 0,
  updateTypeData: 0,
  updateFormatData: 0,
  addType: 0,
  convertToHtml: 0,
  outGridView: 0,
  showCommand: 0,
  classStatements: 0,
  classBaseListEntries: 0,
  classMethods: 0,
  classProperties: 0,
}
walk(cRoot, (n) => {
  if (n.type === "class_method_definition") control.classMethods++
  if (n.type === "class_property_definition") control.classProperties++
  if (n.type === "class_statement") {
    control.classStatements++
    let seenColon = false
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (!c) continue
      if (!seenColon) {
        if (c.type === ":") seenColon = true
        continue
      }
      if (c.type === "{" || c.type === "class_body") break
      if (c.type === "simple_name" || c.type === "type_name" || c.type === "generic_type_name" || c.type === "type_identifier") {
        control.classBaseListEntries++
      }
    }
    return
  }
  const cmd = commandName(n)
  if (cmd === "add-member") control.addMember++
  else if (cmd === "update-typedata") control.updateTypeData++
  else if (cmd === "update-formatdata") control.updateFormatData++
  else if (cmd === "add-type") control.addType++
  else if (cmd === "convertto-html") control.convertToHtml++
  else if (cmd === "out-gridview") control.outGridView++
  else if (cmd === "show-command") control.showCommand++
})
const controlFailures: string[] = []
for (const [k, v] of Object.entries(control)) if (v === 0) controlFailures.push(k)
if (controlFailures.length > 0) {
  console.error(`CONTROL FAILURE: the synthetic control did not trip: ${controlFailures.join(", ")}. Every zero below would be a false zero.`)
  process.exit(6)
}

// ───────────────────────────── the facts ─────────────────────────────
/** Does the vocabulary even HAVE a component symbol kind? Read from the enum, so the answer cannot go stale. */
const symbolKinds = (() => {
  const out: string[] = []
  let inside = false
  for (const line of readFileSync(path.join(ROOT, "src/ast/types.ts"), "utf8").split("\n")) {
    if (!inside) {
      if (line.includes("export enum SymbolKind")) inside = true
      continue
    }
    const t = line.trim()
    if (t === "}") break
    if (t === "" || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue
    const eq = t.indexOf("= \"")
    if (eq < 0) continue
    const rest = t.slice(eq + 3)
    const close = rest.indexOf("\"")
    if (close > 0) out.push(rest.slice(0, close))
  }
  return out
})()
const componentKind = symbolKinds.filter((k) => k.includes("component") || k.includes("render") || k.includes("widget"))

const artifact = {
  language: LANG,
  instrument: "script/m14/powershell-extended-census.ts",
  measuredAt: new Date().toISOString(),
  population: {
    admitted: admitted.length,
    repos: repos.size,
    parsed: filesParsed,
    failed: filesFailed,
    absent,
    overCap,
    sizeCapBytes: SIZE_CAP,
    declaredNames: declared.size,
    rule: "per-repo `git ls-files`, the router's powershell spellings, <= 512 KiB (this lane's census cap); an empty population is a refusal",
  },
  control: { ok: controlFailures.length === 0, results: control },
  vocabulary: {
    symbolKinds: symbolKinds.length,
    componentSymbolKinds: componentKind,
    note: "a `renders` target must be a component symbol; the vocabulary is read from src/ast/types.ts rather than asserted",
  },
  renders: counters.renders,
  mixes_in: counters.mixes_in,
  classMembers: counters.classMembers,
  falsifiers: {
    renders:
      "a site where a declaration produces a COMPONENT value that a host renderer constructs and whose target is a declared component: counted as sitesWhoseTargetNamesADeclaration, and a non-zero there is a name READ (uses/calls), not a render",
    mixes_in:
      "a site where a declaration attaches a MEMBER SET that is itself a named declaration: counted as memberSetNamesADeclaration, over the argument of -Value/-MemberName/-Name (never -TypeName, which is the host)",
  },
}

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n")
console.log(JSON.stringify(artifact.population, null, 1))
console.log(JSON.stringify({ renders: artifact.renders, mixes_in: artifact.mixes_in, classMembers: artifact.classMembers, componentKinds: componentKind }, null, 1))
console.log(`artifact: ${path.relative(ROOT, OUT)}`)
