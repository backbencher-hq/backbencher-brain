import { stripZigQuoting, ZIG_DECLARED_TYPE_BUILTINS } from "../../src/ast/real-zig-analyzer"

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
 * The `references` oracle below (Z14) was committed into the SHARED differential
 * and the 2026-09-29 merge deleted it — along with zig's compared-label set, so the lane
 * was reporting coverage of a class it was no longer auditing, and nobody noticed
 * because the number still looked like a pass. It lives here now, for the same
 * reason the others do: a lane's gates must not be one merge away from gone.
 *
 * TWO things are imported here, and both are for the same reason — a copied rule
 * drifts. The published name canonicalization: A mirror derives from the TREE, but the comparison is
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
    // Z53: the blank-identifier test belongs on the RAW spelling, not the
    // canonicalized one. `const _ = 1;` and `var _ = x;` bind the blank identifier
    // and declare nothing (Z8/GO5), and their node text is exactly `_`. An ENUM
    // MEMBER spelled `@"_"` is a real, deliberately named member — zig's x86 backend
    // does exactly this: `const Label = enum { @"0:", @"1:", …, @"_", pseudo }` —
    // and testing the STRIPPED form threw it away, so the analyzer published
    // `contains Label -> _` and the truth had no row for it: 3 unexplained rows at
    // full corpus, in files no 200-file draw reached.
    //
    // This is Z46's distinction (a blank in a BINDING is a discard; a blank in a
    // DECLARATION is a name) applied to the oracle for the first time. Three fixes
    // in three places is not three coincidences: it is one rule that was never
    // written as a rule.
    const isBlankIdentifier = String(rawMember ?? "").trim() === "_"
    if (!owner || !member || isBlankIdentifier) return
    // `~~` cannot occur inside a zig identifier, so the composite key is
    // unambiguous. A literal NUL would do the same job and did — but it made this
    // file BINARY to git, and an oracle nobody can read as text is an oracle
    // nobody reviews.
    const k = `${owner}~~${member}`
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
        const name = nameKid && nameKid.type === "identifier" ? stripZigQuoting(String(nameKid.text ?? "")) : null
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
        if (c && c.type === "identifier") push(nextOwner ?? "", stripZigQuoting(String(c.text ?? "")))
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
// ONE import-site walk, shared by the two classes the analyzer publishes from
// it. Z30 established that an `@import` is a first-class graph fact and emits a
// TWIN: `imports <path>` for the module, and `references <path>` for the same
// literal, the second classified `import_based` by classifyEvidenceTier rather
// than `declared_type`. The twin was in the analyzer from the start and in NO
// truth, so F5 counted it as unexplained while all four of the lane's
// bidirectional gates stayed 0/0 — they compare per site, per owner key or per
// (label, target, source set), and an edge absent from the truth entirely is
// invisible to every one of them. 29 `references → std` rows in 120 files, plus
// the same shape for path literals (`src/dev.zig`).
//
// The walk lives here, ONCE, because the alternative is the third spelling of
// the import rule and Z24/Z25/Z29 are all what that costs.
export interface ZigImportSite { target: string; line: number }

