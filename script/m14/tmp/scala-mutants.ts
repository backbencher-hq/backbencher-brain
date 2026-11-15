// M60 (scala deep review) — the `contains` / name load-bearing battery.
//
// WHY A BATTERY, AND WHY IT MUST BE PARAMETERISED. An oracle that derives a
// SUBSET of what the analyzer publishes cannot prove the analyzer's extra rows
// are fabrications: a mutant on such an oracle reads clean and means nothing.
// The `contains` oracle had to reach MISSING=0 and UNEXPLAINED=0 on 400+ files
// per corpus BEFORE any of these mutants mean anything — that is why this file
// exists as a separate step and not inside the oracle commit.
//
// TRAP 13, learned the hard way on the kotlin lane: a mutator hardcoded to the
// kotlin analyzer mutated the SCALA file and then restored the kotlin one,
// leaving scala mutated and printing a meaningless "CLEAN". So:
//   - the analyzer path is a REQUIRED argument, never a default;
//   - every run records the analyzer's sha256 before and after, and prints
//     RESTORE-FAILED loudly rather than reporting a result;
//   - the restore is from an in-memory copy taken at load time, not from git,
//     so an uncommitted edit to the analyzer is still preserved.
//
// Usage: npx tsx script/m14/tmp/scala-mutants.ts <analyzer.ts> [--fixtures] [--draw <file> --repo <r>]

import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const argv = process.argv.slice(2)
const analyzerPath = argv.find((a) => !a.startsWith("--"))
if (!analyzerPath) {
  console.error("usage: scala-mutants.ts <path-to-analyzer.ts> [--fixtures] [--draw <file> --repo <name>]")
  process.exit(2)
}
const has = (k: string): boolean => argv.includes(k)
const argOf = (k: string): string | undefined => {
  const i = argv.indexOf(k)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}
const draw = argOf("--draw")
const repo = argOf("--repo")
const LABEL = argOf("--label") ?? "contains"
// calls/instantiates/extends/implements/overrides/implements compare as SETS (the
// oracle emits one row per distinct target; the analyzer one per site), and the
// heritage labels come from the SHARED deriveTreeEdges. Everything else compares
// counts, which is the stricter instrument and the one that names the DUPLICATE class.
const SET = has("--set") || ["calls", "instantiates", "extends", "implements", "overrides"].includes(LABEL)

const sha = (p: string): string => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 16)
const ORIGINAL = fs.readFileSync(analyzerPath, "utf8")
const ORIGINAL_SHA = sha(analyzerPath)

type Mutant = { id: string; label: string; find: string; replace: string; expect: string }

