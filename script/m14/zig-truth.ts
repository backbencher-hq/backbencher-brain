import { stripZigQuoting } from "../../src/ast/real-zig-analyzer"

/**
 * ZIG WAVE 4 — the lane's TRUTHS, in one lane-owned module.
 *
 * WHY A SEPARATE FILE. The differential (`script/m14/differential.ts`) is the
 * family's shared harness and has been mid-repair by other lanes during this
 * wave; a truth that lives only inside it cannot be run, reviewed or
 * red-teamed while that is true. The family already has the pattern —
 * `script/m14/fsharp-truth-oracle.ts` and `script/m14/clojure-truth.ts` are both
 * lane-owned truth modules — and it has one advantage over a harness-local
 * function: the owning lane can calibrate the oracle against a known case
 * BEFORE the shared harness depends on it, which is the only way a clean result
 * means anything.
 *
 * Every derivation here is TREE-ONLY. The one input that may come from the
 * analyzer is a shared name inventory, and only where the project already
 * sanctions it; a rule that needs the analyzer's own output to state is not a
 * mirror (that lesson cost three findings: Z24, Z25 and Z26).
 *
 * ONE thing IS imported, and it is worth being explicit about why: the published
 * name canonicalization. A mirror derives from the TREE, but the comparison is
 * against the PUBLISHED surface, and since #924's E half those two spellings
 * differ — `@"1Monochrome"` in the tree, `1Monochrome` published. The first
 * version of the `contains` truth re-implemented the rule and read 75 PHANTOM
 * and 75 MISSING on one shape (an enum whose members begin with a digit, which
 * zig makes you quote). So the rule is IMPORTED, not copied, and every derivation
 * here pushes `stripZigQuoting(name)` — with the reason in the file, because a
 * copied canonicalization rule is a rule that will drift.
 */

/**
 * ZIG WAVE 3/4 — the `contains` truth, the lane's LAST unoracled label.
 *
 * `contains` was 16.6% of everything this analyzer emits (5,521 of 33,266
 * relationships over 400 corpus files) and nothing had ever adjudicated it, for
 * a structural reason: the analyzer derives containment from `symbol.ownerName`,
 * a field its OWN walk sets, so the class is self-agreeing — it cannot disagree
 * with the symbol table because it is built from it. This derivation rebuilds the
 * owner chain from DECLARATION STRUCTURE instead, which is the only thing that
 * makes the comparison worth running.
 *
 * The rules, one per node shape, all mirrorable from the tree (which is the test
 * of a mirror: if a rule needs the analyzer's own output, it is not a mirror):
 *
 *   • the five container declarations own their `container_field` children —
 *     which is how fields, ENUM MEMBERS and union members all arrive, because in
 *     this grammar an enum body is `container_field` children and an error-set body
 *     is bare `identifier` children (two shapes, one rule each, not one guess);
 *   • an error set owns its direct `identifier` children;
 *   • a container owns its `function_declaration` children (methods) and its
 *     container-scope `variable_declaration` children (nested types, container-level
 *     consts and vars);
 *   • Z19: inside an executable body — a function body, a `test`, a `comptime`
 *     block, any `block` — a declaration is an execution artifact and is owned by
 *     nothing;
 *   • Z21: a container in an EXPRESSION position is anonymous and owns nothing;
 *   • Z22: and so is a container declared inside an executable body — a local type
 *     has no file-scope identity to own anything with. This is the rule the
 *     ownership verifier lacked in the derived direction: it only ever asked "is
 *     every PUBLISHED owner justifiable?", so a container that should own nothing
 *     and does was visible, and one that should own something and does not was not.
 *     Both directions are compared now, and the Z22 rule is what makes the missing
 *     direction reachable.
 *
 * KNOWN LIMIT, stated rather than left for a reader to infer from a clean count:
 * the F5 matcher keys on `label + normTarget(target)`, so this truth is compared
 * BY MEMBER NAME, not by (owner, member). It therefore convicts a fabricated or
 * missing edge whose name is wrong, and CANNOT convict one whose owner is wrong —
 * Z19 and Z21 each moved 335 edges to a different owner while keeping every member
 * name. The owner-sensitive half of the class is `script/m14/tmp/zigw-ownership.ts`,
 * which keys on the owner. The two together are the class; neither alone is.
 */
