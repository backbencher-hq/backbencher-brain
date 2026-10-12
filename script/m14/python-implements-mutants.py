#!/usr/bin/env python3
"""
MUTANT HARNESS for the python `implements` rule.

Two properties this has and a shell loop does not:

  1. It VERIFIES each mutation actually changed the file before running the suite, and
     reports `NOT APPLIED` as a failure in its own right. Three mutants in the first pass
     of this work reported "0 failing fixtures" - and two of them had never been applied at
     all, because a shell single-quoted `python3 -c` does not interpret `\\n` and the
     multi-line pattern simply never matched. Reading "0 failing" as "mutant survived" is
     the wrong conclusion in the same way as reading it as "mutant caught": both are
     statements about a mutation that may not exist.

  2. It classifies the outcome. A mutant that fails a fixture is CAUGHT. One that passes is
     a SURVIVOR, and the honesty contract says a surviving mutant fails the suite rather
     than the mutant. One whose change is provably a no-op is EQUIVALENT and must be
     reported as such - an equivalent mutant is a fact about the code (a redundant guard),
     not a fact about the tests.

Usage:  python3 script/m14/python-implements-mutants.py [--verbose]
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "src" / "ast" / "real-python-analyzer.ts"

MUTANTS = [
    {
        "id": "implements/branch-disabled",
        "what": "the whole `implements` route disabled - re-opens the GAP the workstream measured",
        "old": """          const ifaceKind = ctx.interfaceBindings
            ? this.interfaceBaseKind(arg, ctx.interfaceBindings, node.startPosition.row + 1)
            : null""",
        "new": "          const ifaceKind: any = null",
        "expect": "CAUGHT",
    },
    {
        "id": "implements/double-label",
        "what": "an interface base emits BOTH implements and extends - one syntactic fact, two rows",
        "old": """          this.pushRel(ctx, className, baseLeaf, ifaceKind
            ? ASTEngine.RelationshipType.Implements
            : ASTEngine.RelationshipType.Extends, 1.0, {""",
        "new": """          this.pushRel(ctx, className, baseLeaf, ASTEngine.RelationshipType.Extends, 1.0, {
            /* MUTANT */
          })
          if (ifaceKind) this.pushRel(ctx, className, baseLeaf, ASTEngine.RelationshipType.Implements, 1.0, {""",
        "expect": "CAUGHT",
    },
    {
        "id": "implements/spelling-proof",
        "what": "the proof keys on the NAME instead of the binding - fabricates on every user class called ABC/Protocol",
        "old": "  private pythonMarkerKindForBase(base: PyBaseRef, atLine: number, ib: InterfaceBindings): string | null {",
        "new": """  private pythonMarkerKindForBase(base: PyBaseRef, atLine: number, ib: InterfaceBindings): string | null {
    if (base.leaf === "ABC" || base.leaf === "ABCMeta" || base.leaf === "Protocol") return "abc"  // MUTANT: keys on the NAME""",
        "expect": "CAUGHT",
    },
    {
        "id": "implements/bare-route-on-dotted",
        "what": "PY-26 reverted: the bare-name proof fires on a DOTTED base, so `vendor.Protocol` is relabelled as the stdlib's",
        "old": '    if (base.dotted) {',
        "new": '    if (base.dotted && false) {',
        "expect": "CAUGHT",
    },
    {
        "id": "implements/dotted-root-unproven",
        "what": "a dotted spelling proves itself with no root-import condition",
        "old": "      if (!ib.importRoots.has(root)) return null",
        "new": "      if (false) return null",
        "expect": "CAUGHT",
    },
    {
        "id": "implements/register-no-proof",
        "what": "`.register(Y)` emits without a proven receiver - the 492-homonym fabrication",
        "old": "            if (kind) {",
        "new": "            if (true) {",
        "expect": "CAUGHT",
    },
    {
        "id": "implements/generic-accepted",
        "what": "typing.Generic treated as an interface - 291 base occurrences, a type-parameter marker",
        "old": '            if (importedLeaf === "Protocol") {',
        "new": '            if (importedLeaf === "Protocol" || importedLeaf === "Generic") {',
        "expect": "CAUGHT",
    },
    {
        "id": "implements/alias-reads-bound-name",
        "what": "an aliased import tests the BOUND name instead of the IMPORTED one - `from abc import ABC as BaseABC` stops proving",
        "old": '          const importedLeaf = imported.slice(imported.lastIndexOf(".") + 1)',
        "new": "          const importedLeaf = bound",
        "expect": "CAUGHT",
    },
    {
        "id": "implements/typing-extensions-dropped",
        "what": "typing_extensions stops proving Protocol - pydantic writes it in 21 of its base lists",
        "old": '          } else if (mod === "typing" || mod === "typing_extensions") {',
        "new": '          } else if (mod === "typing") {',
        "expect": "CAUGHT",
    },
    {
        "id": "implements/collections-abc-narrowed",
        "what": "collections.abc bases stop proving - the stdlib interface catalogue, 24 proven bases in this corpus",
        "old": '          } else if (mod === "collections.abc") {',
        "new": '          } else if (mod === "__never__") {',
        "expect": "CAUGHT",
    },
    {
        "id": "implements/enum-signed-numeric",
        "what": "PY-27 reverted: a signed numeric enum value is not constant, so `unsafe = -1` publishes no member",
        "old": "          if (!reservedByEnum && right && (signedNumeric || literalContainer ||",
        "new": "          if (!reservedByEnum && right && (false || literalContainer ||",
        "expect": "CAUGHT",
    },
    {
        "id": "implements/r7-qualification-removed",
        "what": "the R7 endpoint qualification removed - the 7 placeholder-literal edges return",
        "old": "        this.pushRel(ctx, owner, qualifyReservedEndpoint(s.name, owner), ASTEngine.RelationshipType.Contains, 1.0, {}, s.range?.startLine)",
        "new": "        this.pushRel(ctx, owner, s.name, ASTEngine.RelationshipType.Contains, 1.0, {}, s.range?.startLine)",
        "expect": "CAUGHT",
    },
    {
        "id": "implements/r7-qualification-indiscriminate",
        "what": "the R7 endpoint qualification applied to EVERY member - the fabrication direction",
        "old": """function qualifyReservedEndpoint(name: string, owner: string): string {
  return RESERVED_ENDPOINT_NAMES.has(name) ? `${owner}.${name}` : name
}""",
        "new": """function qualifyReservedEndpoint(name: string, owner: string): string {
  return owner ? `${owner}.${name}` : name
}""",
        "expect": "CAUGHT",
    },
    {
        "id": "owner/deep-chain-widened",
        "what": "the owner boundary widened to ANY `self.`-rooted chain - `self.store.save` would be labelled with the ENCLOSING class and the store would bind it to a method of the wrong class",
        "old": """    const receiverName = dotIdx > 0 && fullCallee.indexOf(".", dotIdx + 1) === -1
      ? fullCallee.slice(0, dotIdx)
      : undefined""",
        "new": """    const receiverName = dotIdx > 0
      ? fullCallee.slice(0, dotIdx)
      : undefined""",
        "expect": "CAUGHT",
    },
    {
        "id": "owner/spelling-only",
        "what": "the owner keyed on the parameter SPELLING alone, inventing one where no class encloses (`def free(self)` at module scope names no class)",
        "old": """    if (!enclosingClass || !receiverName) return undefined
    return receiverName === "self" || receiverName === "cls" ? enclosingClass : undefined""",
        "new": """    if (!receiverName) return undefined
    return receiverName === "self" || receiverName === "cls" ? (enclosingClass ?? "self") : undefined""",
        "expect": "CAUGHT",
    },
    {
        "id": "owner/uses-owner-dropped",
        "what": "the owner dropped from `uses` member reads - the READ half of the channel, so `self.host` stops naming the class it belongs to",
        "old": """              ...(qualified !== leaf.text ? { qualifiedTarget: true, receiver: recvName } : {}),
              ...(memberOwner ? { owner: memberOwner } : {}),""",
        "new": """              ...(qualified !== leaf.text ? { qualifiedTarget: true, receiver: recvName } : {}),""",
        "expect": "CAUGHT",
    },
    {
        "id": "references/keyword-argument-name-is-not-a-type",
        "what": "round 6 reverted - the annotation walk descends into a validator CALL and publishes its keyword-argument NAMES as type references (`-> min_length`, `-> strict`), the fabrication the verdict named",
        "old": """      if (n.type === "keyword_argument") {
        const v = n.childForFieldName("value")
        if (v) collectTypeNodes(v, out)
        return
      }""",
        "new": """      /* MUTANT: keyword_argument recursed fully, so its NAME is published as a type */""",
        "expect": "CAUGHT",
    },
    {
        "id": "local-callee/axis-removed",
        "what": "the local-callee axis removed - a callee bound in an enclosing function falls back to bare-name-callee, re-opening the 4,837-edge hole round 7 closed",
        "old": """      : this.isLocalCalleeName(calleeLeaf, fullCallee, ctx.functionLocals)
        ? "local-callee"
        : "bare-name-callee"
    // The relation-level OWNER CHANNEL""",
        "new": """      : "bare-name-callee"
    // The relation-level OWNER CHANNEL""",
        "expect": "CAUGHT",
    },
    {
        "id": "local-callee/global-not-subtracted",
        "what": "a `global`-declared name is NOT subtracted - a write to a name that lives in another scope reads as a function-local binding, the over-claim direction",
        "old": """      for (const r of rebinds) names.delete(r)
""",
        "new": """      // MUTANT: rebinds are not subtracted, so a global statement reads as a local binding
""",
        "expect": "CAUGHT",
    },
    {
        "id": "local-callee/nested-body-leaks",
        "what": "the collector walks INTO a nested function's body, so that function's locals leak into the outer scope - a name bound only in `inner` reads as local to `outer`",
        "old": """        if (t === "function_definition" || t === "class_definition") {
          const nm = this.findChildByType(n, "identifier")
          if (nm?.text) names.add(nm.text)
          continue // its BODY is its own scope; only its name binds here
        }""",
        "new": """        if (t === "function_definition" || t === "class_definition") {
          const nm = this.findChildByType(n, "identifier")
          if (nm?.text) names.add(nm.text)
          // MUTANT: no `continue` - the nested BODY is walked and its locals leak outward
        }""",
        "expect": "CAUGHT",
    },
    {
        "id": "import-alias/namespace-alias-dropped",
        "what": "`import X as Y` stops publishing the bound name - every `t.Callable` / `t.Protocol` route returns to reading as a name bound by nothing",
        "old": """          ...(alias ? { importedAs: alias } : {}),
""",
        "new": """          // MUTANT: the namespace alias is not published
""",
        "expect": "CAUGHT",
    },
    {
        "id": "import-alias/from-item-binding-lost",
        "what": "`from X import Z as W` stops publishing the bound name - the second shape, whose binding was lost one layer deeper still",
        "old": """            ...(item.bound ? { importedAs: item.bound } : {}),
""",
        "new": """            // MUTANT: the from-import item binding is not published
""",
        "expect": "CAUGHT",
    },
    {
        "id": "import-alias/invented-for-plain",
        "what": "the bound name is invented for an UN-aliased import - a key that merely repeats the imported name, the direction that turns a fact into noise",
        "old": """          ...(alias ? { importedAs: alias } : {}),
""",
        "new": """          ...(alias ? { importedAs: alias } : { importedAs: moduleName }),
""",
        "expect": "CAUGHT",
    },
    {
        "id": "reference-binding/axis-removed",
        "what": "the local-binding axis removed from `references` - a type-holding name bound in the enclosing function falls back to the position code, and the 246-edge residual round 8 priced returns to UNEXPLAINED",
        "old": "          const bindingReason = this.dynamicTypeBindingReason(tn, t, functionLocals)\n",
        "new": "          const bindingReason = undefined // MUTANT: the binding is not read\n",
        "expect": "CAUGHT",
    },
    {
        "id": "reference-binding/claimed-for-everything",
        "what": "the OVER-claim direction - every reference is declared a local binding, so a module-level type at an isinstance position is labelled dynamic too and the code stops distinguishing anything",
        "old": "  private dynamicTypeBindingReason(leaf: Node | null | undefined, name: string, locals: Map<string, Set<string>>): string | undefined {\n    if (!leaf || !name) return undefined\n",
        "new": "  private dynamicTypeBindingReason(leaf: Node | null | undefined, name: string, locals: Map<string, Set<string>>): string | undefined {\n    if (!leaf || !name) return undefined\n    return \"local-binding-target\" // MUTANT: labelled unconditionally\n",
        "expect": "CAUGHT",
    },
    {
        "id": "extends/dynamic-base-stated-as-a-class",
        "what": "the base axis reverted - `class Row(dump_cls)` publishes an unqualified extends edge for a base whose class only exists at runtime",
        "old": "            ...(!ifaceKind && baseBindingReason ? { reasonCode: baseBindingReason } : {}),\n",
        "new": "            // MUTANT: a dynamic base is not stated\n",
        "expect": "CAUGHT",
    },
    {
        "id": "inline-type-parameter/not-read",
        "what": "PEP-695 type parameters are no longer read - `def f[T]` falls back to the position code, re-opening the 52-edge residual",
        "old": "      if (cur.type === \"function_definition\" || cur.type === \"class_definition\") {\n        if (this.typeParameterNames(cur).has(name)) return \"inline-type-parameter\"\n      }\n",
        "new": "      // MUTANT: the type-parameter clause is not read\n",
        "expect": "CAUGHT",
    },
    {
        "id": "inline-type-parameter/bound-read-as-the-name",
        "what": "the clause is read from the WRONG end - `def f[W: int]` yields the BOUND (`int`) instead of the parameter (`W`), so the name goes unstated and a constraint is published as a reference",
        "old": "    if (n.type === \"identifier\") return n.text\n    for (let i = 0; i < n.namedChildCount; i++) {\n      const c = n.namedChild(i)\n      if (!c) continue\n      const found = this.firstIdentifier(c)\n      if (found !== undefined) return found\n    }\n    return undefined\n",
        "new": "    if (n.type === \"identifier\") return n.text\n    for (let i = n.namedChildCount - 1; i >= 0; i--) {\n      const c = n.namedChild(i)\n      if (!c) continue\n      const found = this.firstIdentifier(c)\n      if (found !== undefined) return found\n    }\n    return undefined\n",
        "expect": "CAUGHT",
    },
    {
        "id": "parser-error/type-clause-claims-again",
        "what": "PY-D17 reverted - a type clause the parser flagged is walked again, so `def f(d: double[:], o: Optional[double[:]])` publishes `references f -> o`, a PARAMETER claimed to be a type",
        "old": "      if ((n as any).hasError === true) return\n      if (n.type === \"identifier\") {\n",
        "new": "      // MUTANT: a parser-flagged clause is trusted again\n      if (n.type === \"identifier\") {\n",
        "expect": "CAUGHT",
    },
    {
        "id": "parser-error/no-clause-is-trusted",
        "what": "the OVER-correction direction - NO declared type is published at all, so the clean clauses that must keep `Optional`/`list`/`Mapping`/`dict`/`double` go silent and the fix stops distinguishing a malformed clause from an ordinary one",
        "old": "      if ((n as any).hasError === true) return\n      if (n.type === \"identifier\") {\n",
        "new": "      if ((n as any).hasError === true) return\n      return // MUTANT: every clause refused\n      if (n.type === \"identifier\") {\n",
        "expect": "CAUGHT",
    },
    {
        "id": "parser-error/call-in-error-region",
        "what": "the CALL side reverted - a call whose subtree the parser flagged publishes a callee again, which is how an ASN.1 document named `.py` produced `calls BitStr -> SIZE`",
        "old": "    if ((node as any).hasError === true) return\n    for (let anc = node.parent; anc; anc = anc.parent) {\n      if (anc.type === \"ERROR\" || (anc as any).isMissing === true) return\n    }\n",
        "new": "    // MUTANT: a call inside a parser-flagged region is published\n",
        "expect": "CAUGHT",
    },
    {
        "id": "round10/global-write-symbol-disabled",
        "what": 'PY-D18 disabled: `global X` + a creating write no longer publishes the module-scope binding, so the priced 98 rows stay unresolved',
        "old": '    this.publishGlobalWriteBindings(rootNode, ctx)',
        "new": '    // MUTANT round10: disabled',
        "expect": "CAUGHT",
    },
    {
        "id": "round10/creation-needs-no-value",
        "what": "the creating write accepts a VALUELESS annotation (`X: T`), which binds nothing in CPython — the price script's overcount, re-opened",
        "old": '            if (!n.childForFieldName("right")) break',
        "new": '            // MUTANT round10: valueless annotations count as creating',
        "expect": "CAUGHT",
    },
    {
        "id": "round10/nested-body-inherits-globals",
        "what": "a nested function's body is read as part of its parent, so an outer `global` + an inner write becomes a pair CPython never makes",
        "old": '        if (t === "function_definition" || t === "class_definition") continue\n        if (t === "lambda" || t === "list_comprehension" || t === "set_comprehension" ||',
        "new": '        if (t === "lambda" || t === "list_comprehension" || t === "set_comprehension" ||',
        "expect": "CAUGHT",
    },
    {
        "id": "round10/module-scope-dedupe-dropped",
        "what": 'the dedupe against module-scope declarations is removed, so a name already bound at module level (and one bound by an import) gets a SECOND declaration',
        "old": '      if (bound.has(name)) continue',
        "new": '      // MUTANT round10: dedupe dropped',
        "expect": "CAUGHT",
    },
    {
        "id": "round10/as-binding-reads-old-fields",
        "what": "round 7's dead reads restored: `with_item.alias` / `except_clause.name`, which are null on every node this grammar produces",
        "old": '            addTargets(this.asBindingTarget(n), names)',
        "new": '            addTargets(n.childForFieldName("alias"), names)  // MUTANT round10: the old dead read',
        "expect": "CAUGHT",
    },
    {
        "id": "round10/star-import-fact-dropped",
        "what": "PY-D19's surface fact dropped: `from M import *` stops saying `starImport`, so the verdict can no longer tell it from `import M`",
        "old": '            ...(item.name === "*" ? { starImport: true } : {}),',
        "new": '            // MUTANT round10: star fact dropped',
        "expect": "CAUGHT",
    },
    # ------------------------------------------------------------------ round 11 (PY-D21 / PY-D22)
    {
        "id": "round11/multi-target-targets-disabled",
        "what": "round 10's gate restored: a non-identifier target publishes NOTHING, so every multi-target assignment binds no name again (the 12-row corpus blast returns)",
        "old": '    const targetNodes = left.type === "identifier" ? [left] : this.patternTargetNodes(left)',
        "new": '    const targetNodes = left.type === "identifier" ? [left] : []',
        "expect": "CAUGHT",
    },
    {
        "id": "round11/splat-target-dropped",
        "what": "the round-11 walker literal removed: `a, *rest = f()` descends the pattern and silently drops the SPLAT element, which is the defect the literal was added to fix",
        "old": '          t.type === "as_pattern_target" || t.type === "list_splat_pattern" ||',
        "new": '          t.type === "as_pattern_target" ||',
        "expect": "CAUGHT",
    },
    {
        "id": "round11/multi-target-form-fact-dropped",
        "what": "the provenance fact dropped from the symbol metadata, so nothing on the published symbol says WHICH spelling bound it",
        "old": '      metadata: { pythonSpecific: true, isModuleVariable: true, ...this.multiTargetForm(left) },',
        "new": '      metadata: { pythonSpecific: true, isModuleVariable: true },',
        "expect": "CAUGHT",
    },
    {
        "id": "round11/comprehension-scope-check-dropped",
        "what": "PY-D22's CALLEE check removed, so a call to a comprehension's own `for` target is attributed to the project again",
        "old": '      } else if (this.scopeOwnBindings(cur).has(name)) {\n        return true\n      }',
        "new": '      }',
        "expect": "CAUGHT",
    },
    {
        "id": "round11/reference-scope-check-dropped",
        "what": "PY-D22's REFERENCE check removed — the same fact read by the annotation emitter, which is 1 of the 12 priced corpus rows and would otherwise drift independently of the call side",
        "old": '      } else if (this.scopeOwnBindings(cur).has(name)) {\n        // PY-D22 (round 11) — a comprehension\'s `for` target and a lambda\'s parameter are bindings',
        "new": '      } else if (cur.type === "no_such_scope_node") {\n        // PY-D22 (round 11) — a comprehension\'s `for` target and a lambda\'s parameter are bindings',
        "expect": "CAUGHT",
    },
    {
        "id": "round11/lambda-scope-check-dropped",
        "what": "the LAMBDA half of PY-D22 removed: a lambda's parameters live under `lambda_parameters`, a spelling different from a `def`'s, and dropping the case reads a parameter call as a project-wide name",
        "old": '      case "lambda": {\n        const params = scope.childForFieldName("parameters")\n        if (params) this.addParameterNames(params, out)\n        return out\n      }',
        "new": '      case "lambda": {\n        return out\n      }',
        "expect": "CAUGHT",
    },
    {
        "id": "round11/first-clause-only",
        "what": "only the FIRST `for` clause of a comprehension is read, so a target of a later clause (`for k, v in ... for v2 in (k, v)`) binds nothing",
        "old": '          if (c?.type !== "for_in_clause") continue',
        "new": '          if (c?.type !== "for_in_clause") continue\n          if (out.size > 0) continue  // MUTANT round11: only the first clause is read',
        "expect": "CAUGHT",
    },
    {
        "id": "round11/comprehension-locals-cheap-fix",
        "what": "THE CHEAP WRONG FIX pinned: comprehension targets are added to the ENCLOSING FUNCTION's local set instead of the comprehension's own scope, so a read of the same name AFTER the comprehension is excused as a local",
        "old": '          continue // its BODY is its own scope; only its name binds here\n        }\n        if (t === "lambda" || t === "list_comprehension" || t === "set_comprehension" ||\n            t === "dictionary_comprehension" || t === "generator_expression") continue',
        "new": '          continue // its BODY is its own scope; only its name binds here\n        }\n        if (t === "lambda" || t === "list_comprehension" || t === "set_comprehension" ||\n            t === "dictionary_comprehension" || t === "generator_expression") {\n          for (let i = 0; i < n.namedChildCount; i++) {\n            const cc = n.namedChild(i)\n            if (cc?.type === "for_in_clause") addTargets(cc.childForFieldName("left"), names)\n          }\n          continue\n        }',
        "expect": "CAUGHT",
    },
    {
        "id": "round12/module-binder-walk-disabled",
        "what": "PY-D23's publication disabled: a module-scope `for`/`with as`/`except as` binding is a name again with no declaration behind it (the wagtail `mixin` row returns)",
        "old": '    this.publishScopeBinderBindings(rootNode, ctx)',
        "new": '    // MUTANT: module/class binder publication disabled',
        "expect": "CAUGHT",
    },
    {
        "id": "round12/with-except-binder-dropped",
        "what": "the `with … as` and `except … as` halves of PY-D23 dropped while the `for` half stays - the shape a fix that only reads the statement it was reported on would have",
        "old": '''          case "with_item": {
            this.collectBinderNames(this.asBindingTarget(n), "with", currentClass, pending)
            break
          }
          case "except_clause": {
            this.collectBinderNames(this.asBindingTarget(n), "except", currentClass, pending)
            break
          }''',
        "new": '''          case "with_item":
          case "except_clause": {
            break // MUTANT: the with/except as-bindings dropped
          }''',
        "expect": "CAUGHT",
    },
    {
        "id": "round12/member-read-rule-dropped",
        "what": "PY-D24's rule disabled: an isinstance type argument written as a member read is published as a declaration-like name again (the 3 corpus rows return to UNEXPLAINED)",
        "old": '    if (leaf.parent?.type === "attribute") {',
        "new": '    if (false && leaf.parent?.type === "attribute") {',
        "expect": "CAUGHT",
    },
    {
        "id": "round12/member-read-receiver-guard-dropped",
        "what": "THE OVER-FIRING VERSION, pinned: the last-named-child guard removed, so the RECEIVER leaf (`field` inside `field.related_model`) takes `member-read` although the file binds it as a local - the exact defect the probe caught before the rule shipped",
        "old": '      if (!lastNamed || lastNamed.startIndex !== leaf.startIndex || lastNamed.endIndex !== leaf.endIndex) {',
        "new": '      if (false) {',
        "expect": "CAUGHT",
    },
]


def digest() -> str:
    return hashlib.sha256(TARGET.read_bytes()).hexdigest()


def run_fixtures() -> tuple[int, list[str]]:
    proc = subprocess.run(
        ["bun", "script/m14/run-fixtures.ts", "--lang", "python"],
        cwd=ROOT, capture_output=True, text=True, timeout=1200,
    )
    fails = [l.split()[1] for l in proc.stdout.splitlines() if l.startswith("FAIL")]
    return len(fails), fails


def main() -> int:
    verbose = "--verbose" in sys.argv
    original = TARGET.read_text()
    base_digest = hashlib.sha256(original.encode()).hexdigest()

    n0, f0 = run_fixtures()
    print(f"control (unmutated): {n0} failing fixture(s) {f0}")
    if n0 != 0:
        print("CONTROL IS RED - the suite must be green before a mutant result means anything.")
        TARGET.write_text(original)
        return 2

    results = []
    for m in MUTANTS:
        if m["old"] not in original:
            results.append((m, "NOT APPLIED", [], "pattern absent from the source"))
            continue
        TARGET.write_text(original.replace(m["old"], m["new"], 1))
        if digest() == base_digest:
            TARGET.write_text(original)
            results.append((m, "NOT APPLIED", [], "replacement was a no-op"))
            continue
        try:
            n, fails = run_fixtures()
        finally:
            TARGET.write_text(original)
        verdict = "CAUGHT" if n > 0 else "SURVIVED"
        results.append((m, verdict, fails, ""))
        if verbose and n == 0:
            print(f"    {m['id']}: survived with 0 failures")

    print()
    print(f"{'mutant':44} {'verdict':12} caught by")
    print("-" * 110)
    bad = 0
    for m, verdict, fails, why in results:
        print(f"{m['id']:44} {verdict:12} {', '.join(fails) if fails else why}")
        if verdict != m["expect"]:
            bad += 1

    print()
    caught = sum(1 for _, v, _, _ in results if v == "CAUGHT")
    survived = sum(1 for _, v, _, _ in results if v == "SURVIVED")
    notapplied = sum(1 for _, v, _, _ in results if v == "NOT APPLIED")
    print(f"{caught} caught · {survived} survived · {notapplied} not applied · of {len(results)}")
    print()
    for m, verdict, _, why in results:
        print(f"  {verdict:12} {m['id']}")
        print(f"               {m['what']}")
        if why:
            print(f"               {why}")

    TARGET.write_text(original)
    print()
    print("ANALYZER RESTORED to the unmutated source" if digest() == base_digest else "RESTORE FAILED")
    # A surviving mutant fails the suite, not the mutant (docs/M14-HONESTY-CONTRACT.md 5.3).
    if survived or notapplied:
        print(f"SUITE FAILS: {survived} surviving, {notapplied} unapplied.")
        return 1
    print("every mutant was applied and caught.")
    return 0


if __name__ == "__main__":
    sys.exit(main())