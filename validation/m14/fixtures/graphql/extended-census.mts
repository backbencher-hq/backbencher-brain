/**
 * GRAPHQL EXTENDED-TYPE CENSUS — the whole-population instrument behind this lane's rulings for
 * `extends`, `decorates`, `renders`, `mixes_in` and `part_of`.
 *
 * WHY IT EXISTS. Those five types are either implemented and measured, or RULED with a count, a
 * population and a falsifier. A ruling on a construct must count THE CONSTRUCT — not the analyzer's
 * missing emission and not a keyword scan. This file walks the admitted population through the wired
 * grammar (`wasm/tree-sitter-graphql.wasm`, the same build the analyzer uses) and counts, per type:
 *
 *   extends    the supertype clause (`implements`) and the schema-extension syntax
 *              (`extend type Foo`), and whether an extension composes a DISTINCT member set into a
 *              supertype chain. GraphQL has no inheritance clause: the only supertype slot is
 *              `ImplementsInterfaces` (published as `implements`), and an extension adds members to
 *              the SAME type (published as `contains` with `metadata.extension`). The three-way
 *              discriminator the ruling must state is measured here:
 *                - not `extends`: an extension declares no second type and no supertype; the count of
 *                  `implements` clauses whose supertype is inheritance-shaped in the same document is
 *                  the falsifier's counter and it reads 0;
 *                - not `mixes_in`: a mixin edge needs a member-set PROVIDER symbol composed into the
 *                  composing type's supertype chain; an extension block is anonymous and its members
 *                  belong to the extended type itself (member-carrying extension sites are counted as
 *                  the near miss);
 *                - not `part_of`: neither extension form includes another FILE.
 *   decorates  directive DEFINITIONS vs directive APPLICATIONS, and the callable test. The contract
 *              (`src/ast/types.ts`, Decorates) is "a decorator is APPLIED TO a declaration". A
 *              directive application IS applied to a declaration, so the deciding question is whether
 *              the applied thing is a CALLABLE WITH AN IMPLEMENTATION: a directive definition in SDL
 *              carries a signature (`directive @foo(arg: Int) on FIELD`) and NO body, so the
 *              composer/executor side cannot be populated without inventing one. The csharp
 *              precedent (attributes are passive metadata => ontological) is the discriminator.
 *   renders    GraphQL declares a schema and executes requests; it has no component/element render
 *              construct. Near misses are counted rather than dismissed: executable operations (a
 *              request document, including persisted-query style executable-only documents) and
 *              payload-shaping directives (`@defer`/`@stream`).
 *   part_of    the `#import "<file>"` comment convention. It is a TOOLCHAIN convention over `comment`
 *              nodes, not a grammar production; its targets are FILE PATHS (a GraphQL name cannot
 *              contain a dot, so no declaration can answer one), it shares no scope, and the lane
 *              already publishes it as `imports` (170 whole-population edges). Counted with targets
 *              present on disk, because a ruling that ignores the real form is prose.
 *
 * TWO-PASS PER FILE, because an extension's target may be declared after it: pass 1 collects the
 * document's own top-level declarations, pass 2 counts every construct and classifies each extension
 * target as declared-here / declared-only-as-an-extension / declared-elsewhere.
 *
 * CLI:  npx tsx validation/m14/fixtures/graphql/extended-census.mts [--out <path>]
 * Read-only apart from the JSON it writes. Population = the arbiter's own discovery loop
 * (git-tracked, `detectLanguageFromPath === "graphql"`, at or under the 1 MB FULL_AST_LIMIT cap), so
 * every count is comparable cell for cell with `incoming-gate.ts`.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const REPO_ROOT = process.env.BB_REPO ?? path.resolve(import.meta.dirname, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const OUT = flag("out") ?? path.resolve(import.meta.dirname, "extended-census.json")

const { detectLanguageFromPath } = await import(`${REPO_ROOT}/src/ast/language-detection.ts`)

// EXACTLY the gate's admission for the arm's extension set (`--exts graphql,gql`), so this census
// measures the same 1,911-file population the incoming arm does. The router's table also carries
// `.graphqls`; that spelling is NOT in the arm's set, and admitting it here would measure a
// different population under the same name.
const EXTS = ["graphql", "gql"]
const admit = (rel: string): boolean => {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  return EXTS.some((e) => low.endsWith(`.${e}`)) || (EXTS.some((e) => base === e) && detectLanguageFromPath(rel) === "graphql")
}

// ---------------------------------------------------------------- the population (the gate's loop)
const files: { repo: string; rel: string; abs: string; dir: string; text: string }[] = []
const excluded = { tracked: 0, absent: 0, overCap: 0, wrongLanguage: 0 }
const repos = new Set<string>()
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
    if (!admit(rel)) continue
    excluded.tracked++
    const abs = path.join(dir, rel)
    let text: string
    try {
      const size = statSync(abs).size
      if (size > SIZE_CAP) {
        excluded.overCap++
        continue
      }
      text = readFileSync(abs, "utf8")
    } catch {
      excluded.absent++
      continue
    }
    files.push({ repo: e, rel, abs, dir: path.dirname(abs), text })
    repos.add(e)
  }
}

// ---------------------------------------------------------------- the wired grammar
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(REPO_ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language: any = await WSL.load(readFileSync(path.join(REPO_ROOT, "wasm", "tree-sitter-graphql.wasm")))
const parser = new WSP()
parser.setLanguage(language)

// The grammar's OWN declared-type table: the space in which a construct must have a production to be
// grammar-expressible. Counted here rather than asserted, and searched for the stems the five rulings
// turn on (the same shape the clean/java/json lanes used for their instrument-A halves).
const declaredTypes = new Set<string>()
for (let i = 0; i < language.nodeTypeCount; i++) {
  const n = language.nodeTypeForId(i)
  if (n) declaredTypes.add(n)
}
const stemsIn = (re: RegExp): string[] => [...declaredTypes].filter((t) => re.test(t)).sort()
const grammarStems = {
  extends: stemsIn(/inherit|supertype|extends|base_?class/i),
  decorates: stemsIn(/decorat|annotat|attribute|pragma/i),
  renders: stemsIn(/render|component|element|jsx|vnode|template|slot/i),
  mixes_in: stemsIn(/mixin|trait|with_?clause|member_?set|embed/i),
  part_of: stemsIn(/include|import|part_?of|paste/i),
  // The grammar's own extension/interface vocabulary, named so a reader can see the near miss is a
  // production rather than an absence: `extend type Foo` HAS a node type, it is just not inheritance.
  extensionAndSupertype: stemsIn(/extension|implements/i),
}

// ---------------------------------------------------------------- declarations / node vocabulary
const DEF_KINDS: Record<string, string> = {
  ObjectTypeDefinition: "Class",
  InputObjectTypeDefinition: "Class",
  InterfaceTypeDefinition: "Interface",
  UnionTypeDefinition: "Type",
  ScalarTypeDefinition: "Type",
  EnumTypeDefinition: "Enum",
  SchemaDefinition: "Namespace",
}
const EXT_LEAF: Record<string, string> = {
  ObjectTypeExtension: "Class",
  InputObjectTypeExtension: "Class",
  InterfaceTypeExtension: "Interface",
  UnionTypeExtension: "Type",
  ScalarTypeExtension: "Type",
  EnumTypeExtension: "Enum",
  SchemaExtension: "Namespace",
}
const DEF_SET = new Set(Object.keys(DEF_KINDS))
const EXT_SET = new Set(Object.keys(EXT_LEAF))
const EXT_MEMBER_NODES = ["FieldsDefinition", "InputFieldsDefinition", "EnumValuesDefinition", "ImplementsInterfaces", "UnionMemberTypes", "Directives"]
const SPEC_DIRECTIVES = new Set(["deprecated", "include", "skip", "specifiedBy", "oneOf"])
const PAYLOAD_DIRECTIVES = new Set(["defer", "stream", "export", "live"])
const DECL_PARENTS = new Set([
  ...Object.keys(DEF_KINDS), ...Object.keys(EXT_LEAF),
  "FieldDefinition", "InputValueDefinition", "EnumValueDefinition", "DirectiveDefinition",
  // a directive applied inside a directive definition's own location list is metadata on the
  // DIRECTIVE's signature; counted as declaration-context (it decorates a declaration)
])
const EXEC_PARENTS = new Set(["OperationDefinition", "Field", "FragmentDefinition", "FragmentSpread", "InlineFragment", "VariableDefinition", "SelectionSet"])

const namedChild = (n: any, type: string): any | undefined => (n.namedChildren ?? []).find((c: any) => c?.type === type)
const nameOf = (n: any): string => String(namedChild(n, "Name")?.text ?? "")

const namedTypes = new Map<string, number>()
/** every top-level type name the population DECLARES — the test for a symbol-shaped inclusion
 *  target: if nothing declares the name, the target is a tooling ALIAS (a module key), not a
 *  GraphQL name, and no `part_of` edge has a symbol to point at. */
