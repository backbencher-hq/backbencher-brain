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
 *             to a declaration. The counters are the five nearest real constructs,
 *             each counted rather than argued:
 *               ConvertTo-Html        converts OBJECTS to HTML text (a serializer)
 *               Out-GridView          displays objects in a GUI grid (a host
 *                                     displays DATA; the target is the data, not a
 *                                     component)
 *               Show-Command          displays a cmdlet's parameter UI
 *               Show-ControlPanelItem opens a CONTROL PANEL ITEM — its own counter,
 *                                     because it shares nothing with a cmdlet's
 *                                     parameter UI but the word "Show"
 *               XamlReader            a WPF reader that constructs UI from XAML text
 *             A sixth shape, `format data files` (.ps1xml `<View>`), is named but
 *             NOT counted here because those files do not route to this lane — the
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
 *              already emitted). The runtime cmdlets are the impostor class, and they
 *              are NOT ONE CONSTRUCT, so they are not one number:
 *                Add-Member        attaches members to an OBJECT VALUE at runtime
 *                Update-TypeData   attaches members to a TYPE NAME at runtime
 *                → these two ARE member attachment: 144 sites, the construct the
 *                  ruling is about
 *                Add-Type          compiles C#/VB SOURCE at runtime (172 sites). Its
 *                                  argument is a source string by construction, so a
 *                                  tally that added it to "the member set is inline
 *                                  text" would be true for the wrong reason
 *                Update-FormatData attaches a DISPLAY VIEW (10 sites), not members
 *              The FALSIFIER reads the `-Value` / `-NotePropertyValue` ARGUMENT of a
 *              member attachment — not `-Name` / `-MemberName`, which name ONE member
 *              and are tallied separately (`memberNameArguments`), and not any name
 *              anywhere in the command. The falsifier fires if such an argument is a
 *              NAMED DECLARATION (a symbol this population declares) rather than an
 *              inline script block, string or value: members attached to a VALUE are
 *              mutation of one object, not composition of a member set into a type,
 *              and the contract's source is a DECLARATION.
 *              NOTHING IS LEFT UNCOUNTED, AND THE RESIDUALS ARE LISTED RATHER THAN
 *              ASSUMED: an attachment with no `-Value` at all is counted in
 *              `attachmentSitesWithNoValueArgument` and listed in
 *              `attachmentSitesWithoutValue` WITH THE PARAMETERS IT USED INSTEAD
 *              (measured: 23 sites — 18 parameter-shape and error tests in
 *              `Add-Member.Tests.ps1`, an `Update-TypeData -AppendPath`, a bare
 *              `-PassThru`, an `Update-TypeData` naming only serialization
 *              parameters, and two commands with no arguments; NO
 *              `-NotePropertyMembers` hashtable form occurs in the population at
 *              all, which the first draft of this comment guessed it did); and an
 *              attachment with no `command_elements` node at all is counted in
 *              `attachmentSitesWithNoArguments` rather than raising the
 *              attachment total and slipping past the residual, which is what the
 *              early `return` did before that counter existed. Every
 *              member-set argument whose shape is none of block/string/declared-name
 *              is listed in `memberSetUnshapedArgs` (measured: bare value tokens like
 *              `$value`, `$null`, `(Get-ExpectedComputerInfoValue $propertyName)`) so
 *              the residual is inspectable rather than a number a reader has to trust.
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
// THE PARSER IS NULLABLE AND THE GUARD IS THE CONTROL, not a convenience: `getParser` returns
// `null` when the grammar cannot be loaded, and a run that continued would parse nothing and print
// zeros about a language it never read. The probe below is the second half of the same control.
if (!parser) {
  console.error(`CONTROL FAILURE: getParser("${LANG}") returned null — there is no parser, so every count below would be a false zero.`)
  process.exit(2)
}
const probeTree = parser.parse("class A : B { }")
const probe = probeTree?.rootNode ?? null
if (!probe || probe.type !== "program") {
  console.error("CONTROL FAILURE: the powershell parser did not load; every count below would be a false zero.")
  process.exit(2)
}
probeTree?.delete()

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
/**
 * THE PARSED FILE AND ITS RECORD, PAIRED — not two arrays indexed against each other. `trees` held
 * only the files that PARSED while `admitted` held all of them, so ONE parse failure shifted every
 * later per-site record onto the WRONG FILE: the counts stayed right and every `exampleSites` /
 * residual listing named a file the site was not read from. `population.failed` is 0 today, so no
 * record in the current artifact is misattributed — the identity was corpus luck, not construction.
 */
