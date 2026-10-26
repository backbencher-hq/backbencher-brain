/**
 * solidity-extended-census — the four EXTENDED relationship types, counted as GRAMMAR CONSTRUCTS
 * over the whole admitted `.sol` population, with the RESOLUTION class of every candidate target.
 *
 * WHY THIS EXISTS. The fleet's extended vocabulary (`decorates`, `renders`, `mixes_in`, `part_of`)
 * is decided per language by the constructs the language actually has. Solidity has two live
 * candidates that no other tail language has in this shape:
 *
 *   `modifier_invocation`   `function f() onlyOwner { … }` — an annotation applied to a declaration
 *                           which CALLS a callable (the modifier's body runs around f's body). The
 *                           impostor that looks IDENTICAL in the tree is a base-constructor call,
 *                           `constructor() Base(1) {}` — the SAME node type, the same field-less
 *                           `identifier` child. The only discriminator is therefore RESOLUTION:
 *                           does the target name a declared `modifier_definition`, or a declared
 *                           `contract`/`interface`/`library`? A name-based test cannot tell them
 *                           apart, and a name filter does not separate a construct from its
 *                           impostors (the fleet's dart-lane form).
 *
 *   `using_directive`       `using L for T;` and `using {f, g} for T global;` — a member-set
 *                           composition: L's / f's members are attached to T, and NO conformance is
 *                           declared. Host type and composed name are read from the tree's own
 *                           fields, never from source text: the grammar puts the host in
 *                           `using_directive.source` (a `type_name`), the plain form's library in a
 *                           `type_alias` child, and the braced form's function path in a
 *                           `using_alias` child.
 *
 * It measures the two RULING candidates beside them and names what a falsifier would have to count:
 *   `part_of`   every `import_directive`, classified by FORM (plain / braced / namespace-alias) and
 *               by whether its source string resolves to a file inside the same repository. The
 *               scope question — whether a Solidity import shares the importing unit's single scope
 *               — is a LANGUAGE fact (each source unit is compiled in its own module scope), so the
 *               census reports the construct population the ruling is about, not a guess about it.
 *   `renders`   the render-family node types in the SERVED grammar's own inventory are counted by
 *               the Lead-owned `script/m14/grammar-node-inventory.ts`; this census counts the
 *               nearest Solidity constructs instead: `new_expression` (already truthfully
 *               `instantiates`) and the callables that RETURN a contract type.
 *
 * WHAT IT READS. The tree, through `ASTEngine.getParser("solidity")` — the same served grammar the
 * analyzer's parse goes through. Nothing here reads a target's spelling to decide a relationship;
 * a class is decided by a declared name in the admitted population.
 *
 * POPULATION. Discovery is COPIED from `script/m14/incoming-gate.ts:discoverFiles` (that file is a
 * script whose top level executes, so it cannot be imported): the git-tracked `.sol` files of
 * `.corpus`, under worker's 1 MiB full-AST cap, one admitted extension (`sol` — the router's own
 * spelling at `src/ast/language-detection.ts`). The copy is the one thing that can drift, so a
 * stride sample (`--cap`) REFUSES to print unless its population equals the gate's own admitted
 * count for the same sample, and exits 3 when it does not.
 *
 * PARSER LIFECYCLE. The grammar is acquired PER FILE and the tree is deleted after the walk — a
 * HELD parser is recreated by the engine every 500 acquisitions and its next parse faults, which is
 * the class lesson every finished lane handed over. Every skip is counted and printed.
 *
 * TWO PASSES, because the decorates discriminator is RESOLUTION-based: pass 1 indexes every
 * declaration name in the admitted population (modifiers, and the type-like declarations
 * `contract`/`interface`/`library`/`struct`/`enum`/`type`); pass 2 classifies each invocation
 * against that index. In-file declarations take precedence over project-wide ones, and a name
 * declared as BOTH a modifier and a type is counted as `ambiguous` rather than silently guessed.
 *
 * USAGE
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   bun run script/m14/solidity-extended-census.ts --cap=50        # stride sample + gate control
 *   bun run script/m14/solidity-extended-census.ts                 # whole admitted population
 *   bun run script/m14/solidity-extended-census.ts --json          # machine-readable
 *
 * EXIT: 0 printed · 2 environment (no corpus / no files) · 3 CONTROL DID NOT FIRE.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const GATE = path.join(ROOT, "script/m14/incoming-gate.ts")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const SIZE_CAP = 1024 * 1024
const EXTS = ["sol"]

const CAP = (() => {
  const hit = process.argv.find((a) => a.startsWith("--cap="))
  return hit ? Number(hit.slice(6)) : 0
})()
const JSON_OUT = process.argv.includes("--json")

// ── population: the exact admission rule the fleet gate uses ────────────────────────────────────
function admitByExtension(rel: string): boolean {
  const base = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase()
  const dot = base.lastIndexOf(".")
  const ext = dot >= 0 ? base.slice(dot + 1) : ""
  return EXTS.includes(ext)
}

function discover(cap: number): { files: string[]; total: number; repos: number; absent: number; overCap: number } {
  const found: string[] = []
  const repos = new Set<string>()
  let absent = 0
  let overCap = 0
  let entries: string[]
  try {
    entries = readdirSync(CR)
  } catch {
    return { files: [], total: 0, repos: 0, absent: 0, overCap: 0 }
  }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      if (!admitByExtension(rel)) continue
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) { overCap++; continue }
      } catch {
        absent++
        continue
      }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  const total = found.length
  let files = found
  if (cap > 0 && total > cap) {
    const stride = Math.max(1, Math.floor(total / cap))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < cap; i += stride) picked.push(found[i])
    files = picked
  }
  return { files, total, repos: repos.size, absent, overCap }
}

// ── tallies ─────────────────────────────────────────────────────────────────────────────────────
type Bar = { sites: number; files: Set<string>; repos: Set<string> }
const mk = (): Bar => ({ sites: 0, files: new Set(), repos: new Set() })
const repoOf = (rel: string) => rel.split("/")[0]
const bump = (m: Map<string, Bar>, k: string, rel: string) => {
  let b = m.get(k)
  if (!b) { b = mk(); m.set(k, b) }
  b.sites++
  b.files.add(rel)
  b.repos.add(repoOf(rel))
}
/** nested key path, joined — keeps a single map of flat classifications */
const bump2 = (m: Map<string, Bar>, keys: string[], rel: string) => bump(m, keys.join(" · "), rel)

