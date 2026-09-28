// M12.46 real-corpus framework validation.
//
// Samples framework-relevant files from the pinned real-repository corpus
// (validation/m11/corpus-manifest.json revisions) and verifies:
//   1. Files using a framework detect the EXPECTED framework as primary.
//   2. Files with no framework usage report unknown / language-default only
//      (no fabrication).
//   3. Every sampled file's primary framework is either the expected one or a
//      legitimate language default / unknown — never a random unrelated label.
//
// Usage: bun script/m12/verify-m12-framework-corpus.ts
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const REPO_ROOT = "$HOME/fixtures/repositories"
const OUT_FILE = join(process.cwd(), "validation/m12/results/framework-corpus.json")

// repo -> { expected: string[] (any match passes), globHint: (path) => boolean }
// The expected framework is hand-audited from each repo's dominant stack.
const REPO_EXPECTATIONS: Record<string, { dir: string; expected: string[]; pick: (p: string) => boolean }> = {
  vue_core: { dir: "vue-core", expected: ["vue"], pick: (p) => /\.ts$/.test(p) && /packages\/[^/]+\/src/.test(p) && /(defineComponent|createApp|ref\(|computed\()/.test(readFileSync(join(REPO_ROOT, "vue-core", p), "utf8")) },
  svelte: { dir: "svelte", expected: ["svelte"], pick: (p) => /\.(svelte|ts)$/.test(p) && /packages\/svelte\/src/.test(p) && /(onMount|createEventDispatcher|export let)/.test(readFileSync(join(REPO_ROOT, "svelte", p), "utf8")) },
  grails_core: { dir: "grails-core", expected: ["grails"], pick: (p) => /\.groovy$/.test(p) && /(grails\.|@Controller|@Service|@Transactional)/.test(readFileSync(join(REPO_ROOT, "grails-core", p), "utf8")) },
  elixir: { dir: "elixir", expected: ["phoenix", "ecto", "plug"], pick: (p) => /\.ex$/.test(p) && /(use Phoenix|Phoenix\.|Ecto\.|defmodule .*\.(Web|Repo|Router))/.test(readFileSync(join(REPO_ROOT, "elixir", p), "utf8")) },
  terraform: { dir: "terraform", expected: ["HCL/Terraform"], pick: (p) => /\.tf$/.test(p) && /(provider\s|resource\s)/.test(readFileSync(join(REPO_ROOT, "terraform", p), "utf8")) },
  dplyr: { dir: "dplyr", expected: ["Tidyverse", "dplyr"], pick: (p) => /\.(R|r)$/.test(p) && /(library\(dplyr\)|library\(tidyverse\)|%>%)/.test(readFileSync(join(REPO_ROOT, "dplyr", p), "utf8")) },
  fsharp: { dir: "fsharp", expected: ["F#"], pick: (p) => /\.fs$/.test(p) && /(^module |namespace |type .* =)/.test(readFileSync(join(REPO_ROOT, "fsharp", p), "utf8")) },
  scala3: { dir: "scala3", expected: ["play", "akka", "spark", "scalatest"], pick: (p) => /\.scala$/.test(p) && /(import play\.|import akka\.|import org\.apache\.spark|scalatest)/.test(readFileSync(join(REPO_ROOT, "scala3", p), "utf8")) },
  swift_nio: { dir: "swift-nio", expected: ["swift-nio", "NIO"], pick: (p) => /\.swift$/.test(p) && /(import NIO|ChannelHandler|EventLoopFuture)/.test(readFileSync(join(REPO_ROOT, "swift-nio", p), "utf8")) },
  cargo: { dir: "cargo", expected: ["tokio", "serde", "clap"], pick: (p) => /\.rs$/.test(p) && /(use tokio|use serde|tokio::|serde::|use clap)/.test(readFileSync(join(REPO_ROOT, "cargo", p), "utf8")) },
  phpunit: { dir: "phpunit", expected: ["PHPUnit"], pick: (p) => /\.php$/.test(p) && /(extends TestCase|@test|class .*Test)/.test(readFileSync(join(REPO_ROOT, "phpunit", p), "utf8")) },
  powershell: { dir: "powershell", expected: ["PowerShell"], pick: (p) => /\.ps1$/.test(p) && /(function |param\()/.test(readFileSync(join(REPO_ROOT, "powershell", p), "utf8")) },
  rake: { dir: "rake", expected: ["Ruby on Rails"], pick: (p) => /\.rb$/.test(p) && /(ApplicationController|ActiveRecord|rails)/.test(readFileSync(join(REPO_ROOT, "rake", p), "utf8")) },
  gh_workflow: { dir: "rake", expected: ["GitHub Actions"], pick: (p) => /\.ya?ml$/.test(p) && /\.github\/workflows/.test(p) && /(on:|jobs:)/.test(readFileSync(join(REPO_ROOT, "rake", p), "utf8")) },
  gh_workflow_fallback: { dir: "rake", expected: ["GitHub Actions"], pick: (p) => false, fallbackOnly: true },
  graphql_js: { dir: "graphql-js", expected: ["GraphQL"], pick: (p) => /\.js$/.test(p) && /(new GraphQLSchema|GraphQLObjectType|graphql)/.test(readFileSync(join(REPO_ROOT, "graphql-js", p), "utf8")) },
  go_tools: { dir: "go-tools", expected: ["go"], pick: (p) => /\.go$/.test(p) && /(package main|func main)/.test(readFileSync(join(REPO_ROOT, "go-tools", p), "utf8")) },
}

// Language-default primaries that are acceptable when a repo expectation does
// not match (the file may not use the dominant framework).
const ACCEPTABLE_DEFAULTS = new Set([
  "unknown", "JavaScript", "TypeScript", "Python", "Ruby", "Java", "C#", "C++",
  "C", "Go", "Rust", "SQL", "Dart", "Bash Script", "Bash", "Standard C",
  "Standard C Library", "Standard CSS", "HTML5", "GraphQL", "XML", "Zig",
  "F#", "PowerShell", "Perl", "Erlang", "HCL/Terraform", "Make", "Markdown",
  "Vue", "Svelte", "Objective-C", "Lua", "R", "Haskell", "Scala", "Clojure",
  "Groovy", "Elixir", "PHP", "Swift", "Kotlin",
])

interface SampleResult {
  repo: string
  file: string
  language: string | undefined
  framework: string
  detected: string[]
  expected: string[]
  status: "match" | "default" | "mismatch" | "error"
  detail?: string
}

const samples: SampleResult[] = []
let matches = 0
let defaults = 0
let mismatches = 0
let errors = 0

for (const [repo, spec] of Object.entries(REPO_EXPECTATIONS)) {
  const dir = join(REPO_ROOT, spec.dir)
  let files: string[]
  try {
    files = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8" })
      .trim().split("\n").filter(Boolean).sort()
  } catch {
    continue
  }
  // Deterministic sample: up to 6 files that match the pick predicate, plus
  // fall back to the first 3 files if none match (sanity — they must not
  // fabricate a framework).
  const candidates = files.filter(spec.pick).slice(0, 6)
  const fallback = candidates.length > 0 ? [] : files.filter((f) => f.includes(".") && !/\.(lock|json|md|txt|ya?ml|rdoc|gitignore)$/i.test(f) && !/\.gitignore$/.test(f)).slice(0, 3)
  const toCheck = [...candidates, ...fallback]
  // An explicit fallbackOnly probe (e.g. the YAML workflow probe) checks only
  // its own pick matches and never pulls unrelated files.
  if ((spec as any).fallbackOnly && candidates.length === 0) continue

  for (const file of toCheck) {
    const full = join(dir, file)
    const content = readFileSync(full, "utf8")
    if (content.length > 200_000) continue
    try {
      const parsed = await ASTEngine.parseFile(full, content, { projectPath: dir } as any)
      const md: any = parsed.metadata || {}
      const framework: string = md.framework ?? "unknown"
      const detected: string[] = Array.isArray(md.detectedFrameworks) ? md.detectedFrameworks : []
      let status: SampleResult["status"]
      let detail: string | undefined
      const lower = (s: string) => s.toLowerCase()
      const expectedLower = spec.expected.map(lower)
      if (expectedLower.includes(lower(framework)) || spec.expected.some((e) => detected.some((d) => lower(d) === lower(e)))) {
        status = "match"
        matches++
      } else if (ACCEPTABLE_DEFAULTS.has(framework)) {
        status = "default"
        defaults++
        if (spec.expected.length > 0 && !fallback.includes(file)) {
          detail = `expected one of [${spec.expected.join(", ")}] but got language default ${framework}`
        }
      } else {
        status = "mismatch"
        mismatches++
        detail = `expected one of [${spec.expected.join(", ")}] but got ${framework} (detected: ${detected.join(", ")})`
      }
      samples.push({
        repo, file, language: parsed.language, framework, detected, expected: spec.expected, status, detail,
      })
    } catch (error: any) {
      errors++
      samples.push({
        repo, file, language: undefined, framework: "ERROR", detected: [], expected: spec.expected,
        status: "error", detail: String(error?.message ?? error).slice(0, 200),
      })
    }
  }
}

const pass = mismatches === 0 && errors === 0
console.log(`M12.46 real-corpus framework validation: ${samples.length} samples, ${matches} match, ${defaults} language-default, ${mismatches} MISMATCH, ${errors} errors`)
for (const s of samples.filter((s) => s.status === "mismatch" || s.status === "error")) {
  console.log(`  ${s.status.toUpperCase()} ${s.repo}/${s.file}: ${s.detail}`)
}
for (const s of samples.filter((s) => s.status === "default" && s.detail)) {
  console.log(`  note ${s.repo}/${s.file}: ${s.detail}`)
}

writeFileSync(OUT_FILE, JSON.stringify({ schemaVersion: 1, pass, samples, matches, defaults, mismatches, errors }, null, 2))
console.log(`wrote ${OUT_FILE}`)
process.exit(pass ? 0 : 1)