const parsedFiles: { root: Node; a: Admitted }[] = []

for (const a of admitted) {
  let root: Node
  try {
    const tree = parser.parse(a.text)
    const treeRoot = tree?.rootNode ?? null
    if (!treeRoot) {
      // A NULL TREE OR A TREE WITH NO ROOT IS A FAILED PARSE, not an empty file: it is counted.
      filesFailed++
      tree?.delete()
      continue
    }
    root = treeRoot
    filesParsed++
  } catch {
    filesFailed++
    continue
  }
  parsedFiles.push({ root, a })
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

/**
 * THE ARGUMENT'S OWN SHAPE — ONE classifier, used by the corpus walk and by the control.
 *
 * Two copies of a shape test are two answers to whether an argument is a block, a string, a declared
 * name or a bare value, and the control would then be proving a predicate the corpus never runs.
 *
 * THE DECLARED-NAME HALF IS A SUBTREE TEST: any declared name ANYWHERE inside the argument makes it
 * `declared_name`. That is STRONGER than "the member set is a named declaration" — a cast
 * (`-Value ([SomeType]$o)`) would read as declared — so a zero here is the stronger reading and a
 * non-zero would have to be read by a human before it was called a named member set.
 */
const argumentShape = (c: Node, isDeclared: (lower: string) => boolean): { shape: string; namesADeclaration: boolean } => {
  let namesADeclaration = false
  let sawBlock = false
  let sawString = false
  if (c.type === "generic_token" && isDeclared(c.text.trim().toLowerCase())) namesADeclaration = true
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
      isDeclared(m.text.trim().toLowerCase())
    )
      namesADeclaration = true
  })
  const shape = sawBlock ? "script_block" : sawString ? "string_literal" : namesADeclaration ? "declared_name" : c.type
  return { shape, namesADeclaration }
}