const { files, total, repos, absent, overCap } = discover(CAP)
if (files.length === 0) {
  console.error(`solidity-extended-census: 0 admitted .sol files under ${CR}. Set BB_CORPUS_ROOT to the corpus.`)
  process.exit(2)
}

const declared = {
  modifier: new Map<string, Set<string>>(), // name -> files declaring it as a modifier
  typeKind: new Map<string, Map<string, Set<string>>>(), // name -> kind -> files
}
/**
 * Record a declared name. The name is deliberately NOT `declare`: Bun's TypeScript transform
 * parses a statement-position `declare(...)` as an ambient declaration and REMOVES it (measured:
 * the call and the statement after it never execute, and the typechecker does not complain,
 * because in expression position `declare` is a legal identifier). A helper whose NAME changes
 * what the code does is a name this file does not use.
 */
const recordDecl = (name: string, kind: string, rel: string) => {
  if (kind === "modifier") {
    let s = declared.modifier.get(name)
    if (!s) { s = new Set(); declared.modifier.set(name, s) }
    s.add(rel)
    return
  }
  let byKind = declared.typeKind.get(name)
  if (!byKind) { byKind = new Map(); declared.typeKind.set(name, byKind) }
  let fs = byKind.get(kind)
  if (!fs) { fs = new Set(); byKind.set(kind, fs) }
  fs.add(rel)
}