// Every `find` is a literal that must occur EXACTLY ONCE in the analyzer; a
// mutant whose anchor is absent or ambiguous is itself the finding, and the
// script refuses to run it rather than reporting a vacuous clean.
const MUTANTS: Mutant[] = [
  {
    id: "A1",
    label: "gate the `constructor` member on the presence of class_parameters",
    find: '          const cp = namedChildOf(n, "class_parameters")\n          if (cp) {\n            push(nm, "constructor")',
    replace: '          const cp = namedChildOf(n, "class_parameters")\n          if (false) {\n            push(nm, "constructor")',
    expect: "contains MISSING: every class/enum with a parameter list loses its constructor row",
  },
  {
    id: "A2",
    label: "publish EVERY class parameter as a field (drop the val/var requirement)",
    find: '      if (!isCase && !hasChildOfType(param, "val") && !hasChildOfType(param, "var")) continue',
    replace: "      if (false) continue",
    expect: "contains UNEXPLAINED: every plain class's plain constructor parameters become published fields",
  },
  {
    id: "A3",
    label: "drop the case-class rule (every parameter is a field)",
    find: "for (const list of lists) for (const pn of fieldParams(list, hasChildOfType(n, \"case\"))) push(nm, pn)",
    replace: "for (const list of lists) for (const pn of fieldParams(list, false)) push(nm, pn)",
    expect: "contains MISSING: every case-class parameter published as a field disappears",
  },
  {
    id: "A4",
    label: "drop type aliases from a body's members",
    find: '    } else if (n.type === "type_definition") {\n      const nm = declName(n)\n      if (owner && nm) push(owner, nm)\n    } else if (n.type === "simple_enum_case" || n.type === "full_enum_case") {',
    replace: '    } else if (n.type === "type_definition_never") {\n      const nm = declName(n)\n      if (owner && nm) push(owner, nm)\n    } else if (n.type === "simple_enum_case" || n.type === "full_enum_case") {',
    expect: "contains MISSING: every type alias (85 cats-effect / 372 scala3 per 400 files) disappears",
  },
  {
    id: "A5",
    label: "drop enum cases from a body's members",
    find: '    } else if (n.type === "simple_enum_case" || n.type === "full_enum_case") {\n      const nm = declName(n)\n      if (owner && nm) push(owner, nm)\n    }',
    replace: '    } else if (false) {\n      const nm = declName(n)\n      if (owner && nm) push(owner, nm)\n    }',
    expect: "contains MISSING: 459 + 71 enum cases per 400 scala3 files",
  },
  {
    id: "A6",
    label: "drop the anonymous-class OWNER rule",
    find: '  const isAnonymousClassNode = (n: any): boolean => {\n    if (namedChildOf(n, "template_body") === null) return false',
    replace: '  const isAnonymousClassNode = (n: any): boolean => {\n    if (true) return false\n    if (namedChildOf(n, "template_body") === null) return false',
    expect: "contains MISSING: every anonymous class's OWNER row disappears (291 / 191 per 400 files)",
  },
  {
    id: "A7",
    label: "drop the `given` owner kind",
    find: '    } else if (n.type === "given_definition") {',
    replace: '    } else if (n.type === "given_definition_never") {',
    expect: "contains MISSING: 105 givens per 400 scala3 files lose their own row and their members fall to the enclosing type",
  },
  {
    id: "A8",
    label: "drop the METHOD scope gate (publish every val, lambda or not)",
    find: '    } else if (n.type === "lambda_expression") {\n      // A lambda has no name and owns nothing — it is purely a scope boundary.\n      nextInFn = true',
    replace: '    } else if (n.type === "lambda_expression_never") {\n      // A lambda has no name and owns nothing — it is purely a scope boundary.\n      nextInFn = true',
    expect: "contains MISSING: every val inside a lambda publishes. cats-effect's test suites are entirely this shape — this is the rule behind the 56 rows SDJ-2 could not attribute",
  },
  {
    id: "A9",
    label: "clear the function scope at a `given` (drop the SDJ-3 asymmetry)",
    find: '      if (owner) push(owner, nm)\n      nextOwner = nm\n      // `nextInFn` is deliberately NOT cleared here.',
    replace: '      if (owner) push(owner, nm)\n      nextOwner = nm\n      nextInFn = false\n      // `nextInFn` is deliberately NOT cleared here.',
    expect: "contains MISSING: a val in a given body inside a method starts publishing (1 row in 23,081 on scala3)",
  },
  {
    id: "A10",
    label: "drop the trait-abstract-member rule (val_declaration / var_declaration)",
    find: '  const VAL_DECLS = new Set([\n    "val_definition", "var_definition", "val_declaration", "var_declaration",\n  ])',
    replace: '  const VAL_DECLS = new Set([\n    "val_definition", "var_definition",\n  ])',
    expect: "contains MISSING: every abstract trait field disappears (34 + 1 cats-effect, 33 + 4 scala3 per 400 files)",
  },
  {
    id: "A11",
    label: "publish a CONSTRUCTOR for traits as well (handleTrait has no such path)",
    find: '        if (n.type === "class_definition" || n.type === "enum_definition") {\n          const cp = namedChildOf(n, "class_parameters")',
    replace: '        if (true) {\n          const cp = namedChildOf(n, "class_parameters")',
    expect: "contains UNEXPLAINED: a trait with a parameter list gains a constructor and a field the analyzer never published — the fabrication the old oracle committed",
  },
  {
    id: "A12",
    label: "attribute a given's members to the ENCLOSING TYPE",
    find: '      const nm = declName(n) || `given_${++givenCounter}`\n      if (owner) push(owner, nm)\n      nextOwner = nm',
    replace: '      const nm = declName(n) || `given_${++givenCounter}`\n      if (owner) push(owner, nm)',
    expect: "contains MISSING: a given stops being an owner, so its members (and an anonymous class in its body) fall to the enclosing type — the other fabrication the old oracle committed",
  },
]