const counters = {
  renders: {
    convertToHtml: 0,
    outGridView: 0,
    showCommand: 0,
    /**
     * `Show-ControlPanelItem` HAD NO COUNTER AND WAS COUNTED AS `showCommand`: both commands fell
     * through one `else`, so a "0 Show-Command" row was really "0 of those two commands". They
     * display different things — a control panel item is not a cmdlet's parameter UI — so the key
     * said something the count did not.
     */
    showControlPanelItem: 0,
    xamlReaderTypeMentions: 0,
    candidateSites: 0,
    /**
     * CANDIDATE SITES whose arguments contain a declaration of this population — a SITE count, at most
     * once per command, because the falsifier's unit is a site. The NODE count below is the same walk
     * per matching name, and it is what this key used to hold: one `ConvertTo-Html` naming two
     * declarations read as 2 SITES when it is 1.
     */
    sitesWhoseTargetNamesADeclaration: 0,
    /** Matching NAME NODES inside candidate sites' arguments — reported beside the site count, never as it. */
    declarationNameNodesInRenderArguments: 0,
    filesWithAnyCandidate: 0,
    exampleSites: [] as { file: string; line: number; command: string }[],
  },
  mixes_in: {
    classStatements: 0,
    classBaseListEntries: 0,
    /**
     * FOUR CMDLETS, THREE DIFFERENT CONSTRUCTS — counted apart, because the population of the
     * construct the ruling is about must not be a sum that includes shapes the ruling never claims.
     *
     *   Add-Member / Update-TypeData   attach MEMBERS to an object or to a type: this, and only
     *                                  this, is the construct `mixes_in` would denote.
     *   Add-Type                       COMPILES A SOURCE STRING (`-TypeDefinition 'public class C'`).
     *                                  It is not a member attachment at all, and its argument is a
     *                                  string by construction, so a tally that mixed it in would
     *                                  make "the member set is inline text" true for the wrong reason.
     *   Update-FormatData              attaches a display FORMAT VIEW, not members.
     */
    addMember: 0,
    updateTypeData: 0,
    updateFormatData: 0,
    addType: 0,
    /** Add-Member + Update-TypeData — the construct the ruling is about. */
    memberAttachmentSites: 0,
    candidateSites: 0,
    /**
     * THE FALSIFIER'S SUBJECT: the `-Value` argument of a MEMBER ATTACHMENT, by grammar shape.
     * Not `-Name`/`-MemberName` (those name ONE member, never a set — they are tallied in
     * `memberNameArguments`), and not any name anywhere in the command.
     */
    memberSetArgumentShapes: {} as Record<string, number>,
    /** Member-attachment `-Value` arguments that are a DECLARATION (a name this population declares). */
    memberSetNamesADeclaration: 0,
    /** EVERY such site, in full, so the falsifier is inspectable rather than a number. */
    memberSetDeclaredSites: [] as { file: string; line: number; command: string; param: string; argument: string; declarationKinds: string[] }[],
    /** `-Name` / `-MemberName` / `-NotePropertyName` arguments, keyed by parameter AND shape: a name is not a set. */
    memberNameArguments: {} as Record<string, number>,
    /**
     * THE DECLARATION-SHAPED NAME ARGUMENTS, LISTED. The tally above says how many there are; a tally
     * is not evidence, so each one carries its file, line and text — which is what the ruling disposes
     * of BY NAME (`Add-Type -Name TestClass`, `Add-Member -Name Build`).
     */
    memberNameDeclaredSites: [] as { file: string; line: number; command: string; param: string; argument: string; declarationKinds: string[] }[],
    /** Every member-set argument whose shape is none of block / string / declared-name, in full (capped). */
    memberSetUnshapedArgs: [] as { file: string; line: number; command: string; param: string; shape: string; argument: string }[],
    /** `Add-Type -TypeDefinition` shapes — a compiled source string, counted so it is not claimed as a member set. */
    typeCompilationDefinitionShapes: {} as Record<string, number>,
    /** Member-set-shaped parameters on a command that is NOT a member attachment (should be 0; stated, not assumed). */
    memberSetOnNonAttachment: {} as Record<string, number>,
    /** The HOST: `-TypeName`, counted separately so a host name is never read as a member set. */
    hostTypeArgumentSites: 0,
    /**
     * HOST ARGUMENTS THAT ARE NOT A CORPUS DECLARATION. This key was named
     * `hostTypeIsPrimitiveOrWildcard`, and the name was FALSE: the test is `shape !== "declared_name"`,
     * which is also reached by a RUNTIME VARIABLE (`-TypeName $t`), a `[type]` literal and a qualified
     * name. The sites are listed in `hostTypeNonDeclaredSites` so a reader sees which they are instead
     * of trusting a label — the same repair the member-set side already carries.
     */
    hostTypeArgumentNotACorpusDeclaration: 0,
    hostTypeNonDeclaredSites: [] as { file: string; line: number; command: string; shape: string; argument: string }[],
    /**
     * MEMBER ATTACHMENTS WITH NO `-Value` ARGUMENT AT ALL — the residual that would otherwise be an
     * unclassified hole. `Add-Member -NotePropertyMembers @{…}` carries its members in a hashtable
     * instead of a `-Value`, and such a site cannot be classified by this reader; it is counted here
     * rather than left to look like a site that was read and found clean.
     */
    attachmentSitesWithNoValueArgument: 0,
    /**
     * MEMBER ATTACHMENTS WITH NO ARGUMENT LIST AT ALL — no `command_elements` node, or an empty one
     * (`Add-Member` alone). Without this counter such a site raised `memberAttachmentSites` and then hit
     * the early `return` before the residual, so `144 = 121 + 23` would have closed because no such site
     * exists in this corpus rather than because the reader guarantees it.
     */
    attachmentSitesWithNoArguments: 0,
    /** Those sites, WITH THE PARAMETERS THEY USED INSTEAD — so the residual is named, not inferred. */
    attachmentSitesWithoutValue: [] as { file: string; line: number; command: string; params: string[] }[],
    filesWithAnyCandidate: 0,
    /** Files carrying a real member attachment (Add-Member / Update-TypeData). */
    filesWithAnyMemberAttachment: 0,
    exampleSites: [] as { file: string; line: number; command: string }[],
  },
  /** Members declared INSIDE a class body — containment, not composition. Reported so the two are not confused. */
  classMembers: { methods: 0, properties: 0 },
}