const counts = {
  parsed: 0,        // pass 1 (declaration index) — the population closure is defined on this pass
  failed: 0,        // pass 1 parse failures
  walked: 0,        // pass 2 (construct census)
  pass2Failed: 0,
  parseFailures: [] as string[],
}
const sites = new Map<string, Bar>() // construct sites
const modifierDef = new Map<string, Bar>() // declared modifier names
const invocation = new Map<string, Bar>() // by resolution class · enclosing declaration
const usingForms = new Map<string, Bar>() // by form · host class · composed resolution
const imports = new Map<string, Bar>() // by form · source resolution
const callables = new Map<string, Bar>() // function/constructor/modifier/fallback counts
const inheritance = mk()

const relOf = (abs: string) => path.relative(CR, abs).split(path.sep).join("/")
const admittedSet = new Set(files.map(relOf))

const namedChildren = (node: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < node.namedChildCount; i++) out.push(node.namedChild(i))
  return out
}
const firstChildOfType = (node: any, type: string): any => {
  if (!node) return null
  for (const c of namedChildren(node)) if (c.type === type) return c
  return null
}
const firstIdentifier = (node: any): any => {
  if (!node) return null
  return firstChildOfType(node, "identifier")
}
const lastIdentifier = (node: any): any => {
  const ids = namedChildren(node).filter((c: any) => c.type === "identifier")
  return ids.length ? ids[ids.length - 1] : null
}
/** every descendant of one type (iterative, bounded) */
const descendantsOfType = (node: any, type: string): any[] => {
  const out: any[] = []
  const stack: any[] = namedChildren(node)
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === type) out.push(n)
    for (const c of namedChildren(n)) stack.push(c)
  }
  return out
}
const unquote = (s: string): string => {
  const t = s.trim()
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) return t.slice(1, -1)
  return t
}
/** `./a/../b.sol` → `a/b.sol`, relative to the importing file's directory */
const resolveImport = (fromRel: string, spec: string): string | null => {
  if (!spec.startsWith(".")) return null
  const dir = fromRel.slice(0, fromRel.lastIndexOf("/"))
  const joined = path.posix.normalize(path.posix.join(dir, spec))
  return joined.startsWith("..") ? null : joined
}

const parser: any = await ASTEngine.getParser("solidity")

// ── PASS 1 — declaration index over the admitted population ────────────────────────────────────
function indexDeclarations(node: any, rel: string): void {
  const stack: any[] = [node]
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    switch (n.type) {
      case "modifier_definition": {
        const nameNode = n.childForFieldName("name") ?? firstIdentifier(n)
        if (nameNode) {
          recordDecl(nameNode.text, "modifier", rel)
          bump(modifierDef, nameNode.text, rel)
        }
        break
      }
      case "contract_declaration": recordDecl((n.childForFieldName("name") ?? firstIdentifier(n))?.text ?? "", "contract", rel); break
      case "interface_declaration": recordDecl((n.childForFieldName("name") ?? firstIdentifier(n))?.text ?? "", "interface", rel); break
      case "library_declaration": recordDecl((n.childForFieldName("name") ?? firstIdentifier(n))?.text ?? "", "library", rel); break
      case "user_defined_type_definition": recordDecl((n.childForFieldName("name") ?? firstIdentifier(n))?.text ?? "", "type", rel); break
      case "struct_declaration": recordDecl((n.childForFieldName("name") ?? firstIdentifier(n))?.text ?? "", "struct", rel); break
      case "enum_declaration": recordDecl((n.childForFieldName("name") ?? firstIdentifier(n))?.text ?? "", "enum", rel); break
    }
    for (const c of namedChildren(n)) stack.push(c)
  }
}

for (const abs of files) {
  const rel = relOf(abs)
  try {
    const content = readFileSync(abs, "utf8")
    const tree = parser.parse(content, abs)
    if (!tree?.rootNode) { counts.failed++; continue }
    indexDeclarations(tree.rootNode, rel)
    counts.parsed++
    tree.delete()
  } catch (e: any) {
    counts.failed++
    counts.parseFailures.push(`${rel}: ${String(e?.message ?? e).slice(0, 120)}`)
  }
}

// resets the parser between passes on purpose: the engine's 500-acquisition cache is the hazard
// this file's header names, and a fresh pass is where a stale parser would fault if it were held.
for (const name of [...declared.typeKind.keys()]) {
  if (name === "") declared.typeKind.delete(name)
}
for (const name of [...declared.modifier.keys()]) {
  if (name === "") declared.modifier.delete(name)
}