const allDeclaredNames = new Set<string>()
const anonTypes = new Map<string, number>()
let nodes = 0
let parseFailures = 0

// extends
const extendsCounters = {
  implementsClauses: 0,
  implementsSupertypeInterfaceHere: 0,
  implementsSupertypeObjectHere: 0,
  implementsSupertypeUnionOrScalarHere: 0,
  implementsSupertypeAmbiguousKindHere: 0,
  implementsSupertypeNotDeclaredHere: 0,
  implementsConditionMet: 0, // the analyzer's `extends` branch: a Class/Type supertype declared here
  typeSystemExtensions: 0,
  typeExtensions: 0,
  schemaExtensions: 0,
  typeExtensionSites: 0,
  typeExtensionSitesDeclaredHere: 0,
  typeExtensionSitesDeclaredElsewhere: 0,
  schemaExtensionSites: 0,
  typeExtensionSitesCarryingMembers: 0,
  typeExtensionSitesCarryingImplements: 0,
  extensionKinds: {} as Record<string, number>,
  extendsKeywordTokens: 0,
}

// decorates
const decoratesCounters = {
  directiveApplications: 0,
  directiveApplicationsWithArguments: 0,
  directiveApplicationParents: {} as Record<string, number>,
  declarationContextApplications: 0,
  executableContextApplications: 0,
  otherContextApplications: 0,
  directiveDefinitions: 0,
  directiveDefinitionsWithArguments: 0,
  directiveDefinitionsWithImplementationBody: 0,
  directiveDefinitionsWithErrorChild: 0,
  directiveDefinitionChildPatterns: {} as Record<string, number>,
  customDirectiveDefinitions: 0,
  specDirectiveDefinitions: 0,
  applicationsDeclaredInSameDocument: 0,
  applicationsNamingAnyDeclaredDefinition: 0,
  applicationsNamingSpecBuiltin: 0,
  applicationsNamingUndeclaredDirective: 0,
  appliedDirectiveNames: new Map<string, number>(),
  declaredDirectiveNames: new Set<string>(),
  payloadShapingApplications: {} as Record<string, number>,
}