// The two ANONYMOUS-NAME mutants and the given-name mutant live in the ANALYZER,
// not the oracle: they are the two real defects, and an oracle-side battery
// cannot detect a wrong name it also gets wrong.
const ANALYZER_MUTANTS: Mutant[] = [
  {
    id: "B1",
    label: "ANALYZER: restore the source-text anonymous name (S3)",
    find: '      const superName = this.stripTypeArgs(this.scalaAnonymousSupertypeName(typeNode))',
    replace: '      const superName = this.stripTypeArgs(typeNode ? this.scalaTypeHeadName(typeNode) : "")',
    expect: "contains UNEXPLAINED: anonymous_(IO ~> F) and the multiline body name return — 20 / 15 per 400 files",
  },
  {
    id: "B2",
    label: "ANALYZER: restore the FLAT stable_identifier segment scan (S3)",
    find: "              if (c.type === \"stable_identifier\") collectStable(c, guard + 1)",
    replace: "              if (c.type === \"stable_identifier\") for (let q = 0; q < c.namedChildCount; q++) { const sx = c.namedChild(q); if (sx && sx.type === \"identifier\") segs.push(sx.text) }",
    expect: "contains UNEXPLAINED: anonymous_concurrent.Callable (a qualified supertype loses its leading segments)",
  },
  {
    id: "B3",
    label: "ANALYZER: restore the given's BODY as its name (S6)",
    find: '    const explicitName = node.childForFieldName("name")?.text ?? null',
    replace: "    const explicitName = this.findChildIdentifier(node)",
    expect: "contains UNEXPLAINED: 40 of 85 anonymous givens on scala3 publish their value's name; 28 collide",
  },
  {
    id: "B4",
    label: "ANALYZER: restore the first-identifier name read in handleFunction (operator names lose their name)",
    // The anchor must be UNIQUE. `const name = this.extractIdentifier(node, "name")`
    // occurs six times in the analyzer (handleClass/Object/Trait/Enum/Given/Function),
    // and a mutator that silently edits the first occurrence reports a result about
    // a different handler than the one it names — the trap-13 family. The extra
    // context line pins it to handleFunction.
    find: '    const name = this.extractIdentifier(node, "name")\n\n    let extensionReceiverType: string | undefined',
    replace: '    const name = this.findChildIdentifier(node) ?? this.extractIdentifier(node, "name")\n\n    let extensionReceiverType: string | undefined',
    expect: "operator-named methods (`def !>`, `def ++`) take a PARAMETER's name, or none — 13 names in 5 cats-effect files, 61 in 20 scala3 files",
  },
  {
    id: "B5",
    label: "ANALYZER: restore the OWNER-KIND gap — a `given` does not own its members",
    find: "        const g = this.handleGiven(node, symbols, relationships, exports, patternsObj, parent)\n        if (g) { currentParent = g; indexType(g) }",
    replace: "        this.handleGiven(node, symbols, relationships, exports, patternsObj, parent)",
    expect: "contains MISSING: a given's members (and an anonymous class in its body) fall to the enclosing type — the mirror of oracle mutant A12",
  },
]