/**
 * RESOLUTION-BASED class of a modifier-invocation target — the whole discriminator. A name
 * declared as a modifier ANYWHERE in the admitted population is an applied modifier (a decorator);
 * a name declared as a contract/interface/library is a base-constructor call (the impostor); a name
 * declared as BOTH is `ambiguous` and is counted rather than guessed.
 */
function classifyInvocationName(name: string, rel: string): string {
  if (name === "") return "empty"
  const modFile = declared.modifier.get(name)?.has(rel) === true
  const modAny = declared.modifier.has(name)
  const typeKinds = declared.typeKind.get(name)
  const typeFile = typeKinds ? [...typeKinds.values()].some((s) => s.has(rel)) : false
  const typeAny = typeKinds !== undefined
  if (modAny && typeAny) return "ambiguous-modifier-and-type"
  if (modFile) return "modifier-in-file"
  if (modAny) return "modifier-project"
  if (typeFile) return "type-in-file"
  if (typeAny) return "type-project"
  return "unresolved"
}

function classifyTypeName(name: string, rel: string): string {
  if (name === "") return "empty"
  const kinds = declared.typeKind.get(name)
  if (!kinds) return "unresolved"
  const inFile = [...kinds.values()].some((s) => s.has(rel))
  const kindList = [...kinds.keys()].sort().join("+")
  return `${inFile ? "in-file" : "project"}:${kindList}`
}

// ── PASS 2 — construct census with the resolution discriminator ─────────────────────────────────
function enclosingCallable(node: any): { kind: string; name: string; nameNode: any } | null {
  let p = node.parent
  while (p) {
    if (p.type === "function_definition" || p.type === "modifier_definition" ||
        p.type === "constructor_definition" || p.type === "fallback_receive_definition") {
      const nameNode = p.childForFieldName("name") ?? null
      return { kind: p.type, name: nameNode?.text ?? p.type, nameNode }
    }
    if (p.type === "contract_declaration" || p.type === "interface_declaration" || p.type === "library_declaration") return null
    p = p.parent
  }
  return null
}