/**
 * EVERY CLASSIFIED PARAMETER HAS A ROLE, AND THE ROLE DECIDES WHICH TALLY IT FEEDS.
 *
 * The first version put `-Value`, `-MemberName` and `-Name` in one "member set" bucket and then
 * claimed "every member-set argument is inline" from it — a sum in which the parameter that names
 * ONE member (and `Add-Type -Name`, which names the TYPE BEING COMPILED) sat beside the argument
 * that carries the member body. MEASURED WRONG BECAUSE THE ARITHMETIC DID NOT CLOSE: 232 arguments
 * against 326 command sites, and the three declaration-shaped hits were `-Name` arguments. THE LABEL
 * WAS MEASURING A DIFFERENT POPULATION FROM THE ONE IT NAMED. A name is not a set.
 *
 * Declared at module scope because the CONTROL below classifies the same parameters, and two copies
 * of a role table are two answers to the same question.
 */
// THE ROLE IS A PROPERTY OF (COMMAND, PARAMETER), NOT OF THE PARAMETER NAME. `-Name`
// names ONE member of an existing type on Add-Member, but on Add-Type it names the .NET
// TYPE THE COMPILATION CREATES — a HOST, the thing whose members `-TypeDefinition`
// supplies. Keying the table on the bare parameter put 2 `Add-Type -Name TestClass`
// arguments into the member-name tally, where they read as member sets naming a
// declaration; the command-qualified key is read first and falls back to the bare one.
const MIXIN_ARG_ROLE: Record<string, "host" | "memberSet" | "memberName" | "typeCompilation"> = {
  "-typename": "host",
  "-value": "memberSet",
  "-notepropertyvalue": "memberSet",
  "-membername": "memberName",
  "-notepropertyname": "memberName",
  "-name": "memberName",
  "-typedefinition": "typeCompilation",
  "add-type -name": "host",
}

