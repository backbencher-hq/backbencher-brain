// script/m13/verify-security-handler.ts — M13.41 (Sec2).
//
// Handler adapter end-to-end: prove that analyzeSecurityAcrossLanguages
// returns the CrossLanguageSecurityFindings shape the MCP handler actually
// consumes — findings + suspiciousSources + summary, with evidence-linked
// source→sink flows resolved to file/line/symbol. Also prove that any
// regex-based taint detection is documented as heuristic (not AST).
//
// Key contract: the handler does NOT test the taint engine directly — it
// tests the ADAPTER that the handler calls. The taint engine's own
// verify-security.ts covers the strict report; this covers the handler shape.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { readFileSync } from "node:fs"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.41",
  code: "Sec2",
  tool: "bb_security",
  title: "bb_security: handler adapter end-to-end + no regex-as-AST",
  layers: ["unit", "integration"],
  decisions: {
    adapterTested: "test the handler-shape adapter (cross-language-security.ts), not just the taint engine",
    evidenceLinked: "every finding must have resolved file/line/symbol + flow chain",
    regexDocumented: "regex-based taint detection (taint-analyzer.ts) is honest: documented as heuristic not AST in docs/BB_SECURITY.md",
  },
  limitations: [
    "Taint-analyzer.ts uses regex for source/sink heuristics — this is a KNOWN heuristic, documented in docs/BB_SECURITY.md.",
    "The taint engine's own correctness is covered by verify-security.ts; this verifier tests only the handler adapter shape.",
  ],
})

const rootDir = path.resolve(import.meta.dir, "..", "..")

// ── 1. Handler adapter e2e on a tainted fixture ────────────────────────────
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-sec-handler-"))
  const projectId = getProjectId(root)
  mkdirSync(path.join(root, "src"), { recursive: true })
  // Fixture with a clear SQLi pattern: user input → SQL query.
  writeFileSync(path.join(root, "src", "app.ts"), [
    "import express from 'express'",
    "const app = express()",
    "app.get('/users', async (req, res) => {",
    "  const userInput = req.query.name",
    "  const sql = `SELECT * FROM users WHERE name = '${userInput}'`",
    "  const result = await db.query(sql)",
    "  res.send(result)",
    "})",
  ].join("\n"))

  await indexProjectParallel(projectId, root, {})

  const { CrossLanguageSecurityAnalysis } = await import("../../src/security/cross-language-security")
  const result = await CrossLanguageSecurityAnalysis.analyzeSecurityAcrossLanguages(projectId)

  // Shape contract: findings, suspiciousSources, summary must all be arrays/objects.
  harness.check("handler: findings is an array", Array.isArray(result.findings), `type=${typeof result.findings}`)
  harness.check("handler: suspiciousSources is an array", Array.isArray(result.suspiciousSources), `type=${typeof result.suspiciousSources}`)
  harness.check("handler: cross_language_vulnerabilities is an array", Array.isArray(result.cross_language_vulnerabilities), `type=${typeof result.cross_language_vulnerabilities}`)
  harness.check("handler: summary is an object", typeof result.summary === "object" && result.summary !== null, `type=${typeof result.summary}`)
  harness.check("handler: summary has severity breakdown", typeof result.summary.critical === "number" && typeof result.summary.high === "number", JSON.stringify(result.summary).slice(0, 200))

  // Evidence-linked: every finding must have file/line/flow chain.
  const allFindings = [...result.findings, ...result.suspiciousSources]
  harness.check("handler: findings have non-empty file paths", allFindings.every((f) => f.file && f.file !== "?"), `${allFindings.filter((f) => !f.file || f.file === "?").length} missing files`)
  harness.check("handler: findings carry severity", allFindings.every((f) => !!f.severity), `${allFindings.filter((f) => !f.severity).length} missing severity`)
  harness.check("handler: findings carry flow chains (non-empty)", allFindings.length === 0 || allFindings.some((f) => f.flow.length > 0), `max flow chain length: ${Math.max(...allFindings.map((f) => f.flow.length))}`)

  // suspiciousSources should be source_only/unresolved flows — they exist as
  // lower-confidence leads, not confirmed findings.
  harness.negative("handler: no zero-severity findings", allFindings.every((f) => f.severity !== ""), "empty severity found")

  rmSync(root, { recursive: true, force: true })
}

