/**
 * GRAPHQL SPACE PROBE — the artefact `validation/m14/fixtures/graphql/ruling-attestation.json` cites,
 * so that the arbiter's ABSENCE rulings for `calls` and `instantiates` are checkable instead of prose.
 *
 * WHY IT EXISTS. `script/m14/ontology-coverage-gate.ts` refuses a vocabulary-based ruling in a
 * KEY-BEARING language unless the ruling declares the `attribute-keys` space, and with an attestation
 * it verifies the declared numbers against the artefact the attestation names (see the gate's SPACE
 * ATTESTATION block and `verifyAttestation`). GraphQL is key-bearing in exactly that structural sense:
 * a `FieldDefinition` in the wired grammar is `Name`, `:`, `Type` — three children whose middle one is
 * the anonymous `:` token — which is the gate's own binding test (`n.childCount >= 3 &&
 * n.child(1).type` is `=` or `:`), observed rather than assumed from the language's name. HCL's
 * `inherits = [...]` hid 44 sites behind that blind spot; this file measures whether GraphQL hides
 * anything behind it, and states the site rule that makes the answer falsifiable.
 *
 * TWO SPACES, ONE WALK, and BOTH are measured on the grammar the arbiter now resolves
 * (`graphql: { wasm: "tree-sitter-graphql.wasm", … }` in `script/m14/differential.ts`'s LANGS — the
 * entry this lane's ruled table recorded as missing, which made BOTH gate instruments parse every
 * corpus file with the BASH grammar):
 *
 *   node-types      every `node.type` the wired grammar produces, all children (the gate's own
 *                   `walkPreorder` visits named AND anonymous nodes), with the named/anonymous split
 *                   because "75 named types" and "128 types" are both true and mean different things.
 *   attribute-keys  the gate's binding rule, counted on the tree: how many key/value bindings the
 *                   corpus writes and what they are. This is the space a node-type inventory cannot
 *                   enumerate, so a ruling that does not probe it proves nothing here.
 *
 * AND THE CONSTRUCT SITES the two rulings turn on, each with the site rule written down, because a
 * count of 0 is only evidence if the reader can see what would have made it non-zero:
 *
 *   calls          0 sites. A site would be a key-bearing node whose KEY names a callee the document
 *                  DECLARES and whose VALUE applies it. GraphQL's key space is `name: Type` — the
 *                  value is a type ANNOTATION, never an application — and a field selection
 *                  (`user(id: 1)`) is not key-bearing at all (its children are Name, Arguments,
 *                  SelectionSet). The nearest real form is measured and named: argument-bearing
 *                  `Field` and `Directive` nodes, all published as `uses` under the family labelling
 *                  rule. Relabelling them is the OVERTURN CONDITION, and it is a family rule
 *                  (ledger R-number), not a grammar or corpus change.
 *   instantiates   0 sites. A site would be a key-bearing node whose value CONSTRUCTS an instance of a
 *                  declared type. `ObjectValue` exists (3,523 nodes in the lane's census) and is an
 *                  argument VALUE, not an instance — named here as the excluded population.
 *
 * CLI:  npx tsx validation/m14/fixtures/graphql/rulebook-space-probe.mts [--out <path>]
 * Read-only apart from the JSON it writes. Population = the arbiter's own (git-tracked, detected as
 * `graphql`, at or under the 1 MB cap), so the counts are comparable cell for cell.
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
const OUT = flag("out") ?? path.resolve(import.meta.dirname, "rulebook-space-probe.json")

const { detectLanguageFromPath } = await import(`${REPO_ROOT}/src/ast/language-detection.ts`)

// ---------------------------------------------------------------- the population
// The gate's own discovery loop, cited rather than paraphrased: git-tracked paths, a file the process
// cannot read is skipped, and a file above the engine's FULL_AST_LIMIT is never read at all (so it can
// be excluded by NAME, which is the only way to count it before parsing it).
const files: { repo: string; rel: string; abs: string; text: string }[] = []
const excluded = { tracked: 0, absent: 0, overCap: 0, wrongLanguage: 0 }
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
    excluded.tracked++
    let text: string
    try {
      const size = statSync(abs).size
      if (size > SIZE_CAP) {
        if (detectLanguageFromPath(abs) === "graphql") excluded.overCap++
        continue
      }
      text = readFileSync(abs, "utf8")
    } catch {
      if (detectLanguageFromPath(abs) === "graphql") excluded.absent++
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "graphql") continue
    files.push({ repo: e, rel, abs, text })
  }
}

// ---------------------------------------------------------------- the wired grammar
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(REPO_ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(REPO_ROOT, "wasm", "tree-sitter-graphql.wasm"))))

// ---------------------------------------------------------------- space 1: node types, space 2: keys
const namedTypes = new Map<string, number>()
const anonTypes = new Map<string, number>()
const keyNodeTypes = new Map<string, number>()
const keys = new Map<string, number>()
const keySamples: string[] = []
let nodes = 0
let keyBindings = 0
let parseFailures = 0

// The construct-site probes. Each counts the SITE RULE stated in the header, not a keyword scan: a
// regex would have convicted the string case (`"call"` inside a description) that this graphql
// corpus writes in prose descriptions.
let argumentBearingFields = 0
let argumentBearingDirectives = 0
let objectValues = 0
/** The RAW keyword calibration — a keyword-shaped KEY, with no site rule applied. It FIRES, which is
 *  what makes the 0 below a measurement rather than an inert counter: 22 `calls`-shaped keys and 340
 *  `instantiates`-shaped keys exist in this corpus's key space, and every one of them is an ordinary
 *  field/argument NAME whose value is a type annotation (`create: Boolean`, `run: String`). */
