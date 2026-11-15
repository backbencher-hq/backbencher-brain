/**
 * ZIG WAVE 2 PROBE — the ORACLE RED-TEAM (M14 §5.7).
 *
 * The differential now audits zig's `references` class (Z14). A gate that has
 * never been observed to fail is not evidence, so this probe runs the SAME
 * comparison twice:
 *
 *   1. the real analyzer against the oracle — the published direction;
 *   2. a PRE-FIX analyzer (the old identifier-walk leaf, transcribed verbatim
 *      and labelled as such) against the same oracle — the direction that must
 *      go red. Case 2 is the one that proves the oracle can convict: if the
 *      pre-fix leaf and the oracle agreed on everything, the audit would be a
 *      tautology.
 *
 * Also reports the class composition (how many of the compared edges are
 * declared_type vs import) so "the class is audited" is a number.
 */
import * as fs from "fs"
import { init, zigFiles, parser, analyzer } from "./zigw-harness"
import { deriveZigReferenceEdges, deriveZigBareUses } from "../../m14/differential"

const BUILTINS: ReadonlySet<string> = new Set([
  "void", "bool", "f16", "f32", "f64", "f80", "f128", "c_longdouble",
  "i8", "i16", "i32", "i64", "i128", "isize", "u8", "u16", "u32", "u64", "u128", "usize",
  "anytype", "comptime_int", "comptime_float", "noreturn", "type", "anyerror",
  "c_char", "c_short", "c_int", "c_long", "c_longlong", "c_uint", "c_ulong", "c_ulonglong", "c_void",
  "error", "test",
])

/** The PRE-FIX leaf, transcribed from `zigTypeLeafNode` as it was before Z13:
 *  walk every identifier under the declaration, drop the first, take the last,
 *  then strip the junk class and the `<or>`/`=` surgeries. */
