import { readFileSync, writeFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"

const checks: { name: string; passed: boolean; detail?: string }[] = []
const check = (name: string, passed: boolean, detail?: string) => checks.push({ name, passed, detail })

const ROOT = process.cwd()

async function read(file: string) {
  return parseFile(`${ROOT}/validation/m12/fixtures/markdown/${file}`, ROOT)
}

const docs = await read("Docs.md")
const changelog = await read("Changelog.md")
const neg = await read("Negative.md")

const syms = (p: any) => p.symbols ?? []
const rels = (p: any) => p.relationships ?? []
const hasSym = (p: any, name: string, kind: string) => syms(p).some((s: any) => s.name === name && s.kind === kind)
const hasRel = (p: any, type: string, source: string, target: string) => rels(p).some((r: any) => (r.type ?? "") === type && (r.source ?? "") === source && (r.target ?? "") === target)

// ---- symbols ----
check("ATX h1 is a type", hasSym(docs, "Main Title", "type"))
check("ATX h2 is a type", hasSym(docs, "Section One", "type"))
check("ATX h3 is a type", hasSym(docs, "Sub Section A", "type"))
check("setext heading is a type", hasSym(docs, "Setext Section", "type"))
check("front matter is a namespace", hasSym(docs, "front_matter", "namespace"))
check("pipe table is a class", hasSym(docs, "Feature/Status/Owner", "class"))
check("code fence is a function", hasSym(docs, "code_block.python", "function"))

// ---- heading ownership ----
const subA = syms(docs).find((s: any) => s.name === "Sub Section A")
check("h3 owner is its h2", subA?.ownerName === "Section One")
const sectionTwo = syms(docs).find((s: any) => s.name === "Section Two")
check("h2 owner is its h1", sectionTwo?.ownerName === "Main Title")
check("top-level h1 has no owner", syms(docs).find((s: any) => s.name === "Main Title")?.ownerName === undefined)

// ---- contains hierarchy ----
check("contains h1 -> h2", hasRel(docs, "contains", "Main Title", "Section One"))
check("contains h2 -> h3", hasRel(docs, "contains", "Section One", "Sub Section A"))
check("contains heading -> table", hasRel(docs, "contains", "Section Two", "Feature/Status/Owner"))
check("contains table -> column", hasRel(docs, "contains", "Feature/Status/Owner", "Owner"))
check("contains heading -> code fence", hasRel(docs, "contains", "Section Two", "code_block.python"))

// ---- inline grammar: links/images/autolinks ----
check("link destination uses edge", hasRel(docs, "uses", "Main Title", "https://example.com/docs"))
check("relative link uses edge", hasRel(docs, "uses", "Sub Section A", "../src/engine.ts"))
check("heading anchor uses edge", hasRel(docs, "uses", "Sub Section A", "#section-one"))
check("image source uses edge", hasRel(changelog, "uses", "0.9.0 - 2025-12-01", "./assets/logo.png"))
check("link inside list item uses edge", hasRel(docs, "uses", "Sub Section B", "https://example.com/items/1"))
check("link inside blockquote uses edge", hasRel(docs, "uses", "Section Two", "../docs/guide.md"))
check("uri autolink uses edge", hasRel(docs, "uses", "Setext Section", "https://example.com/auto"))
check("email autolink uses edge", hasRel(docs, "uses", "Setext Section", "dev@example.com"))

// ---- negative fixture: broken links are noise ----
check("unclosed link paren produces no edge", !rels(neg).some((r: any) => r.target === "https://example.com/never"))
check("empty destination produces no edge", !rels(neg).some((r: any) => r.target === "" || r.target === "()"))
check("empty image source produces no edge", !rels(neg).some((r: any) => r.target === ""))
check("code fence under heading still resolves", hasRel(neg, "contains", "Unclosed Code Fence", "code_block.js"))

// ---- noise traps ----
check("task markers are not symbols", !syms(docs).some((s: any) => s.name === "[ ]" || s.name === "[x]"))
check("list markers are not symbols", !syms(docs).some((s: any) => s.name === "-" || s.name === "1."))
check("plain paragraph is not a symbol", !syms(docs).some((s: any) => s.name === "Welcome to the"))

// ---- regex-free source ----
// Precise scan: a regex literal is a `/pattern/flags` token that appears as
// an expression (after `=`, `(`, `,`, space, or `return`), is not a comment,
// not a URL, and not the `->` arrow inside doc comments.
const source = readFileSync("src/ast/real-markdown-analyzer.ts", "utf8")
const regexLines = source.split("\n").map((line, i) => ({ line, i: i + 1 })).filter(({ line }) => {
  const trimmed = line.trim()
  if (trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed.startsWith("//")) return false
  if (trimmed.includes("://")) return false
  if (/->/.test(trimmed) && !trimmed.includes("replace") && !trimmed.includes("match") && !trimmed.includes("split") && !trimmed.includes("test")) return false
  return /[=(\s,;]\/(?![*/])(?:\\.|[^/\\\n])+\/[dgimsuy]*/.test(trimmed)
})
check("analyzer source has no regex literals", regexLines.length === 0, regexLines.map((r) => `line ${r.i}`).join(", "))

const result = { analyzer: "markdown", checks, passed: checks.every((c) => c.passed), total: checks.length, passedCount: checks.filter((c) => c.passed).length }
writeFileSync("validation/m12/results/markdown-contract.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
