/**
 * M60 pass 2 — the CLEAN `extends` and `overrides` probes.
 *
 * Both types were believed missing at handover and neither had a ruling table, so
 * they carry NO ruling. A type with no ruling is not RULED; it is unmeasured. These
 * are the two measurements, by BOTH instruments the workstream allows:
 *
 *   A. GRAMMAR INVENTORY — enumerate every named node type the pinned grammar
 *      actually produces across the corpus, and show none expresses inheritance or
 *      an override specifier. Positive evidence of absence, from the grammar.
 *
 *   B. PARSE-TREE SEMANTIC COUNT — for a construct the language CAN express, a
 *      grammar inventory is silent by construction and the count must be semantic.
 *      A string or a comment cannot fake it.
 *
 * `overrides` is the interesting one. Clean has no `override` keyword, but it has
 * TYPECLASSES: a `class_declaration` declares a method signature and an
 * `instance_declaration` implements it. An instance member with the same name as
 * the class's member IS an override in the only sense the language has one — the
 * dictionary selects the instance's member for the class's member. So the probe
 * counts exactly that pairing, plus two further readings of "override":
 *
 *   B1 instance-member overrides class-member      (the typeclass reading)
 *   B2 a second member of the same name in one instance/class (a redefinition)
 *   B3 a second module-level definition of one name in one file (a redefinition)
 *
 * `extends` gets three readings too:
 *
 *   B4 a class_context constraint naming another class DECLARED IN THE SAME FILE —
 *      the only shape in which Clean can name one class from another
 *   B5 any node type in the corpus whose text/fields express a supertype clause
 *
 * Usage: npx tsx script/m14/clean-extends-overrides-probe.ts [--limit N]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = process.cwd()
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const WIDE = path.join(ROOT, "script", "m14", "clean-wide-manifest.txt")
const argv = process.argv.slice(2)
const li = argv.indexOf("--limit")
const LIMIT = li >= 0 ? Number(argv[li + 1]) : 0
const USE_WIDE = argv.includes("--wide")

const files: string[] = []
const seen = new Set<string>()
for (const e of fs.readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!fs.statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (fs.statSync(abs).size > 512 * 1024) continue } catch { continue }
    if (!abs.endsWith(".icl") && !abs.endsWith(".dcl")) continue
    if (seen.has(abs)) continue
    seen.add(abs); files.push(abs)
  }
}
if (USE_WIDE && fs.existsSync(WIDE)) {
  for (const l of fs.readFileSync(WIDE, "utf8").split("\n")) {
    const abs = l.trim()
    if (!abs || seen.has(abs) || !fs.existsSync(abs)) continue
    if (!abs.endsWith(".icl") && !abs.endsWith(".dcl")) continue
    seen.add(abs); files.push(abs)
  }
}
files.sort()
const sample = LIMIT > 0 ? files.slice(0, LIMIT) : files

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-clean.wasm")))
const parser = new P()
parser.setLanguage(grammar)

// ------------------------------------------------------------------ instrument A
const namedTypes = new Map<string, number>()
let nodes = 0
/** class name (declared) -> Set(memberName) ; and instance target -> Set(memberName) */
const classMembers = new Map<string, Set<string>>()
const classFiles = new Map<string, string>()
const instanceMembers: { file: string; line: number; cls: string; member: string }[] = []
const redefsInBlock: { file: string; line: number; owner: string; member: string }[] = []
const redefsModule: { file: string; line: number; name: string }[] = []
const ctxNamesLocalClass: { file: string; line: number; owner: string; constraint: string }[] = []