// ── `references` (M60 S4). Sixteen positions in three classes, and the
// sub-site that never fires on a draw is a rule the corpus cannot prove, so the
// census (scala-ref-sites.ts) records which of them a draw reaches and the
// battery records which of them the draw can break.
const REF_MUTANTS: Mutant[] = [
  {
    id: "R1",
    label: "drop the IMPORT class",
    find: '      case "import_declaration": {\n        const p = importPathOf(n)\n        if (p) importPaths.push(p)\n        break\n      }',
    replace: '      case "import_declaration": {\n        break\n      }',
    expect: "references MISSING: every import module (261 edges on the 60-file scala3 draw, 1,337 in cats-effect 400)",
  },
  {
    id: "R2",
    label: "drop the THROW class",
    find: '      case "throw_expression":\n      case "throw": {\n        const target = throwTargetOf(n.namedChild(0))\n        if (target) push(resolveSource(n), target, "throw_target")\n        break\n      }',
    replace: '      case "throw_expression_never":\n      case "throw_never": {\n        break\n      }',
    expect: "references MISSING: every throw target (20 on the 60-file scala3 draw)",
  },
  {
    id: "R3",
    label: "drop the PARAMETER / class_parameter position",
    find: '      case "class_parameter":\n      case "parameter": {\n        emit(n, [n], n.type)\n        break\n      }',
    replace: '      case "class_parameter_never":\n      case "parameter_never": {\n        break\n      }',
    expect: "references MISSING: 1,164 edges on the 60-file scala3 draw — the largest single position",
  },
  {
    id: "R4",
    label: "drop the val/var TYPE-CLAUSE position",
    find: '      case "val_definition":\n      case "var_definition":\n      case "val_declaration":\n      case "var_declaration": {',
    replace: '      case "val_definition_never":\n      case "var_definition_never":\n      case "val_declaration_never":\n      case "var_declaration_never": {',
    expect: "references MISSING: 96 edges on the 60-file scala3 draw (54 val + 31 var + 8 val_declaration + 3 var_declaration)",
  },
  {
    id: "R5",
    label: "drop the RETURN-TYPE position",
    find: '            const isReturn = sawParams || !hasParamsClause\n            emit(n, [c], c.type === "tuple_type" ? "tuple_type" : (isReturn ? "return_type" : "annotation_type"))',
    replace: '            const isReturn = sawParams || !hasParamsClause\n            if (isReturn) emit(n, [c], c.type === "tuple_type" ? "tuple_type" : "return_type")',
    expect: "references MISSING: the annotation_type position only (the return_type form stays) — this is the NARROW test, so a clean read means the pre-parameter type clause never fires, not that return_type is unproven",
  },
  {
    id: "R6",
    label: "drop the typed_pattern position",
    find: '      case "typed_pattern": {\n        const last = n.namedChild(n.namedChildCount - 1)\n        if (last) emit(n, [last], "pattern_type")\n        break\n      }',
    replace: '      case "typed_pattern_never": {\n        break\n      }',
    expect: "references MISSING: 213 edges on the 60-file scala3 draw",
  },
  {
    id: "R7",
    label: "drop the case_class_pattern position",
    find: '      case "case_class_pattern": {\n        const first = n.namedChild(0)\n        if (first) emit(n, [first], "pattern_type")\n        break\n      }',
    replace: '      case "case_class_pattern_never": {\n        break\n      }',
    expect: "references MISSING: 163 edges on the 60-file scala3 draw",
  },
  {
    id: "R8",
    label: "drop the type ALIAS position",
    find: '          emit(n, rhs, "type_definition", String(tName.text))',
    replace: '          if (rhs.length === 1e9) emit(n, rhs, "type_definition", String(tName.text))',
    expect: "references MISSING: 327 edges on the 60-file scala3 draw",
  },
  {
    id: "R9",
    label: "drop the GIVEN type position",
    find: '        if (roots.length) emit(n, roots, "given_definition")',
    replace: '        if (roots.length === 1e9) emit(n, roots, "given_definition")',
    expect: "references MISSING: 67 edges on the 60-file scala3 draw",
  },
  {
    id: "R10",
    label: "drop the CAST / INSTANCEOF positions",
    find: '      case "generic_function": {',
    replace: '      case "generic_function_never": {',
    expect: "references MISSING: 99 edges on the 60-file scala3 draw (75 cast_target + 24 instanceof_check)",
  },
  {
    id: "R11",
    label: "drop the SELF-TYPE position",
    find: '      case "self_type": {\n        const last = n.namedChild(n.namedChildCount - 1)\n        if (last) emit(n, [last], "self_type")\n        break\n      }',
    replace: '      case "self_type_never": {\n        break\n      }',
    expect: "references MISSING: 4 edges on the 60-file scala3 draw",
  },
  {
    id: "R12",
    label: "drop the @throws position",
    find: '        if (gt && gt.namedChild(0)?.text === "throws") {\n          const argsNode = namedChildOfType(gt, "type_arguments")\n          if (argsNode) emit(n, [argsNode], "throws_annotation")\n        }',
    replace: '        if (false) {\n        }',
    expect: "references MISSING: 1 edge on the 60-file scala3 draw — a single edge, so this mutant is the one most likely to read clean on a draw that does not contain an @throws",
  },
  {
    id: "R13",
    label: "drop the METHOD-VALUE position (a capitalized receiver)",
    find: '            if (c0 >= 65 && c0 <= 90) push(resolveSource(n), String(recv.text), "field_expression")',
    replace: '            if (false) push(resolveSource(n), String(recv.text), "field_expression")',
    expect: "references MISSING: 123 edges on the 60-file scala3 draw",
  },
  {
    id: "R14",
    label: "stop treating a qualified type as ONE target (walk into stable_type_identifier)",
    find: '    if (n.type === "stable_type_identifier") { add(String(n.text)); return }',
    replace: '    if (n.type === "stable_type_identifier_never") { add(String(n.text)); return }',
    expect: "references MISSING or UNEXPLAINED: every qualified type position splits into segments. A SPLIT reads as UNEXPLAINED (the analyzer publishes the dotted name and the truth no longer does)",
  },
  {
    id: "R15",
    label: "stop stripping quoting from targets",
    find: '  const push = (source: string, target: string, kind: string): void => {\n    if (!source || !target) return\n    const t = stripNameQuoting(String(target).trim())',
    replace: '  const push = (source: string, target: string, kind: string): void => {\n    if (!source || !target) return\n    const t = String(target).trim()',
    expect: "references UNEXPLAINED: the analyzer defect S7. A draw with a backticked import reads 8 UNEXPLAINED on the 60-file scala3 rotation; a draw without one reads clean, which is the sample trap again",
  },
]