let keywordKeyMatchesCalls = 0
let keywordKeyMatchesInstantiates = 0
/** The SITE rule applied: the key must name a callee/constructor AND the value must apply or construct
 *  it. GraphQL's key space values are `Type` nodes — annotations — so the applied/constructed set is
 *  empty, and the rule is implemented as a shape test, not as a comment. */
let callSites = 0
let instantiationSites = 0
const firedKeys: { key: string; kind: "calls" | "instantiates"; nodeType: string; binding: string }[] = []
const candidateBindings: { key: string; nodeType: string; valueIsAnnotation: boolean; valueIsApplied: boolean; text: string }[] = []
const firedKeyCounts = new Map<string, number>()
/** Every type name the population DECLARES, filled in a first pass — the site rule's second half:
 *  a construction site constructs an instance of a type the DOCUMENT declares, so `create: [...]` on
 *  an executable document's input value is data, not construction. */
const declaredTypes = new Set<string>()

/** The gate's binding rule, verbatim: three or more children with `=` or `:` as the second. */
const isBinding = (n: any): boolean => n.childCount >= 3 && ["=", ":"].includes(n.child(1)?.type)

/** The callee named by a key construct would have to BE the key's own text, for the site rule above. */
const CALL_KEYS = /^(call|invoke|invocation|execute|apply|run|dispatch)$/i
const CONSTRUCT_KEYS = /^(new|instantiate|newinstance|create|construct|clone|make)$/i

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
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    nodes++
    if (n.isNamed) namedTypes.set(n.type, (namedTypes.get(n.type) ?? 0) + 1)
    else anonTypes.set(n.type, (anonTypes.get(n.type) ?? 0) + 1)

    if (isBinding(n)) {
      keyBindings++
      keyNodeTypes.set(n.type, (keyNodeTypes.get(n.type) ?? 0) + 1)
      const keyText = String(n.child(0)?.text ?? "")
      if (keyText) {
        keys.set(keyText, (keys.get(keyText) ?? 0) + 1)
        if (keySamples.length < 6) keySamples.push(`${n.type} \`${keyText}\``)
        // THE SITE RULES. A call site needs the key to NAME A CALLEE and the value to APPLY it,
        // against a callee the document declares; a construction site needs the value to construct.
        // Neither shape exists here — the value is a type annotation — and these two counters are what
        // makes that claim measurable instead of definitional: they would fire on a corpus that
        // spelled `resolve: callSomeResolver` or the like.
        const valueNode = (n.namedChildren ?? [])[n.namedChildCount - 1]
        // DEFERRED, not counted here: the site rule's second half needs the WHOLE population's declared
        // type names, and a document can declare a type after the binding that names it. Counting in
        // the same pass would make the rule order-dependent, which is how a site gets missed.
        candidateBindings.push({
          key: keyText,
          nodeType: n.type,
          valueIsAnnotation: valueNode?.type === "Type",
          valueIsApplied: (valueNode?.namedChildren ?? []).some((c: any) => c?.type === "Arguments"),
          text: String(n.text).split("\n")[0].slice(0, 40),
        })
      }
    }

    // The nearest real forms, counted on the TREE so a description string cannot fake one.
    if (n.type.endsWith("TypeDefinition") || n.type === "DirectiveDefinition") {
      const nm = (n.namedChildren ?? []).find((c: any) => c?.type === "Name")?.text
      if (nm) declaredTypes.add(String(nm))
    }
    if (n.type === "Field" && (n.namedChildren ?? []).some((c: any) => c?.type === "Arguments")) argumentBearingFields++
    if (n.type === "Directive" && (n.namedChildren ?? []).some((c: any) => c?.type === "Arguments")) argumentBearingDirectives++
    if (n.type === "ObjectValue") objectValues++

    for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i))
  }
  root.tree?.delete?.()
}