export function deriveZigContainment(root: any): { label: string; from: string; target: string }[] {
  const out: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const CONTAINERS = new Set([
    "struct_declaration", "union_declaration", "enum_declaration",
    "error_set_declaration", "opaque_declaration",
  ])
  // Z19: entering any of these means "declarations here are execution artifacts".
  const EXECUTABLE = new Set([
    "function_declaration", "function_signature", "test_declaration",
    "comptime_declaration", "block",
  ])
  const firstIdent = (n: any): string | null => {
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c && (c.type === "identifier" || c.type === "field_identifier" || c.type === "type_identifier")) {
        return String(c.text)
      }
    }
    return null
  }
  const push = (rawOwner: string, rawMember: string): void => {
    const owner = stripZigQuoting(rawOwner)
    const member = stripZigQuoting(rawMember)
    if (!owner || !member || member === "_") return
    const k = `${owner}\u0000${member}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ label: "contains", from: owner, target: member })
  }
  const visit = (n: any, owner: string | null, executable: boolean, anon: boolean): void => {
    let nextOwner = owner
    let nextAnon = anon
    let nextExec = executable

    if (CONTAINERS.has(n.type)) {
      const p = n.parent
      const declRhs =
        !!p && p.type === "variable_declaration" && p.namedChildCount > 0 &&
        p.namedChild(p.namedChildCount - 1)?.id === n.id
      if (declRhs) {
        const nameKid = p && p.namedChildCount > 0 ? p.namedChild(0) : null
        const name = nameKid && nameKid.type === "identifier" ? String(nameKid.text) : null
        // Z22: a container inside an executable body is a LOCAL type. It is
        // declared, so it has a name — but it owns nothing, and the analyzer
        // publishes none of its members, so deriving any would be a MISSING row
        // in the direction that does not exist.
        if (name && !executable) nextOwner = name
        else nextAnon = true
      } else {
        // Z21: an anonymous container in an expression position owns nothing.
        nextAnon = true
      }
    } else if (!executable && !anon) {
      if (n.type === "container_field") {
        if (owner) push(owner, firstIdent(n) ?? "")
      } else if (n.type === "function_declaration") {
        if (owner) push(owner, firstIdent(n) ?? "")
        nextExec = true
      } else if (n.type === "variable_declaration") {
        // a container-scope declaration is a member (nested type, container const)
        // — EXCEPT an import alias, which Z9 settled deliberately: it mints an
        // import fact and a reference edge and no symbol, so there is no
        // `contains` edge to match. The first version derived those and read 5
        // MISSING rows (`terminal -> color`, `terminal -> style`, `Inspector ->
        // cimgui` — all `const x = @import("...")` inside a container).
        const kids: any[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) kids.push(c)
        }
        // An import ALIAS mints a symbol at file and container scope, and NOT
        // inside a function body (Z9, the family's LocalsAreNotSymbols rule).
        //
        // The exception was once unconditional, because the analyzer behaved that
        // way: Z35 found the real rule was "an @import binding is a symbol only
        // when its right-hand side is longer than the import itself", which is not
        // a rule a language has. When the analyzer changed, this mirror's stale
        // copy showed up as 4 PHANTOM rows on exactly the container-scope aliases
        // it used to exclude — a mirror written against yesterday's contract is
        // not a mirror, it is a second opinion of the wrong thing.
        const isImportAlias = kids.some(
          (c) => c.type === "builtin_function" && String(c.text ?? "").replace(/^@/, "").startsWith("import"),
        )
        if (owner && !(isImportAlias && executable)) push(owner, firstIdent(n) ?? "")
      }
    }
    // NOTE ON ERROR-SET MEMBERS: the first version of this truth pushed one row
    // per direct `identifier` child of an error set (an error set\'s body IS bare
    // identifiers in this grammar, unlike every other container) and read 13
    // MISSING rows that were all the TRUTH\'s error: the published contract (Z4) is
    // that an error-set member is a DECLARATION SITE and an edge target — it
    // resolves by name in `error.X` expressions — and is deliberately not a symbol,
    // so it has no `contains` edge to match. Enum members ARE symbols (1,361 of
    // ERROR-SET MEMBERS are their own rule, and the first version of this file
    // was wrong about them in the other direction: it read 13 MISSING and I
    // concluded the analyzer published no error members as symbols. It DOES — as
    // `enum_member`, owned by the set (`contains Error -> OutOfMemory`), which is
    // why 1,361 of them are in the owned-kind census and why deleting this branch
    // turned those 13 MISSING into 224 PHANTOM. An error set's body is bare
    // `identifier` children where every other container uses `container_field`,
    // so the shape is a separate rule and not a case of the one above. This is
    // the calibration the header asks for: a new gate is run against a KNOWN
    // case before its verdict is believed, and twice the first run was the
    // INSTRUMENT rather than the analyzer.
    // `nextAnon`, not the incoming `anon`: `pub const E = error{A} || error{B}`
    // puts the sets inside a binary expression, so the container rule above
    // already marked them anonymous (Z21 — an expression-position container owns
    // nothing), and the member rule has to read THAT state. Reading the incoming
    // state instead is what produced the `Options -> InvalidValue` MISSING rows.
    if (n.type === "error_set_declaration" && !nextAnon && !nextExec) {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "identifier") push(nextOwner ?? "", String(c.text))
      }
    }
    if (EXECUTABLE.has(n.type)) nextExec = true
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) visit(c, nextOwner, nextExec, nextAnon)
    }
  }
  visit(root, null, false, false)
  return out
}


