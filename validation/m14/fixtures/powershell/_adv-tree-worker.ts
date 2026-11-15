/**
 * Shard worker for the TREE half of `adversarial-probes.ts` (probes P1 and P7).
 *
 * Reads a newline-separated file list, parses each file with the SAME pinned wasm
 * the engine loads (`wasm/tree-sitter-powershell.wasm`, resolved through
 * `resolveWasmAsset`), and writes the two per-file facts the tree probes need:
 *
 *   classes  every `class_statement` with its positional `simple_name` header and
 *            every member it declares, carrying the member's `hidden` / `static`
 *            attribute state. This is the population probe P1 counts on.
 *   shapes   the child-type sequence of every `class_statement` header, so the
 *            inventory is over the WHOLE population and not a sample.
 *
 * Why a worker: `parser.parse()` is synchronous WASM and cannot be interrupted
 * from the event loop, so one pathological file hangs a single process forever.
 * The census found the file that does it — `fsharp/eng/release/scripts/
 * GetAssemblyVersions.ps1` reports `memory access out of bounds` in this wasm —
 * and this probe reads the tree directly, with no engine timer above it. Sharding
 * keeps that blast radius to one shard and the run reports it rather than
 * dropping it.
 */
import { readFileSync, writeFileSync } from "node:fs"
import type { Node } from "web-tree-sitter"
import { getParser } from "../../../../src/ast/engine"

const [listFile, outFile] = process.argv.slice(2)
const files = readFileSync(listFile, "utf8").split("\n").filter(Boolean)

// `getParser` from src/ast/engine.ts, NOT a hand-rolled `Language.load`. The first
// version of this worker built its own parser from `loadWebTreeSitter()` plus
// `resolveWasmAsset`, and all ten shards died with
// `TypeError: Cannot read properties of undefined (reading 'loadWebAssemblyModule')`
// at tree-sitter.js:2049 — web-tree-sitter's emscripten glue is only wired up by
// the engine's own init path (core wasm resolved to an absolute path, registry
// bytes handed in), so `Language.load` outside it has no runtime to load into.
//
// That failure is worth recording rather than only fixing: the probe REPORTED
// `hiddenClassMembersOnCorpus: 0` and `sameNameDerivedBasePairs: 0` from those ten
// dead shards, which is precisely the "empty result over a non-empty corpus is a
// failed check, not a pass" shape the honesty contract §5.4 refuses. A zero from
// an instrument that never ran is not a measurement, so the shard-failure count is
// printed beside every tree number and the population size is asserted.
const parser = await getParser("powershell")
if (parser.parse("class A { }").rootNode.type !== "program") {
  console.error("[ADV-TREE] the parser did not load — every tree number below would be a false zero")
  process.exit(2)
}