// renders
const rendersCounters = {
  operationDefinitions: 0,
  operationFiles: 0,
  fragmentDefinitions: 0,
  fragmentSpreads: 0,
  inlineFragments: 0,
  executableOnlyDocuments: 0,
  executableOnlyDocumentFiles: [] as string[],
  deferStreamApplications: 0,
}

// part_of
const partOfCounters = {
  comments: 0,
  importSites: 0,
  importFiles: [] as string[],
  importTargets: new Map<string, number>(),
  importForms: { barePath: 0, typedFrom: 0 } as Record<string, number>,
  importTargetsPresentOnDisk: 0,
  importTargetsSymbolShaped: 0,
  symbolShapedTargets: [] as { file: string; target: string }[],
  symbolShapedTargetsNamingDeclaredSymbol: 0,
  samples: [] as { file: string; line: number; text: string; target: string; present: boolean }[],
}

for (const f of files) {
  let root: any
  try {
    const tree = parser.parse(f.text)
    root = tree?.rootNode
  } catch {
    parseFailures++
    continue
  }
  if (!root) {
    parseFailures++
    continue
  }

  // ---- pass 1: this document's own top-level declarations (an extension's target may follow it)
  const declaredHere = new Map<string, Set<string>>()
  const declaredDirectivesHere = new Set<string>()
  {
    const stack: any[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()
      if (!n) continue
      if (DEF_SET.has(n.type)) {
        const nm = nameOf(n)
        if (nm) {
          allDeclaredNames.add(nm)
          const set = declaredHere.get(nm) ?? new Set<string>()
          set.add(DEF_KINDS[n.type])
          declaredHere.set(nm, set)
        }
      } else if (EXT_SET.has(n.type)) {
        const nm = nameOf(n)
        if (nm && !declaredHere.has(nm)) declaredHere.set(nm, new Set(["__extensionOnly__"]))
      } else if (n.type === "DirectiveDefinition") {
        const nm = nameOf(n)
        if (nm) declaredDirectivesHere.add(nm)
      }
      for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i))
    }
  }
  // extensions keyed by name are recorded in pass 1 so "declared only as an extension" is decidable;
  // the marker set stays separate from real declaration kinds.
  const kindOf = (nm: string): Set<string> | undefined => declaredHere.get(nm)

  // ---- pass 2: every construct, with its parent so applications/contexts are classifiable
  const hasTypeSystemDef = { value: false }
  let docOperations = 0
  let docFragments = 0
  const stack: any[] = [{ n: root, p: null, pp: null }]
  while (stack.length > 0) {
    const { n, p, pp } = stack.pop()
    if (!n) continue
    nodes++
    if (n.isNamed) namedTypes.set(n.type, (namedTypes.get(n.type) ?? 0) + 1)
    else anonTypes.set(n.type, (anonTypes.get(n.type) ?? 0) + 1)
    if (n.type === "extend") extendsCounters.extendsKeywordTokens++
    if (DEF_SET.has(n.type)) hasTypeSystemDef.value = true

    // ---- extends: the supertype clause
    if (n.type === "ImplementsInterfaces" && p?.type !== "ImplementsInterfaces") {
      const inner: any[] = [n]
      while (inner.length > 0) {
        const t = inner.pop()
        if (!t) continue
        if (t.type === "NamedType") {
          extendsCounters.implementsClauses++
          const nm = nameOf(t)
          const kinds = nm ? kindOf(nm) : undefined
          const real = kinds ? [...kinds].filter((k) => k !== "__extensionOnly__") : []
          if (!real.length) extendsCounters.implementsSupertypeNotDeclaredHere++
          else if (real.length > 1) extendsCounters.implementsSupertypeAmbiguousKindHere++
          else if (real[0] === "Interface") extendsCounters.implementsSupertypeInterfaceHere++
          else if (real[0] === "Class") {
            extendsCounters.implementsSupertypeObjectHere++
            extendsCounters.implementsConditionMet++
          } else {
            extendsCounters.implementsSupertypeUnionOrScalarHere++
            extendsCounters.implementsConditionMet++
          }
          continue
        }
        for (let i = (t.namedChildren ?? []).length - 1; i >= 0; i--) inner.push(t.namedChildren[i])
      }
    }
    // ---- extends: the schema-extension syntax, and what it carries
    if (n.type === "TypeSystemExtension") extendsCounters.typeSystemExtensions++
    if (n.type === "TypeExtension") extendsCounters.typeExtensions++
    if (n.type === "SchemaExtension") extendsCounters.schemaExtensions++
    if (EXT_SET.has(n.type)) {
      extendsCounters.extensionKinds[n.type] = (extendsCounters.extensionKinds[n.type] ?? 0) + 1
      const childTypes = new Set((n.namedChildren ?? []).map((c: any) => c?.type))
      if (n.type === "SchemaExtension") {
        // A schema extension adds ROOT OPERATIONS and directives to the SCHEMA — it names no type,
        // so it is not a candidate for an is-a / member-set edge at all. Counted so the two forms
        // are never silently added together (76+176 of the named form is the figure the prior
        // probe measured; the 95 schema extensions are a different construct).
        extendsCounters.schemaExtensionSites++
      } else {
        extendsCounters.typeExtensionSites++
        const nm = nameOf(n)
        const kinds = nm ? kindOf(nm) : undefined
        const real = kinds ? [...kinds].filter((k) => k !== "__extensionOnly__") : []
        if (real.length) extendsCounters.typeExtensionSitesDeclaredHere++
        else extendsCounters.typeExtensionSitesDeclaredElsewhere++
        if (EXT_MEMBER_NODES.some((t) => childTypes.has(t))) extendsCounters.typeExtensionSitesCarryingMembers++
        if (childTypes.has("ImplementsInterfaces")) extendsCounters.typeExtensionSitesCarryingImplements++
      }
    }

    // ---- decorates: directive definitions vs applications
    if (n.type === "DirectiveDefinition") {
      decoratesCounters.directiveDefinitions++
      const nm = nameOf(n)
      if (nm) decoratesCounters.declaredDirectiveNames.add(nm)
      if (nm && SPEC_DIRECTIVES.has(nm)) decoratesCounters.specDirectiveDefinitions++
      else decoratesCounters.customDirectiveDefinitions++
      const childTypes = new Set((n.namedChildren ?? []).map((c: any) => c?.type))
      if (childTypes.has("ArgumentsDefinition")) decoratesCounters.directiveDefinitionsWithArguments++
      // THE CALLABLE TEST, SECOND HALF: an implementation BODY. The grammar's directive_definition
      // has exactly Description?, `directive`, `@`, Name, ArgumentsDefinition?, `repeatable`?,
      // `on`, DirectiveLocations. Any other named child would be a body; the counter is implemented
      // so a grammar that ever adds one cannot leave it vacuous.
      // THE SIGNATURE VOCABULARY of a directive definition (GraphQL spec 3.13): Description?,
      // `directive`, `@`, Name, ArgumentsDefinition?, `repeatable`?, `on`, DirectiveLocations.
      // `Directives` is the grammar's wrapper for a directive list applied to the definition itself
      // (metadata on the signature) and is not an implementation body. Anything OCCURRING outside
      // this vocabulary is a body, and the pattern table is published so the classification is
      // checkable rather than asserted.
      // `ERROR` is the parser's recovery node (damage), never a body: it is counted separately so a
      // damaged definition cannot be read as an implemented one.
      if (childTypes.has("ERROR")) decoratesCounters.directiveDefinitionsWithErrorChild++
      const SIGNATURE = new Set(["Description", "Name", "ArgumentsDefinition", "DirectiveLocations", "Directives", "ERROR"])
      const pattern = [...childTypes].sort().join("+")
      decoratesCounters.directiveDefinitionChildPatterns[pattern] = (decoratesCounters.directiveDefinitionChildPatterns[pattern] ?? 0) + 1
      if ([...childTypes].some((t) => !SIGNATURE.has(t))) decoratesCounters.directiveDefinitionsWithImplementationBody++
    }
    if (n.type === "Directive") {
      decoratesCounters.directiveApplications++
      const nm = nameOf(n)
      if (nm) decoratesCounters.appliedDirectiveNames.set(nm, (decoratesCounters.appliedDirectiveNames.get(nm) ?? 0) + 1)
      if (nm && declaredDirectivesHere.has(nm)) decoratesCounters.applicationsDeclaredInSameDocument++
      const hasArgs = (n.namedChildren ?? []).some((c: any) => c?.type === "Arguments")
      if (hasArgs) decoratesCounters.directiveApplicationsWithArguments++
      // `Directives` is the grammar's wrapper around an application list; the context that matters
      // is the node the list is attached to, so the wrapper is transparent here.
      const effParent = p?.type === "Directives" ? pp : p
      const pt = effParent?.type ?? "(root)"
      decoratesCounters.directiveApplicationParents[pt] = (decoratesCounters.directiveApplicationParents[pt] ?? 0) + 1
      if (DECL_PARENTS.has(pt)) decoratesCounters.declarationContextApplications++
      else if (EXEC_PARENTS.has(pt)) decoratesCounters.executableContextApplications++
      else decoratesCounters.otherContextApplications++
      if (nm && PAYLOAD_DIRECTIVES.has(nm)) {
        decoratesCounters.payloadShapingApplications[nm] = (decoratesCounters.payloadShapingApplications[nm] ?? 0) + 1
        rendersCounters.deferStreamApplications++
      }
    }

    // ---- renders: executable request documents, the nearest construct to a component render
    if (n.type === "OperationDefinition") {
      rendersCounters.operationDefinitions++
      docOperations++
    }
    if (n.type === "FragmentDefinition") {
      rendersCounters.fragmentDefinitions++
      docFragments++
    }
    if (n.type === "FragmentSpread") rendersCounters.fragmentSpreads++
    if (n.type === "InlineFragment") rendersCounters.inlineFragments++

    // ---- part_of: the `#import` comment convention
    if (n.type === "comment") {
      partOfCounters.comments++
      const raw = String(n.text ?? "")
      if (/^#\s*import\b/.test(raw.trim())) {
        partOfCounters.importSites++
        if (partOfCounters.importFiles[partOfCounters.importFiles.length - 1] !== f.rel) partOfCounters.importFiles.push(f.rel)
        // GraphQL's two spellings: `#import "path"` and `#import Type from "path"` (graphql-tools).
        const m = raw.match(/from\s+['"]([^'"]+)['"]/) ?? raw.match(/['"]([^'"]+)['"]/)
        const target = m?.[1] ?? ""
        if (target) partOfCounters.importTargets.set(target, (partOfCounters.importTargets.get(target) ?? 0) + 1)
        if (/from\s+['"]/.test(raw)) partOfCounters.importForms.typedFrom++
        else partOfCounters.importForms.barePath++
        const present = target ? (() => { try { return statSync(path.resolve(f.dir, target)).isFile() } catch { return false } })() : false
        if (present) partOfCounters.importTargetsPresentOnDisk++
        // A GraphQL name is /[_A-Za-z][_0-9A-Za-z]*/ and cannot contain a dot or a separator: a path
        // target is therefore not symbol-shaped and no declaration can answer it.
        if (target && /^[_A-Za-z][_0-9A-Za-z]*$/.test(target)) {
          partOfCounters.importTargetsSymbolShaped++
          partOfCounters.symbolShapedTargets.push({ file: f.rel, target })
        }
        if (partOfCounters.samples.length < 8) {
          partOfCounters.samples.push({ file: f.rel, line: n.startPosition.row + 1, text: raw.slice(0, 60), target, present })
        }
      }
    }

    for (let i = n.childCount - 1; i >= 0; i--) stack.push({ n: n.child(i), p: n, pp: p })
  }
  rendersCounters.operationFiles += docOperations > 0 ? 1 : 0
  if ((docOperations > 0 || docFragments > 0) && !hasTypeSystemDef.value) {
    rendersCounters.executableOnlyDocuments++
    if (rendersCounters.executableOnlyDocumentFiles.length < 12) rendersCounters.executableOnlyDocumentFiles.push(f.rel)
  }
  root.tree?.delete?.()
}

// A symbol-shaped `#import` target is still not a SYMBOL unless something DECLARES it. The one
// corpus site (`shared`) is a graphql-import CONFIG ALIAS resolved by the tool, so it names no
// declaration; counted here rather than assumed.
partOfCounters.symbolShapedTargetsNamingDeclaredSymbol = partOfCounters.symbolShapedTargets.filter((t) => allDeclaredNames.has(t.target)).length

// ---------------------------------------------------------------- whole-population joins
// The callable test, cross-file half: an application can only name an IMPLEMENTATION if the
// population declares a directive definition with a body — measured above, per document. The names
// are joined here for the classification of application sites.
for (const [nm, count] of decoratesCounters.appliedDirectiveNames) {
  if (SPEC_DIRECTIVES.has(nm)) decoratesCounters.applicationsNamingSpecBuiltin += count
  else if (decoratesCounters.declaredDirectiveNames.has(nm)) decoratesCounters.applicationsNamingAnyDeclaredDefinition += count
  else decoratesCounters.applicationsNamingUndeclaredDirective += count
}

// Control: the counters that must be able to fire. A census whose zeros come from dead instrument
// paths is indistinguishable from a language with no construct, so every ruling counter carries a
// live near-miss control beside it.
const controls = {
  extends: {
    implementsClauses: extendsCounters.implementsClauses,
    extendsKeywordTokens: extendsCounters.extendsKeywordTokens,
    typeExtensionSites: extendsCounters.typeExtensionSites,
    fires: extendsCounters.implementsClauses > 0 && extendsCounters.typeExtensionSites > 0,
  },
  decorates: {
    directiveApplications: decoratesCounters.directiveApplications,
    directiveDefinitions: decoratesCounters.directiveDefinitions,
    fires: decoratesCounters.directiveApplications > 0 && decoratesCounters.directiveDefinitions > 0,
  },
  renders: {
    operationDefinitions: rendersCounters.operationDefinitions,
    fragmentDefinitions: rendersCounters.fragmentDefinitions,
    fires: rendersCounters.operationDefinitions > 0,
  },
  mixes_in: {
    typeExtensionSitesCarryingMembers: extendsCounters.typeExtensionSitesCarryingMembers,
    typeExtensionSitesCarryingImplements: extendsCounters.typeExtensionSitesCarryingImplements,
    fires: extendsCounters.typeExtensionSitesCarryingMembers > 0,
  },
  part_of: {
    importSites: partOfCounters.importSites,
    comments: partOfCounters.comments,
    fires: partOfCounters.importSites > 0,
  },
  grammarInventory: {
    declaredTypes: declaredTypes.size,
    stems: grammarStems,
    // The grammar produces `*Extension`, `ImplementsInterfaces` and `Directive` nodes — the near-miss
    // vocabulary is LIVE, which is what makes the absent stems a measurement rather than a dead list.
    fires: declaredTypes.has("Directive") && declaredTypes.has("ImplementsInterfaces") && [...declaredTypes].some((t) => t.endsWith("Extension")),
  },
}

const sortCounts = (m: Map<string, number>): Record<string, number> =>
  Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))

