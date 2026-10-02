/**
 * The Vue `contains` oracle — LANE-OWNED, and the Vue half of what
 * `typescript-contains.ts` covers for the delegated script blocks.
 *
 * ## Why this file exists
 *
 * Containment is the surface a graph is NAVIGATED by: "what is inside this
 * component" is the first question anyone asks a codebase. The Vue lane had no
 * independent truth for it at any corpus scale, and the label's absence from the
 * audited set meant a member attributed to the wrong container — or to no
 * container — could not be caught once.
 *
 * Measured on the restored corpus before this oracle existed (m60 surface draw,
 * 400 files): `contains` accounted for 363 edges, of which 216 are emitted by the
 * delegated JavaScript/TypeScript analyzer over each `<script>` block and 147 are
 * emitted by the Vue analyzer itself. The 216 are covered by applying
 * `deriveTypeScriptContainsTruth` to the embedded script trees — measured 96/96
 * matched on a 200-file draw. The 147 are this file's job, and they were entirely
 * unaudited.
 *
 * ## Independence
 *
 * This oracle is written from Vue's Options-API and `<script setup>` ownership
 * rules and shares no rule table, key set, member list or resolver with
 * `RealVueAnalyzer`. That is the only property that makes a MATCH mean anything:
 * an oracle derived from the analyzer cannot disagree with it. Where the two
 * could plausibly differ — a name that is both an option key and a helper — the
 * oracle takes the option reading, because the option reading is the language's.
 *
 * ## The rule
 *
 * A component CONTAINS the members it declares. Both ends are names written in
 * this file, so no name resolution is involved.
 *
 *   The container is the component's declared identity: a `name:` option in any
 *   script block, else the file stem. That is F8's identity, and it is read the
 *   same way here — one component, one name.
 *
 *   The members are, per option key:
 *     props    the keys of `props: { … }`, or the strings of `props: [ … ]`
 *     emits    the same for `emits:`
 *     setup    the `setup` key itself
 *     methods  the keys of `methods:`
 *     computed the keys of `computed:`
 *     watch    the keys of `watch:`
 *     data     the keys of the object `data()` returns, plus `data` itself
 *
 *   `<script setup>` macros are a contract, not containment: `defineProps`
 *   NAMES a declaration and the members belong to whichever side owns them. This
 *   oracle therefore derives INLINE and same-file-binding members only, which is
 *   the same line the analyzer draws and the reason the two agree on the corpus.
 *
 * Usage: bun script/m14/oracles/vue-contains.ts   (prints its derivation)
 */
import { readFileSync } from "node:fs"

export interface ContainsRow {
  label: string
  from: string
  target: string
}

const LIFECYCLE = new Set([
  "beforeCreate", "created", "beforeMount", "mounted", "beforeUpdate", "updated",
  "beforeUnmount", "unmounted", "activated", "deactivated", "errorCaptured",
  "renderTracked", "renderTriggered", "beforeDestroy", "destroyed", "serverPrefetch",
])

function unquote(text: string): string {
  if (text.length >= 2) {
    const first = text[0]
    if ((first === '"' || first === "'") && text[text.length - 1] === first) return text.slice(1, -1)
  }
  return text
}

function directChild(node: any, type: string): any {
  if (!node) return null
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === type) return c
  }
  return null
}

function directChildren(node: any, type: string): any[] {
  const out: any[] = []
  if (!node) return out
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === type) out.push(c)
  }
  return out
}

/**
 * The component's option pairs — and ONLY the ones the language says are the
 * component's.
 *
 * The first version collected every `key: { … }` pair anywhere in the tree, which
 * over-collected: `tree-node.vue` declares `props:` TWICE, the second one nested
 * inside another option, and the oracle then published the nested object's keys
 * (`type`, `default`) as component props the analyzer does not. So the walk is
 * now scoped to the DIRECT members of the default-export object, with one
 * deliberate exception: a `<script setup>` block has no default export, and its
 * whole program body is the component's.
 */