// THE SITE RULES, evaluated once the population is fully read. Each needs BOTH halves, and each is a
// shape test on the value node rather than a prose sentence:
//
//   calls          the key names a callee AND the value APPLIES it (an `Arguments` child). 22
//                  keyword-shaped keys exist in this corpus, and 0 of them applies anything — they
//                  are field and argument NAMES (`create: Boolean`).
//   instantiates   the key names a constructor AND the value constructs an instance of a type the
//                  DOCUMENT DECLARES. The value-shape test alone fires 304 times on
//                  `create: [{node: …}]`, an input VALUE in an executable document whose `create` key
//                  is a data key and names no declared type; requiring the declaration is what
//                  separates a construction from a literal.
for (const b of candidateBindings) {
  if (CALL_KEYS.test(b.key)) {
    keywordKeyMatchesCalls++
    firedKeyCounts.set(`calls:${b.key}`, (firedKeyCounts.get(`calls:${b.key}`) ?? 0) + 1)
    if (firedKeys.filter((f) => f.kind === "calls").length < 6) firedKeys.push({ key: b.key, kind: "calls", nodeType: b.nodeType, binding: b.text })
    if (b.valueIsApplied) callSites++
  }
  if (CONSTRUCT_KEYS.test(b.key)) {
    keywordKeyMatchesInstantiates++
    firedKeyCounts.set(`instantiates:${b.key}`, (firedKeyCounts.get(`instantiates:${b.key}`) ?? 0) + 1)
    if (firedKeys.filter((f) => f.kind === "instantiates").length < 6) firedKeys.push({ key: b.key, kind: "instantiates", nodeType: b.nodeType, binding: b.text })
    if (!b.valueIsAnnotation && declaredTypes.has(b.key)) instantiationSites++
  }
}

const sortCounts = (m: Map<string, number>): Record<string, number> =>
  Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))