// ── Z30: the `imports` class ────────────────────────────────────────────────
/**
 * `@import("std")` / `@cImport(…)` / `usingnamespace @import(…)`.
 *
 * An import names a MODULE, not a symbol, which is why this is its own
 * relationship type in the engine's contract (`imports`) and why the family's
 * other lanes emit it: c moved to it in #910, go's own `requiredKinds` has named
 * it since its wave, and 17 analyzers publish it. The consumers are real too —
 * `graph-engine.ts`, `brain-relationship-enrichment.ts` and the MCP tool handler
 * all read the `imports` type, so a lane that omits it has no import graph at
 * all rather than a sparser one.
 *
 * Measured on 400 corpus files: 1,458 import facts, 394 distinct module
 * targets, and 176 targets contain a path separator (`../global.zig`,
 * `../build/gresource.zig`) — strings that are not legal Zig declaration names
 * and could never be one, which is the same argument go made for moving its own
 * import edges off `references`.
 *
 * The shape, measured rather than assumed: `@import("x")` is a
 * `builtin_function` whose `builtin_identifier` child is `@import` and whose
 * `string` child has a `string_content` grandchild. `@cImport({…})` is the same
 * shape with `@cInclude` NESTED inside it, so the module path is absent and there
 * is no target to publish — the fact is recorded, the edge is not. That asymmetry
 * is the analyzer's and the mirror's, and it is stated here because a reader
 * comparing 1,458 facts to fewer edges should know why without reading the code.
 */
export function deriveZigImports(root: any): { label: string; from: string; target: string; line: number }[] {
  const out: { label: string; from: string; target: string; line: number }[] = []
  const seen = new Set<string>()
  const unquote = (t: string): string => {
    const s = String(t ?? "")
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1)
    return s
  }
  const visit = (n: any): void => {
    if (n.type === "builtin_function" || n.type === "call_expression") {
      const id = n.type === "builtin_function"
        ? (() => { for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && (c.type === "builtin_identifier" || c.type === "identifier")) return c } return null })()
        : (n.namedChildCount > 0 ? n.namedChild(0) : null)
      const text = String(id?.text ?? "")
      if (text === "@import" || text === "@cImport" || text === "import") {
        // The module path. MEASURED SHAPE, and the first version of this rule
        // got it wrong: in the pinned corpus the string lives under an
        // `arguments` node (`builtin_function[builtin_identifier, arguments]`),
        // and the derivation returned 0 sites over 400 files while the analyzer
        // published 1,458 — which is what a first-run instrument is supposed to
        // look like, and the reason the gate reports both directions. So: the
        // string is looked for on the builtin_function itself AND on its
        // `arguments` child, and only at ONE level, because an `@cImport` nests
        // its `@cInclude` strings inside and those are include paths, not this
        // import's module.
        let str: any = null
        const scan = (host: any): any => {
          for (let i = 0; i < host.namedChildCount; i++) {
            const c = host.namedChild(i)
            if (c && (c.type === "string" || c.type === "string_content")) return c
          }
          return null
        }
        str = scan(n)
        if (!str) {
          let args: any = null
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && c.type === "arguments") { args = c; break }
          }
          if (args) str = scan(args)
        }
        if (str && str.type === "string") {
          for (let i = 0; i < str.namedChildCount; i++) {
            const sc = str.namedChild(i)
            if (sc && sc.type === "string_content") { str = sc; break }
          }
        }
        if (str) {
          const target = unquote(str.text)
          if (target) {
            const line = (str.startPosition?.row ?? n.startPosition?.row ?? 0) + 1
            const key = `${line}|${target}`
            if (!seen.has(key)) {
              seen.add(key)
              out.push({ label: "imports", from: "(global)", target, line })
            }
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) visit(c)
    }
  }
  visit(root)
  return out
}