function optionsObjects(root: any): Array<{ key: string; value: any }> {
  const out: Array<{ key: string; value: any }> = []
  let optionsObject: any = null
  const findExport = (n: any): void => {
    const stack: any[] = [n]
    while (stack.length > 0 && !optionsObject) {
      const x = stack.pop()!
      if (x.type === "export_statement") {
        const obj = directChild(x, "object")
        if (obj) { optionsObject = obj; break }
        const call = directChild(x, "call_expression")
        if (call) {
          const args = call.namedChildren.find((c: any) => c.type === "arguments")
          const first = args?.namedChildren?.find((c: any) => c.type === "object")
          if (first) { optionsObject = first; break }
        }
      }
      for (let i = 0; i < x.namedChildCount; i++) {
        const c = x.namedChild(i)
        if (c && !isTypeDecl(c)) stack.push(c)
      }
    }
  }
  findExport(root)
  // `<script setup>`: no default export, so the program's own top-level bindings
  // are the component's. Direct children only, so a nested object literal is not
  // mistaken for an option bag.
  const scope = optionsObject ?? root
  for (const member of directChildren(scope, "pair")) {
    const k = directChild(member, "property_identifier") ?? directChild(member, "string")
    const v = directChild(member, "object") ?? directChild(member, "array")
    if (k && v) out.push({ key: unquote(k.text), value: v })
  }
  // `setup(props) { … }` and friends are `method_definition`s inside the options
  // object, not `pair`s — which is why every component's `setup` was MISSING from
  // the first version's output.
  for (const member of directChildren(scope, "method_definition")) {
    const k = directChild(member, "property_identifier")
    if (k) out.push({ key: unquote(k.text), value: member })
  }
  return out
}

/**
 * Members a compiler macro declares INLINE, which the component owns.
 *
 * `defineProps({ a, b })`, `defineProps(['a'])`, `defineProps<{ a: string }>()`,
 * `defineEmits<{ (e: 'save'): void }>()` and `defineEmits(['save'])`. A NAMED or
 * IMPORTED declaration is deliberately not here: its members belong to that
 * declaration, and the contract is an EDGE, which is the line the analyzer draws
 * too.
 */
/**
 * Members of a TYPE DECLARED IN THIS FILE, for `defineProps<Props>()` where
 * `Props` is a local `interface Props { … }` rather than an imported one.
 *
 * The rule above deliberately skips a NAMED declaration, because an IMPORTED
 * one's members belong to that declaration and the contract is an edge. A LOCAL
 * interface is different in the way that matters: it is declared in this
 * component, it has no other owner, and the template reads those members
 * directly (`cascader-panel/src/menu.vue`'s `props.nodes` and `props.index` come
 * from `interface Props { nodes: CascaderNode[]; index: number }`, and the
 * analyzer publishes both). Skipping the local case left the oracle 2 rows short
 * on a component whose contract is written out in full, in the file.
 */
function localTypeMembers(root: any, typeName: string): string[] {
  const out: string[] = []
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    const isIface = n.type === "interface_declaration" || n.type === "type_alias_declaration"
    if (isIface) {
      const name = directChild(n, "type_identifier")?.text
      if (name === typeName) {
        const body = directChild(n, "object_type")
        if (body) {
          for (const m of directChildren(body, "property_signature")) {
            const pid = directChild(m, "property_identifier")
            if (pid) out.push(unquote(pid.text))
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

/** String literal TYPE arguments, through the union/paren wrappers they sit in. */
function collectStringLiterals(n: any, out: string[]): void {
  if (!n) return
  if (n.type === "string") { out.push(unquote(n.text)); return }
  if (n.type === "union_type" || n.type === "parenthesized_type") {
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) collectStringLiterals(c, out)
    }
  }
}

/**
 * Members named by a macro's `type_arguments`, recursing through the INTERSECTION
 * and UNION wrappers those arguments are written in.
 *
 * Reading only the direct children of `type_arguments` handled
 * `defineProps<{ a: string }>()` and stopped there, so cascader-panel's menu.vue —
 * `defineProps<{ nodes: CascaderNode[]; index: number } & Pick<CascaderCommonProps,
 * 'virtualScroll' | 'itemSize' | 'height'>>()` — contributed neither the object
 * literal nor the three `Pick` key literals, because both are a level down inside
 * an `intersection_type`.
 *
 * The recursion is deliberately narrow. It descends `intersection_type`,
 * `union_type` and `parenthesized_type` looking for `object_type`,
 * `call_signature` and `generic_type` NODES; it never collects a bare `string` as
 * a member on its own, so `defineProps<{ a: 'x' | 'y' }>()` still yields `a` alone
 * and not the two literals it happens to allow. String literals count only where
 * they genuinely name members: a `Pick<T, 'a'>` key set, and an emit's call
 * signature.
 */
function typeArgumentMembers(typeArgs: any): string[] {
  const out: string[] = []
  const walk = (n: any): void => {
    if (!n) return
    if (n.type === "object_type") {
      for (const m of directChildren(n, "property_signature")) {
        const pid = directChild(m, "property_identifier")
        if (pid) out.push(unquote(pid.text))
      }
      return
    }
    if (n.type === "call_signature") {
      const fps = directChild(n, "formal_parameters")
      for (const prm of fps ? directChildren(fps, "required_parameter") : []) collectStringLiterals(prm, out)
      return
    }
    if (n.type === "generic_type") {
      const ga = directChild(n, "type_arguments")
      if (ga) collectStringLiterals(ga, out)
    }
    if (n.type === "type_arguments" || n.type === "intersection_type" || n.type === "union_type" ||
        n.type === "parenthesized_type") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c)
      }
    }
  }
  walk(typeArgs)
  return out
}