const artefact = {
  schemaVersion: 1,
  kind: "m14-graphql-extended-census",
  lane: "graphql",
  generatedAt: new Date().toISOString(),
  producedBy: "validation/m14/fixtures/graphql/extended-census.mts",
  corpusRoot: CR,
  population: {
    admittedFiles: files.length,
    repositories: repos.size,
    excluded,
    note: "the arbiter's own discovery loop: git-tracked, detectLanguageFromPath === graphql, at or under the 1 MB FULL_AST_LIMIT cap",
  },
  grammar: {
    wasm: "wasm/tree-sitter-graphql.wasm",
    abi: language.abiVersion,
    nodes,
    parseFailures,
    declaredTypes: declaredTypes.size,
    observedNamedTypes: sortCounts(namedTypes),
    observedAnonymousTokens: sortCounts(anonTypes),
    stems: grammarStems,
  },
  extends: {
    grammarHalf:
      "the wired build declares 142 node types; its only supertype production is ImplementsInterfaces (published as `implements`), and the schema-extension syntax HAS productions (TypeSystemExtension > TypeExtension > ObjectTypeExtension/…, SchemaExtension). No inheritance production exists; `extend` is member addition, not a supertype clause.",
    corpusHalf: {
      ...extendsCounters,
      extensionKinds: Object.fromEntries(Object.entries(extendsCounters.extensionKinds).sort()),
    },
    discriminator:
      "an extension ADDS MEMBERS to the SAME type: no second type is declared, no supertype is named, no file is included. It is therefore neither `extends` (no is-a), nor `mixes_in` (no distinct member-set provider composed into a supertype chain), nor `part_of` (no file inclusion). The members are published as `contains` with metadata.extension/inExtension, and the extension block itself is anonymous.",
    falsifier: {
      run: "npx tsx validation/m14/fixtures/graphql/extended-census.mts — re-read this artefact's extends.corpusHalf.implementsConditionMet and extension site counts",
      wouldFail:
        "implementsConditionMet >= 1 (a document in which an implements clause names a supertype the SAME document declares as an object/input/union/scalar — the analyzer's `extends` branch would then emit an edge), or an extension site composing a distinct NAMED member-set provider into a supertype chain (an is-a/member-set composition the analyzer does not publish).",
    },
  },
  decorates: {
    grammarHalf:
      "the wired build declares Directive and DirectiveDefinition productions, so directive syntax is grammar-expressible; what it does not declare is any body/implementation production inside a DirectiveDefinition.",
    counts: {
      directiveApplications: decoratesCounters.directiveApplications,
      directiveApplicationsWithArguments: decoratesCounters.directiveApplicationsWithArguments,
      declarationContextApplications: decoratesCounters.declarationContextApplications,
      executableContextApplications: decoratesCounters.executableContextApplications,
      otherContextApplications: decoratesCounters.otherContextApplications,
      directiveApplicationParents: Object.fromEntries(Object.entries(decoratesCounters.directiveApplicationParents).sort((a, b) => b[1] - a[1])),
      directiveDefinitions: decoratesCounters.directiveDefinitions,
      directiveDefinitionsWithArguments: decoratesCounters.directiveDefinitionsWithArguments,
      directiveDefinitionsWithImplementationBody: decoratesCounters.directiveDefinitionsWithImplementationBody,
      directiveDefinitionsWithErrorChild: decoratesCounters.directiveDefinitionsWithErrorChild,
      directiveDefinitionChildPatterns: decoratesCounters.directiveDefinitionChildPatterns,
      customDirectiveDefinitions: decoratesCounters.customDirectiveDefinitions,
      specDirectiveDefinitions: decoratesCounters.specDirectiveDefinitions,
      distinctAppliedDirectiveNames: decoratesCounters.appliedDirectiveNames.size,
      distinctDeclaredDirectiveNames: decoratesCounters.declaredDirectiveNames.size,
      applicationsDeclaredInSameDocument: decoratesCounters.applicationsDeclaredInSameDocument,
      applicationsNamingAnyDeclaredDefinition: decoratesCounters.applicationsNamingAnyDeclaredDefinition,
      applicationsNamingSpecBuiltin: decoratesCounters.applicationsNamingSpecBuiltin,
      applicationsNamingUndeclaredDirective: decoratesCounters.applicationsNamingUndeclaredDirective,
      payloadShapingApplications: decoratesCounters.payloadShapingApplications,
    },
    callableTest:
      "an application names a directive DEFINITION, and a directive definition IS declared with arguments (" +
      String(decoratesCounters.directiveDefinitionsWithArguments) +
      " of " +
      String(decoratesCounters.directiveDefinitions) +
      "). But the composer side — the implementation — is NOT in the document: " +
      String(decoratesCounters.directiveDefinitionsWithImplementationBody) +
      " of " +
      String(decoratesCounters.directiveDefinitions) +
      " definitions carry a body. So an application names a SIGNATURE/contract the server implements elsewhere, not an applied callable declared in the graph. That is exactly the csharp attribute case the fleet ruled ONTOLOGICAL (a decorator is an applied callable; an attribute is passive metadata).",
    falsifier: {
      run: "npx tsx validation/m14/fixtures/graphql/extended-census.mts — re-read decorates.counts.directiveDefinitionsWithImplementationBody and applicationsNamingAnyDeclaredDefinition",
      wouldFail:
        "directiveDefinitionsWithImplementationBody >= 1 (a directive definition carrying a body, i.e. an applied callable declared in the document), or a corpus site where a directive application is accompanied by an implementation body the analyzer can resolve to — either would retire the ontological ruling and return `decorates` to the denominator.",
    },
  },
  renders: {
    grammarHalf: {
      stems: grammarStems.renders,
      reading: "0 of the wired build's declared node types is a component/element render production.",
    },
    nearMisses: {
      operationDefinitions: rendersCounters.operationDefinitions,
      operationFiles: rendersCounters.operationFiles,
      fragmentDefinitions: rendersCounters.fragmentDefinitions,
      fragmentSpreads: rendersCounters.fragmentSpreads,
      inlineFragments: rendersCounters.inlineFragments,
      executableOnlyDocuments: rendersCounters.executableOnlyDocuments,
      executableOnlyDocumentSamples: rendersCounters.executableOnlyDocumentFiles,
      deferStreamApplications: rendersCounters.deferStreamApplications,
      reading:
        "an executable operation is a REQUEST document (including persisted-query-style executable-only documents); a fragment/inline fragment is a selection, and @defer/@stream shape a payload. None constructs a component element naming a declared component — which is the contract's shape (Renders: target = the rendered COMPONENT).",
    },
    falsifier: {
      run: "npx tsx validation/m14/fixtures/graphql/extended-census.mts — re-read renders.nearMisses and renders.grammarHalf.stems",
      wouldFail:
        "a corpus site where an element/component construct names a DECLARED component, or a component/element/render node type in the served build. Either retires the ruling and returns `renders` to the denominator.",
    },
  },
  mixes_in: {
    grammarHalf: {
      stems: grammarStems.mixes_in,
      extensionStems: grammarStems.extensionAndSupertype,
      reading:
        "the build declares NO mixin/trait/with-clause/member-set production. It DOES declare the extension productions and ImplementsInterfaces, which is why the near miss is measured rather than waved away.",
    },
    nearMisses: {
      typeExtensionSites: extendsCounters.typeExtensionSites,
      typeExtensionSitesDeclaredHere: extendsCounters.typeExtensionSitesDeclaredHere,
      typeExtensionSitesDeclaredElsewhere: extendsCounters.typeExtensionSitesDeclaredElsewhere,
      schemaExtensionSites: extendsCounters.schemaExtensionSites,
      typeExtensionSitesCarryingMembers: extendsCounters.typeExtensionSitesCarryingMembers,
      typeExtensionSitesCarryingImplements: extendsCounters.typeExtensionSitesCarryingImplements,
      implementsClauses: extendsCounters.implementsClauses,
      reading:
        "an extension block is ANONYMOUS: it declares no type that could be the composing source, and it composes no DISTINCT member-set provider — its members belong to the extended type itself and are published as `contains`. `implements` is conformance (published as `implements`). 0 sites compose a named member set into a supertype chain, which is what `mixes_in` means.",
    },
    falsifier: {
      run: "npx tsx validation/m14/fixtures/graphql/extended-census.mts — re-read mixes_in.nearMisses",
      wouldFail:
        "an extension site composing a DISTINCT NAMED member-set provider into a supertype chain (a type whose supertype list names another type as a member-set provider), or a mixin/trait/member-set production in the served build.",
    },
  },
  part_of: {
    grammarHalf: {
      stems: grammarStems.part_of,
      reading:
        "the build declares no include/import/part/paste production. `#import` is a COMMENT convention: the grammar produces a `comment` node whose text is English, and the lane's analyzer reads the convention and publishes it as `imports` (170 whole-population edges).",
    },
    counts: {
      comments: partOfCounters.comments,
      importSites: partOfCounters.importSites,
      importFiles: new Set(partOfCounters.importFiles).size,
      distinctTargets: partOfCounters.importTargets.size,
      forms: partOfCounters.importForms,
      targetsPresentOnDisk: partOfCounters.importTargetsPresentOnDisk,
      targetsSymbolShaped: partOfCounters.importTargetsSymbolShaped,
      symbolShapedTargetSites: partOfCounters.symbolShapedTargets,
      symbolShapedTargetSitesNamingDeclaredSymbol: partOfCounters.symbolShapedTargetsNamingDeclaredSymbol,
      declaredSymbolNamesInPopulation: allDeclaredNames.size,
      samples: partOfCounters.samples,
      topTargets: Object.fromEntries(Object.entries(sortCounts(partOfCounters.importTargets)).slice(0, 20)),
    },
    falsifier: {
      run: "npx tsx validation/m14/fixtures/graphql/extended-census.mts — re-read part_of.counts.importSites and targetsSymbolShaped",
      wouldFail:
        "a corpus site where the inclusion target is a SYMBOL (a GraphQL name, not a file path) and the construct shares the including unit's scope — or a served build declaring an include/paste node type. Either retires the ruling and returns `part_of` to the denominator.",
    },
  },
  controls,
}

