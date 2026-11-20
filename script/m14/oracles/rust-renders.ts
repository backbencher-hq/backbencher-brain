/**
 * The Rust `renders` oracle — LANE-OWNED.
 *
 * It lives here rather than in `differential.ts` for the reason its siblings
 * (`rust-contains.ts`, `rust-overrides.ts`) record: that shared file is edited by
 * several lanes at once, and every line a lane keeps out of a shared file is a
 * line that cannot conflict.
 *
 * ## Why this file exists
 *
 * `renders` is admitted to the differential's compared-label set for EVERY
 * language through the global list (`"renders"` sits in the head of the
 * allowlist), and rust publishes the edge — the analyzer emits one per
 * UI-framework macro invocation whose angle-tag names a same-file component.
 * But `deriveRustEdges` has NO render branch and no other rust oracle derives
 * one, so the label is COMPARED WITH NO TRUTH. Today that reads as a clean
 * 0/0; the day a corpus file carries a render macro, every true row reads as
 * UNEXPLAINED, which is exactly the "allowance without truth" shape the
 * differential's own comments name as worse than an exclusion. This oracle is
 * the missing half, written before the corpus needs it.
 *
 * ## The rule (independent of the analyzer)
 *
 * A `renders` truth row exists when ALL of the following hold, each read from
 * the tree:
 *
 *   1. a `macro_invocation` whose name is one of the six DECLARED render hosts
 *      (view / html / rsx / render / maud / markup) — a name filter on the
 *      macro leaf, because shape alone is the dart impostor lesson;
 *   2. its `token_tree` contains an angle-tag shape: an anonymous `<` child
 *      followed by an `identifier` child, with a closing `>` or `/>` later in
 *      the same tree. The angle brackets are anonymous `token` nodes in this
 *      grammar, so the scan must read ALL children, not named children only;
 *   3. the tag identifier is NOT a bare HTML tag (the impostor stop: `<div/>`
 *      renders a value, not a component);
 *   4. the tag identifier names a symbol THIS FILE declares — the component
 *      test. The declaration inventory is built from the tree's own item nodes
 *      (struct/enum/trait/union/type/function/const/static/mod), NOT from the
 *      analyzer's symbol table, so a match means two walkers agreed.
 *
 * The edge is `renders(<enclosing fn-or-module-scope> -> <tag>)`. The scope is
 * the innermost named item the invocation sits inside, else the file — the
 * same contract the analyzer publishes (`edgeSource(parent) ?? file`), derived
 * here by walking ancestors, not by calling the analyzer.
 *
 * ## What this oracle deliberately does NOT do
 *
 * It does not expand the macro (RUST-D2: macro bodies are templates, and a
 * render host is no exception). It does not look inside `macro_definition`
 * bodies. It does not follow `use` imports to decide whether the tag is
 * same-file: the test IS same-file, and a tag imported from another crate is
 * not a component this file renders.
 */

export type RustRendersEdge = { label: "renders"; from: string; target: string }

const RENDER_MACROS = new Set(["view", "html", "rsx", "render", "maud", "markup"])

/** Bare HTML tags render a VALUE, not a component. */
const BARE_HTML = new Set([
  "div","span","p","a","ul","li","ol","h1","h2","h3","h4","h5","h6","br","hr",
  "img","input","button","form","table","tr","td","th","section","header",
  "footer","nav","main","aside","article","label","select","option","textarea",
  "canvas","svg","path","g","template","slot",
])

/** Item nodes that declare a nameable symbol in this file. */
const ITEM_TYPES = new Set([
  "struct_item", "enum_item", "trait_item", "union_item", "type_item",
  "function_item", "const_item", "static_item", "mod_item",
])

/** The name node of an item: `name` field, else `type` field, else first identifier. */
function itemNameOf(item: any): string | null {
  const f = item.childForFieldName?.("name")
  if (f && String(f.text).length > 0) return String(f.text)
  for (let i = 0; i < item.namedChildCount; i++) {
    const c = item.namedChild(i)
    if (!c) continue
    const t = String(c.type)
    if (t === "type_identifier" || t === "identifier") return String(c.text)
  }
  return null
}

/** Every name this file declares, read from the tree's own items. */
function declaredNames(root: any): Set<string> {
  const out = new Set<string>()
  const walk = (n: any): void => {
    if (!n) return
    if (ITEM_TYPES.has(String(n.type))) {
      const nm = itemNameOf(n)
      if (nm) out.add(nm)
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
  return out
}

/** The innermost named item enclosing a node, else the file spelling. */
function enclosingScope(node: any, declared: Set<string>): string {
  for (let p = node.parent; p; p = p.parent) {
    if (ITEM_TYPES.has(String(p.type))) {
      const nm = itemNameOf(p)
      if (nm && declared.has(nm)) return nm
    }
  }
  return "(file)"
}

/** The macro_invocation's token_tree, as the named CHILD it is (no field read). */
function tokenTreeOf(inv: any): any | null {
  for (let i = 0; i < inv.namedChildCount; i++) {
    const c = inv.namedChild(i)
    if (c && String(c.type) === "token_tree") return c
  }
  return null
}

/** The macro's name leaf: `macro_name` child, else first identifier child. */
function macroNameOf(inv: any): string | null {
  for (let i = 0; i < inv.namedChildCount; i++) {
    const c = inv.namedChild(i)
    if (!c) continue
    const t = String(c.type)
    if (t === "macro_name" || t === "identifier" || t === "scoped_identifier") {
      const txt = String(c.text).replace(/!$/, "")
      if (txt.length > 0) return txt
    }
  }
  return null
}

/**
 * Derive every `renders` truth row for one parsed rust file.
 * `root` is the file's `source_file` node.
 */
export function deriveRustRendersTruth(root: any): RustRendersEdge[] {
  const declared = declaredNames(root)
  const out: RustRendersEdge[] = []

  const walk = (n: any): void => {
    if (!n) return
    if (String(n.type) === "macro_invocation") {
      const name = macroNameOf(n)
      if (name && RENDER_MACROS.has(name)) {
        const tt = tokenTreeOf(n)
        if (tt) {
          // ALL children, including anonymous tokens: the angle brackets are
          // anonymous `token` nodes and the tag is the identifier after `<`.
          const flat: { text: string; type: string }[] = []
          for (let k = 0; k < tt.childCount; k++) {
            const c = tt.child(k)
            if (c) flat.push({ text: String(c.text), type: String(c.type) })
          }
          for (let k = 0; k + 1 < flat.length; k++) {
            if (flat[k].text === "<" && flat[k + 1].type === "identifier") {
              const tag = flat[k + 1].text
              if (tag.length > 0 && !BARE_HTML.has(tag.toLowerCase()) && declared.has(tag)) {
                out.push({ label: "renders", from: enclosingScope(n, declared), target: tag })
              }
              k++ // consumed the tag identifier
            }
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
  return out
}