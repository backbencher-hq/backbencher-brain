/**
 * ZIG WAVE 3 PROBE — HOW WRONG IS THE NAME HEURISTIC? (the ZIG.GAP.4 sizing)
 *
 * Z11 replaced the "an upper-case name is a type alias" fallback for the RHS
 * forms where the NODE TYPE decides, and left it in place for the forms where
 * the grammar cannot: an `identifier` RHS, a `field_expression` RHS, a
 * `call_expression` RHS, an `if`/`switch` RHS, a `struct_initializer` RHS and a
 * `parenthesized_expression` RHS. The declared limitation counts the SITES that
 * ride the heuristic (798 in the pinned corpora) — but a site riding a heuristic
 * is not a site that is WRONG, and the difference is the whole sizing question:
 * if the heuristic is 95% right, the limitation is the honest answer and a
 * resolution pass is wasted work; if 40% of those sites are mis-kinded, it is
 * the largest remaining defect in the lane.
 *
 * So this probe RESOLVES each site against the file's own declarations — a
 * second, independent derivation, not the analyzer's rule — and reports the
 * wrong-kind rate per form, split by whether the site was resolvable at all:
 *
 *   RIGHT       the resolution agrees with the published kind
 *   WRONG       the resolution disagrees  ← the number that sizes the pass
 *   UNRESOLVED  the file cannot say (an external name, a value call into a
 *               function, a generic application of an imported type). Counted,
 *               never guessed: a site the file cannot resolve is not evidence
 *               that the analyzer is wrong.
 *
 * The inventory is built from the ANALYZER's own symbols (the same shared-ground-
 * truth precedent the zig bare-uses oracle follows: the ownership/kind of a
 * declaration is not what is being audited here, so it is read, not re-derived),
 * while every RESOLUTION is derived from the tree.
 */
import * as fs from "fs"
import { init, zigFiles, parser, analyzer } from "./zigw-harness"

const SKIP_INFN = new Set(["function_declaration", "test_declaration", "comptime_declaration", "block", "function_signature"])
const CONTAINER_KINDS = new Set(["struct", "enum", "union", "type", "interface", "class"])