writeFileSync(OUT, JSON.stringify(artefact, null, 2) + "\n")

const c = extendsCounters
console.log(`graphql extended census — ${files.length} admitted files (${repos.size} repos), ${nodes.toLocaleString()} nodes, ${parseFailures} parse failure(s)`)
console.log(`  grammar            : ${declaredTypes.size} declared types`)
console.log(`  extends            : implements clauses ${c.implementsClauses.toLocaleString()} (${c.implementsSupertypeInterfaceHere.toLocaleString()} interface-here, ${c.implementsConditionMet} inheritance-shaped-here) · extension sites ${c.typeExtensionSites} type extensions (${c.typeExtensionSitesDeclaredHere} same-doc / ${c.typeExtensionSitesDeclaredElsewhere} declared-elsewhere) + ${c.schemaExtensionSites} schema extensions · extend tokens ${c.extendsKeywordTokens}`)
console.log(`  decorates          : ${decoratesCounters.directiveApplications.toLocaleString()} applications (${decoratesCounters.declarationContextApplications.toLocaleString()} on declarations) · ${decoratesCounters.directiveDefinitions} definitions (${decoratesCounters.directiveDefinitionsWithArguments} with args, ${decoratesCounters.directiveDefinitionsWithImplementationBody} with a body) · ${decoratesCounters.appliedDirectiveNames.size} distinct applied names`)
console.log(`  renders            : ${rendersCounters.operationDefinitions.toLocaleString()} operations / ${rendersCounters.operationFiles} files · ${rendersCounters.executableOnlyDocuments} executable-only docs · ${rendersCounters.deferStreamApplications} @defer/@stream`)
console.log(`  mixes_in           : ${c.typeExtensionSites} type extension sites, ${c.typeExtensionSitesCarryingMembers} carrying members, ${c.typeExtensionSitesCarryingImplements} carrying implements`)
console.log(`  part_of            : ${partOfCounters.importSites} #import sites / ${new Set(partOfCounters.importFiles).size} files · ${partOfCounters.importTargetsPresentOnDisk} targets present · ${partOfCounters.importTargetsSymbolShaped} symbol-shaped`)
console.log(`  controls           : ${Object.entries(controls).filter(([, v]: any) => v.fires === false).map(([k]) => k).join(", ") || "all fire"}`)
console.log(`  artefact           : ${path.relative(REPO_ROOT, OUT)}`)