// ANALYZER mutants for the two `references` defects.
const REF_ANALYZER_MUTANTS: Mutant[] = [
  {
    id: "R16",
    label: "ANALYZER: restore the RAW import module path (S7)",
    find: 'if (child.type === "identifier") { parts.push(part(child.text)); moduleLine = child.startPosition.row + 1 }',
    replace: 'if (child.type === "identifier") { parts.push(child.text); moduleLine = child.startPosition.row + 1 }',
    expect: "references UNEXPLAINED: 658 of 23,650 scala3 import declarations carry a backticked segment; cats-effect has 0",
  },
  {
    id: "R17",
    label: "ANALYZER: restore the first-identifier resolveSource (S8)",
    find: '  private scalaDeclaredNameOf(node: Node): string | null {\n    const f = node.childForFieldName?.("name")\n    if (f) return f.text\n    return this.findChild(node, "identifier")?.text ?? null\n  }',
    replace: '  private scalaDeclaredNameOf(node: Node): string | null {\n    return this.findChild(node, "identifier")?.text ?? null\n  }',
    expect: "references MISSING: an operator-named method\'s references collapse onto a type parameter, and because the dedupe key includes the source the edge COUNT drops — 26 rows on cats-effect, and 0 on any draw without an operator-named method carrying types",
  },
]