// ── Z32: the `instantiates` classes ─────────────────────────────────────────
/**
 * Two statically derivable instantiations, mirroring `analyzeZigInstantiation`.
 *
 * 1. GENERIC TYPE APPLICATION — a call to an in-file `fn … type`. The inventory is
 *    the tree's own `function_declaration` nodes whose `type` field is the `type`
 *    builtin: 34 of them and 82 application sites in 400 corpus files.
 * 2. CONSTRUCTION — `TypeName{ … }` where TypeName is an in-file declared type:
 *    101 sites in 400 files. The measured shape is
 *    `struct_initializer[identifier, initializer_list]`, so the type name is the
 *    first named child. `.{ … }` is an `anonymous_struct_initializer` with no
 *    name and is deliberately NOT an instantiation (Z21's anonymous-container
 *    ruling: a container with no stable identity instantiates nothing), and a
 *    qualified application (`std.ArrayList(u8)`) is a `field_expression` callee,
 *    not an in-file type, so it is out of scope for both the analyzer and this
 *    mirror — stated here because "we only mirror in-file types" is a LIMITATION
 *    of the class, not a property of it: an external generic application is real
 *    and unmeasured.
 *
 * ZIG.D.1 ruled this relationship type out on the grounds that generics are
 * "compile-time monomorphized without a runtime type dispatch the analyzer can
 * attribute statically". The measurement contradicts the reason, not the taste:
 * these two classes need no dispatch and no monomorphization knowledge at all.
 */