async function main(): Promise<void> {
  await init()
  const limit = Number(process.argv[2] ?? 1200)
  const files = zigFiles(["zig", "zls", "ghostty"], limit)

  interface Row { right: number; wrong: number; unresolved: number; exWrong: string[]; exUnresolved: string[] }
  const rows: Record<string, Row> = {}
  const bump = (form: string, verdict: "right" | "wrong" | "unresolved", ex: string) => {
    const r = (rows[form] ??= { right: 0, wrong: 0, unresolved: 0, exWrong: [], exUnresolved: [] })
    r[verdict]++
    if (verdict === "wrong" && r.exWrong.length < 6) r.exWrong.push(ex)
    if (verdict === "unresolved" && r.exUnresolved.length < 3) r.exUnresolved.push(ex)
  }

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser().parse(src)
    const res: any = analyzer().analyze(tree.rootNode, src, f)
    const rel = f.split("/repositories/")[1] ?? f

    // ── the file's own declaration inventory, from the analyzer's symbols ────
    const typesByName = new Set<string>()   // struct/enum/union/type aliases
    const valuesByName = new Set<string>()  // constants, variables, functions
    const kindsByName = new Map<string, string>()
    for (const s of res.symbols as any[]) {
      const k = String(s.kind)
      const n = String(s.name)
      kindsByName.set(n, k)
      if (CONTAINER_KINDS.has(k)) typesByName.add(n)
      else if (k === "constant" || k === "variable" || k === "function" || k === "method" || k === "enum_member") valuesByName.add(n)
    }

    const where = (n: any) => `${rel.split("/").slice(-2).join("/")}:${n.startPosition.row + 1}  ${n.text.replace(/\s+/g, " ").slice(0, 74)}`

    /** Resolve one RHS node to "type" | "value" | null (the file cannot say). */
    const resolve = (rhs: any, depth = 0): "type" | "value" | null => {
      if (!rhs || depth > 4) return null
      const t = rhs.type
      // a TYPE node: a type position, whatever its name
      if (["builtin_type", "pointer_type", "slice_type", "array_type", "nullable_type", "error_union_type", "anyframe_type", "opaque_declaration", "error_type"].includes(t)) return "type"
      if (["struct_declaration", "union_declaration", "enum_declaration", "error_set_declaration"].includes(t)) return "type"
      if (t === "identifier") {
        const n = String(rhs.text)
        if (typesByName.has(n)) return "type"
        if (valuesByName.has(n)) return "value"
        return null
      }
      if (t === "field_expression") {
        // A qualified path. The FILE can only speak about it when the FINAL
        // segment is one of its own declarations: `const T = pkg.Inner` with a
        // local `Inner` is a type alias; `const x = LocalType.member` is a value;
        // `const R = std.Build.Step.Run` is a type the file cannot see at all.
        // Resolving the HEAD instead (the first version of this probe) called the
        // middle case a type and reported 174 phantom wrong rows.
        const kids: any[] = []
        for (let i = 0; i < rhs.namedChildCount; i++) {
          const c = rhs.namedChild(i)
          if (c) kids.push(c)
        }
        const last = kids[kids.length - 1]
        if (!last || last.type !== "identifier") return null
        const n = String(last.text)
        if (typesByName.has(n)) return "type"
        if (valuesByName.has(n)) return "value"
        return null
      }
      if (t === "call_expression") {
        const callee = rhs.namedChildCount > 0 ? rhs.namedChild(0) : null
        if (!callee) return null
        if (callee.type === "builtin_identifier") return "value"   // @as/@intCast/@TypeOf are values
        const head = resolve(callee, depth + 1)
        if (head === "type") return "type"    // `MyList(u8)` — a generic type application
        if (head === "value") return "value"  // `makeThing(1)` — a call
        return null                          // an external name: the file cannot say
      }
      if (t === "parenthesized_expression") {
        const inner: any[] = []
        for (let i = 0; i < rhs.namedChildCount; i++) {
          const c = rhs.namedChild(i)
          if (c) inner.push(c)
        }
        return inner.length === 1 ? resolve(inner[0], depth + 1) : null
      }
      if (t === "struct_initializer") {
        // `T{...}` is a CONSTRUCTION (a value); `[_]type{...}` is a type-valued
        // array; `[_]u8{...}` is an array value. The element type decides.
        const first: any = rhs.namedChildCount > 0 ? rhs.namedChild(0) : null
        if (!first) return null
        if (first.type === "array_type" || first.type === "slice_type") {
          for (let i = 0; i < first.namedChildCount; i++) {
            const e = first.namedChild(i)
            if (e && e.type === "builtin_type" && (e.text === "type" || e.text === "comptime_int" || e.text === "comptime_float")) return "type"
            if (e && (e.type === "struct_declaration" || e.type === "enum_declaration" || e.type === "union_declaration" || e.type === "error_set_declaration")) return "type"
          }
          return "value"
        }
        if (first.type === "identifier") {
          // a construction of a named type is a VALUE; the field name proves the
          // type is not a function (a call needs a `call_expression`)
          return "value"
        }
        return resolve(first, depth + 1)
      }
      if (t === "if_expression" || t === "switch_expression" || t === "labeled_type_expression") {
        // type-valued when a branch is a container declaration, else unresolved
        let sawType = false
        const st: any[] = [rhs]
        while (st.length > 0) {
          const m = st.pop()!
          if (["struct_declaration", "union_declaration", "enum_declaration", "error_set_declaration", "opaque_declaration", "labeled_type_expression"].includes(m.type)) sawType = true
          for (let i = 0; i < m.namedChildCount; i++) {
            const c = m.namedChild(i)
            if (c) st.push(c)
          }
        }
        return sawType ? "type" : null
      }
      return null
    }

    // ── every container-scope declaration that rides the name heuristic ──────
    const visit = (n: any, inFn: boolean): void => {
      if (n.type === "variable_declaration" && !inFn) {
        const kids: any[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) kids.push(c)
        }
        if (kids.length > 0 && kids[0].type === "identifier" && kids[0].text !== "_" && kids[0].text.length <= 80) {
          const name = kids[0].text
          const upper = name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()
          const rhs = kids[kids.length - 1]
          let isVar = false
          for (let i = 0; i < n.childCount; i++) {
            const c = n.child(i)
            if (c && !c.isNamed && c.type === "var") isVar = true
          }
          const published = kindsByName.get(name) ?? "MISSING"
          // only the forms the heuristic still decides, and only where the name
          // heuristic is what fired (i.e. not already forced by the node type)
          const forcedByNode = ["integer", "float", "string", "multiline_string", "boolean", "character",
            "binary_expression", "unary_expression", "null_coercion_expression", "index_expression",
            "catch_expression", "block", "initializer_list", "range_expression", "assignment_expression",
            "error_type", "anonymous_struct_initializer", "dereference_expression", "builtin_type",
            "pointer_type", "slice_type", "array_type", "nullable_type", "error_union_type", "anyframe_type",
            "struct_declaration", "enum_declaration", "union_declaration", "error_set_declaration",
            "opaque_declaration", "function_signature", "labeld", "labeled_type_expression"]
          const form = rhs.type
          if (!isVar && !forcedByNode.includes(form)) {
            const truth = resolve(rhs)
            const expectKind = truth === "type" ? "type" : truth === "value" ? "constant" : null
            if (expectKind === null) bump(form, "unresolved", where(n))
            else {
              const agree = (expectKind === "type") === (published === "type" || published === "struct" || published === "enum" || published === "union")
              bump(form, agree ? "right" : "wrong", where(n))
            }
            void upper
          }
        }
      }
      const childInFn = inFn || SKIP_INFN.has(n.type)
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c, childInFn)
      }
    }
    visit(rootOf(tree), false)
    tree.delete()
  }

  console.log(`files: ${files.length}\n`)
  console.log("form".padEnd(26) + "right".padStart(8) + "wrong".padStart(8) + "unresolved".padStart(12))
  let TR = 0, TW = 0, TU = 0
  for (const [form, r] of Object.entries(rows).sort((a, b) => (b[1].wrong + b[1].unresolved) - (a[1].wrong + a[1].unresolved))) {
    TR += r.right; TW += r.wrong; TU += r.unresolved
    console.log(form.padEnd(26) + String(r.right).padStart(8) + String(r.wrong).padStart(8) + String(r.unresolved).padStart(12))
  }
  console.log("TOTAL".padEnd(26) + String(TR).padStart(8) + String(TW).padStart(8) + String(TU).padStart(12))
  const judged = TR + TW
  console.log(`\nwrong rate over the sites the file CAN resolve: ${judged === 0 ? "n/a" : (100 * TW / judged).toFixed(1)}%  (${TW} of ${judged})`)
  console.log(`wrong rate over ALL heuristic sites: ${judged + TU === 0 ? "n/a" : (100 * TW / (judged + TU)).toFixed(1)}%  (${TW} of ${judged + TU})`)
  console.log("\n=== WRONG samples (the rows a resolution pass would fix) ===")
  for (const [form, r] of Object.entries(rows)) {
    if (r.exWrong.length === 0) continue
    console.log(`\n${form}:`)
    for (const e of r.exWrong) console.log(`   ${e}`)
  }
  console.log("\n=== UNRESOLVED samples (the file cannot say; never counted as wrong) ===")
  for (const [form, r] of Object.entries(rows)) {
    if (r.exUnresolved.length === 0) continue
    console.log(`\n${form}:`)
    for (const e of r.exUnresolved) console.log(`   ${e}`)
  }
}

function rootOf(tree: any): any { return tree.rootNode }
void main()