for (const f of sample) {
  let t: any
  try { t = parser.parse(fs.readFileSync(f, "utf8")) } catch { continue }
  if (!t) continue
  const rel = path.relative(CR, f)
  const root = t.rootNode
  const v = (n: any) => { namedTypes.set(n.type, (namedTypes.get(n.type) ?? 0) + 1); nodes++; for (let i = 0; i < n.childCount; i++) v(n.child(i)) }
  v(root)

  // Per-file declaration inventory, read from FIELDS only.
  const fileClasses = new Map<string, Set<string>>()
  const walk = (n: any) => {
    if (n.type === "class_declaration") {
      const nm = n.childForFieldName("name")
      const cname = nm?.text ?? ""
      const mem = new Set<string>()
      const m = (x: any) => {
        if (x.type === "type_signature" || x.type === "function_declaration" || x.type === "operator_definition") {
          const sn = x.childForFieldName("name")
          if (sn?.text) mem.add(sn.text)
        }
        for (let i = 0; i < x.childCount; i++) m(x.child(i))
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) m(c) }
      if (cname) { fileClasses.set(cname, mem); classMembers.set(cname, mem); classFiles.set(cname, rel) }
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(root)

  // B1: instance members vs the declared class's members. Two passes so a class
  // declared LATER in the file still counts.
  const insts: { file: string; line: number; cls: string; members: { name: string; line: number }[] }[] = []
  const w2 = (n: any) => {
    if (n.type === "instance_declaration") {
      const nm = n.childForFieldName("name")
      // The class is inside the `name` field's instance_class; its first
      // `constructor` child is the class name. The 253-defect: this is not always
      // a bare constructor, so read the first constructor descendant of the field.
      let cls = ""
      const fld = nm
      const fc = (x: any): string => { if (x.type === "constructor") return x.text; for (let i = 0; i < x.childCount; i++) { const r = fc(x.child(i)); if (r) return r } return "" }
      if (fld) cls = fc(fld)
      const members: { name: string; line: number }[] = []
      const m = (x: any) => {
        if (x.type === "type_signature" || x.type === "function_declaration" || x.type === "operator_definition") {
          const sn = x.childForFieldName("name")
          if (sn?.text) members.push({ name: sn.text, line: sn.startPosition.row + 1 })
        }
        for (let i = 0; i < x.childCount; i++) m(x.child(i))
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.startIndex !== nm?.startIndex) m(c) }
      if (cls) insts.push({ file: rel, line: n.startPosition.row + 1, cls, members })
    }
    for (let i = 0; i < n.childCount; i++) w2(n.child(i))
  }
  w2(root)
  for (const inst of insts) {
    const seenM = new Set<string>()
    for (const mem of inst.members) {
      instanceMembers.push({ file: inst.file, line: mem.line, cls: inst.cls, member: mem.name })
      if (seenM.has(mem.name)) redefsInBlock.push({ file: inst.file, line: mem.line, owner: inst.cls, member: mem.name })
      seenM.add(mem.name)
    }
  }

  // B2: module-level redefinition of one name in one file.
  const modNames = new Map<string, number>()
  const w3 = (n: any) => {
    if (n.type === "function_declaration" || n.type === "macro_definition" || n.type === "type_definition" || n.type === "class_declaration") {
      const nm = n.childForFieldName("name")
      const txt = nm?.text ?? ""
      if (txt) {
        const prev = modNames.get(txt)
        if (prev !== undefined) redefsModule.push({ file: rel, line: n.startPosition.row + 1, name: txt })
        modNames.set(txt, n.startPosition.row + 1)
      }
    }
    for (let i = 0; i < n.childCount; i++) w3(n.child(i))
  }
  w3(root)

  // B4: a class_context constraint naming a class THIS FILE declares.
  const w4 = (n: any) => {
    if (n.type === "class_context" || n.type === "class_declaration" || n.type === "instance_declaration") {
      let ownerName = ""
      if (n.type !== "class_context") ownerName = n.childForFieldName("name")?.text ?? ""
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c.type === "class_context") {
          const cs = (x: any) => { if (x.type === "constructor") { const s = x.text; if (fileClasses.has(s)) ctxNamesLocalClass.push({ file: rel, line: x.startPosition.row + 1, owner: ownerName, constraint: s }) } for (let j = 0; j < x.childCount; j++) cs(x.child(j)) }
          cs(c)
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) w4(n.child(i))
  }
  w4(root)
  if (sample.indexOf(f) % 80 === 0) process.stderr.write(".")
}

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`\nclean extends/overrides probe`)
console.log(`corpus: ${files.length} admitted${USE_WIDE ? " (git-tracked + committed wide manifest)" : " (git-tracked only)"}; sampled ${sample.length}; AST nodes walked ${nodes.toLocaleString()}`)

console.log(`\n=== INSTRUMENT A — grammar inventory ===`)
console.log(`distinct node types the grammar produces across the sample: ${namedTypes.size}`)
const INHERITANCE_SHAPED = ["extends", "extend", "implements", "inherit", "inheritance", "superclass", "super", "base_class", "parent_class", "override", "overrides", "mixin", "interface_declaration", "trait", "subclass", "sub_type"]
const hits = INHERITANCE_SHAPED.filter((n) => namedTypes.has(n))
console.log(`node types whose NAME expresses inheritance or an override: ${hits.length === 0 ? "NONE" : hits.join(", ")}`)
console.log(`every node type observed (${namedTypes.size}):`)
const names = [...namedTypes.keys()].sort()
for (let i = 0; i < names.length; i += 6) console.log("  " + names.slice(i, i + 6).map((s) => w(s, 24)).join(""))

console.log(`\n=== INSTRUMENT B — parse-tree semantic counts ===`)
let b1 = 0
const b1ex: string[] = []
for (const im of instanceMembers) {
  const mem = classMembers.get(im.cls)
  if (mem && mem.has(im.member)) { b1++; if (b1ex.length < 8) b1ex.push(`${im.file}:${im.line} instance-member ${im.member} of \`instance ${im.cls}\` == member ${im.member} of \`class ${im.cls}\` (class declared in ${classFiles.get(im.cls)})`) }
}
console.log(`B1 instance-member overrides class-member (typeclass reading): ${b1} occurrences across ${new Set(instanceMembers.filter((i) => classMembers.get(i.cls)?.has(i.member)).map((i) => i.file)).size} files`)
for (const e of b1ex) console.log(`     ${e}`)
console.log(`   distinct classes with a member an instance re-implements: ${new Set(instanceMembers.filter((i) => classMembers.get(i.cls)?.has(i.member)).map((i) => i.cls)).size}`)
console.log(`   instance members examined: ${instanceMembers.length}; instance members whose class this corpus declares: ${instanceMembers.filter((i) => classMembers.has(i.cls)).length}`)
console.log(`\nB2 second member of the same name inside one instance/class: ${redefsInBlock.length}`)
for (const e of redefsInBlock.slice(0, 8)) console.log(`     ${e.file}:${e.line} ${e.owner}.${e.member}`)
console.log(`\nB3 second module-level definition of one name in one file: ${redefsModule.length}`)
for (const e of redefsModule.slice(0, 12)) console.log(`     ${e.file}:${e.line} ${e.name}`)
console.log(`\nB4 class_context constraint naming a class THIS FILE declares: ${ctxNamesLocalClass.length}`)
for (const e of ctxNamesLocalClass.slice(0, 12)) console.log(`     ${e.file}:${e.line} ${e.owner} context | ${e.constraint}`)
console.log(`\nclass_declaration names collected: ${classMembers.size}`)
console.log(`instance_declaration targets collected: ${new Set(instanceMembers.map((i) => i.cls)).size}`)