import { BrainDatabase } from "../../brain/database"
import type { ProjectID } from "../../project/schema"
import { semanticVectorSearch } from "./semantic-search"
import { searchSymbols } from "./symbol-search"
import { makeProvenance, type EvidenceProvenance } from "../evidence"

export interface QuickAnswerResult {
  answer: string
  confidence: number
  sources: Array<{ file: string; line: number; context: string }>
  suggestions?: string[]
  provenance: EvidenceProvenance
}

const ENGINE = "quick-answer@intelligence"
const ENGINE_VERSION = "m10.03"

function statProvenance(projectId: ProjectID, fact: string): EvidenceProvenance {
  return makeProvenance({
    evidenceClass: "indexed",
    engine: ENGINE,
    engineVersion: ENGINE_VERSION,
    projectId,
    source: fact,
    limitations: ["Count is a direct aggregate over indexed rows; it does not interpret semantics."],
  })
}

function semanticProvenance(projectId: ProjectID, inner: EvidenceProvenance): EvidenceProvenance {
  return makeProvenance({
    evidenceClass: "semantic_candidate",
    engine: ENGINE,
    engineVersion: ENGINE_VERSION,
    projectId,
    source: "semantic-search@intelligence",
    limitations: inner.limitations,
    unknowns: inner.unknowns.length ? inner.unknowns : ["The natural-language query is matched by similarity, not parsed for intent."],
  })
}

function fallbackProvenance(projectId: ProjectID, reason: string): EvidenceProvenance {
  return makeProvenance({
    evidenceClass: "unknown",
    engine: ENGINE,
    engineVersion: ENGINE_VERSION,
    projectId,
    source: "symbol-search@intelligence",
    limitations: ["No semantic or statistical answer derived; only named-symbol matches returned."],
    unknowns: [reason],
  })
}

function emptyProvenance(projectId: ProjectID): EvidenceProvenance {
  return makeProvenance({
    evidenceClass: "unknown",
    engine: ENGINE,
    engineVersion: ENGINE_VERSION,
    projectId,
    source: "no-result",
    limitations: ["No indexed evidence matched the query."],
    unknowns: ["Query may refer to behavior not captured by the AST index."],
  })
}

async function indexHasFiles(projectId: ProjectID): Promise<boolean> {
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const row = raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id = ?").get(projectId) as { c: number } | undefined
    return (row?.c ?? 0) > 0
  } catch {
    return false
  }
}

