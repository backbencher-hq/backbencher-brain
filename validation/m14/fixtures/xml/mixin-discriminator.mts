/**
 * MIXES-IN DISCRIMINATOR — for every `xs:group ref=` and `xs:attributeGroup ref=` site in
 * the whole admitted population: does the named definition resolve IN THIS FILE, in another
 * admitted file, or nowhere? And which of the analyzer's existing edges does each site carry
 * today?
 *
 * ## WHY THIS IS THE DISCRIMINATOR AND NOT A NAME FILTER
 *
 * The mixin candidate is a COMPOSITION WITH NO CONFORMANCE: `<xs:group ref="G"/>` inside a
 * complexType composes G's content model into the type, and the type neither extends G nor
 * declares any conformance to it. The impostor classes the ruling must exclude, each by a
 * MEASURED property rather than by name:
 *
 *   - a `ref=` on an ELEMENT (`<xs:element ref="e"/>`) — a reference to a declared element,
 *     which the analyzer already emits as `references`
 *   - a `type=` attribute — a type USE, already `references`
 *   - an `xs:include` — a file splice, already `part_of`
 *   - `substitutionGroup=` — XSD's IS-A for elements; its TYPE-level relation is derivation,
 *     already `extends`
 *
 * ## RUN
 *   BB_CORPUS_ROOT=$PWD/.corpus npx tsx validation/m14/fixtures/xml/mixin-discriminator.mts
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"

const ROOT = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const EXTS = new Set(["xml", "xsd", "dtd", "svg", "xsl", "xslt", "rng"])
const CAP = 512 * 1024
const XSD_NS = "http://www.w3.org/2001/XMLSchema"

const screen = /attributeGroup\s+ref|<xs[d]?:group\s+[^>]*ref\s*=|<xs[d]?:attributeGroup\s+[^>]*ref\s*=/

type RefSite = { repo: string; rel: string; line: number; kind: "group" | "attributeGroup"; refLocal: string; refWritten: string; resolved: "in-file" | "cross-file" | "absent" }

async function main() {
  const repos: string[] = []
  for (const entry of readdirSync(ROOT)) {
    const p = path.join(ROOT, entry)
    let st
    try { st = statSync(p) } catch { continue }
    if (!st.isDirectory()) continue
    try { statSync(path.join(p, ".git")); repos.push(entry) } catch {}
  }

  // admitted sets per repo for cross-file resolution
  const admittedByRepo = new Map<string, Set<string>>()
  for (const repo of repos) {
    let files: string[]
    try {
      files = execSync(`git -C ${JSON.stringify(path.join(ROOT, repo))} ls-files`, { encoding: "utf8", maxBuffer: 1 << 28 })
        .split("\n").map((s) => s.trim()).filter(Boolean)
    } catch { continue }
    const set = new Set<string>()
    for (const rel of files) {
      const ext = rel.slice(rel.lastIndexOf(".") + 1)
      if (!EXTS.has(ext)) continue
      let st
      try { st = statSync(path.join(ROOT, repo, rel)) } catch { continue }
      if (!st.isFile() || st.size > CAP) continue
      set.add(rel)
    }
    admittedByRepo.set(repo, set)
  }

  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-xml.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)

  const sites: RefSite[] = []
  let admitted = 0
  let parsed = 0

  for (const repo of repos) {
    for (const rel of admittedByRepo.get(repo) ?? []) {
      admitted++
      const abs = path.join(ROOT, repo, rel)
      let text: string
      try { text = readFileSync(abs, "utf8") } catch { continue }
      if (!screen.test(text)) continue
      const tree = parser.parse(text)
      if (!tree) continue
      parsed++

      // Pass 1: collect the LOCAL NAMES this file DECLARES as group/attributeGroup definitions
      // (an `<xs:group name="G">` is a vocabulary declaration; the declared name is in the
      // `name=` attribute). Tree-read, never text-split.
      const declaredLocals = new Set<string>()
      const bindings = new Map<string, string>([["xml", "http://www.w3.org/XML/1998/namespace"]])
      const collectDecls = (node: any) => {
        if (node.type === "element") {
          const tag = node.children?.find((c: any) => c && (c.type === "STag" || c.type === "EmptyElemTag"))
          const nameNode = tag?.children?.find((c: any) => c?.type === "Name")
          const written = nameNode?.text?.trim() ?? ""
          const colon = written.indexOf(":")
          const prefix = colon >= 0 ? written.slice(0, colon) : ""
          const local = colon >= 0 ? written.slice(colon + 1) : written
          const added: [string, string | undefined][] = []
          if (tag) {
            for (let i = 0; i < tag.namedChildCount; i++) {
              const attr = tag.namedChild(i)
              if (attr?.type !== "Attribute") continue
              const an = attr.children?.find((c: any) => c?.type === "Name")?.text?.trim() ?? ""
              const av = attr.children?.find((c: any) => c?.type === "AttValue")?.text?.trim() ?? ""
              const value = av.length >= 2 && (av[0] === '"' || av[0] === "'") ? av.slice(1, -1) : av
              if (an === "xmlns") { added.push(["", bindings.get("")]); bindings.set("", value) }
              else if (an.startsWith("xmlns:")) { const p = an.slice(6); added.push([p, bindings.get(p)]); bindings.set(p, value) }
              if (an === "name" && (local === "group" || local === "attributeGroup") && bindings.get(prefix) === XSD_NS) {
                declaredLocals.add(value)
              }
            }
          }
          for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i)
            if (c && c.type !== "STag" && c.type !== "EmptyElemTag" && c.type !== "ETag") collectDecls(c)
          }
          for (const [k, prev] of added.reverse()) { if (prev === undefined) bindings.delete(k); else bindings.set(k, prev) }
          return
        }
        for (let i = 0; i < node.namedChildCount; i++) { const c = node.namedChild(i); if (c) collectDecls(c) }
      }
      collectDecls(tree.rootNode)

      // Pass 2: the ref= sites on group/attributeGroup elements
      const refSites: { line: number; kind: "group" | "attributeGroup"; refLocal: string; refWritten: string }[] = []
      const visit = (node: any) => {
        if (node.type === "element") {
          const tag = node.children?.find((c: any) => c && (c.type === "STag" || c.type === "EmptyElemTag"))
          const nameNode = tag?.children?.find((c: any) => c?.type === "Name")
          const written = nameNode?.text?.trim() ?? ""
          const colon = written.indexOf(":")
          const prefix = colon >= 0 ? written.slice(0, colon) : ""
          const local = colon >= 0 ? written.slice(colon + 1) : written
          const added: [string, string | undefined][] = []
          let refWritten: string | undefined
          let refLine = (tag ?? node).startPosition.row + 1
          if (tag) {
            for (let i = 0; i < tag.namedChildCount; i++) {
              const attr = tag.namedChild(i)
              if (attr?.type !== "Attribute") continue
              const an = attr.children?.find((c: any) => c?.type === "Name")?.text?.trim() ?? ""
              const av = attr.children?.find((c: any) => c?.type === "AttValue")?.text?.trim() ?? ""
              const value = av.length >= 2 && (av[0] === '"' || av[0] === "'") ? av.slice(1, -1) : av
              if (an === "xmlns") { added.push(["", bindings.get("")]); bindings.set("", value) }
              else if (an.startsWith("xmlns:")) { const p = an.slice(6); added.push([p, bindings.get(p)]); bindings.set(p, value) }
              if (an === "ref") { refWritten = value; refLine = attr.startPosition.row + 1 }
            }
          }
          if (refWritten !== undefined && (local === "group" || local === "attributeGroup") && bindings.get(prefix) === XSD_NS) {
            const c2 = refWritten.indexOf(":")
            const refLocal = c2 >= 0 ? refWritten.slice(c2 + 1) : refWritten
            refSites.push({ line: refLine, kind: local as "group" | "attributeGroup", refLocal, refWritten })
          }
          for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i)
            if (c && c.type !== "STag" && c.type !== "EmptyElemTag" && c.type !== "ETag") visit(c)
          }
          for (const [k, prev] of added.reverse()) { if (prev === undefined) bindings.delete(k); else bindings.set(k, prev) }
          return
        }
        for (let i = 0; i < node.namedChildCount; i++) { const c = node.namedChild(i); if (c) visit(c) }
      }
      visit(tree.rootNode)

      for (const s of refSites) {
        sites.push({ repo, rel, ...s, resolved: declaredLocals.has(s.refLocal) ? "in-file" : "cross-file" })
      }
      if (typeof (tree as any).delete === "function") (tree as any).delete()
    }
  }

  // The cross-file half: does the refLocal name occur as a group/attributeGroup DECLARATION
  // in another admitted file of the same repo? A cheap second pass over the repo's XSD files
  // using the SAME declaration reader, memoised per file.
  const declCache = new Map<string, Set<string>>()
  const readDecls = (abs: string): Set<string> => {
    const cached = declCache.get(abs)
    if (cached) return cached
    let out = new Set<string>()
    try {
      const text = readFileSync(abs, "utf8")
      const tree = parser.parse(text)
      if (tree) {
        const bindings = new Map<string, string>()
        const walk = (node: any) => {
          if (node.type === "element") {
            const tag = node.children?.find((c: any) => c && (c.type === "STag" || c.type === "EmptyElemTag"))
            const nameNode = tag?.children?.find((c: any) => c?.type === "Name")
            const written = nameNode?.text?.trim() ?? ""
            const colon = written.indexOf(":")
            const prefix = colon >= 0 ? written.slice(0, colon) : ""
            const local = colon >= 0 ? written.slice(colon + 1) : written
            const added: [string, string | undefined][] = []
            if (tag) {
              for (let i = 0; i < tag.namedChildCount; i++) {
                const attr = tag.namedChild(i)
                if (attr?.type !== "Attribute") continue
                const an = attr.children?.find((c: any) => c?.type === "Name")?.text?.trim() ?? ""
                const av = attr.children?.find((c: any) => c?.type === "AttValue")?.text?.trim() ?? ""
                const value = av.length >= 2 && (av[0] === '"' || av[0] === "'") ? av.slice(1, -1) : av
                if (an === "xmlns") { added.push(["", bindings.get("")]); bindings.set("", value) }
                else if (an.startsWith("xmlns:")) { const p = an.slice(6); added.push([p, bindings.get(p)]); bindings.set(p, value) }
                if (an === "name" && (local === "group" || local === "attributeGroup") && bindings.get(prefix) === XSD_NS) out.add(value)
              }
            }
            for (let i = 0; i < node.namedChildCount; i++) {
              const c = node.namedChild(i)
              if (c && c.type !== "STag" && c.type !== "EmptyElemTag" && c.type !== "ETag") walk(c)
            }
            for (const [k, prev] of added.reverse()) { if (prev === undefined) bindings.delete(k); else bindings.set(k, prev) }
            return
          }
          for (let i = 0; i < node.namedChildCount; i++) { const c = node.namedChild(i); if (c) walk(c) }
        }
        walk(tree.rootNode)
        if (typeof (tree as any).delete === "function") (tree as any).delete()
      }
    } catch { /* unreadable */ }
    declCache.set(abs, out)
    return out
  }

  for (const s of sites) {
    if (s.resolved === "in-file") continue
    const repoSet = admittedByRepo.get(s.repo)
    let found = false
    for (const other of repoSet ?? []) {
      if (other === s.rel) continue
      if (!other.endsWith(".xsd") && !other.endsWith(".xml")) continue
      const abs = path.join(ROOT, s.repo, other)
      let st
      try { st = statSync(abs) } catch { continue }
      if (!st.isFile() || st.size > CAP) continue
      if (readDecls(abs).has(s.refLocal)) { found = true; break }
    }
    s.resolved = found ? "cross-file" : "absent"
  }

  const byKind: Record<string, { sites: number; files: Set<string>; in_file: number; cross_file: number; absent: number }> = {}
  for (const s of sites) {
    const k = byKind[s.kind] ?? { sites: 0, files: new Set<string>(), in_file: 0, cross_file: 0, absent: 0 }
    k.sites++
    k.files.add(`${s.repo}/${s.rel}`)
    if (s.resolved === "in-file") k.in_file++
    else if (s.resolved === "cross-file") k.cross_file++
    else k.absent++
    byKind[s.kind] = k
  }

  const out = {
    instrument: "validation/m14/fixtures/xml/mixin-discriminator.mts",
    population: { root: ROOT, repos: repos.length, admitted, parsedCandidates: parsed },
    sites: {
      group_ref: byKind["group"] ? { sites: byKind["group"].sites, files: byKind["group"].files.size, in_file: byKind["group"].in_file, cross_file: byKind["group"].cross_file, absent: byKind["group"].absent } : { sites: 0, files: 0, in_file: 0, cross_file: 0, absent: 0 },
      attributeGroup_ref: byKind["attributeGroup"] ? { sites: byKind["attributeGroup"].sites, files: byKind["attributeGroup"].files.size, in_file: byKind["attributeGroup"].in_file, cross_file: byKind["attributeGroup"].cross_file, absent: byKind["attributeGroup"].absent } : { sites: 0, files: 0, in_file: 0, cross_file: 0, absent: 0 },
    },
    in_file_examples: sites.filter((s) => s.resolved === "in-file").slice(0, 8).map((s) => `${s.repo}/${s.rel}:${s.line} <xs:${s.kind} ref="${s.refWritten}">`),
    cross_file_examples: sites.filter((s) => s.resolved === "cross-file").slice(0, 5).map((s) => `${s.repo}/${s.rel}:${s.line} <xs:${s.kind} ref="${s.refWritten}">`),
    absent_examples: sites.filter((s) => s.resolved === "absent").slice(0, 5).map((s) => `${s.repo}/${s.rel}:${s.line} <xs:${s.kind} ref="${s.refWritten}">`),
  }
  console.log(JSON.stringify(out, null, 2))
  writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "mixin-discriminator.json"), JSON.stringify(out, null, 2) + "\n")
}

main().catch((e) => { console.error(e); process.exit(1) })