// ── `uses` (M60 S5 + SDJ-1 + S9/S10). Four arms: interpolation, a field
// expression's receiver, `this.y`/`super.y` reading the FIELD, and the
// extension receiver.
const USES_MUTANTS: Mutant[] = [
  {
    id: "U1",
    label: "drop the INTERPOLATION arm",
    find: '    if (n.type === "interpolation") {\n      const id = n.namedChild(0)\n      if (id && id.type === "identifier") push(resolveSource(n.parent), id.text)\n    } else if (n.type === "field_expression") {',
    replace: '    if (false) {\n    } else if (n.type === "field_expression") {',
    expect: "uses MISSING: every interpolated identifier — the arm was worth 14 truth-only rows when the arms were last split",
  },
  {
    id: "U2",
    label: "drop the RECEIVER read (a field_expression reads its leftmost identifier)",
    find: '        } else if (recv && recv.text.length > 0 && !isCapitalized(recv.text)) {\n          push(resolveSource(n.parent), recv.text)\n        }',
    replace: '        } else if (false) {\n        }',
    expect: "uses MISSING: every receiver read — the arm the `uses` label exists for",
  },
  {
    id: "U3",
    label: "drop the CAPTIALIZED-receiver guard, so `Foo.bar` reads `Foo`",
    find: "  const isCapitalized = (t: string): boolean => {\n    if (!t) return false\n    const c = t.charCodeAt(0)\n    return c >= 65 && c <= 90\n  }",
    replace: "  const isCapitalized = (_t: string): boolean => false",
    expect: "uses UNEXPLAINED: a capitalized receiver becomes a read, where the G3 ruling sends it to the references graph",
  },
  {
    id: "U4",
    label: "drop the WRITE gate entirely (every compound assignment also reads)",
    find: '  const isWriteLhs = (n: any): boolean => {\n    const p = n?.parent\n    if (!p) return false',
    replace: '  const isWriteLhs = (_n: any): boolean => {\n    const p: any = null\n    if (!p) return false',
    expect: "uses UNEXPLAINED: every write LHS also emits a read",
  },
  {
    id: "U5",
    label: "treat EVERY infix ending in `=` as a write (drop the comparison/arrow exclusions)",
    find: '    if (op.endsWith("==") || op.endsWith("<=") || op.endsWith(">=")) return false\n    if (op.includes("=:=") || op.includes("<:<")) return false\n    if (op === "=>" || op === "<-" || op === "<:" || op === ">:" || op === "=:") return false',
    replace: "",
    expect: "uses MISSING: `q1 === q2` and `frozen_=:=` become writes, so their reads are suppressed — the half of S10 the hand-list got wrong",
  },
  {
    id: "U6",
    label: "restrict the assignment rule to the BUILT-IN compound-assign list (the pre-S10 hand-list)",
    find: '  const operatorIsAssignment = (op: string): boolean => {\n    if (!op || !op.endsWith("=")) return false\n    if (COMPOUND_ASSIGN_OPS.has(op)) return true',
    replace: '  const operatorIsAssignment = (op: string): boolean => {\n    if (!COMPOUND_ASSIGN_OPS.has(op)) return false\n    if (!op || !op.endsWith("=")) return false',
    expect: "uses UNEXPLAINED: dotty's user-defined `++=` (105 uses in 400 files), `::=`, `:=`, `||=` and `&&=` are reads again — the half of S10 the analyzer got wrong",
  },
  {
    id: "U7",
    label: "drop the EXTENSION-RECEIVER arm (SDJ-1's rule)",
    find: '        let anc: any = n.parent\n        while (anc && anc.type !== "extension_definition") anc = anc.parent\n        if (anc) {\n          const pc = namedChildOf(anc, "parameters")',
    replace: '        let anc: any = n.parent\n        while (anc && anc.type !== "extension_definition_never") anc = anc.parent\n        if (anc) {\n          const pc = namedChildOf(anc, "parameters")',
    expect: "uses MISSING: every extension receiver — 648 defs live in extension blocks on a 400-file scala3 draw",
  },
  {
    id: "U8",
    label: "resolve the read's SOURCE with the first-identifier fallback again",
    find: '    const nameOf = (d: any): string => String(field(d, "name")?.text ?? "")',
    // The defect is reproduced EXACTLY: the original first lookup asked for a
    // field named "identifier", which no node has, so it ALWAYS fell through to
    // the first-identifier-child scan. A mutant that merely APPENDED the fallback
    // after a correct `name:` lookup reads clean, because the correct lookup
    // always wins — the degenerate-metric trap one level down.
    replace: '    const nameOf = (d: any): string => String(field(d, "identifier")?.text ?? firstNamedOf(d, ["identifier"])?.text ?? "")',
    expect: "uses UNEXPLAINED: an operator-named method\'s reads attribute to its first PARAMETER, and since push() keys on (from, target) the two operator methods `==` and `!=` collapse onto one source — the S8-b mirror",
  },
]

const USES_ANALYZER_MUTANTS: Mutant[] = [
  {
    id: "U9",
    label: "ANALYZER: restore the INVERTED extension gate (emit only when the extension is nested in a METHOD)",
    find: "    if (extensionReceiverType) {\n      relationships.push({\n        source: name,\n        target: extensionReceiverType,\n        type: ASTEngine.RelationshipType.Uses,",
    replace: "    if (extensionReceiverType && !isMethod) {\n      relationships.push({\n        source: name,\n        target: extensionReceiverType,\n        type: ASTEngine.RelationshipType.Uses,",
    expect: "uses MISSING: 382 of the 648 defs in an extension block lose their receiver edge — SDJ-1's whole residual",
  },
  {
    id: "U10",
    label: "ANALYZER: restore the hand-listed compound-assign gate",
    find: "function scalaOperatorIsAssignment(op: string): boolean {\n  if (!op || !op.endsWith(\"=\")) return false",
    replace: "function scalaOperatorIsAssignment(op: string): boolean {\n  return COMPOUND_ASSIGN_OPS.has(op)\n  if (!op || !op.endsWith(\"=\")) return false",
    expect: "uses UNEXPLAINED: dotty's `++=` (105 uses in 400 files), `::=`, `:=`, `||=`, `&&=` become reads again",
  },
]