export async function quickAnswer(projectId: ProjectID, query: string): Promise<QuickAnswerResult> {
  // Honesty guard: a missing index must never produce a confident stat answer
  // ("There are 0 symbols") — the project may have thousands of symbols that
  // were simply never indexed. Without an index there is no evidence, so the
  // answer is an explicit unknown, not a fabricated count.
  if (!(await indexHasFiles(projectId))) {
    return {
      answer: "I can't answer this: no index exists for this project. Index it first (bb_health refresh or full reindex), then ask again.",
      confidence: 0.1,
      sources: [],
      provenance: makeProvenance({
        evidenceClass: "unknown",
        engine: ENGINE,
        engineVersion: ENGINE_VERSION,
        projectId,
        source: "no-index",
        limitations: ["No index means no evidence exists to answer from."],
        unknowns: ["No index exists for this project; run indexing first."],
      }),
    }
  }
  const lowerQuery = query.toLowerCase()

  if (lowerQuery.includes("how many") && (lowerQuery.includes("symbol") || lowerQuery.includes("total"))) {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const row = raw.prepare("SELECT count(*) AS c FROM brain_symbol WHERE project_id = ?").get(projectId) as { c: number }
    return { answer: `There are ${(row?.c ?? 0).toLocaleString()} symbols in this project`, confidence: 0.95, sources: [], provenance: statProvenance(projectId, "count(brain_symbol)") }
  }

  if (lowerQuery.includes("how many") && (lowerQuery.includes("relationship") || lowerQuery.includes("relation"))) {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const row = raw.prepare("SELECT count(*) AS c FROM brain_relationship WHERE project_id = ?").get(projectId) as { c: number }
    return { answer: `There are ${(row?.c ?? 0).toLocaleString()} relationships in this project`, confidence: 0.95, sources: [], provenance: statProvenance(projectId, "count(brain_relationship)") }
  }

  if (lowerQuery.includes("how many") && (lowerQuery.includes("import") || lowerQuery.includes("dependency"))) {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const row = raw.prepare("SELECT count(*) AS c FROM brain_import WHERE project_id = ?").get(projectId) as { c: number }
    return { answer: `There are ${(row?.c ?? 0).toLocaleString()} imports in this project`, confidence: 0.95, sources: [], provenance: statProvenance(projectId, "count(brain_import)") }
  }

  if (lowerQuery.includes("largest") || (lowerQuery.includes("biggest") && lowerQuery.includes("file"))) {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const row = raw.prepare("SELECT relative_path AS path, size_bytes AS size FROM brain_file WHERE project_id = ? ORDER BY size_bytes DESC LIMIT 1").get(projectId) as { path: string; size: number } | undefined
    if (row?.size) {
      return {
        answer: `The largest file is "${row.path}" at ${(row.size / 1024).toFixed(1)} KB`,
        confidence: 0.9,
        sources: [{ file: row.path, line: 0, context: `${(row.size / 1024).toFixed(1)} KB` }],
        provenance: statProvenance(projectId, "max(brain_file.size_bytes)"),
      }
    }
  }

  if (lowerQuery.includes("how many") && lowerQuery.includes("function")) {
    const raw = await BrainDatabase.getRawInstance(projectId)
    // Functions are stored as 'function' (JS/TS/Go…) or 'method' (Ruby,
    // Python, Java, C#, Kotlin, …). Counting only 'function' reports 0 for
    // method-first languages — a cross-language correctness bug caught by
    // running bb_ask against a real Ruby repo. Count both buckets.
    const row = raw.prepare("SELECT count(*) AS c FROM brain_symbol WHERE project_id = ? AND symbol_type IN ('function','method')").get(projectId) as { c: number }
    return { answer: `There are ${row?.c ?? 0} functions in this project`, confidence: 0.95, sources: [], provenance: statProvenance(projectId, "count(brain_symbol where function|method)") }
  }

  if (lowerQuery.includes("how many") && lowerQuery.includes("class")) {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const row = raw.prepare("SELECT count(*) AS c FROM brain_symbol WHERE project_id = ? AND symbol_type = 'class'").get(projectId) as { c: number }
    return { answer: `There are ${row?.c ?? 0} classes in this project`, confidence: 0.95, sources: [], provenance: statProvenance(projectId, "count(brain_symbol where class)") }
  }

  if (lowerQuery.includes("most complex")) {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const row = raw.prepare(
      "SELECT s.name AS name, s.complexity AS complexity, s.line_start AS line, f.relative_path AS file " +
        "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
        "WHERE s.project_id = ? AND s.symbol_type IN ('function','method') " +
        "ORDER BY s.gravity_score DESC, s.complexity DESC LIMIT 1",
    ).get(projectId) as { name: string; complexity: number; line: number; file: string } | undefined
    if (row) {
      return {
        answer: `The most complex function is "${row.name}" with complexity ${row.complexity}`,
        confidence: 0.9,
        sources: [{ file: row.file, line: row.line || 0, context: `Function: ${row.name}` }],
        provenance: statProvenance(projectId, "max(brain_symbol.complexity)"),
      }
    }
  }

  if (lowerQuery.includes("how many") && (lowerQuery.includes("file") || lowerQuery.includes("java") || lowerQuery.includes("python") || lowerQuery.includes("go") || lowerQuery.includes("typescript") || lowerQuery.includes("javascript") || lowerQuery.includes("kotlin") || lowerQuery.includes("rust"))) {
    const langMap: Record<string, string> = { "c++": "cpp", "c#": "csharp" }
    const knownLangs = new Set(["java", "python", "go", "typescript", "javascript", "kotlin", "rust", "cpp", "c++", "csharp", "c#", "dart", "swift", "ruby", "php", "scala", "elixir", "clojure", "haskell", "lua", "r", "perl", "objective-c", "groovy", "xml", "json", "yaml", "html", "css", "sql"])
    let lang = ""
    for (const w of lowerQuery.split(/\s+/)) {
      const l = langMap[w] || w
      if (l.length >= 2 && knownLangs.has(l)) { lang = l; break }
    }
    const raw = await BrainDatabase.getRawInstance(projectId)
    if (lang) {
      const row = raw.prepare("SELECT count(*) AS c FROM brain_file WHERE project_id = ? AND language = ?").get(projectId, lang) as { c: number }
      return { answer: `There are ${row?.c ?? 0} ${lang} files in this project`, confidence: 0.95, sources: [], provenance: statProvenance(projectId, `count(brain_file where language=${lang})`) }
    }
    const row = raw.prepare("SELECT count(*) AS c FROM brain_file WHERE project_id = ?").get(projectId) as { c: number }
    return { answer: `There are ${row?.c ?? 0} files in this project`, confidence: 0.95, sources: [], provenance: statProvenance(projectId, "count(brain_file)") }
  }

  const semantic = await semanticVectorSearch(projectId, query, { maxResults: 5 })
  if (semantic.results.length > 0) {
    // Honesty: when the semantic route could not produce a vector-ranked
    // answer (keyword fallback — no embeddings, low coverage, or an embedding
    // error), the response must say so explicitly instead of presenting
    // lexical matches as semantic ones. This is the "does not know" surface
    // the milestone requires: low-coverage answers show an explicit unknown.
    const isFallback = semantic.metadata.method === "keyword-fallback"
    const fallbackNote =
      "Note: semantic embeddings are unavailable or insufficient for this query " +
      "(coverage too low), so the matches below are lexical, not semantic — I cannot " +
      "confidently answer this from embeddings.\n\n"
    let combinedAnswer = `Closest matches from the AST index for your query (search results, not a verified answer):\n\n`
    if (isFallback) combinedAnswer = fallbackNote + combinedAnswer
    const sources: Array<{ file: string; line: number; context: string }> = []
    for (const res of semantic.results.slice(0, 5)) {
      const staleMark = res.stale ? " [STALE — file changed since index]" : ""
      combinedAnswer += `--- File: ${res.file} (Line ${res.line})${staleMark} ---\n`
      combinedAnswer += `[${res.symbolType}] ${res.symbolName} — similarity ${res.similarity.toFixed(3)}\n`
      const truncated = (res.snippet || "").split("\n").slice(0, 30).join("\n")
      if (truncated) combinedAnswer += `\`\`\`\n${truncated}\n\`\`\`\n\n`
      sources.push({ file: res.file, line: res.line, context: res.symbolName + (res.stale ? " (STALE)" : "") })
    }
    combinedAnswer += `\n— Use bb_search for precise symbol lookup: "bb_search(query='${query}')".\n`
    combinedAnswer += `— Use bb_search with mode="file" to read any indexed file.`
    const sims = semantic.results.slice(0, 5).map((r) => Number(r.similarity) || 0)
    const avgSim = sims.reduce((a, b) => a + b, 0) / sims.length
    return {
      answer: combinedAnswer,
      confidence: Math.round(Math.max(0.2, Math.min(0.85, avgSim)) * 100) / 100,
      sources,
      provenance: semanticProvenance(projectId, semantic.provenance),
    }
  }

  try {
    const symbolResults = await searchSymbols(projectId, query, { maxResults: 5, includeContent: true })
    if (symbolResults.length > 0) {
      let fallbackAnswer = `I found these symbols matching "${query}" (use bb_search with mode="symbol" to read their code):\n\n`
      for (const r of symbolResults.slice(0, 5)) {
        const staleMark = (r as any).stale ? " [STALE — file changed since index]" : ""
        fallbackAnswer += `- ${r.symbolName || r.context} [${r.symbolType || "symbol"}] in ${r.file}:${r.line}${staleMark}\n`
      }
      const q = query.toLowerCase()
      const scored = symbolResults.slice(0, 5).map((r) => {
        const name = (r.symbolName || "").toLowerCase()
        if (name === q) return 1
        if (name.startsWith(q) || q.startsWith(name)) return 0.7
        if (name.includes(q)) return 0.5
        return 0.3
      })
      const quality = scored.reduce((a, b) => a + b, 0) / scored.length
      return {
        answer: fallbackAnswer,
        confidence: Math.round(Math.max(0.2, Math.min(0.8, quality)) * 100) / 100,
        sources: symbolResults.map((r) => ({ file: r.file, line: r.line, context: r.symbolName || r.context })),
        provenance: fallbackProvenance(projectId, "semantic search returned no results; symbol-name match used as fallback"),
      }
    }
  } catch {}

  return {
    answer: "I couldn't find a specific answer or matching code to your query in the brain database.",
    confidence: 0.1,
    sources: [],
    suggestions: [
      "How many functions are in this project?",
      "What is the most complex function?",
      "How many classes are there?",
      "How many files are in this project?",
      "Use bb_search for precise symbol lookup",
    ],
    provenance: emptyProvenance(projectId),
  }
}
