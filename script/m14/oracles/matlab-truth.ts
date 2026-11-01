/**
 * The MATLAB oracle — LANE-OWNED, written from MATLAB's own semantics and the lane's measured
 * conventions, sharing no rule table or resolver with `RealMatlabAnalyzer`.
 *
 * ## What it derives
 *
 *  - `exports`    — the file exports its PRIMARY function/class: a MATLAB file's identity is the name
 *                   it declares first, and the lane publishes `<file-stem> -> <primary name>`.
 *  - `extends` / `implements` — `classdef X < A & B & C`: the FIRST base is inheritance (X IS-A A) and
 *                   every following base is additional conformance. A dotted base
 *                   (`matlab.mixin.Copyable`) is ONE base, kept with its dotted spelling.
 *  - `contains`   — a class contains its properties, events, enumeration members and methods (the
 *                   constructor included); a function contains the functions nested in its body.
 *  - `calls`      — every function call's CALLEE name.
 *  - `uses`       — identifiers read or written in a function body (parameters included). A
 *                   member-READ (`obj.Data`) names the object, not the property; a member WRITE
 *                   (`report.Data = data`) names both, which is the asymmetry the fixtures measure.
 *  - `references` — names read without being invoked: function handles `@name` and metaclass objects
 *                   `?Name`; both publish the written name (dotted spellings kept).
 *  - `imports`    — `import pkg.name` publishes the written name AND its first package segment;
 *                   `import pkg.*` publishes the package. A MATLAB import is a COMMAND, not a call.
 *
 * ## What it deliberately does not claim
 *
 * Argument count, property attributes (SetAccess/Access/Static), default values and block structure
 * are not edges. A shape the oracle does not model shows up as an unexplained analyzer row.
 */
export type MatlabEdge = { label: string; from: string; target: string }