function walkCensus(node: any, rel: string): void {
  const stack: any[] = [node]
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    switch (n.type) {
      case "modifier_definition": {
        bump(sites, "modifier_definition", rel)
        break
      }
      case "modifier_invocation": {
        const id = firstIdentifier(n)
        const enc = enclosingCallable(n)
        const enclosing = enc ? enc.kind : "none"
        const cls = classifyInvocationName(id?.text ?? "", rel)
        bump(sites, "modifier_invocation", rel)
        bump2(invocation, [cls, enclosing], rel)
        break
      }
      case "inheritance_specifier": {
        inheritance.sites++
        inheritance.files.add(rel)
        inheritance.repos.add(repoOf(rel))
        bump(sites, "inheritance_specifier", rel)
        break
      }
      case "using_directive": {
        bump(sites, "using_directive", rel)
        const hostNode = n.childForFieldName("source")
        // host class from the tree, never from the spelling: `using L for uint256` puts a
        // `primitive_type` under the host `type_name`, `using L for Price` a `user_defined_type`.
        const hostUdt = hostNode ? descendantsOfType(hostNode, "user_defined_type")[0] ?? null : null
        const hostName = hostUdt ? lastIdentifier(hostUdt)?.text ?? "" : ""
        const hostKind = hostNode
          ? (hostUdt !== null ? "user-defined"
            : descendantsOfType(hostNode, "primitive_type").length > 0 ? "primitive"
              : `other:${namedChildren(hostNode)[0]?.type ?? hostNode.type}`)
          : "no-host-field"
        const hostScope = hostKind === "user-defined" ? classifyTypeName(hostName, rel) : hostKind
        const typeAlias = firstChildOfType(n, "type_alias")
        const usingAlias = firstChildOfType(n, "using_alias")
        const form = typeAlias ? "library" : usingAlias ? "braced" : "unknown"
        if (form === "library") {
          const libName = firstIdentifier(typeAlias)?.text ?? ""
          bump2(usingForms, [form, hostKind, hostScope, `library=${classifyTypeName(libName, rel)}`], rel)
        } else if (form === "braced") {
          const paths = descendantsOfType(usingAlias, "user_defined_type")
          const teams = paths.map((p: any) => {
            const ids = namedChildren(p).filter((c: any) => c.type === "identifier")
            return ids.length >= 2 ? `lib=${classifyTypeName(ids[0].text, rel)}` : `fn=${classifyTypeName(ids[0]?.text ?? "", rel)}`
          })
          const distinct = [...new Set(teams)].sort().join(",")
          bump2(usingForms, [form, hostKind, hostScope, distinct], rel)
        } else {
          bump2(usingForms, ["unknown", hostKind, hostScope], rel)
        }
        break
      }
      case "import_directive": {
        bump(sites, "import_directive", rel)
        const srcNode = n.childForFieldName("source")
        const spec = srcNode ? unquote(srcNode.text) : ""
        const alias = n.childForFieldName("alias")
        const namedCount = namedChildren(n).filter((c: any) => c.type === "identifier" && c !== alias).length
        // the namespace form carries an anonymous `*` token; the plain-alias form does not
        let hasStar = false
        for (let i = 0; i < n.childCount; i++) if (n.child(i)?.type === "*") hasStar = true
        const form = hasStar ? "namespace" : alias && namedCount === 0 ? "alias" : namedCount > 0 ? "braced" : "plain"
        const resolved = resolveImport(rel, spec)
        const srcClass = spec === "" ? "empty" : resolved === null ? "external-or-non-relative" : "relative"
        const targetClass = resolved === null ? "" : admittedSet.has(resolved) ? "target-admitted" : "target-absent"
        bump2(imports, [form, srcClass, targetClass].filter(Boolean), rel)
        break
      }
      case "new_expression": bump(sites, "new_expression", rel); break
      case "function_definition": bump(callables, "function", rel); break
      case "constructor_definition": bump(callables, "constructor", rel); break
      case "fallback_receive_definition": bump(callables, "fallback-receive", rel); break
    }
    for (const c of namedChildren(n)) stack.push(c)
  }
}

for (const abs of files) {
  const rel = relOf(abs)
  try {
    const content = readFileSync(abs, "utf8")
    const tree = parser.parse(content, abs)
    if (!tree?.rootNode) { counts.failed++; continue }
    counts.walked++
    walkCensus(tree.rootNode, rel)
    tree.delete()
  } catch (e: any) {
    counts.pass2Failed++
    counts.parseFailures.push(`${rel}: ${String(e?.message ?? e).slice(0, 120)}`)
  }
}

// ── CONTROL: a stride sample must BE the gate's population ─────────────────────────────────────
type Control = { ok: boolean; checked: string; detail: string }
let control: Control
if (CAP > 0) {
  let gateAdmitted = -1
  try {
    const out = execFileSync("npx", ["tsx", GATE, "solidity", EXTS.join(","), String(CAP), "--json"], {
      encoding: "utf8", cwd: ROOT, env: { ...process.env, BB_CORPUS_ROOT: CR },
      maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    })
    const j = JSON.parse(out)
    gateAdmitted = Number(j?.population?.admitted ?? j?.admitted ?? -1)
  } catch (e: any) {
    const stdout = typeof e?.stdout === "string" ? e.stdout : ""
    const j = (() => { try { return JSON.parse(stdout) } catch { return null } })()
    if (j) gateAdmitted = Number(j?.population?.admitted ?? j?.admitted ?? -1)
  }
  if (gateAdmitted < 0) {
    console.error("CONTROL DID NOT FIRE: the gate refused to measure, so the census population cannot be checked against it.")
    process.exit(3)
  }
  if (gateAdmitted !== files.length) {
    console.error(`CONTROL DID NOT FIRE: census sample ${files.length} files != gate admitted ${gateAdmitted}.`)
    process.exit(3)
  }
  control = { ok: true, checked: "incoming-gate --json admitted", detail: `sample of ${files.length} equals the gate's admitted count` }
} else {
  control = { ok: true, checked: "closure (whole population)", detail: `parsed ${counts.parsed} + failed ${counts.failed} = admitted ${files.length}` }
}

