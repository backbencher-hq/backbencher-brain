// script/m56/generate-support-data.ts — M56.S1.
//
// Generates website/src/data/support.generated.ts from website/faq.md, the
// SINGLE FAQ source (M56.S1 decision: one file, two consumers — the /support
// page and its FAQPage structured data). The markdown is parsed structurally:
//   `## Section`    → a named section
//   `### Question`  → a question
//   body            → the answer's markdown (normalized to plain text, see
//                     mdToText below)
// plus the SUPPORT_CHANNELS block: the real inboxes the site may publish.
//
// Deterministic output (no timestamps) so `--check` mode can diff byte-wise,
// mirroring generate-site-truth.ts / generate-docs-data.ts.
//
// Run: npx tsx script/m56/generate-support-data.ts [--check]

import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const SOURCE = path.join(ROOT, "website/faq.md")
const OUT = path.join(ROOT, "website/src/data/support.generated.ts")
const CHECK = process.argv.includes("--check")

// --- markdown → structured FAQ -------------------------------------------------

interface QA {
  q: string
  section: string
  a: string // normalized plain text (markdown formatting stripped, links kept as "label (href)")
}
interface Section {
  name: string
  questions: string[] // question slugs, in order
}
interface Parsed {
  sections: Section[]
  qas: QA[]
}