// ── the callee-shape rule (M60 S11). This one is a SHARED BLIND SPOT: before the
// fix the oracle made the same mistake, so the differential reported 0 while both
// sides were wrong together. A mutant that only breaks one side therefore does NOT
// read clean — which is the property that makes this pair worth keeping.
const CALL_ANALYZER_MUTANTS: Mutant[] = [
  {
    id: "C1",
    label: "ANALYZER: restore the expression callee (drop the name-shape allowlist)",
    find: "        const CALLEE_NAME_SHAPES = new Set([\n          \"identifier\", \"field_expression\", \"generic_function\", \"operator_identifier\",\n          \"type_identifier\", \"stable_type_identifier\",\n        ])\n        if (!CALLEE_NAME_SHAPES.has(fnNode.type)) return",
    replace: "        const CALLEE_NAME_SHAPES = new Set([\"identifier\", \"field_expression\", \"generic_function\", \"operator_identifier\",\"type_identifier\", \"stable_type_identifier\", \"instance_expression\", \"infix_expression\", \"parenthesized_expression\", \"prefix_expression\", \"wildcard\"])\n        if (!CALLEE_NAME_SHAPES.has(fnNode.type)) return",
    expect: "calls UNEXPLAINED: the expression targets return, and because the ORACLE was fixed at the same time they are now analyzer-only rather than shared — 8 rows on cats-effect 457, 34 on scala3 400",
  },
]

const PATTERN_ANALYZER_MUTANTS: Mutant[] = [
  {
    id: "V1",
    label: "ANALYZER: restore the single-shape refusal (only tuple_pattern is refused)",
    find: "    if (\n      patternNode.type !== \"identifier\" &&\n      patternNode.type !== \"identifiers\" &&\n      patternNode.type !== \"operator_identifier\"\n    ) return",
    replace: "    if (patternNode.type === \"tuple_pattern\") return",
    expect: "the four shapes the analyzer had published come back — and because the ORACLE was fixed at the same time they are now analyzer-only, so the fixture and the corpus both see them",
  },
]

function mutate(m: Mutant, src: string): string {
  if (m.extra) return src
  const n = src.split(m.find).length - 1
  if (n !== 1) throw new Error(`anchor occurs ${n} times (need exactly 1): ${m.find.slice(0, 90)}`)
  return src.replace(m.find, m.replace)
}