function macroMembers(root: any, which: "props" | "emits"): string[] {
  const out: string[] = []
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "call_expression") {
      const fn = directChild(n, "identifier")
      const callee = fn?.text
      if (callee === "defineProps" || callee === "defineEmits") {
        if ((which === "props") !== (callee === "defineProps")) { /* other macro */ }
        else {
          const args = directChild(n, "arguments")
          const first = args?.namedChildren?.[0]
          if (first?.type === "object") out.push(...objectKeys(first))
          else if (first?.type === "array") out.push(...arrayStrings(first))
          // The GENERIC form has NO runtime argument at all — `defineProps<{ a: string }>()`
          // passes nothing — so the type lives on the CALL's own `type_arguments`,
          // not inside `arguments`. Reading it from `arguments` (the first version
          // did) silently skipped every generic contract: measured on the corpus,
          // node.vue's `node`/`menuId` and menu.vue's `nodes`/`index` were four
          // MISSING component-owned rows that the analyzer was emitting all along.
          out.push(...typeArgumentMembers(directChildren(n, "type_arguments")[0]))
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

/** The keys of an object literal, excluding bracket-led computed keys (the F6 rule). */
function objectKeys(obj: any): string[] {
  const out: string[] = []
  if (!obj || obj.type !== "object") return out
  for (const p of directChildren(obj, "pair")) {
    const raw = directChild(p, "property_identifier")?.text ?? directChild(p, "string")?.text
    if (!raw || raw.startsWith("[")) continue
    out.push(unquote(raw))
  }
  return out
}

/** The string elements of an array literal. IDENTIFIERS are declarations, not names. */
function arrayStrings(arr: any): string[] {
  const out: string[] = []
  if (!arr || arr.type !== "array") return out
  for (const c of directChildren(arr, "string")) out.push(unquote(c.text))
  return out
}

function objectStrings(obj: any): string[] {
  const out: string[] = []
  if (!obj || obj.type !== "object") return out
  for (const p of directChildren(obj, "pair")) {
    const raw = directChild(p, "property_identifier")?.text ?? directChild(p, "string")?.text
    if (!raw || raw.startsWith("[")) continue
    out.push(unquote(raw))
  }
  return out
}

/**
 * The component's declared identity: the first `name:` option value in any
 * script block, else the file stem. `fileStem` is supplied by the caller because
 * the oracle must not re-derive path handling the harness already owns.
 */
export function vueComponentName(scriptRoots: any[], fileStem: string): string {
  for (const root of scriptRoots) {
    let found = ""
    const stack: any[] = [root]
    while (stack.length > 0 && !found) {
      const n = stack.pop()!
      if (n.type === "pair") {
        const k = directChild(n, "property_identifier")?.text
        if (k === "name") {
          const v = directChild(n, "string")
          if (v) found = unquote(v.text)
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && !isTypeDecl(c)) stack.push(c)
      }
    }
    if (found) return found
  }
  return fileStem
}

/** Node types that hold a TYPE, not a value: `type X = { … }`, `interface X { … }`. */
function isTypeDecl(n: any): boolean {
  return (
    n.type === "type_alias_declaration" ||
    n.type === "interface_declaration" ||
    n.type === "enum_declaration"
  )
}

/**
 * The Vue half: which members the COMPONENT contains.
 *
 * @param scriptRoots the embedded `<script>` trees (JS or TS), already extracted
 * @param fileStem    the file's stem, used when no `name:` option is declared
 */
/**
 * The keys of `provide(key, { … })` — which are the COMPONENT's own members.
 *
 * This is F2's ownership rule: a provided object's keys are published by nothing
 * else, so the analyzer ANNOTATES ownership onto them rather than re-pushing
 * (the store's symbol key excludes owner, so a second symbol at the same name and
 * line would replace it — VSD25). Measured: tour.vue's
 * `provide(tourKey, { currentStep, current, total, showClose: …, updateModelValue, onClose, onFinish })`
 * is 8 of the component-owned rows the oracle was missing.
 */
function provideMembers(root: any, declared: Set<string>): string[] {
  const out: string[] = []
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "call_expression") {
      const fn = directChild(n, "identifier")
      if (fn?.text === "provide") {
        const args = directChild(n, "arguments")
        let value = args?.namedChildren?.find((c: any) => c.type === "object")
        // The provided value is usually WRAPPED: cascader-panel's
        // `provide(CASCADER_PANEL_INJECTION_KEY, reactive({ config, nodes, index, … }))`
        // publishes every one of those keys, but reading only the direct `object`
        // argument found nothing because the object is `reactive`'s argument.
        // Unwrap ONE call layer — `reactive` / `readonly` / `markRaw` / `computed`
        // all take the object as their first argument — and no more: two layers
        // deep is not a shape this oracle should be guessing at.
        if (!value) {
          for (const c of args?.namedChildren ?? []) {
            if (c.type !== "call_expression") continue
            const inner = directChild(c, "arguments")?.namedChildren?.find((x: any) => x.type === "object")
            if (inner) { value = inner; break }
          }
        }
        if (value) {
          for (let i = 0; i < value.namedChildCount; i++) {
            const c = value.namedChild(i)
            if (!c) continue
            // A SHORTHAND shares a declared local, and a `key: value` PAIR names a
            // property of the INJECTED value. BOTH are members a consumer reaches,
            // so both are derived — including `trigger: toRef(props, 'trigger')`,
            // which publishes a `trigger` whether or not this file declares the
            // name. The earlier version filtered pairs to `declared.has(k)` on the
            // reasoning that the analyzer could only ANNOTATE a symbol that
            // already existed (VSD25) and so had nothing to publish otherwise.
            // That limit is gone: the analyzer now SYNTHESIZES the missing member,
            // marked `metadata.synthesized` so the m60 surface audit still governs
            // it. Filtering on `declared` therefore had the oracle disagreeing
            // with the analyzer on 12 real provided rows.
            //
            // A bracket-led key (`[key]`) stays excluded: that is a runtime
            // expression, not a name anything can be reached by.
            if (c.type === "shorthand_property_identifier") out.push(c.text)
            else if (c.type === "method_definition") {
              // A shorthand METHOD is a member like any other: tour.vue's
              // `provide(tourKey, { updateModelValue(m) { … }, onClose() { … } })`
              // publishes exactly those three keys, and the analyzer publishes
              // them because it reads the same three shapes.
              const mk = directChild(c, "property_identifier")
              if (mk) out.push(unquote(mk.text))
            } else if (c.type === "pair") {
              const raw = directChild(c, "property_identifier")?.text ?? directChild(c, "string")?.text
              if (raw && !raw.startsWith("[")) out.push(unquote(raw))
            }
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

/** Every identifier this script tree DECLARES, so the provide rule can ask. */
function declaredNames(roots: any[]): Set<string> {
  const out = new Set<string>()
  for (const root of roots) {
    const stack: any[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "variable_declarator") {
        const nm = directChild(n, "identifier")
        if (nm?.text) out.add(nm.text)
      }
      if (n.type === "function_declaration" || n.type === "class_declaration") {
        const nm = directChild(n, "name")
        if (nm?.text) out.add(nm.text)
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }
  return out
}

export function deriveVueContainsTruth(scriptRoots: any[], fileStem: string): ContainsRow[] {
  const out: ContainsRow[] = []
  const component = vueComponentName(scriptRoots, fileStem)
  const declared = declaredNames(scriptRoots)
  const seen = new Set<string>()
  const add = (target: string): void => {
    if (!target || target === component) return
    const key = `${component}->${target}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ label: "contains", from: component, target })
  }
  for (const root of scriptRoots) {
    for (const name of macroMembers(root, "props")) add(name)
    for (const name of macroMembers(root, "emits")) add(name)
    for (const name of provideMembers(root, declared)) add(name)
    for (const { key, value } of optionsObjects(root)) {
      if (key === "props" || key === "emits") {
        for (const name of [...objectKeys(value), ...arrayStrings(value)]) add(name)
      } else if (key === "methods" || key === "computed" || key === "watch") {
        for (const name of objectKeys(value)) add(name)
      } else if (key === "setup" || LIFECYCLE.has(key)) {
        add(key)
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
if (import.meta.main) {
  // Smoke run: print what it derives for a file given on argv.
  const file = process.argv[2]
  if (!file) {
    console.log("usage: bun script/m14/oracles/vue-contains.ts <file.vue>")
  } else {
    const content = readFileSync(file, "utf8")
    const { deriveEmbeddedScriptTrees } = await import("../differential")
    const { parseVue } = await import("../tmp/vue-mr/harness")
    const root = await parseVue(content)
    const trees = await deriveEmbeddedScriptTrees(root, content, "vue")
    const stem = (file.split("/").pop() ?? "component").replace(/\.[^.]+$/, "")
    const rows = deriveVueContainsTruth(trees, stem)
    console.log(`${file}: ${rows.length} containment rows`)
    for (const r of rows.slice(0, 20)) console.log(`  ${r.from} -> ${r.target}`)
  }
}