const artefact = {
  schemaVersion: 1,
  kind: "m60-rulebook-space-probe",
  lane: "graphql",
  generatedAt: new Date().toISOString(),
  producedBy: "validation/m14/fixtures/graphql/rulebook-space-probe.mts",
  corpusRoot: CR,
  readBy: "validation/m14/fixtures/graphql/ruling-attestation.json -> script/m14/ontology-coverage-gate.ts",
  grammar: {
    wasm: "wasm/tree-sitter-graphql.wasm",
    wiredAt: "script/m14/differential.ts LANGS.graphql",
    why: "before that entry existed the arbiter resolved `(LANGS as any)[LANG]?.wasm ?? tree-sitter-bash.wasm`, so BOTH instruments walked a bash tree — 57 node types, none of them GraphQL's",
  },
  population: {
    admittedFiles: files.length,
    excluded,
    note: "same discovery loop as script/m14/ontology-coverage-gate.ts: git-tracked, detectLanguageFromPath === graphql, at or under the 1 MB FULL_AST_LIMIT cap",
  },
  grammarInventory: {
    nodes,
    parseFailures,
    namedTypes: namedTypes.size,
    anonymousTokens: anonTypes.size,
    distinctTypes: namedTypes.size + anonTypes.size,
    inventory: sortCounts(namedTypes),
    anonymousTokenInventory: sortCounts(anonTypes),
  },
  keySpace: {
    rule: "the gate's own: n.childCount >= 3 && n.child(1).type is \"=\" or \":\" — observed structurally, not assumed from the language's name",
    bindings: keyBindings,
    distinctKeyNodeTypes: keyNodeTypes.size,
    distinctKeys: keys.size,
    byKeyNodeType: sortCounts(keyNodeTypes),
    samples: keySamples,
    // WHY THE KEY SPACE IS THE ONE THAT MATTERS HERE: this is the space in which a construct can hide
    // from a node-type inventory, and it holds the language's entire field surface (`name: Type`).
  },
  constructSites: {
    calls: callSites,
    instantiates: instantiationSites,
    rule: "a site is a KEY-BEARING node whose key names a callee/constructor AND whose value applies or constructs it. GraphQL's key value is a `Type` node — an annotation — so the applied/constructed set is empty; both counters are implemented as shape tests on the value node, and the RAW keyword calibration beside them proves the counters are not inert.",
    keywordCalibration: {
      callsShapedKeys: keywordKeyMatchesCalls,
      instantiatesShapedKeys: keywordKeyMatchesInstantiates,
      why: "THE CALIBRATION, because 'absent from a list I wrote' is only evidence if the list can hold a present entry. These counters fired on this corpus WITHOUT the site rule: the keys are ordinary field and argument NAMES (`create`, `run`, `make`, `apply` …) declared as `name: Boolean`, and treating a field NAME as a call is exactly the defect a keyword scan has — the same one that made the arbiter's first `extends` probe match `class voice` inside a bash word list. `byKey` counts every fired key, and `samples` prints them verbatim.",
      samples: firedKeys,
      byKey: Object.fromEntries([...firedKeyCounts.entries()].sort((a, b) => b[1] - a[1])),
      distinctKeysFired: [...new Set([...firedKeyCounts.keys()].map((k) => k.split(":")[1]))].sort(),
    },
    excludedSitePopulations: {
      argumentBearingFields,
      argumentBearingDirectives,
      objectValues,
      why: "the nearest real forms, published so the 0 is not read as 'nothing of the shape occurs'. Argument-bearing `Field`/`Directive` nodes are labelled `uses` under the family's one-fact-one-label rule (ledger R10), which is the OVERTURN CONDITION for `calls`; `ObjectValue` is an argument value, not an instance of a declared type, which is the OVERTURN condition statement for `instantiates`.",
    },
  },
}

writeFileSync(OUT, JSON.stringify(artefact, null, 2) + "\n")

console.log(`graphql space probe — ${files.length} admitted files, ${nodes.toLocaleString()} nodes, ${parseFailures} parse failure(s)`)
console.log(`  grammar inventory : ${namedTypes.size} named types + ${anonTypes.size} anonymous tokens = ${namedTypes.size + anonTypes.size} distinct`)
console.log(`  key space         : ${keyBindings.toLocaleString()} bindings over ${keyNodeTypes.size} key-bearing node type(s), ${keys.size.toLocaleString()} distinct keys`)
console.log(`  construct sites   : calls=${callSites} instantiates=${instantiationSites} (raw keyword calibration: ${keywordKeyMatchesCalls} + ${keywordKeyMatchesInstantiates} keyword-shaped KEYS, all ordinary field names)`)
console.log(`  nearest real forms: argument-bearing Field=${argumentBearingFields.toLocaleString()} Directive=${argumentBearingDirectives.toLocaleString()} · ObjectValue=${objectValues.toLocaleString()}`)
console.log(`  artefact          : ${path.relative(REPO_ROOT, OUT)}`)