const children = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < (n?.namedChildCount ?? 0); i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}
const txt = (n: any): string => (n ? String(n.text ?? "") : "")
const firstOfType = (n: any, type: string): any | undefined => children(n).find((c: any) => c.type === type)
const allOfType = (n: any, type: string): any[] => children(n).filter((c: any) => c.type === type)
const leaf = (s: string): string => {
  const parts = String(s).replace(/`/g, "").split(".").filter(Boolean)
  return parts.length ? parts[parts.length - 1] : String(s)
}
const firstIdentifier = (n: any): string => {
  const id = children(n).find((c: any) => c.type === "identifier")
  return id ? txt(id) : ""
}
/** A function_definition's own name: its `identifier` child (the output names are under function_output). */
const functionName = (fn: any): string => firstIdentifier(fn)

export function deriveMatlabTruth(root: any, filePath: string): MatlabEdge[] {
  const edges: MatlabEdge[] = []
  const push = (label: string, from: string, target: string) => {
    if (target) edges.push({ label, from, target })
  }
  const fileStem = String(filePath ?? "").split("/").pop()?.replace(/\.[^.]+$/, "") ?? ""

  // ── one walker for a function body: calls, uses, references, imports ────────────────────────
  // `uses` counts an identifier that the body READS or WRITES (parameters included), the CALLEE is
  // a `calls` row and not a use, and a member access names the receiver — except as an ASSIGNMENT
  // TARGET, where `report.Data = data` names both `report` and `Data`. Measured 2026-11-01 on the
  // lane's class-and-methods fixture: constructor uses = report, report, Data, data; method
  // `value = sum(obj.Data)` uses = value, obj (the property `Data` is not a use when READ).
  const walkBody = (node: any, owner: string) => {
    for (const c of children(node)) {
      if (c.type === "function_definition") continue
      if (c.type === "function_call") {
        const ids = allOfType(c, "identifier")
        const callee = ids.length ? txt(ids[0]) : ""
        if (callee) push("calls", owner, leaf(callee))
        for (const sub of children(c)) {
          if (sub === ids[0]) continue
          walkBody(sub, owner)
        }
        continue
      }
      if (c.type === "assignment") {
        const kids = children(c)
        const lhs = kids[0]
        if (lhs?.type === "field_expression") {
          const ids = allOfType(lhs, "identifier")
          if (ids[0]) push("uses", owner, leaf(txt(ids[0])))
          if (ids.length > 1) push("uses", owner, leaf(txt(ids[ids.length - 1])))
        } else if (lhs?.type === "identifier") {
          push("uses", owner, leaf(txt(lhs)))
        } else if (lhs) {
          walkBody(lhs, owner)
        }
        for (const rhs of kids.slice(1)) walkBody(rhs, owner)
        continue
      }
      if (c.type === "field_expression") {
        const ids = allOfType(c, "identifier")
        if (ids[0]) push("uses", owner, leaf(txt(ids[0])))
        continue
      }
      if (c.type === "handle_operator" || c.type === "metaclass_operator") {
        // `@helper` / `?Widget` / `@pkg.f`: the name as written, dotted spellings kept.
        const name = txt(c).replace(/^[@?]/, "").trim()
        if (name) push("references", owner, name)
        continue
      }
      if (c.type === "command") {
        const nameNode = firstOfType(c, "command_name")
        const argNode = firstOfType(c, "command_argument")
        if (nameNode && txt(nameNode) === "import" && argNode) {
          const target = txt(argNode).trim()
          if (target.endsWith(".*")) push("imports", owner, target.slice(0, -2))
          else if (target.includes(".")) {
            push("imports", owner, target)
            push("imports", owner, target.split(".")[0])
          } else push("imports", owner, target)
        }
        // command arguments are not uses: `clear all` names no variable read
        continue
      }
      if (c.type === "identifier") {
        push("uses", owner, leaf(txt(c)))
        continue
      }
      walkBody(c, owner)
    }
  }

  const walkFunction = (fn: any, owner: string) => {
    const body = firstOfType(fn, "block")
    if (!body) return
    // nested functions are contained by this one and walked under their own names
    for (const nested of allOfType(body, "function_definition")) {
      const nm = functionName(nested)
      if (nm) {
        push("contains", owner, nm)
        walkFunction(nested, nm)
      }
    }
    walkBody(body, owner)
  }

  const source = children(root).find((c: any) => c.type === "source_file") ?? root
  let primary = ""
  for (const c of children(source)) {
    if (c.type === "class_definition") {
      const name = firstIdentifier(c)
      if (!primary) primary = name
      if (name) push("exports", fileStem || "(file)", name)
      const supers = firstOfType(c, "superclasses")
      if (supers && name) {
        const bases = allOfType(supers, "property_name").map((p: any) => txt(p).trim()).filter(Boolean)
        bases.forEach((base, i) => push(i === 0 ? "extends" : "implements", name, base))
      }
      // A class may carry SEVERAL blocks of each kind (`methods (Static)`, `methods (Access=private)`,
      // …) — reading only the first dropped every method after the first block. Measured 2026-11-01 on
      // robotics-toolbox-matlab unit_test/CodeGeneratorTest.m: 8 unexplained `contains` rows.
      for (const properties of allOfType(c, "properties")) {
        for (const p of allOfType(properties, "property")) {
          const pn = firstIdentifier(p)
          if (pn) push("contains", name, pn)
        }
      }
      for (const events of allOfType(c, "events")) {
        for (const e of children(events)) if (e.type === "identifier") push("contains", name, txt(e))
      }
      for (const enumeration of allOfType(c, "enumeration")) {
        for (const en of allOfType(enumeration, "enum")) {
          const enName = firstIdentifier(en)
          if (enName) push("contains", name, enName)
        }
      }
      for (const methods of allOfType(c, "methods")) {
        for (const m of allOfType(methods, "function_definition")) {
          const mn = functionName(m)
          if (mn) push("contains", name, mn)
          walkFunction(m, name)
        }
      }
    } else if (c.type === "function_definition") {
      const name = functionName(c)
      if (!primary) primary = name
      if (name) push("exports", fileStem || "(file)", name)
      walkFunction(c, name)
    }
  }
  return edges
}