const run = (cmd: string, args: string[]): string => {
  try {
    return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
  } catch (e: any) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}`
  }
}

interface Reading { fixtures?: string; probe?: string }
const read = (): Reading => {
  const r: Reading = {}
  if (has("--fixtures")) {
    const out = run("npx", ["tsx", "script/m14/run-fixtures.ts", "--lang", "scala"])
    const m = out.match(/summary:.*?"scala":\{"pass":(\d+),"fail":(\d+)\}/)
    r.fixtures = m ? `${m[1]} pass / ${m[2]} fail` : out.split("\n").filter((l) => /FAIL|Error/.test(l)).slice(0, 3).join(" | ") || "NO SUMMARY"
  }
  if (draw && repo) {
    // The LABEL is an argument. Hardcoding it here made a whole references
    // battery report 0/15 moved while measuring the contains label — a
    // DEGENERATE metric, which is the tell: a strategy that comes out exactly
    // equal to baseline is a broken instrument far more often than a real
    // equivalence. It is asserted below: the label is printed in BASELINE so a
    // reader can see which one was measured.
    // `--set` is forwarded, not assumed. The probe's default is COUNT mode, which
    // is right for contains/uses/references and wrong for calls — so a calls
    // battery run without this reported a baseline of 10,702 unexplained on a
    // CLEAN lane. The mutant still read load-bearing (the fixture failed too), but
    // a baseline that is wrong by construction is the degenerate-metric trap in its
    // purest form: the number looks enormous and means nothing.
    const extra = SET ? ["--set"] : []
    const out = run("npx", ["tsx", "script/m14/tmp/scala-probe.ts", "--repo", repo, "--draw", draw, "--label", LABEL, ...extra])
    const m = out.match(/MISSING=(\d+) UNEXPLAINED=(\d+) DUPLICATE[^=]*=(\d+)/)
    r.probe = m ? `${LABEL}: MISSING=${m[1]} UNEXPLAINED=${m[2]} DUP=${m[3]}` : out.split("\n").slice(-3).join(" | ")
  }
  return r
}

const base = read()
console.log(`analyzer: ${analyzerPath}  sha=${ORIGINAL_SHA}`)
console.log(`BASELINE  ${base.fixtures ? `fixtures: ${base.fixtures}` : ""}${base.fixtures && base.probe ? "  " : ""}${base.probe ?? ""}`)
console.log("")

let all = MUTANTS
if (has("--analyzer")) all = ANALYZER_MUTANTS
if (has("--refs")) all = REF_MUTANTS
if (has("--refs-analyzer")) all = REF_ANALYZER_MUTANTS
if (has("--uses")) all = USES_MUTANTS
if (has("--uses-analyzer")) all = USES_ANALYZER_MUTANTS
if (has("--calls-analyzer")) all = CALL_ANALYZER_MUTANTS
if (has("--pattern-analyzer")) all = PATTERN_ANALYZER_MUTANTS
if (has("--both")) all = [...all, ...ANALYZER_MUTANTS, ...REF_ANALYZER_MUTANTS]
const isAnalyzerMutant = (m: Mutant): boolean =>
  ANALYZER_MUTANTS.includes(m) || REF_ANALYZER_MUTANTS.includes(m) ||
  USES_ANALYZER_MUTANTS.includes(m) || CALL_ANALYZER_MUTANTS.includes(m) ||
  PATTERN_ANALYZER_MUTANTS.includes(m)
// `--only A9` is the SAMPLE-CHECK step: a mutant that reads clean is a
// statement about the drawn set, so re-running it on a draw that contains the
// shape is how "clean" is promoted to "not exercised" or refuted.
const only = argOf("--only")
const selected = only ? all.filter((m) => only.split(",").includes(m.id)) : all
if (selected.length === 0) throw new Error(`no mutant matches --only ${only}`)
const results: { id: string; label: string; r: Reading; ok: boolean }[] = []

for (const m of selected) {
  const target = isAnalyzerMutant(m) ? analyzerPath : path.join(ROOT, "script/m14/differential.ts")
  const src = fs.readFileSync(target, "utf8")
  let mutated: string
  try {
    mutated = mutate(m, src)
  } catch (e) {
    console.log(`${m.id}  ANCHOR-ERROR  ${(e as Error).message}`)
    results.push({ id: m.id, label: m.label, r: {}, ok: false })
    continue
  }
  fs.writeFileSync(target, mutated)
  const r = read()
  // A mutant is LOAD-BEARING when the reading MOVED. A clean mutant is only a
  // statement about the SAMPLE, so it is reported as such and never as a pass.
  const moved = JSON.stringify(r) !== JSON.stringify(base)
  fs.writeFileSync(target, src)
  const restored = sha(target) === shaOfOriginal(target, src)
  results.push({ id: m.id, label: m.label, r, ok: moved && restored })
  const cells = [`${m.id.padEnd(3)}`, moved ? "LOAD-BEARING" : "CLEAN(!)", restored ? "" : " RESTORE-FAILED"]
  if (r.fixtures) cells.push(`fixtures ${r.fixtures}`)
  if (r.probe) cells.push(r.probe)
  console.log(cells.join("  "))
  console.log(`      ${m.label}`)
  console.log(`      expect: ${m.expect}`)
}

function shaOfOriginal(p: string, src: string): string {
  return crypto.createHash("sha256").update(src).digest("hex").slice(0, 16)
}

const after = sha(analyzerPath)
console.log("")
console.log(after === ORIGINAL_SHA
  ? `analyzer restored: sha=${after} (byte-identical to the pre-battery state)`
  : `RESTORE FAILED: analyzer sha=${after} != ${ORIGINAL_SHA}`)
console.log(`${results.filter((x) => x.ok).length}/${results.length} mutants moved the reading AND restored cleanly`)