export function deriveZigInstantiation(root: any): { label: string; from: string; target: string; line: number; class: string }[] {
  const out: { label: string; from: string; target: string; line: number; class: string }[] = []
  const typeNames = new Set<string>()
  const typeFns = new Set<string>()
  const lineOf = (n: any): number => (n?.startPosition?.row ?? 0) + 1

  const inv = (n: any): void => {
    if (n.type === "function_declaration" || n.type === "function_signature") {
      const t = n.childForFieldName?.("type")
      if (t && (t.type === "builtin_type" || t.type === "identifier") && String(t.text) === "type") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "identifier") { typeFns.add(String(c.text)); break }
        }
      }
    }
    if (n.type === "struct_declaration" || n.type === "enum_declaration" || n.type === "union_declaration" || n.type === "opaque_declaration") {
      const p = n.parent
      if (p && p.type === "variable_declaration" && p.namedChildCount > 0 && p.namedChild(0)?.type === "identifier") {
        typeNames.add(String(p.namedChild(0).text))
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) inv(c) }
  }
  inv(root)

  const enclosing = (n: any): string => {
    let cur = n.parent
    while (cur) {
      if (cur.type === "function_declaration" || cur.type === "test_declaration") {
        for (let i = 0; i < cur.namedChildCount; i++) {
          const c = cur.namedChild(i)
          if (c && c.type === "identifier") return String(c.text)
        }
      }
      cur = cur.parent
    }
    return "(global)"
  }
  const seen = new Set<string>()
  const sites = (n: any): void => {
    if (n.type === "call_expression") {
      const callee = n.namedChildCount > 0 ? n.namedChild(0) : null
      if (callee && callee.type === "identifier" && typeFns.has(String(callee.text))) {
        const k = `g|${enclosing(n)}|${callee.text}|${lineOf(callee)}`
        if (!seen.has(k)) { seen.add(k); out.push({ label: "instantiates", from: enclosing(n), target: String(callee.text), line: lineOf(callee), class: "generic type application" }) }
      }
    }
    if (n.type === "struct_initializer" || n.type === "struct_literal") {
      const first = n.namedChildCount > 0 ? n.namedChild(0) : null
      // The head is frequently QUALIFIED, and the two shapes the corpus uses are
      // a `field_expression` (`Color.C{ .r = 1 }`, `T.KV{ .key = 0 }` where T is
      // a test's type parameter) and a `call_expression`
      // (`std.ArrayList(u8){}`). The first version of this rule accepted only an
      // `identifier` head and read 2 PHANTOM rows as a result — the analyzer was
      // right on both and the mirror was incomplete, which is the mirror's own
      // failure mode and the reason this file states the shapes it accepts.
      const headOk = !!first && (first.type === "identifier" || first.type === "field_expression" || first.type === "type_identifier" || first.type === "call_expression")
      if (first && headOk) {
        const raw = String(first.text ?? "")
        const nm = raw.includes(".") ? raw.slice(raw.lastIndexOf(".") + 1) : raw
        // a call_expression head is a generic APPLICATION head, not a plain
        // type name — `ArrayList` is the nominal type, and whether it is
        // instantiable in-file is ZIG.D.1's question, not this rule's
        if (first.type !== "call_expression" && typeNames.has(nm)) {
          const k = `c|${enclosing(n)}|${nm}|${lineOf(first)}`
          if (!seen.has(k)) { seen.add(k); out.push({ label: "instantiates", from: enclosing(n), target: nm, line: lineOf(first), class: "construction" }) }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) sites(c) }
  }
  sites(root)
  return out
}

// ── Z33: the `exports` class ────────────────────────────────────────────────
/**
 * File-scope `pub` declarations: the module's public API surface.
 *
 * Z20's ruling holds and is mirrored here rather than re-decided: a `pub`
 * declaration INSIDE a container is reached as `Container.member`, so it is a
 * `contains` edge and its `pub` is the member's `visibility: "public"`; only a
 * file-scope `pub` names a binding an importer can actually use. The test for
 * "file scope" is structural — no enclosing container whose body the declaration
 * sits in — so it needs no symbol table and no inference.
 *
 * Measured: 1,465 exported declarations in 391 of 400 corpus files.
 */
export function deriveZigExports(root: any): { label: string; from: string; target: string; line: number }[] {
  const CONTAINERS = new Set(["struct_declaration", "union_declaration", "enum_declaration", "opaque_declaration", "error_set_declaration"])
  const out: { label: string; from: string; target: string; line: number }[] = []
  const seen = new Set<string>()
  // `pub` OR `export`: both make a file-scope declaration part of the module's
  // published surface, and `export fn ghostty_config_new(...)` is zig's C-ABI
  // export form. The first version of this rule looked only for `pub` and read 18
  // PHANTOM rows — the analyzer was exporting a form the mirror did not know.
  const hasPub = (n: any): boolean => {
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c && !c.isNamed && (c.type === "pub" || c.type === "export")) return true
    }
    return false
  }
  const insideContainer = (n: any): boolean => {
    let cur = n.parent
    while (cur) {
      if (CONTAINERS.has(cur.type)) return true
      if (cur.type === "source_file") return false
      cur = cur.parent
    }
    return false
  }
  const firstIdent = (n: any): string | null => {
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c && c.type === "identifier") return String(c.text)
    }
    return null
  }
  const walk = (n: any): void => {
    if (
      (n.type === "variable_declaration" || n.type === "function_declaration") &&
      hasPub(n) && !insideContainer(n)
    ) {
      const rawName = firstIdent(n)
      const name = rawName ? stripZigQuoting(rawName) : null
      if (name) {
        const line = (n.startPosition?.row ?? 0) + 1
        const k = `${name}|${line}`
        if (!seen.has(k)) {
          seen.add(k)
          out.push({ label: "exports", from: "(file)", target: name, line })
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
  }
  walk(root)
  return out
}