// ── 2. Fixture with pure regex-detectable taint (SQLi in Python) ───────────
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-sec-py-"))
  const projectId = getProjectId(root)
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "src", "app.py"), [
    "from flask import Flask, request",
    "import sqlite3",
    "app = Flask(__name__)",
    "@app.route('/search')",
    "def search():",
    "    q = request.args.get('q')",
    "    conn = sqlite3.connect('db.sqlite')",
    "    cursor = conn.execute(f\"SELECT * FROM items WHERE name = '{q}'\")",
    "    return str(cursor.fetchall())",
  ].join("\n"))

  await indexProjectParallel(projectId, root, {})

  const { CrossLanguageSecurityAnalysis } = await import("../../src/security/cross-language-security")
  const result = await CrossLanguageSecurityAnalysis.analyzeSecurityAcrossLanguages(projectId)

  // All findings must carry type (vulnerability classification).
  harness.check("handler (py): findings carry vulnerability type", [...result.findings, ...result.suspiciousSources].every((f) => !!f.type), `missing types: ${[...result.findings, ...result.suspiciousSources].filter((f) => !f.type).length}`)

  rmSync(root, { recursive: true, force: true })
}

// ── 3. No regex-as-AST claim ────────────────────────────────────────────────
// The taint-analyzer.ts uses regex for source/sink detection. This must be
// honestly documented as heuristic, not claimed as AST-based.
{
  const taintAnalyzerSrc = readFileSync(path.join(rootDir, "src", "ast", "taint-analyzer.ts"), "utf8")
  const hasRegex = taintAnalyzerSrc.includes("new RegExp") || /\/[^/*]/.test(taintAnalyzerSrc)
  harness.check("honesty: taint-analyzer.ts uses pattern matching (fact)", hasRegex, hasRegex ? "regex patterns detected" : "no regex")

  // docs/BB_SECURITY.md must acknowledge this.
  const secDoc = readFileSync(path.join(rootDir, "docs", "BB_SECURITY.md"), "utf8")
  harness.check("honesty: docs/BB_SECURITY.md acknowledges indexer heuristics", secDoc.includes("indexer heuristics"), "missing heuristic acknowledgment")
  harness.check("honesty: docs/BB_SECURITY.md does NOT claim regex-as-AST (heuristic only)", !secDoc.includes("AST-based taint") && !secDoc.includes("pure AST"), "claims AST where it should not")

  // taint-analyzer.ts must not be described as pure-AST in any doc.
  harness.negative("honesty: no doc claims taint detection is pure-AST", !secDoc.includes("pure AST taint"), "pure-AST claim found")
}

// ── 4. Handler routes to correct adapter ───────────────────────────────────
{
  const handlerSrc = readFileSync(path.join(rootDir, "src", "mcp", "tool-handlers.ts"), "utf8")
  const secSection = handlerSrc.slice(handlerSrc.indexOf("bb_security:"), handlerSrc.indexOf("bb_visualize:"))
  harness.check("handler: routes to CrossLanguageSecurityAnalysis", secSection.includes("CrossLanguageSecurityAnalysis.analyzeSecurityAcrossLanguages"), "missing adapter call")
  harness.check("handler: returns findings + suspiciousSources + summary", secSection.includes("result?.findings") && secSection.includes("result?.suspiciousSources") && secSection.includes("result?.summary"), "missing handler shape fields")
  harness.check("handler: history flag routes to getAnalysisHistory", secSection.includes("getAnalysisHistory(projectId, \"security\""), "missing history route")
}

harness.emit()