function preFixHead(decl: any): string | null {
  const ids: string[] = []
  const stack: any[] = [decl]
  let guard = 0
  while (stack.length > 0 && guard++ < 200) {
    const n = stack.pop()!
    if (n.type === "identifier") ids.push(String(n.text))
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  if (ids.length === 0) return null
  if ((decl.type === "parameter" || decl.type === "container_field") && decl.namedChildCount > 0 && decl.namedChild(0)?.type === "identifier") {
    ids.shift()
    if (ids.length === 0) return null
  }
  const trim = ids[ids.length - 1]!.replace(/[!*\s[\]{}]+/g, "").trim()
  if (!trim) return null
  const base = trim.split("<or>")[0] ?? trim
  const head = base.indexOf("=") !== -1 ? base.slice(0, base.indexOf("=")).trim() : base
  if (!head || BUILTINS.has(head)) return null
  const c0 = head.charCodeAt(0)
  if (c0 >= 48 && c0 <= 57) return null
  return head
}

function preFixReferenceTargets(root: any): Set<string> {
  const out = new Set<string>()
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    // The import half of the class did not change, so the pre-fix transcription
    // derives it too — otherwise its `missing` count would be an artefact of the
    // transcription rather than a defect, and the two directions would not be
    // comparable.
    if (n.type === "variable_declaration" || n.type === "using_namespace_declaration") {
      const direct = (p: any, type: string): any | null => {
        if (!p) return null
        for (let i = 0; i < p.namedChildCount; i++) {
          const c = p.namedChild(i)
          if (c && c.type === type) return c
        }
        return null
      }
      const scope: any = n.type === "using_namespace_declaration" ? n : (() => {
        const kids: any[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) kids.push(c)
        }
        return kids.length > 0 ? kids[kids.length - 1] : null
      })()
      const bi = direct(scope, "builtin_identifier")
      if (bi && (bi.text === "@import" || bi.text === "@cImport")) {
        const args = direct(scope, "arguments")
        const str = args ? (direct(args, "string") ?? direct(args, "string_content")) : null
        if (str) {
          const raw = String(str.text)
          out.add(raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) ? raw.slice(1, -1) : raw)
        }
      }
    }
    if (n.type === "parameter" || n.type === "container_field") {
      const h = preFixHead(n)
      if (h) out.add(h)
    }
    if (n.type === "function_declaration") {
      const kids: any[] = []
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) kids.push(c)
      }
      const ret = kids.filter((c) => c.type !== "identifier" || kids.indexOf(c) !== 0).find((c) =>
        c.type === "error_union_type" || c.type === "nullable_type" || c.type === "pointer_type" ||
        c.type === "slice_type" || c.type === "builtin_type" || c.type === "identifier" || c.type === "field_expression")
      if (ret) {
        const h = preFixHead(ret)
        if (h) out.add(h)
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

const norm = (t: string) => {
  const s = String(t).replace(/<.*$/, "").replace(/\[.*$/, "").trim()
  const parts = s.split(/::|\./).filter(Boolean)
  return parts[parts.length - 1] ?? s
}

async function main(): Promise<void> {
  await init()
  const files = zigFiles(["zig", "zls", "ghostty"], Number(process.argv[2] ?? 400))
  let declaredType = 0, imports = 0
  let missing = 0, unexplained = 0
  const missEx: string[] = [], unexpEx: string[] = []
  let preMissing = 0, preUnexplained = 0
  const preMissEx: string[] = [], preUnexpEx: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser().parse(src)
    const root = tree.rootNode
    const res: any = analyzer().analyze(root, src, f)
    const truth = deriveZigReferenceEdges(root)
    for (const t of truth) {
      const from = String((t as any).from ?? "")
      if (from === "(declared-type)") declaredType++
      else imports++
    }
    const got = new Set<string>()
    for (const r of res.relationships as any[]) {
      if (String(r.type) !== "references") continue
      got.add(norm(String(r.target)))
    }
    for (const t of truth) {
      if (!got.has(norm(t.target))) {
        missing++
        if (missEx.length < 12) missEx.push(`${f.split("/").slice(-2).join("/")}  truth ${t.label} -> ${t.target}`)
      }
    }
    const truthSet = new Set(truth.map((t) => norm(t.target)))
    for (const g of got) {
      if (!truthSet.has(g)) {
        unexplained++
        if (unexpEx.length < 12) unexpEx.push(`${f.split("/").slice(-2).join("/")}  analyzer -> ${g}`)
      }
    }
    // the pre-fix direction
    const pre = preFixReferenceTargets(root)
    for (const p of pre) {
      if (!truthSet.has(norm(p))) {
        preUnexplained++
        if (preUnexpEx.length < 12) preUnexpEx.push(`${f.split("/").slice(-2).join("/")}  pre-fix -> ${p}   (oracle does not derive it)`)
      }
    }
    for (const t of truthSet) {
      if (!pre.has(t)) {
        preMissing++
        if (preMissEx.length < 12) preMissEx.push(`${f.split("/").slice(-2).join("/")}  oracle -> ${t}   (pre-fix misses it)`)
      }
    }
    tree.delete()
  }
  console.log(`files: ${files.length}`)
  console.log(`truth edges: ${declaredType} declared_type + ${imports} import`)
  console.log(`\n[1] real analyzer vs oracle:   MISSING=${missing}  unexplained=${unexplained}`)
  for (const e of missEx) console.log(`     ${e}`)
  for (const e of unexpEx) console.log(`     ${e}`)
  console.log(`\n[2] PRE-FIX analyzer vs oracle: unexplained=${preUnexplained}  missing=${preMissing}   <- the direction that must be red`)
  for (const e of preUnexpEx) console.log(`     ${e}`)
  for (const e of preMissEx) console.log(`     ${e}`)
  // ---------------------------------------------------------------------
  // [3] Z24 gate: A DECLARATION IS NOT A READ.
  //
  // The bare-read truth's `isDefining` had Z15's operator test as an early
  // `return false` for every parent, so it short-circuited its own declaration
  // branch and derived a `uses` row for the name of every function and field it
  // walked — including the `pub fn init(` line itself. F5 read ~970 MISSING on a
  // 200-file draw and the analyzer was innocent: it had never emitted those
  // edges. The size is one phantom row per file-scope declaration, so it scales
  // with the DRAW, which is why it read like a sampling artefact.
  //
  // This asserts the invariant directly from the tree: a truth `uses` row whose
  // target is a file-scope declaration name must have a genuine bare read site
  // for that name. The red-team direction SIMULATES the pre-Z24 `isDefining`
  // (which emitted a row for every file-scope declaration name it walked) rather
  // than re-running the old function, and says so.
  let declNameRows = 0
  let genuineReads = 0
  let simulatedPreZ24 = 0
  const declEx: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree2 = parser().parse(src)
    const res2: any = analyzer().analyze(tree2.rootNode, src, f)
    const rel = f.split("/repositories/")[1] ?? f
    const truth = deriveZigBareUses(tree2.rootNode, res2.symbols ?? [])
    // file-scope value declarations, from the tree (not from the analyzer)
    const declared = new Set<string>()
    const declSites = new Map<string, boolean>()
    const readSites = new Map<string, boolean>()
    const DECL_PARENTS = new Set([
      "function_declaration", "test_declaration", "variable_declaration",
      "container_field", "struct_item", "enum_item", "union_item", "type_item", "mod_item",
    ])
    const walk = (n: any): void => {
      if (n.type === "identifier") {
        const p = n.parent
        if (p && DECL_PARENTS.has(p.type)) {
          let first = true
          for (let i = 0; i < p.namedChildCount; i++) {
            const c = p.namedChild(i)
            if (c && (c.type === "identifier" || c.type === "field_identifier" || c.type === "type_identifier")) {
              first = c.startIndex === n.startIndex && c.endIndex === n.endIndex
              break
            }
          }
          if (first) { declared.add(n.text); declSites.set(n.text, true); }
        } else if (p && p.type !== "field_expression") {
          readSites.set(n.text, true)
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c)
      }
    }
    walk(tree2.rootNode)
    for (const row of truth) {
      if (row.label !== "uses") continue
      if (!declared.has(row.target)) continue
      if (readSites.get(row.target)) { genuineReads++; continue }
      declNameRows++
      if (declEx.length < 8) declEx.push(`${rel}  uses -> ${row.target}  (declared, and read NOWHERE outside a declaration)`)
    }
    // the pre-Z24 shape: one row per file-scope declaration name
    for (const name of declared) if (!readSites.get(name)) simulatedPreZ24++
    tree2.delete()
  }
  console.log(`\n[3] declaration-is-not-a-read: violations=${declNameRows}  (genuine reads of a declared name: ${genuineReads})`)
  for (const e of declEx) console.log(`     ${e}`)
  console.log(`     pre-Z24 SIMULATION would have raised ${simulatedPreZ24} violation(s) on the same files <- the gate can fail`)

  console.log(`\nverdict: ${missing === 0 && unexplained === 0 ? "case 1 clean" : "case 1 RED"}; ${preUnexplained + preMissing > 0 ? "case 2 convicts (the oracle can fail)" : "case 2 DID NOT CONVICT — the audit would be a tautology"}; case 3 ${declNameRows === 0 ? "clean" : "RED"} (pre-Z24 simulation would be ${simulatedPreZ24})`)
}
void main()