for (const { root, a } of parsedFiles) {
  let renderInFile = false
  let mixinInFile = false
  let attachmentInFile = false

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
      else if (cmd === "show-controlpanelitem") counters.renders.showControlPanelItem++
      else counters.renders.showCommand++
      if (counters.renders.exampleSites.length < 12) {
        counters.renders.exampleSites.push({ file: `${a.repo}/${a.rel}`, line: n.startPosition.row + 1, command: cmd })
      }
      // FALSIFIER HALF: does the command's own arguments name a DECLARED thing?
      // A `-InputObject $x` / a pipeline value is a VALUE, not a declaration.
      // COUNTED TWICE ON PURPOSE AND NEVER CONFLATED: the NODE count is per matching name, the SITE
      // count is once per command — and the site count is the unit the falsifier words.
      // THE WALK IS OVER THE ARGUMENTS, not the command: `command_elements` is where every argument
      // lives, and the command's own name is outside it. Walking `n` would let a cmdlet whose NAME is a
      // declared function read as a site that "names a declaration in its arguments".
      let renderNamesADeclaration = false
      const renderArgs = firstChild(n, "command_elements")
      if (renderArgs) {
        walk(renderArgs, (m) => {
          if (m.type === "simple_name" || m.type === "type_name" || m.type === "type_identifier") {
            if (declared.has(m.text.trim().toLowerCase())) {
              counters.renders.declarationNameNodesInRenderArguments++
              renderNamesADeclaration = true
            }
          }
        })
      }
      if (renderNamesADeclaration) counters.renders.sitesWhoseTargetNamesADeclaration++
      return
    }

    if (MIXIN_COMMANDS.has(cmd)) {
      mixinInFile = true
      counters.mixes_in.candidateSites++
      if (cmd === "add-member") counters.mixes_in.addMember++
      else if (cmd === "update-typedata") counters.mixes_in.updateTypeData++
      else if (cmd === "update-formatdata") counters.mixes_in.updateFormatData++
      else counters.mixes_in.addType++
      const isAttachment = cmd === "add-member" || cmd === "update-typedata"
      if (isAttachment) {
        counters.mixes_in.memberAttachmentSites++
        if (!attachmentInFile) {
          attachmentInFile = true
          counters.mixes_in.filesWithAnyMemberAttachment++
        }
      }
      if (counters.mixes_in.exampleSites.length < 12) {
        counters.mixes_in.exampleSites.push({ file: `${a.repo}/${a.rel}`, line: n.startPosition.row + 1, command: cmd })
      }
      // FALSIFIER HALF — read the PARAMETER, not the whole command. `-TypeName` is
      // the HOST the members are attached to; the MEMBER SET is the `-Value` /
      // `-NotePropertyValue` argument, and `-Name` / `-MemberName` name ONE member
      // and are tallied apart. Classifying the argument's own subtree is what makes
      // the number mean "the composed set is X" rather than "some name in this line
      // is declared".
      // THE GRAMMAR PUTS PARAMETERS AND THEIR ARGUMENTS INSIDE `command_elements`,
      // in source order, alternating `command_parameter` and the argument node:
      //   (command_elements (command_argument_sep) (command_parameter) (generic_token) …
      //                     (command_parameter) (array_literal_expression (… script_block_expression)))
      // So the pairing is a scan of THAT node, not of the command's own children (which
      // are only `command_name` and `command_elements` — the first version of this read
      // the wrong level and measured 0 member-set arguments over 326 sites).
      const elements = firstChild(n, "command_elements")
      if (!elements || elements.childCount === 0) {
        // AN ATTACHMENT WITH NO ARGUMENT LIST AT ALL (`Add-Member` alone) lands here, whether the
        // grammar omits `command_elements` or gives it no children. It has already been counted as a
        // member attachment, so it must be counted as an unread member set too — otherwise the residual
        // closes on corpus luck rather than on the reader's guarantee. AND IT RETURNS EITHER WAY: an
        // empty element list would otherwise fall through to the residual below and be counted TWICE,
        // once here and once in `attachmentSitesWithNoValueArgument`.
        if (isAttachment) counters.mixes_in.attachmentSitesWithNoArguments++
        return
      }
      // Whether this SITE carried a member-set argument at all. A site with none is counted after
      // the loop rather than left to look like a site that was read and found clean: `Add-Member
      // -NotePropertyMembers @{…}` carries its members in a hashtable, which this reader cannot
      // classify, and an uncounted hole is the one thing this census refuses to leave.
      let sawMemberSetArgument = false
      const paramsSeen: string[] = []
      let pending: string | null = null
      for (let i = 0; i < elements.childCount; i++) {
        const c = elements.child(i)
        if (!c) continue
        if (c.type === "command_parameter") {
          pending = c.text.trim().toLowerCase()
          paramsSeen.push(pending)
          continue
        }
        if (c.type === "command_argument_sep" || c.type === "command_name") continue
        if (pending === null) continue
        const param = pending
        pending = null
        const role = MIXIN_ARG_ROLE[`${cmd} ${param}`] ?? MIXIN_ARG_ROLE[param]
        if (!role) continue
        const { shape } = argumentShape(c, (t) => declared.has(t))
        if (role === "host") {
          counters.mixes_in.hostTypeArgumentSites++
          if (shape !== "declared_name") {
            counters.mixes_in.hostTypeArgumentNotACorpusDeclaration++
            if (counters.mixes_in.hostTypeNonDeclaredSites.length < 40) {
              counters.mixes_in.hostTypeNonDeclaredSites.push({
                file: `${a.repo}/${a.rel}`,
                line: n.startPosition.row + 1,
                command: cmd,
                shape,
                argument: c.text.slice(0, 120),
              })
            }
          }
        } else if (role === "memberSet") {
          if (!isAttachment) {
            // A member-set-shaped argument on a command this ruling does not claim. Counted, never
            // folded in: `[]` here is a statement, whereas silence would be an assumption.
            const k = `${cmd} ${param}`
            counters.mixes_in.memberSetOnNonAttachment[k] = (counters.mixes_in.memberSetOnNonAttachment[k] ?? 0) + 1
            continue
          }
          sawMemberSetArgument = true
          counters.mixes_in.memberSetArgumentShapes[shape] = (counters.mixes_in.memberSetArgumentShapes[shape] ?? 0) + 1
          if (shape !== "script_block" && shape !== "string_literal" && shape !== "declared_name") {
            if (counters.mixes_in.memberSetUnshapedArgs.length < 40) {
              counters.mixes_in.memberSetUnshapedArgs.push({
                file: `${a.repo}/${a.rel}`,
                line: n.startPosition.row + 1,
                command: cmd,
                param,
                shape,
                argument: c.text.slice(0, 120),
              })
            }
          }
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
        } else if (role === "memberName") {
          const k = `${param} ${shape}`
          counters.mixes_in.memberNameArguments[k] = (counters.mixes_in.memberNameArguments[k] ?? 0) + 1
          if (shape === "declared_name" && counters.mixes_in.memberNameDeclaredSites.length < 40) {
            const key = c.text.trim().toLowerCase()
            counters.mixes_in.memberNameDeclaredSites.push({
              file: `${a.repo}/${a.rel}`,
              line: n.startPosition.row + 1,
              command: cmd,
              param,
              argument: c.text.slice(0, 120),
              declarationKinds: [...(declared.get(key) ?? [])],
            })
          }
        } else {
          if (cmd === "add-type") {
            counters.mixes_in.typeCompilationDefinitionShapes[shape] = (counters.mixes_in.typeCompilationDefinitionShapes[shape] ?? 0) + 1
          } else {
            const k = `${cmd} ${param}`
            counters.mixes_in.memberSetOnNonAttachment[k] = (counters.mixes_in.memberSetOnNonAttachment[k] ?? 0) + 1
          }
        }
      }
      if (isAttachment && !sawMemberSetArgument) {
        counters.mixes_in.attachmentSitesWithNoValueArgument++
        if (counters.mixes_in.attachmentSitesWithoutValue.length < 40) {
          counters.mixes_in.attachmentSitesWithoutValue.push({
            file: `${a.repo}/${a.rel}`,
            line: n.startPosition.row + 1,
            command: cmd,
            params: paramsSeen,
          })
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
  "Add-Type -Name Held -TypeDefinition 'public class Held { }'",
  "ConvertTo-Html -InputObject $o",
  "$o | Out-GridView",
  "Show-Command Get-ChildItem",
  "Show-ControlPanelItem",
  "function Build { }",
  "$o | Add-Member -Name Build -Value 1",
  "Add-Member",
  "Add-Member -MemberType NoteProperty",
  "ConvertTo-Html -Title (Build)",
  "class Base { }",
  "class Derived : Base { [void] M() { } [int]$P }",
].join("\n")
const cTree = parser.parse(controlText)
const cRoot = cTree?.rootNode ?? null
if (!cRoot) {
  console.error("CONTROL FAILURE: the control text did not parse, so no count below is demonstrably able to fire.")
  process.exit(2)
}
/**
 * THE CONTROL'S OWN DECLARATION SET. `declared` is built from the ADMITTED POPULATION and the control
 * text is deliberately not part of it — so a control reusing `declared` could never trip a
 * `declared_name` counter, and the counters behind the `-Name` disposal would be unreachable in the one
 * place that exists to prove they can fire.
 */
const controlDeclared = new Set<string>()
walk(cRoot, (n) => {
  if (n.type === "function_statement") {
    const nm = firstChild(n, "function_name") ?? firstChild(n, "simple_name")
    if (nm) controlDeclared.add(nm.text.trim().toLowerCase())
  } else if (n.type === "class_statement" || n.type === "enum_statement") {
    const nm = firstChild(n, "simple_name")
    if (nm) controlDeclared.add(nm.text.trim().toLowerCase())
  }
})
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
  // THE NEW BUCKETS GET THEIR OWN CONTROL. A counter the synthetic site cannot trip reports 0 over
  // any corpus, and the role split is exactly the part of this instrument that was wrong once.
  memberAttachmentSites: 0,
  memberSetArgs: 0,
  memberNameArgs: 0,
  typeDefinitionArgs: 0,
  memberSetArgsOnAttachment: 0,
  hostArgs: 0,
  hostNotDeclared: 0,
  attachmentsNoArguments: 0,
  attachmentsNoValue: 0,
  memberNameDeclared: 0,
  unshapedMemberSetArgs: 0,
  renderSitesWithDeclaredName: 0,
  renderDeclaredNameNodes: 0,
  showControlPanelItem: 0,
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
  else if (cmd === "show-controlpanelitem") control.showControlPanelItem++

  // THE ARGUMENT-LEVEL CONTROL, on the same parameters the census classifies, through the SAME
  // role table — so a role that stops matching the grammar goes red here rather than quietly
  // producing a corpus-wide zero.
  if (cmd === "add-member" || cmd === "update-typedata" || cmd === "add-type") {
    const isAttachment = cmd !== "add-type"
    if (isAttachment) control.memberAttachmentSites++
    const elements = firstChild(n, "command_elements")
    if (!elements || elements.childCount === 0) {
      if (isAttachment) control.attachmentsNoArguments++
      return
    }
    let sawMemberSet = false
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
      const role = MIXIN_ARG_ROLE[`${cmd} ${pending}`] ?? MIXIN_ARG_ROLE[pending]
      pending = null
      if (!role) continue
      // THE CORPUS CLASSIFIER, against the control's OWN declaration set: a control that consulted
      // `declared` could never produce a `declared_name` and would prove nothing about that branch.
      const { shape } = argumentShape(c, (t) => controlDeclared.has(t))
      if (role === "host") {
        control.hostArgs++
        if (shape !== "declared_name") control.hostNotDeclared++
      } else if (role === "memberSet") {
        control.memberSetArgs++
        if (isAttachment) {
          control.memberSetArgsOnAttachment++
          sawMemberSet = true
          if (shape !== "script_block" && shape !== "string_literal" && shape !== "declared_name") control.unshapedMemberSetArgs++
        }
      } else if (role === "memberName") {
        control.memberNameArgs++
        if (shape === "declared_name") control.memberNameDeclared++
      } else if (role === "typeCompilation") control.typeDefinitionArgs++
    }
    if (isAttachment && !sawMemberSet) control.attachmentsNoValue++
  }

  // THE RENDER FALSIFIER'S CONTROL — a candidate site whose own arguments name a declared thing. Its
  // predicate is deliberately WIDER than the corpus one (leaf TEXT rather than a node-type list),
  // because the control's job is to prove the counter CAN fire, and a control that guessed the grammar's
  // spelling of `Build` wrong would report a broken counter instead of a narrow one.
  if (cmd === "convertto-html" || cmd === "out-gridview" || cmd === "show-command" || cmd === "show-controlpanelitem") {
    let hit = false
    const renderArgs = firstChild(n, "command_elements")
    if (renderArgs) {
      walk(renderArgs, (m) => {
        if (m.text.length === 0) return
        if (controlDeclared.has(m.text.trim().toLowerCase())) {
          control.renderDeclaredNameNodes++
          hit = true
        }
      })
    }
    if (hit) control.renderSitesWithDeclaredName++
  }
})
const controlFailures: string[] = []
for (const [k, v] of Object.entries(control)) if (v === 0) controlFailures.push(k)
if (controlFailures.length > 0) {
  console.error(`CONTROL FAILURE: the synthetic control did not trip: ${controlFailures.join(", ")}. Every zero below would be a false zero.`)
  process.exit(6)
}
// THE COMMAND-QUALIFIED ROLE IS PINNED IN BOTH DIRECTIONS. `Add-Type -Name Held` names the type the
// compilation CREATES, so it must reach `hostArgs` and must NOT reach `memberNameArgs` — a bare-parameter
// fallback would show up here as 2 and 4 instead of 2 and 3, and a role that quietly stopped matching
// the grammar would otherwise only ever move a corpus number nobody was watching.
if (control.memberNameArgs !== 3 || control.hostArgs !== 2) {
  console.error(
    `CONTROL FAILURE: the role split is not the one the table declares — memberNameArgs ${control.memberNameArgs} (expected 3), hostArgs ${control.hostArgs} (expected 2).`,
  )
  process.exit(7)
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
      "a site where a declaration produces a COMPONENT value that a host renderer constructs and whose target is a declared component: counted as sitesWhoseTargetNamesADeclaration, a SITE count (at most once per command) — declarationNameNodesInRenderArguments is the same walk counted per matching name and is NEVER the site count; a non-zero would be a name READ (uses/calls), not a render",
    mixes_in:
      "a site where a MEMBER ATTACHMENT passes a member set that is itself a named declaration: counted as memberSetNamesADeclaration, over the -Value / -NotePropertyValue argument of Add-Member and Update-TypeData ONLY. -Name / -MemberName / -NotePropertyName name ONE member and are tallied apart (memberNameArguments, with the declaration-shaped ones LISTED in memberNameDeclaredSites); -TypeName is the HOST and never a member set; Add-Type compiles source rather than attaching members. THE SHAPE TEST IS A SUBTREE TEST: any declared name anywhere inside the argument makes it declared_name, so a non-zero would have to be read by a human before it was called a named member set — which is why a zero here is the stronger reading",
  },
  shapeGloss: {
    script_block: "the argument is a `{ … }` block",
    string_literal: "the argument is, or contains, a string literal",
    declared_name: "a declared name occurs inside the argument (a SUBTREE test, not the argument's own type)",
    array_literal_expression:
      "the grammar's wrapper for a SINGLE bare expression, so this is a VALUE — not a list of members, which the key's name would suggest to a reader of this JSON",
    generic_token: "a bare token that is none of the above — a literal, a variable, or a switch-shaped argument",
  },
}

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n")
console.log(JSON.stringify(artifact.population, null, 1))
console.log(JSON.stringify({ renders: artifact.renders, mixes_in: artifact.mixes_in, classMembers: artifact.classMembers, componentKinds: componentKind }, null, 1))
console.log(`artifact: ${path.relative(ROOT, OUT)}`)