const childTypes = (n: Node): string[] => {
  const out: string[] = []
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c) out.push(c.type)
  }
  return out
}
const childTexts = (n: Node, type: string): string[] => {
  const out: string[] = []
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && c.type === type) out.push(c.text)
  }
  return out
}
const firstChildOfType = (n: Node, type: string): Node | null => {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && c.type === type) return c
  }
  return null
}
const walk = (root: Node, types: Set<string>, visit: (n: Node) => void): void => {
  const stack: Node[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (types.has(n.type)) visit(n)
    for (let i = n.childCount - 1; i >= 0; i--) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
}
/** Every `attribute` node text under a member, concatenated. */
const attributeText = (n: Node): string => {
  const parts: string[] = []
  walk(n, new Set(["attribute"]), (a) => parts.push(a.text))
  return parts.join(" ")
}
const enclosingClass = (n: Node): string => {
  let cur: Node | null = n
  while (cur) {
    if (cur.type === "class_statement") return childTexts(cur, "simple_name")[0] ?? ""
    cur = cur.parent
  }
  return ""
}

type MemberRec = { name: string; nodeType: string; hidden: boolean; static: boolean; line: number; headerShape: string; splitNamePrefix: string }
type ClassRec = { name: string; base: string; ifaces: string[]; line: number; members: MemberRec[] }

/**
 * PS27 — the child-type sequence of a class member's HEADER, and the `class_attribute`
 * that follows its type node.
 *
 * A PowerShell class member is `[modifiers] [type] Name(...)` or `[modifiers] [type] $Name { }`,
 * and a modifier — `static`, `hidden` — is a `class_attribute` BEFORE the type. The pinned
 * local-rebuild wasm mis-lexes a member with NO leading modifier whose NAME begins with
 * those same letters: `[int] StaticOpen() { return 40 }` parses as
 *
 *   attribute "[int]" · class_attribute "Static" · simple_name "Open"
 *
 * so the published name is the SUFFIX. `[int] Hidden() { … }` and `[int] Static2() { … }`
 * are worse: the same split leaves an ERROR where the parameter list and body were, and
 * the damage reaches the NEXT class header.
 *
 * This is a GRAMMAR defect, not an analyzer one — the split is in the tree. What the
 * analyzer does with it is the analyzer's business, so the shape and the split prefix
 * are recorded per member and the probe counts them across the whole corpus rather than
 * asserting the corpus is clean.
 */
const memberHeader = (n: Node): { shape: string; splitNamePrefix: string } => {
  const shape: string[] = []
  const named: { type: string; text: string }[] = []
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (!c || !c.isNamed) continue
    shape.push(c.type)
    named.push({ type: c.type, text: c.text })
  }
  // The split needs BOTH halves, and the first version of this probe had only the
  // first: a `class_attribute` AFTER a type node was read as a name prefix, which
  // found `class C7b { [hashtable] static $x; }` in
  // powershell/test/powershell/Language/Classes/Scripting.Classes.BasicParsing
  // .Tests.ps1:35 and reported it as a split member named `staticx`. It is not a
  // split — the test file's own comment two lines above says "order doesn't
  // matter" — and following that probe would have regressed a real case.
  //
  // The second half is what separates them. In a SPLIT header the `class_attribute`
  // is followed by the `simple_name` that is the REST of the name:
  //
  //   [int] StaticOpen()  ->  attribute "[int]" · class_attribute "Static" · simple_name "Open"
  //   [hashtable] static $x  ->  attribute "[hashtable]" · class_attribute "static" · variable "$x"
  //
  // Both are `attribute · class_attribute · X`, and X is the discriminator: a
  // method name is a `simple_name`, a property name is a `variable`. A genuine
  // modifier in this position is always followed by the property's `variable`.
  let splitNamePrefix = ""
  for (let i = 1; i < named.length; i++) {
    const prev = named[i - 1]
    const cur = named[i]
    if (
      cur.type === "class_attribute" &&
      (prev.type === "attribute" || prev.type === "type_literal") &&
      named[i + 1]?.type === "simple_name"
    ) {
      splitNamePrefix = cur.text
    }
  }
  return { shape: shape.join(" "), splitNamePrefix }
}

const out: { file: string; classes: ClassRec[]; shapes: Record<string, number> }[] = []

for (const f of files) {
  let tree: ReturnType<Parser["parse"]> = null
  try {
    tree = parser.parse(readFileSync(f, "utf8"))
  } catch (e) {
    console.error(`[ADV-TREE-ERR] ${f}: ${String(e).slice(0, 200)}`)
    continue
  }
  if (!tree) continue

  const shapes: Record<string, number> = {}
  const classLines = new Map<string, number>()
  walk(tree.rootNode, new Set(["class_statement"]), (n) => {
    const k = childTypes(n).join(" ")
    shapes[k] = (shapes[k] ?? 0) + 1
    const names = childTexts(n, "simple_name")
    if (names.length > 0) classLines.set(names[0], n.startPosition.row + 1)
  })

  const classes: ClassRec[] = []
  walk(tree.rootNode, new Set(["class_statement"]), (n) => {
    const names = childTexts(n, "simple_name")
    classes.push({
      name: names[0] ?? "",
      base: names.length > 1 ? names[1] : "",
      ifaces: names.slice(2),
      line: n.startPosition.row + 1,
      members: [],
    })
  })
  const byName = new Map(classes.map((c) => [c.name, c]))

  walk(tree.rootNode, new Set(["class_method_definition", "class_property_definition"]), (n) => {
    const owner = enclosingClass(n)
    const rec = byName.get(owner)
    if (!rec) return
    const isMethod = n.type === "class_method_definition"
    const nameNode = isMethod ? firstChildOfType(n, "simple_name") : firstChildOfType(n, "variable")
    const raw = nameNode?.text ?? ""
    const name = raw.startsWith("$") ? raw.slice(1) : raw
    if (!name || name === owner) return // the constructor is written with the class name
    const attrs = attributeText(n)
    const hdr = memberHeader(n)
    rec.members.push({
      name,
      nodeType: n.type,
      hidden: attrs.includes("hidden"),
      static: attrs.includes("static"),
      line: n.startPosition.row + 1,
      headerShape: hdr.shape,
      splitNamePrefix: hdr.splitNamePrefix,
    })
  })

  out.push({ file: f, classes, shapes })
}

writeFileSync(outFile, JSON.stringify(out), "utf8")