export function deriveZigImportSites(root: any): ZigImportSite[] {
  const out: ZigImportSite[] = []
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
              out.push({ target, line })
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
/** Z30: the `imports` edge — the module named by the path literal. */
export function deriveZigImports(root: any): { label: string; from: string; target: string; line: number }[] {
  return deriveZigImportSites(root).map(site => ({ label: "imports", from: "(global)", target: site.target, line: site.line }))
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
          if (c && c.type === "identifier") { typeFns.add(stripZigQuoting(String(c.text ?? ""))); break }
        }
      }
    }
    if (n.type === "struct_declaration" || n.type === "enum_declaration" || n.type === "union_declaration" || n.type === "opaque_declaration") {
      const p = n.parent
      if (p && p.type === "variable_declaration" && p.namedChildCount > 0 && p.namedChild(0)?.type === "identifier") {
        typeNames.add(stripZigQuoting(String(p.namedChild(0).text ?? "")))
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

/**
 * ZIG WAVE 2 — the `references` ORACLE source, kept as a probe so the text
 * survives a /tmp cleaner: the canonical copy lives in
 * `script/m14/differential.ts` as `deriveZigReferenceEdges`, and this file is
 * what was spliced in. Kept because the oracle is the lane's only second
 * opinion for its largest emitted class, and an oracle that exists only in a
 * patch is an oracle nobody can review.
 *
 * WHY THIS EXISTS. Until now the zig lane's differential derived `calls` and
 * `uses` and nothing else, so the `references` class — declared-type
 * dependencies and import edges, the largest emitted class on the zig corpora —
 * was compared against NOTHING. The allowlist that keeps the comparison honest
 * dropped the analyzer's own `references` edges from the compared side, so a
 * fabricated declared-type reference, a lost one, and a corrupted one were all
 * invisible: the lane reported 100% coverage with a phantom type reference in
 * the graph.
 *
 * The three measured defects this oracle now audits, all of which the class's
 * own gates could not see:
 *   - the default VALUE was the declared type (`size: Size = .byte` published
 *     `-> byte`);
 *   - a type that names nothing published its FIELD name or its error member;
 *   - the local annotation position was absent from the collector.
 *
 * INDEPENDENCE. Every POSITION and every LEAF is re-derived here with its own
 * traversal. The one shared object with the analyzer is
 * `ZIG_DECLARED_TYPE_BUILTINS`, the type-name vocabulary, IMPORTED rather than
 * re-typed (the #916 lesson: a second copy of a name set is a second answer,
 * and two copies that cancel out of every count is how a self-agreeing edge
 * survives a year of gates). The leaf rules below MIRROR the analyzer's rather
 * than importing them, so the two implementations can disagree — and the
 * red-team in `zigw-oracle-check.ts` is what proves they do.
 */
export function deriveZigReferenceEdges(root: any): { label: string; from: string; target: string; line?: number }[] {
  const edges: { label: string; from: string; target: string; line?: number }[] = []
  const seen = new Set<string>()
  const push = (target: string, from: string) => {
    const t = String(target ?? "")
    if (!t) return
    if (ZIG_DECLARED_TYPE_BUILTINS.has(t)) return
    // the analyzer's digit-head refusal (`123abc`-style heads are not types)
    const c0 = t.charCodeAt(0)
    if (c0 >= 48 && c0 <= 57) return
    const key = "references:" + t
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ label: "references", from, target: t })
  }

  const direct = (p: any, type: string): any | null => {
    if (!p) return null
    for (let i = 0; i < p.namedChildCount; i++) {
      const c = p.namedChild(i)
      if (c && c.type === type) return c
    }
    return null
  }
  const fieldOf = (n: any, name: string): any | null =>
    n && typeof n.childForFieldName === "function" ? n.childForFieldName(name) ?? null : null

  // ── imports: `@import("x")` as a declaration RHS, or a usingnamespace ──────
  // The module path is a `string` under `arguments`; the quotes are stripped
  // because the published target is a module NAME. A builtin inside an ERROR
  // node is not a direct child, so the error-recovered
  // `const x = usingnamespace @import("y.zig")` (invalid in current Zig) yields
  // no import on EITHER side — which is the analyzer's own rule, mirrored.
  const importTarget = (callOrBuiltin: any): string | null => {
    const bi = direct(callOrBuiltin, "builtin_identifier")
    if (!bi || (bi.text !== "@import" && bi.text !== "@cImport")) return null
    const args = direct(callOrBuiltin, "arguments")
    const str = args ? direct(args, "string") ?? direct(args, "string_content") : null
    if (!str) return null
    const raw = String(str.text ?? "")
    if (raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))) {
      return raw.slice(1, -1)
    }
    return raw
  }

  // ── declared types: the grammar's `type` FIELD, never a walk ───────────────
  // Mirrors the analyzer's `leafOfTypeNode`:
  //   - a container literal in a type position is ANONYMOUS (fields, no name);
  //   - an `error_type` is an unnamed set;
  //   - `!T` keeps its dependency in the `ok` half;
  //   - a labeled_type_expression names nothing knowable without its block;
  //   - otherwise the last `identifier` at or under the type node.
  const leaf = (t: any, depth = 0): string | null => {
    if (!t || depth > 6) return null
    if (t.type === "identifier") return String(t.text ?? "")
    if (t.type === "error_union_type") {
      const ok = fieldOf(t, "ok")
      return ok ? leaf(ok, depth + 1) : null
    }
    if (t.type === "error_type" || t.type === "labeled_type_expression") return null
    if (t.type === "struct_declaration" || t.type === "union_declaration" || t.type === "enum_declaration" || t.type === "error_set_declaration") return null
    let found: string | null = null
    const stack: any[] = [t]
    let guard = 0
    while (stack.length > 0 && guard++ < 200) {
      const n = stack.pop()!
      if (n.type === "identifier") found = String(n.text ?? "")
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return found
  }
  const typeLeafFor = (decl: any): string | null => {
    const tf = fieldOf(decl, "type")
    if (tf) return leaf(tf)
    if (decl.type === "container_field" || decl.type === "variable_declaration") return null
    // parameter: a fn-TYPE parameter has no name and its child is the type; a
    // NAMED parameter with no type field is a recovered shape, where the type is
    // the first identifier after the name.
    const nameF = fieldOf(decl, "name")
    if (!nameF) return leaf(decl)
    const stack: any[] = []
    for (let i = decl.namedChildCount - 1; i >= 0; i--) {
      const c = decl.namedChild(i)
      if (c && c.id !== nameF.id) stack.push(c)
    }
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "identifier") return String(n.text ?? "")
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return null
  }

  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = n.type
    if (t === "function_declaration" || t === "function_signature") {
      const params = direct(n, "parameters")
      if (params) {
        for (let i = 0; i < params.namedChildCount; i++) {
          const p = params.namedChild(i)
          if (p && p.type === "parameter") push(typeLeafFor(p), "(declared-type)")
        }
      }
      // the return type is the grammar's `type` field (37,129 of 37,129 corpus
      // functions carry one); the positional fallback mirrors the analyzer's
      const ret = fieldOf(n, "type")
      if (ret) {
        push(leaf(ret), "(declared-type)")
      } else {
        const kids: any[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) kids.push(c)
        }
        for (let i = kids.length - 1; i >= 0; i--) {
          const c = kids[i]
          if (c.type === "block" || c.type === "parameters" || c.type === "block_expression") continue
          if (i === 0 && c.type === "identifier") continue
          if (c.type === "calling_convention") continue
          push(leaf(c), "(declared-type)")
          break
        }
      }
    } else if (t === "container_field" || t === "variable_declaration") {
      push(typeLeafFor(n), "(declared-type)")
    }
    if (t === "variable_declaration") {
      const kids: any[] = []
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) kids.push(c)
      }
      const rhs = kids.length > 0 ? kids[kids.length - 1] : null
      if (rhs && (rhs.type === "call_expression" || rhs.type === "builtin_function")) {
        const target = importTarget(rhs)
        if (target) push(target, "(global)")
      }
    }
    if (t === "using_namespace_declaration") {
      const target = importTarget(direct(n, "builtin_function"))
      if (target) push(target, "(global)")
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  // Z40: the `references` TWIN of every import site — the same path literal on the
  // same line, published by the analyzer since Z30 and by no truth until now.
  // `references` is the label the engine resolves names through, so an import
  // whose module is absent there is a module the graph cannot reach; the twin is
  // load-bearing, and its absence from the truth was a hole in the ORACLE, not a
  // redundant edge to be tidied away.
  //
  // Pushed last, and deduped on its own `import-twin|target|line` key, so a
  // declared-type edge that happens to name the same module stays visible as a
  // separate row instead of being absorbed — that collision is information.
  for (const site of deriveZigImportSites(root)) {
    const key = `import-twin|${site.target}|${site.line}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push({ label: "references", from: "(global)", target: site.target, line: site.line })
  }

  return edges
}

// ── Z37: the two EDGE truths, moved here and given a SOURCE ───────────────────
// `calls`, field-path `uses` and bare-identifier `uses` — 24,743 of this lane's 38,271
// relationships over 400 corpus files, and the two classes the shared matcher CANNOT
// fully adjudicate, because it keys on `label + normTarget(target)` and DISCARDS
// `from`. A read attributed to the wrong function is a wrong graph, and a name-level
// gate cannot see it: that is the Z22 shape, one class up.
//
// They lived in the shared differential, where a merge could restore a STALE copy:
// on 2026-09-29 the file came back with a THIRD variant of the bare-read truth —
// no Z15 operator test, no Z24 branch scoping, and Z25\u0027s node-identity test reverted
// to "first identifier child" — which is why the seven-class F5 draw read 17 MISSING
// and 43 unexplained while a direct per-file comparison against this lane\u0027s own
// truth agreed exactly. A mirror kept in a file other lanes rewrite is a mirror that
// will be wrong in a way nobody notices, so the definitions live here and the harness
// imports them. `zigw-uses-calls.ts` then compares the SOURCE as well as the name.

function zigPlainAssignment(n: any): boolean {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && !c.isNamed && c.type === "=") return true
  }
  return false
}

export function deriveZigEdgesWithSource(
  root: any,
): { label: string; from: string; target: string; line: number }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seenCalls = new Set<string>()
  const seenUses = new Set<string>()
  // ZGD1/ZGD5/ZGD5b oracle mirroring (zig wave M37 #600): F5 previously only
  // compared calls/uses here, so these facets were gate-invisible on BOTH
  // sides. Now the oracle is the independent derivation the differential
  // was always meant to be.
  const TYPE_POSITIONS = new Set(["parameter", "container_field", "function_declaration"])
  const leafOf = (fe: any): string | undefined => {
    if (!fe) return undefined
    const last = fe.namedChildCount > 0 ? fe.namedChild(fe.namedChildCount - 1) : null
    if (last && last.type === "identifier") return stripZigQuoting(String(last.text ?? ""))
    return undefined
  }
  // Z37: the ENCLOSING FUNCTION, carried as a stack, so every row names the symbol
  // the edge is attributed to. The harness matcher keys on `label + normTarget`
  // and discards `from`, so the source was never adjudicated — which is the Z22
  // shape for the two classes that are 83% of this lane's edges (uses 13,278 +
  // calls 11,465 of 38,271 over 400 corpus files). A read attributed to the wrong
  // function is a wrong graph, and no name-level gate can see it.
  const enclosing = (n: any, fn: string | null): string | null => {
    if (n.type === "function_declaration" || n.type === "test_declaration") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        // Z51: canonicalized, and this is the SECOND of two scope sites. The first
        // fix landed on the bare-read pass's copy, and the full-corpus run still
        // reported 364 wrong-source rows concentrated in aro/Hideset.zig, where
        // `pub fn @"union"(...)` is a legal quoted-keyword function and this site
        // returned `@"union"` raw against an analyzer that publishes `union`. Two
        // copies of one rule, and fixing one of them is precisely the mistake
        // Z24/Z25/Z29 were about: the rule is written once and called from both.
        if (c && c.type === "identifier") return stripZigQuoting(String(c.text ?? ""))
      }
    }
    return fn
  }
  const stack: any[] = [{ n: root, fn: null }]
  while (stack.length > 0) {
    const { n, fn } = stack.pop()!
    if (n.type === "call_expression") {
      const callee = n.namedChildCount > 0 ? n.namedChild(0) : null
      let leaf: string | undefined
      if (callee && callee.type === "identifier") leaf = callee.text
      else if (callee && callee.type === "field_expression") leaf = leafOf(callee)
      // ZGD4 mirror: usingnamespace is an import operator, not a user symbol.
      if (leaf === "usingnamespace") leaf = undefined
      // Z37: the dedupe key carries the SOURCE, because the analyzer's does
      // (`${source}->${leaf}`). Keyed on the leaf alone, the first call site claims
      // the name and every later call to the same name from a different function is
      // suppressed — so the mirror not only missed those rows, it attributed the
      // ones it kept to the WRONG function, which is the same defect as the one it
      // was built to find.
      const src = fn ?? "(global)"
      if (leaf && !seenCalls.has(`call:${src}:${leaf}`)) {
        seenCalls.add(`call:${src}:${leaf}`)
        edges.push({ label: "calls", from: src, target: stripZigQuoting(leaf), line: (n.startPosition?.row ?? 0) + 1 })
      }
    }
    if (n.type === "field_expression") {
      const parent = (n as any).parent
      const isCallee = !!parent && parent.type === "call_expression"
      // ZGD5: single-named-child field_expression is `.bad` enum literal /
      // `.{...}` init field — no base, not a member read.
      const isEnumLiteral = n.namedChildCount < 2
      // ZGD1: zig assignments parse as variable_declaration, LHS = first
      // named child (probe-verified). An assignment LHS is a WRITE.
      // ZGD1: zig assignments parse as variable_declaration, LHS = first
      // named child (probe-verified). An assignment LHS is a WRITE.
      // Z15 mirror (2026-09-28): the gate tests the OPERATOR and the assignment
      // node type too. A plain `=` writes without reading; `+=`/`|=`/`*%=` read
      // their left side as well, and `while (i < n) : (i += 1)` is Zig's own
      // idiom for it; an `assignment_expression` LHS is the `.field = value` key
      // of a struct literal, which is a write as well. Without this mirror the
      // oracle and the analyzer disagreed about exactly those two shapes — a
      // 200-file draw read 28 MISSING and 3 UNEXPLAINED before the mirror and
      // 6,866/6,866 covered after it.
      const isAssignLhs =
        !!parent &&
        (parent.type === "variable_declaration" || parent.type === "assignment_expression") &&
        parent.namedChild(0)?.id === n.id &&
        zigPlainAssignment(parent)
      // ZGD5b: type-annotation positions are declared-type facts, not reads.
      // Z38 mirror, field-pass site: this was the ORIGINAL direct-parent test, and
      // it is the shape that let every segment of a dotted type path through — the
      // analyzer's own copy was the same one-level rule. It now walks the chain the
      // same way, so the two sides cannot disagree about which nodes are TYPE
      // FACTS rather than reads. Both mirrors are taught by the same finding, which
      // is the point: one rule, and the gate that convicts a copy of it.
      const VALUE_BOUNDARY = new Set([
        "call_expression", "block", "block_expression", "arguments",
        "assignment_expression", "assignment_statement",
        "compound_assignment_statement", "struct_initializer",
        "anonymous_struct_initializer", "initializer_list",
        "composite_literal", "variable_declaration", "return_expression",
        "if_expression", "switch_expression", "while_expression", "for_expression",
      ])
      const isTypePos = (() => {
        let cur: any = parent
        let hops = 0
        while (cur && hops < 8) {
          if (TYPE_POSITIONS.has(cur.type) || cur.type === "function_signature") return true
          if (VALUE_BOUNDARY.has(cur.type)) return false
          cur = cur.parent
          hops++
        }
        return false
      })()
      if (!isCallee && !isEnumLiteral && !isAssignLhs && !isTypePos) {
        const leaf = stripZigQuoting(leafOf(n) ?? "")
        if (leaf && !seenUses.has(`use:${fn ?? "(global)"}:${leaf}`)) {
          seenUses.add(`use:${fn ?? "(global)"}:${leaf}`)
          edges.push({ label: "uses", from: fn ?? "(global)", target: stripZigQuoting(leaf), line: (n.startPosition?.row ?? 0) + 1 })
        }
      }
    }
    const nextFn = enclosing(n, fn)
    for (let k = n.namedChildCount - 1; k >= 0; k--) {
      const c = n.namedChild(k)
      if (c) stack.push({ n: c, fn: nextFn })
    }
  }
  return edges
}

export function deriveZigBareUsesWithSource(
  root: any,
  symbols: any[] = [],
): { label: string; from: string; target: string; line: number }[] {
  // Z3 mirror (zig review): bare value reads (`return MAX`) — the analyzer
  // and this oracle were BOTH blind to them. Same contract as the analyzer,
  // rule for rule: file-scope const/var/fn/enum-member resolution (plus the
  // global error-member set for `error.X` value leaves), declaration
  // positions (first-identifier rule), call-callee span climb, member
  // leaves (field path owns them), qualified non-leaves, labels, blank,
  // LHS writes, shadowing via walk-order lexical scopes.
  const edges: { label: string; from: string; target: string; line: number }[] = []
  const seen = new Set<string>()
  const fileValues = new Set<string>()
  const enumMembers = new Set<string>()
  // Name inventory comes from the analyzer's own symbols (passed by the
  // lane): file-scope Constant/Variable/Function/EnumMember kinds plus ALL
  // EnumMember names globally. Truth still derives every EDGE independently
  // from tree structure (positions, gates, shadowing) — only the name
  // inventory is shared ground truth, exactly like the grammar itself. This
  // permanently closes the pre-pass-divergence class (owner-blindness,
  // kind-dispatch order, container attribution) that produced 70+ phantom
  // MISSING edges when the oracle re-derived declarations on its own.
  for (const s of symbols ?? []) {
    if (!s || typeof s.name !== "string") continue
    const k = String(s.kind ?? "");
    const isEnumMember = k === "EnumMember" || k === "enummember" || k === "enum_member";
    if (isEnumMember) enumMembers.add(s.name);
    const isValue = k === "Constant" || k === "constant" || k === "Variable" || k === "variable" || k === "Function" || k === "function" || isEnumMember;
    if (isValue && !s.ownerName && !s.owner) fileValues.add(s.name);
  }
  const scopes: Array<Set<string>> = []
  const shadowed = (name: string): boolean => {
    for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(name)) return true
    return false
  }
  const bindIds = (node: any, out: Set<string>): void => {
    const w: any[] = [node]
    while (w.length > 0) {
      const m = w.pop()!
      if (m !== node && (m.type === "call_expression" || m.type === "composite_literal" || m.type === "func_literal" || m.type === "block" || m.type === "block_expression")) continue
      if (m.type === "identifier" && m.text !== "_") out.add(m.text)
      for (let i = m.namedChildCount - 1; i >= 0; i--) { const c = m.namedChild(i); if (c) w.push(c) }
    }
  }
  // Z7 mirror: a parameter binds its declared NAME only (see the analyzer).
  const bindFirstIdent = (node: any, out: Set<string>): void => {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === "identifier") {
        if (c.text !== "_") out.add(c.text)
        return
      }
    }
  }
  const isDefining = (n: any): boolean => {
    const p = n.parent
    if (!p) return false
    // Error sets declare EVERY direct member (mirrors the analyzer).
    if (p.type === "error_set_declaration" && n.type === "identifier") return true
      // Z15 mirror (2026-09-28): a COMPOUND assignment is a read-modify-write,
      // not a definition — `counter += 1` reads the file-scope `counter` before
      // writing it. A plain `=` stays a definition.
      //
      // Z24 (2026-09-29): that operator test belongs to the ASSIGNMENT-shaped
      // parents ONLY. Written as a bare early `return false` for every parent,
      // it short-circuited the declaration branch below it, so the truth derived
      // a bare read for the NAME OF EVERY FUNCTION AND FIELD it walked past —
      // `uses (expr) -> init` at the `pub fn init(` line itself. F5 read ~970
      // MISSING on a 200-file draw and the analyzer was blameless: it had never
      // emitted those edges, correctly. The size is one phantom row per
      // file-scope declaration, so the number moves with the DRAW (6,866-edge
      // draw: 0 missing; 10,635-edge draw: 970) and reads like a sampling
      // artefact rather than like a gate defect. Provenance of every one of them
      // was the declaration site, never a use.
      if (
        p.type === "variable_declaration" || p.type === "assignment_expression" ||
        p.type === "compound_assignment_statement" || p.type === "assignment_statement"
      ) {
        if (!zigPlainAssignment(p)) return false
        // Z25 mirror (2026-09-29): the LHS test is NODE IDENTITY with the
        // first named child, not "the first child of type `identifier`". In a
        // struct literal the KEY is a `field_identifier` (`.id = base_id`), so
        // the first IDENTIFIER child is the VALUE — and the old test read
        // `.id = base_id` as *defining* `base_id`, dropping a genuine bare read of
        // a file-scope name. Same rule as the ZGD1 field-path mirror above, which
        // already used node identity: one rule, two places.
        const lhs = p.namedChild(0)
        return !!lhs && lhs.id === n.id
      }
    if (
      p.type === "function_declaration" || p.type === "test_declaration" ||
      p.type === "struct_item" || p.type === "enum_item" ||
      p.type === "union_item" || p.type === "type_item" ||
      p.type === "mod_item" || p.type === "package_clause" ||
      p.type === "container_field"
    ) {
      for (let i = 0; i < p.namedChildCount; i++) {
        const c = p.namedChild(i)
        if (c && (c.type === "identifier" || c.type === "type_identifier" || c.type === "field_identifier")) {
          return c.startIndex === n.startIndex && c.endIndex === n.endIndex
        }
      }
    }
    return false
  }
  const isCallee = (n: any): boolean => {
    let top: any = n
    let p: any = n.parent
    while (p && p.type !== "call_expression" && p.type !== "block" && p.type !== "function_declaration") {
      top = p
      p = p.parent
    }
    if (!p || p.type !== "call_expression") return false
    const first = p.namedChildCount > 0 ? p.namedChild(0) : null
    return !!first && top.startIndex >= first.startIndex && top.endIndex <= first.endIndex
  }
  const hasToken = (n: any, tok: string): boolean => {
    for (let i = 0; i < (n.childCount ?? 0); i++) {
      const c = n.child(i)
      if (c && !c.isNamed && c.type === tok) return true
    }
    return false
  }
  const stack: any[] = [{ n: root, exit: false, pushed: false }]
  while (stack.length > 0) {
    const { n, exit, pushed, fn } = stack.pop()!
    if (exit) {
      if (pushed) scopes.pop()
      continue
    }
    const t = n.type
    let pushedScope = false
    if (t === "function_declaration") {
      const frame = new Set<string>()
      const pw: any[] = [n]
      while (pw.length > 0) {
        const m = pw.pop()!
        if (m.type !== "function_declaration" || m === n) {
          if (m.type === "parameter") bindFirstIdent(m, frame)
          for (let i = m.namedChildCount - 1; i >= 0; i--) {
            const c = m.namedChild(i)
            if (c && c.type !== "block" && c.type !== "block_expression" && c.type !== "function_declaration") pw.push(c)
          }
        }
      }
      scopes.push(frame)
      pushedScope = true
    } else if (t === "block" || t === "block_expression") {
      scopes.push(new Set<string>())
      pushedScope = true
    } else if (t === "switch_case") {
      // Z6 mirror: captures are scoped to their own switch arm (see the
      // analyzer). Same push/pop mechanics, same empty-at-entry property.
      scopes.push(new Set<string>())
      pushedScope = true
    } else if (t === "payload") {
      if (scopes.length > 0) bindIds(n, scopes[scopes.length - 1])
    } else if (t === "variable_declaration") {
      if (scopes.length > 0 && (hasToken(n, "var") || hasToken(n, "const"))) {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "identifier") {
            if (c.text !== "_") scopes[scopes.length - 1].add(stripZigQuoting(String(c.text ?? "")))
            break
          }
          break
        }
      }
    } else if (t === "identifier") {
      // Z41: the read name is CANONICALIZED, and the inventory it is looked up in
      // is canonicalized too. The two used to disagree about spelling, which no
      // amount of structure can reconcile: the inventory is built from symbol
      // names, and a quoted declaration's symbol name has its `@"..."` syntax
      // stripped (Z34), while the node's own text still carries it. So a read of
      // `const @"progress_normal {d}"` was looked up as `@"progress_normal
      // {d}``, found nothing, and dropped — two rows in 1,200 files, and the only
      // thing left unexplained on the corpus.
      //
      // It is a real read. `zig/lib/std/Progress.zig` genuinely declares
      // `const @"progress_normal {d}" = "\x1b]9;4;1;{d}\x1b\\";` — a legal Zig
      // quoted identifier whose name happens to read like a format string — and
      // uses it at line 1248. Neither the symbol nor the edge is a defect; the
      // MIRROR was comparing a stripped name against a raw one. Z34 ruled that
      // published names are canonical; it was applied to the OUTPUT side and not
      // to the LOOKUP side, and a rule that is not applied on both sides of a
      // comparison is not a rule, it is a coincidence that held until a name
      // contained a quote.
      const name = stripZigQuoting(String(n.text ?? ""))
      const p = n.parent
      let inError = false
      if (p && p.type === "error_type" && p.namedChildCount > 0) {
        const last = p.namedChild(p.namedChildCount - 1)
        if (last && last.startIndex === n.startIndex && last.endIndex === n.endIndex) {
          let q: any = p.parent
          let typePos = false
          while (q) {
            if (q.type === "parameter" || q.type === "container_field") { typePos = true; break }
            if (
              q.type === "variable_declaration" || q.type === "arguments" ||
              q.type === "return_expression" || q.type === "call_expression" ||
              q.type === "function_declaration" || q.type === "block" ||
              q.type === "block_expression"
            ) break
            q = q.parent
          }
          if (!typePos) inError = true
        }
      }
      const isLabel = p && (p.type === "labeled_statement" || p.type === "label_name" || p.type === "block_label" || p.type === "break_label" || p.type === "continue_label")
      let qualified = false
      {
        let cur: any = n.parent
        while (cur) {
          if (cur.type === "qualified_type") { qualified = true; break }
          if (
            cur.type === "call_expression" || cur.type === "field_declaration" ||
            cur.type === "function_declaration" || cur.type === "block" ||
            cur.type === "block_expression" || cur.type === "composite_literal" ||
            cur.type === "variable_declaration" || cur.type === "assignment_statement"
          ) break
          cur = cur.parent
        }
      }
      let lhsWrite = false
      if (p && p.type === "field_expression") {
        lhsWrite = true
      } else if (p && (p.type === "assignment_statement" || p.type === "compound_assignment_statement")) {
        const lhs = p.namedChild(0)
        lhsWrite = !!lhs && lhs.startIndex === n.startIndex && (lhs.endIndex ?? 0) >= n.endIndex
      }
      // Field path owns member leaves AND objects (leaf-only contract,
      // mirroring the analyzer's parent check exactly).
      // LEAF-ONLY, UNCONDITIONALLY. A field path owns its member leaf and the
      // objects along it, so the BASE of `std.debug.assert` is not a read of a
      // value named `std` — it is a read of the member `assert`, which the field
      // pass publishes under the leaf contract.
      //
      // This was briefly rewritten to the Z38 type-position WALK, which was wrong:
      // the two rules are different. Z38 belongs to the FIELD pass, where the leaf
      // of a dotted TYPE path in a signature is a declared-type fact; here the base
      // of a dotted VALUE path is owned by the leaf, always. Conflating them made
      // the mirror publish 58 file-scope `uses -> std` rows the analyzer correctly
      // does not — and it is the mirror that was wrong, twice over: once for the
      // rule, and once for assuming a fix in one pass implied the same rule in the
      // other. One rule per site, and the site that owns it.
      const underField = !!p && p.type === "field_expression"
      if (
        name && name !== "_" && !name.startsWith("$") &&
        !isDefining(n) && !isCallee(n) && !underField && !qualified && !isLabel &&
        !shadowed(name) &&
        (fileValues.has(name) || (inError && enumMembers.has(name)))
      ) {
        // Z37: the dedupe key carries the SOURCE, because the analyzer's does
        // (`${src}::uses::${name}`). Keyed on the name alone, the first read of a
        // name claims the row and every later read of the same name from a
        // different function is suppressed — which is what the first run of the
        // source-keyed gate reported: 592 phantom `uses` in 200 files, every one of
        // them a read the analyzer attributes to a function the mirror had already
        // spent the name on at file scope. A mirror that dedupes differently from
        // the thing it mirrors does not report disagreements, it invents them.
        const src = fn ?? "(global)"
        const k = "uses|" + src + "|" + stripZigQuoting(name)
        if (!seen.has(k)) {
          seen.add(k)
          // Z37: the source is the enclosing function, read from the walk\u0027s own
          // stack entry rather than re-derived by a second rule. The harness matcher
          // discards `from`, so before this the attribution of every bare read was
          // unaudited — which is 83% of the lane\u0027s edges in the unadjudicated state.
          edges.push({ label: "uses", from: src, target: stripZigQuoting(name), line: (n?.startPosition?.row ?? 0) + 1 })
        }
      }
    }
    stack.push({ n, exit: true, pushed: pushedScope, fn })
    let nextFn: string | null = fn
    if (t === "function_declaration" || t === "test_declaration") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "identifier") {
          // Z51: CANONICALIZE. `pub fn @"union"(...)` is legal Zig and common in
          // the corpus (aro's Hideset.zig does exactly this, because `union` is a
          // keyword), and an `identifier` node's text carries the `@"..."` syntax
          // while the analyzer publishes the name without it. Raw here, the truth
          // derived the source `@"union"` and the analyzer published `union`, so
          // every read and call inside that function came out as a phantom AND a
          // miss — 410 symmetric rows across 3 files at full-corpus extent, in a
          // 200-file draw of which none appeared.
          //
          // This is the SAME mistake as Z41 (a read name looked up raw against a
          // canonicalized inventory) and Z43 (a verifier key built from raw text
          // against canonicalized symbols), now in a fourth place: the enclosing
          // SCOPE name. Three fixes in three places is not three coincidences; it
          // is one rule that was never written down as a rule, which is why the
          // canonicalizer is now applied at every point where a node becomes a name.
          nextFn = stripZigQuoting(String(c.text ?? ""))
          break
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push({ n: c, exit: false, pushed: false, fn: nextFn })
    }
  }
  return edges
}
