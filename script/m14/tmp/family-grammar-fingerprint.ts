/**
 * script/m14/tmp/family-grammar-fingerprint.ts
 *
 * What grammar is actually wired for each of the six functional-family lanes,
 * and what is it a build OF? Network is unavailable in this environment, so the
 * candidate set is what is on disk: the repo's `wasm/` copy (wired), the
 * `~/.bb/wasm` mirror, and every `tree-sitter-<lang>` package in the bun install
 * cache. For each candidate this probe records
 *
 *   - sha256 + byte length (byte identity), and
 *   - the grammar's enumerable surface through web-tree-sitter's Language API:
 *     node-type ids in order with their named flag, and field ids 1..fieldCount.
 *
 * The id-ordered list is the interesting one: node-type ids are assigned by
 * `tree-sitter generate` deterministically from the grammar source, so two
 * builds of the same source agree on it even when their bytes differ. That is
 * what lets "the wired wasm is a build of package X" be a MEASURED claim instead
 * of a story in a commit message.
 *
 * Reads: wasm/, ~/.bb/wasm, ~/.bun/install/cache. Writes nothing but the
 * artifact named below.
 */
import * as fs from "fs"
import * as path from "path"
import { createHash } from "crypto"
import { execSync } from "child_process"

const ROOT = path.resolve(import.meta.dir ?? path.dirname(Bun.main), "..", "..", "..")
const HOME = process.env.HOME ?? ""
const CACHE = path.join(HOME, ".bun/install/cache")
const MIRROR = path.join(HOME, ".bb/wasm")
const OUT = path.join(ROOT, "validation/m14/results/archive/family-grammar-fingerprints.json")

