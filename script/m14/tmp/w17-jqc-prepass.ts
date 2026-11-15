// W17: replicate the analyzer's declaredNames pre-pass VERBATIM (from
// real-c-analyzer.ts L195-284) on prefix-2100 builtin.c and report why
// last_var/init/etc. are admitted or not.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const JQ = "/home/ishaq2321/bb_tests/repositories/jq"

// --- verbatim helpers (mirrors of the analyzer's private methods) ---
const isDeclarationLikeIdentifier = (n: any): boolean => {
  const p = n.parent
  if (!p) return false
  const DECL = new Set(["declaration", "init_declarator", "parameter_declaration", "field_declaration", "enumerator", "preproc_def", "preproc_function_def", "function_declarator", "pointer_declarator", "array_declarator", "type_definition"])
  return DECL.has(p.type)
}
const isDirectiveConditionText = (n: any): boolean => {
  const p0 = n.parent
  if (p0 && (p0.type === "preproc_def" || p0.type === "preproc_function_def")) return false
  let cur: any = n.parent
  while (cur) {
    const t: string = cur.type
    if (/statement|declaration|definition|declarator|specifier|enumerator|compound/.test(t)) return false
    if (t.startsWith("preproc_")) return true
    cur = cur.parent
  }
  return false
}
const isInsideParameterList = (n: any): boolean => {
  let cur: any = n
  while (cur) { if (cur.type === "parameter_list") return true; cur = cur.parent }
  return false
}
// isCgd19SuppressedVarDecl mirror (ERROR-span, after-first-glue-header test)
const isCgd19SuppressedVarDecl = (n: any): boolean => {
  let cur: any = n
  let innermost: any = null
  while (cur) { if (cur.type === "ERROR") innermost = cur; cur = cur.parent }
  if (!innermost) return false
  const key = innermost.startIndex as number
  // single-span memo not needed in probe
  let headerIdx = -1
  const st: any[] = [innermost]
  while (st.length) {
    const m = st.pop()!
    if (m !== innermost) {
      if (m.type === "function_definition") { if (headerIdx < 0 || m.startIndex < headerIdx) headerIdx = m.startIndex }
      else if (m.type === "function_declarator") {
        let w: any = m
        let bare = true
        while (w) {
          if (w.startIndex === innermost.startIndex && w.endIndex === innermost.endIndex) break
          if (w.type === "declaration" || w.type === "function_definition") { bare = false; break }
          w = w.parent
        }
        if (bare && w && (headerIdx < 0 || m.startIndex < headerIdx)) headerIdx = m.startIndex
      }
    }
    for (let k = 0; k < m.namedChildCount; k++) { const c = m.namedChild(k); if (c) st.push(c) }
  }
  return headerIdx >= 0 && n.startIndex > headerIdx
}

async function main() {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const full = fs.readFileSync(path.join(JQ, "src/builtin.c"), "utf8")
  const src = full.split("\n").slice(0, 2100).join("\n")
  const root = p.parse(src).rootNode

  const declaredNames = new Set<string>()
  const admitted: Record<string, string> = {}
  const preStack: { n: any; inFn: boolean }[] = [{ n: root, inFn: false }]
  while (preStack.length > 0) {
    const { n, inFn } = preStack.pop()!
    const nextInFn = inFn || n.type === "function_definition"
    if (n.type === "identifier" || n.type === "field_identifier") {
      const p2 = n.parent
      const isFnDefName = (() => {
        if (!p2 || p2.type !== "function_declarator") return false
        let mid: any = p2
        while (mid) {
          if (mid.type === "compound_statement" || mid.type === "parameter_list") return false
          if (mid.type === "function_definition") return true
          mid = mid.parent
        }
        return false
      })()
      if (p2 && (!inFn || isFnDefName) && isDeclarationLikeIdentifier(n) && !isDirectiveConditionText(n) && !isInsideParameterList(n)) {
        const isProto = (() => {
          if (p2.type !== "function_declarator") return false
          let mid: any = p2
          while (mid) {
            if (mid.type === "function_definition") return true
            if (mid.type === "declaration") return false
            mid = mid.parent
          }
          return false
        })()
        const isGlueFdName = (() => {
          if (p2.type !== "function_declarator") return false
          const gp = p2.parent
          if (!gp || gp.type !== "ERROR") return false
          const errStart = gp.startIndex
          const errEnd = gp.endIndex
          let m: any = n
          while (m) {
            if (m.startIndex === errStart && m.endIndex === errEnd) return true
            if (m.type === "declaration") return false
            m = m.parent
          }
          return false
        })()
        const isMacroName = !!(p2.type === "preproc_def" || p2.type === "preproc_function_def")
        const admittedIn = isProto || isMacroName || !(isGlueFdName || isCgd19SuppressedVarDecl(n))
        if (admittedIn) {
          declaredNames.add(n.text)
          if (["last_var", "is_empty_var", "init", "call_arg", "if_empty", "rangevar", "rangestart", "builtin_defs", "builtin_def_1arg"].includes(n.text)) {
            admitted[n.text + "@" + n.startIndex] = "admitted via " + (isProto ? "PROTO" : isMacroName ? "MACRO" : "NOT-SUPPRESSED")
          }
        } else if (["last_var", "is_empty_var", "init", "call_arg", "if_empty"].includes(n.text)) {
          console.log("decl " + n.text + "@" + n.startIndex + " EXCLUDED (suppressed)")
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) preStack.push({ n: c, inFn: nextInFn })
    }
  }
  console.log("=== admissions of leak-class names ===")
  for (const [k, v] of Object.entries(admitted)) console.log(k + " :: " + v)
}
main()