function mdToText(md: string): string {
  const lines: string[] = []
  for (const raw of md.split("\n")) {
    let line = raw
    // fenced code blocks: keep the command, drop the fences
    if (/^```/.test(line.trim())) continue
    // images/links: [label](href) → label (href); bare <mailto> untouched
    line = line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, href: string) =>
      href.startsWith("/") || href.startsWith("http") ? `${label} (${href})` : `${label}`,
    )
    // emphasis markers
    line = line.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/`([^`]+)`/g, "$1")
    // table rows: keep cell text, joined by " — " is over-structured for text;
    // a table becomes "cell | cell" lines (the S1 file has none, but future-proof)
    if (/^\|/.test(line.trim())) {
      line = line.trim().replace(/^\|/, "").replace(/\|$/, "").replace(/\|/g, " | ")
      if (/^[\s|:-]+$/.test(line)) continue
    }
    lines.push(line.trim())
  }
  return lines.join(" ").replace(/\s+/g, " ").trim()
}

function parseFaq(md: string): Parsed {
  const sections: Section[] = []
  const qas: QA[] = []
  let section: string | null = null
  let q: string | null = null
  let body: string[] = []

  const flush = () => {
    if (section && q && body.length) {
      qas.push({ q, section, a: mdToText(body.join("\n")) })
    }
    body = []
    q = null
  }

  for (const raw of md.split("\n")) {
    const h2 = raw.match(/^## (.+)$/)
    const h3 = raw.match(/^### (.+)$/)
    if (h2) {
      flush()
      section = h2[1]!.trim()
      sections.push({ name: section, questions: [] })
      continue
    }
    if (h3) {
      flush()
      q = h3[1]!.trim()
      if (section) sections[sections.length - 1]!.questions.push(q)
      continue
    }
    if (q !== null) body.push(raw)
  }
  flush()
  return { sections, qas }
}

// --- support channels -----------------------------------------------------------
// The real inboxes (M41 T3 verified them; they are owned constants, not
// generated ones — the gate compares this block against what the page renders).

const SUPPORT_CHANNELS = [
  {
    title: "Support",
    body: "Questions about install, setup, or usage. Include the output of bb health and bb stats for the fastest answer.",
    email: "support@backbencher.cc",
  },
  {
    title: "Bug reports",
    body: "Something broke or a result looks wrong? Email us with the command you ran, what you expected, and what happened.",
    email: "support@backbencher.cc",
  },
  {
    title: "Feedback",
    body: "Feature requests, workflow ideas, and honest criticism are all welcome — they shape the roadmap.",
    email: "support@backbencher.cc",
  },
  {
    title: "General & press",
    body: "Partnerships, licensing, the website, or anything that is not a support question.",
    email: "info@backbencher.cc",
  },
]

// --- truth cross-check ------------------------------------------------------------
// The S1 answers state table/tool/language counts. Those numbers come from the
// engine registry; the generator re-reads truth.generated.ts (itself generated
// from the engine by generate-site-truth.ts) and requires the markdown to
// agree — a count in faq.md that drifts from the engine fails HERE, at
// generation time, before any page can publish it.

function truthNumbers(): { tables: number; tools: number; langs: number; parsers: number } {
  const t = readFileSync(path.join(ROOT, "website/src/data/truth.generated.ts"), "utf8")
  const tables = Number(t.match(/tables: (\d+)/)?.[1])
  const langs = Number(t.match(/classified: (\d+)/)?.[1])
  const parsers = Number(t.match(/dedicatedParsers: (\d+)/)?.[1])
  const tools = (t.match(/"bb_[a-z_]+"/g) ?? []).length
  if (!tables || !langs || !parsers || !tools) {
    throw new Error("could not read truth numbers from truth.generated.ts")
  }
  return { tables, tools, langs, parsers }
}

const parsed = parseFaq(readFileSync(SOURCE, "utf8"))
const truth = truthNumbers()

const countChecks: { claim: string; ok: boolean }[] = [
  {
    claim: `${truth.tables} tables`,
    ok: parsed.qas.some((x) => x.a.includes(`${truth.tables} tables`)),
  },
  {
    claim: `${truth.tools} agent tools`,
    ok: parsed.qas.some((x) => x.a.includes(`${truth.tools} agent tools`)),
  },
  {
    claim: `${truth.tools} MCP tools`,
    ok: parsed.qas.some((x) => x.a.includes(`${truth.tools} MCP tools`)),
  },
  {
    claim: `${truth.langs} languages`,
    ok: parsed.qas.some((x) => x.a.includes(`${truth.langs} languages`)),
  },
  {
    claim: `${truth.parsers} with dedicated tree-sitter parsers`,
    ok: parsed.qas.some((x) => x.a.includes(`${truth.parsers} with dedicated`)),
  },
  {
    claim: `${truth.tools} bb tools`,
    ok: parsed.qas.some((x) => x.a.includes(`${truth.tools} bb tools`)),
  },
]

const failed = countChecks.filter((c) => !c.ok)
if (failed.length) {
  console.error(`generate-support-data: faq.md states numbers that disagree with the engine truth:`)
  for (const f of failed) console.error(`  missing/contradicted claim: ${f.claim}`)
  console.error(`regenerate faq.md numbers from website/src/data/truth.generated.ts (tables=${truth.tables}, tools=${truth.tools}, languages=${truth.langs}/${truth.parsers})`)
  process.exit(1)
}

// --- emit --------------------------------------------------------------------------

function q(s: string): string {
  return JSON.stringify(s)
}

const out = `// GENERATED FILE — do not edit by hand.
// npx tsx script/m56/generate-support-data.ts --write
//
// Single FAQ source (M56.S1): parsed from website/faq.md. Two consumers:
//   - website/src/app/support/page.tsx renders these QAs (grouped by section)
//   - website/src/components/SupportJsonLd.tsx derives FAQPage JSON-LD from the
//     SAME array — a search engine is never told anything the page does not show.
// Answers are normalized plain text (markdown stripped, links kept as "label (href)").
// The truth cross-check ran at generation time: every count faq.md states agrees
// with the engine registry (tables=${truth.tables}, tools=${truth.tools}, languages=${truth.langs}/${truth.parsers}).

export interface SupportQA {
  q: string
  section: string
  a: string
}

export const FAQ_SECTIONS = ${JSON.stringify(parsed.sections, null, 2)}

export const SUPPORT_QA: SupportQA[] = [
${parsed.qas.map((x) => `  {\n    q: ${q(x.q)},\n    section: ${q(x.section)},\n    a: ${q(x.a)},\n  },`).join("\n")}
]

export const SUPPORT_CHANNELS = ${JSON.stringify(SUPPORT_CHANNELS, null, 2)}

export const SUPPORT_SOURCE = ${q("website/faq.md")}
`

if (CHECK) {
  const current = readFileSync(OUT, "utf8")
  if (current !== out) {
    console.error("generate-support-data: --check FAILED — support.generated.ts is stale. Re-run with --write.")
    process.exit(1)
  }
  console.log("support.generated.ts is up to date with website/faq.md")
} else {
  writeFileSync(OUT, out)
  const h = execFileSync("git", ["hash-object", OUT], { encoding: "utf8" }).trim()
  console.log(`wrote support.generated.ts (${parsed.qas.length} QAs in ${parsed.sections.length} sections) blob ${h.slice(0, 10)}`)
}