const candidates: Record<string, Array<{ label: string; file: string; provenance: string }>> = {
  haskell: [
    { label: "wired", file: path.join(ROOT, "wasm/tree-sitter-haskell.wasm"), provenance: "repo wasm/" },
    { label: "mirror", file: path.join(MIRROR, "tree-sitter-haskell.wasm"), provenance: "~/.bb/wasm" },
    { label: "npm-0.23.1", file: path.join(CACHE, "tree-sitter-haskell@0.23.1@@@1/tree-sitter-haskell.wasm"), provenance: "tree-sitter-haskell@0.23.1 (npm tarball)" },
  ],
  elixir: [
    { label: "wired", file: path.join(ROOT, "wasm/tree-sitter-elixir.wasm"), provenance: "repo wasm/" },
    { label: "mirror", file: path.join(MIRROR, "tree-sitter-elixir.wasm"), provenance: "~/.bb/wasm" },
    { label: "npm-0.3.5", file: path.join(CACHE, "tree-sitter-elixir@0.3.5@@@1/tree-sitter-elixir.wasm"), provenance: "tree-sitter-elixir@0.3.5 (npm tarball)" },
    { label: "ts-wasms-0.1.13", file: path.join(CACHE, "tree-sitter-wasms@0.1.13@@@1/out/tree-sitter-elixir.wasm"), provenance: "tree-sitter-wasms@0.1.13 prebuilt (upstream dep tree-sitter-elixir ^0.1.1)" },
  ],
  clojure: [
    { label: "wired", file: path.join(ROOT, "wasm/tree-sitter-clojure.wasm"), provenance: "repo wasm/ (claimed @yogthos/tree-sitter-clojure 0.0.14, commit 34972a88)" },
    { label: "mirror", file: path.join(MIRROR, "tree-sitter-clojure.wasm"), provenance: "~/.bb/wasm" },
  ],
  erlang: [
    { label: "wired", file: path.join(ROOT, "wasm/tree-sitter-erlang.wasm"), provenance: "repo wasm/" },
    { label: "mirror", file: path.join(MIRROR, "tree-sitter-erlang.wasm"), provenance: "~/.bb/wasm" },
    { label: "lumis-wasm-erlang-0.26.0", file: path.join(CACHE, "@lumis-sh/wasm-erlang@0.26.0@@@1/tree-sitter-erlang.wasm"), provenance: "@lumis-sh/wasm-erlang@0.26.0 (WhatsApp/tree-sitter-erlang v0.15.0 rev f21023bb, built CLI 0.26.7)" },
  ],
  clean: [
    { label: "wired", file: path.join(ROOT, "wasm/tree-sitter-clean.wasm"), provenance: "repo wasm/ (pinned v1.2.7, commit 2bc64693)" },
    { label: "mirror", file: path.join(MIRROR, "tree-sitter-clean.wasm"), provenance: "~/.bb/wasm" },
  ],
  fsharp: [
    { label: "wired", file: path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"), provenance: "repo wasm/ (v0.3.11 + 2 vendored patches, commit 5dc01113)" },
    { label: "mirror", file: path.join(MIRROR, "tree-sitter-fsharp.wasm"), provenance: "~/.bb/wasm (stale, pre-patch)" },
    { label: "npm-0.3.11", file: path.join(CACHE, "tree-sitter-fsharp@0.3.11@@@1/tree-sitter-fsharp.wasm"), provenance: "tree-sitter-fsharp@0.3.11 (npm tarball, unpatched)" },
    { label: "npm-0.1.0", file: path.join(CACHE, "tree-sitter-fsharp@0.1.0@@@1/tree-sitter-fsharp.wasm"), provenance: "tree-sitter-fsharp@0.1.0 (npm tarball, old)" },
  ],
}

const sha256 = (buf: Uint8Array) => createHash("sha256").update(buf).digest("hex")
const sha256Text = (s: string) => createHash("sha256").update(s).digest("hex")

type Surface = {
  nodeTypeCount: number
  fieldCount: number
  namedTypeCount: number
  /** sha256 over the id-ordered `id\u0000name\u0000named` list — generation-order fingerprint. */
  idOrderDigest: string
  /** sha256 over the sorted (name,named) pair set — language-surface fingerprint. */
  typeSetDigest: string
  /** sha256 over the sorted field names (ids 1..fieldCount). */
  fieldSetDigest: string
  /** every type, in id order, with its named flag — the complete surface record */
  allTypes: Array<{ id: number; name: string; named: boolean }>
  /** sorted named type names, for a human diff */
  namedTypes: string[]
  fields: string[]
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  const coreWasm = path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm")
  await ParserClass.init({ locateFile: () => coreWasm })

  const out: any = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    commit: execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(),
    webTreeSitter: (() => {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/web-tree-sitter/package.json"), "utf8"))
        return pkg.version
      } catch {
        return "unknown"
      }
    })(),
    oracle: "web-tree-sitter Language API: nodeTypeForId/nodeTypeIsNamed (ids 0..count-1), fieldNameForId (ids 1..fieldCount inclusive)",
    languages: {},
  }

  for (const [lang, list] of Object.entries(candidates)) {
    const entries: any[] = []
    for (const c of list) {
      const entry: any = { label: c.label, provenance: c.provenance, file: path.relative(ROOT, c.file) }
      if (!fs.existsSync(c.file)) {
        entry.absent = true
        entries.push(entry)
        continue
      }
      const buf = fs.readFileSync(c.file)
      entry.sha256 = sha256(buf)
      entry.bytes = buf.length
      try {
        const g = await Language.load(buf)
        const ids: string[] = []
        const pairs: string[] = []
        const named: string[] = []
        for (let i = 0; i < g.nodeTypeCount; i++) {
          const name = g.nodeTypeForId(i)
          const isNamed = !!g.nodeTypeIsNamed(i)
          ids.push(`${i}\u0000${name ?? ""}\u0000${isNamed ? 1 : 0}`)
          pairs.push(`${isNamed ? 1 : 0}\u0000${name ?? ""}`)
          if (isNamed && name != null) named.push(name)
        }
        const fields: string[] = []
        for (let i = 1; i <= g.fieldCount; i++) {
          const f = g.fieldNameForId(i)
          if (f) fields.push(f)
        }
        const allTypes: Array<{ id: number; name: string; named: boolean }> = []
        for (let i = 0; i < g.nodeTypeCount; i++) {
          const name = g.nodeTypeForId(i)
          if (name == null) continue
          allTypes.push({ id: i, name, named: !!g.nodeTypeIsNamed(i) })
        }
        const surface: Surface = {
          nodeTypeCount: g.nodeTypeCount,
          fieldCount: g.fieldCount,
          namedTypeCount: named.length,
          idOrderDigest: sha256Text(ids.join("\n")),
          typeSetDigest: sha256Text(pairs.sort().join("\n")),
          fieldSetDigest: sha256Text(fields.slice().sort().join("\n")),
          allTypes,
          namedTypes: named.slice().sort(),
          fields: fields.slice().sort(),
        }
        entry.surface = surface
        g.delete?.()
      } catch (e: any) {
        entry.loadError = String(e?.message ?? e)
      }
      entries.push(entry)
    }

    const wired = entries.find((e) => e.label === "wired")
    const adjudication: any = { comparisons: [] }
    for (const e of entries) {
      if (e.label === "wired") continue
      const cmp: any = { candidate: e.label, provenance: e.provenance }
      if (e.absent) cmp.verdict = "absent"
      else if (!e.surface || !wired?.surface) cmp.verdict = `not-loadable (${e.loadError ? "load error" : "wired load error"})`
      else if (e.sha256 === wired.sha256) cmp.verdict = "byte-identical to the wired wasm"
      else if (e.surface.idOrderDigest === wired.surface.idOrderDigest) cmp.verdict = "same generation (node-type ids identical in order), different bytes"
      else if (e.surface.typeSetDigest === wired.surface.typeSetDigest) cmp.verdict = "same named/anonymous type set, different generation"
      else {
        cmp.verdict = "different grammar surface"
        cmp.wiredNotInCandidate = wired.surface.namedTypes.filter((t: string) => !e.surface.namedTypes.includes(t)).slice(0, 60)
        cmp.candidateNotInWired = e.surface.namedTypes.filter((t: string) => !wired.surface.namedTypes.includes(t)).slice(0, 60)
        // complete diff over ALL types (anonymous tokens included): the named-only
        // diff above can be empty while the token sets differ, which is exactly
        // the case for elixir's 2024 prebuilt vs upstream 0.3.5.
        const key = (t: { name: string; named: boolean }) => `${t.named ? 1 : 0}\u0000${t.name}`
        const w = new Set(wired.surface.allTypes.map(key))
        const c = new Set(e.surface.allTypes.map(key))
        cmp.wiredTypesNotInCandidate = wired.surface.allTypes.filter((t: any) => !c.has(key(t))).map((t: any) => (t.named ? t.name : `anon:${t.name}`))
        cmp.candidateTypesNotInWired = e.surface.allTypes.filter((t: any) => !w.has(key(t))).map((t: any) => (t.named ? t.name : `anon:${t.name}`))
        cmp.wiredFieldsNotInCandidate = wired.surface.fields.filter((f: string) => !e.surface.fields.includes(f))
        cmp.candidateFieldsNotInWired = e.surface.fields.filter((f: string) => !wired.surface.fields.includes(f))
      }
      adjudication.comparisons.push(cmp)
    }
    out.languages[lang] = { candidates: entries, adjudication }
    const wiredSurface = wired?.surface
    console.log(
      `${lang.padEnd(8)} wired ${wired?.sha256?.slice(0, 16) ?? "ABSENT"} ${wiredSurface ? `${wiredSurface.nodeTypeCount} types / ${wiredSurface.namedTypeCount} named / ${wiredSurface.fieldCount} fields` : ""}`,
    )
    for (const c of adjudication.comparisons) console.log(`          ${c.candidate.padEnd(10)} ${c.verdict}`)
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
  console.log(`\nwrote ${path.relative(ROOT, OUT)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