// ── POSITIVE CONTROLS — a zero over nothing is not a measurement ───────────────────────────────
const families: Array<[string, number]> = [
  ["modifier_definition", sites.get("modifier_definition")?.sites ?? 0],
  ["modifier_invocation", sites.get("modifier_invocation")?.sites ?? 0],
  ["using_directive", sites.get("using_directive")?.sites ?? 0],
  ["import_directive", sites.get("import_directive")?.sites ?? 0],
  ["inheritance_specifier", inheritance.sites],
]
const deadFamilies = families.filter(([, n]) => n === 0).map(([k]) => k)
if (deadFamilies.length > 0) {
  console.error(`CONTROL DID NOT FIRE: the census walk found 0 sites for ${deadFamilies.join(", ")} — a construct the Solidity grammar declares and the corpus is known to carry.`)
  process.exit(3)
}

// ── output ─────────────────────────────────────────────────────────────────────────────────────
const sorted = (m: Map<string, Bar>) => [...m.entries()].sort((a, b) => b[1].sites - a[1].sites)
const asJson = (m: Map<string, Bar>) => Object.fromEntries(sorted(m).map(([k, v]) => [k, { sites: v.sites, files: v.files.size, repos: v.repos.size }]))

const payload = {
  population: {
    admitted: files.length,
    discovered: total,
    parsed: counts.parsed,
    failed: counts.failed,
    walked: counts.walked,
    repos,
    absent,
    overCap,
    exts: EXTS,
    sizeCapBytes: SIZE_CAP,
    cap: CAP,
    corpusRoot: CR,
    closure: counts.parsed + counts.failed === files.length,
  },
  control,
  positiveControls: Object.fromEntries(families),
  declared: {
    modifierNames: declared.modifier.size,
    modifierDeclarations: [...declared.modifier.values()].reduce((a, s) => a + s.size, 0),
    typeNames: declared.typeKind.size,
  },
  sites: asJson(sites),
  modifierDefinitions: asJson(modifierDef),
  modifierInvocations: asJson(invocation),
  usingForms: asJson(usingForms),
  imports: asJson(imports),
  callables: asJson(callables),
  inheritance: { sites: inheritance.sites, files: inheritance.files.size, repos: inheritance.repos.size },
  parseFailures: counts.parseFailures.slice(0, 20),
}

if (JSON_OUT) {
  console.log(JSON.stringify(payload, null, 2))
  process.exit(0)
}

const w = (s: string | number, n: number) => String(s).padEnd(n)
console.log(`solidity extended census — ${counts.parsed} parsed of ${files.length} admitted .sol files (${repos} repos; cap ${CAP === 0 ? "NONE (whole population)" : CAP})`)
console.log(`  corpus root ${CR} · extensions ${EXTS.map((e) => "." + e).join(" ")} · size cap ${SIZE_CAP}`)
console.log(`  closure: parsed ${counts.parsed} + failed ${counts.failed} = ${counts.parsed + counts.failed} of ${files.length} admitted · control ${control.checked}`)
console.log(`  positive controls: ${families.map(([k, v]) => `${k} ${v}`).join(" · ")}`)
console.log(`  declared names: modifiers ${declared.modifier.size} · type-like ${declared.typeKind.size}`)
console.log("")
const table = (title: string, m: Map<string, Bar>) => {
  console.log(`${title}`)
  for (const [k, v] of sorted(m)) console.log(`  ${w(k, 76)} ${w(v.sites, 8)} sites ${w(v.files.size, 7)} files ${w(v.repos.size, 5)} repos`)
  console.log("")
}
table("CONSTRUCT SITES", sites)
table("MODIFIER DEFINITIONS (declared names)", modifierDef)
table("MODIFIER INVOCATIONS — by RESOLUTION CLASS · enclosing declaration", invocation)
table("USING DIRECTIVES — form · host class · host resolution · composed resolution", usingForms)
table("IMPORTS — form · source class", imports)
table("CALLABLES", callables)
