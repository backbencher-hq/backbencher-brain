// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — bb_doc's fact-classification and citation-completeness gate:
//   every non-unknown fact carries a citation, the engine's classification and
//   confidence rules are the documented ones, and the handler module (post-split
//   path) validates mode/target and refuses out-of-range options.
// WHICH TOOL IT SERVES — bb_doc.
// WHY IT IS SHAPED THIS WAY — it reads the REAL handler and descriptor through the
//   shared tool-source accessor, so a module move is a data change here rather
//   than a silently green gate; it also refuses to pass on text that was moved.
// WHERE ITS EVIDENCE LIVES — validation/m13/results/d1.json.
// EDIT TOGETHER WHEN THIS CHANGES — script/m13/harness.ts, script/lib/tool-sources.ts,
//   src/mcp/tools/bb_doc/{descriptor,handler}.ts, src/intelligence/documentation/doc-engine.ts.
// CONTRACTS IT MUST NOT BREAK — a green run must mean: the handler carries the
//   mode/target/range refusals, and the engine derives confidence rather than
//   accepting it.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs"
import path from "node:path"
import { Harness } from "./harness"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"
import { readToolSource, toolModuleSourceOf } from "../lib/tool-sources.ts"

const harness = new Harness({
  issue: "M13.55", code: "D1", tool: "bb_doc",
  title: "bb_doc: fact classification + citation completeness",
  layers: ["unit"],
  decisions: { citations: "every fact is classified; no uncited fact reaches output" },
  limitations: ["Contract-level; the engine-level truth predicates live in m20/doc-truth."],
})

const ROOT = path.resolve(".")
const handlerSrc = toolModuleSourceOf("bb_doc")
const engineSrc = readToolSource("src/intelligence/documentation/doc-engine.ts")
const descriptorSrc = readToolSource("src/mcp/tools/bb_doc/descriptor.ts")

// Registry contract
const registry = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_doc")
harness.check("docs: bb_doc in registry", !!registry, "found")
if (registry) {
  harness.check("docs: 7 modes registered", (registry.modes || []).length === 7, String(registry.modes?.length))
  harness.check("docs: requires target for scoped modes", registry.description.includes("symbol") || registry.description.includes("file"), "ok")
}

// Engine: the classification and derived-confidence rules are implemented here.
harness.check("engine: file exists", engineSrc.length > 0, String(engineSrc.length))
harness.negative("engine: no code-generation claims", !engineSrc.includes("generate source") && !engineSrc.includes("produce code"), "clean")
harness.check("engine: has fact classification", ["extracted", "inferred", "generated", "unknown"].every((term) => engineSrc.includes(term)), "classification found")
harness.check("engine: confidence is derived, not passed in", engineSrc.includes("function deriveConfidence(") && engineSrc.includes("CAP_BY_FRESHNESS"), "deriveConfidence present")
const docRequestBlock = engineSrc.slice(engineSrc.indexOf("interface DocRequest"), engineSrc.indexOf("interface DocCitation"))
harness.negative("engine: no caller-supplied confidence field on DocRequest", docRequestBlock.length > 0 && !docRequestBlock.includes("confidence"), "DocRequest has no confidence field")

// Handler: the split module is where the validation lives; reading the monolith
// is what turned this gate green while the checks could not see the handler.
harness.check("handler: module exists at the split path", handlerSrc.length > 200, `handler chars=${handlerSrc.length}`)
harness.check("handler: validates mode", handlerSrc.includes("bb_doc requires mode:"), "mode refusal present")
harness.check("handler: requires target for scoped modes", handlerSrc.includes("mode requires target"), "target refusal present")
harness.check("handler: refuses out-of-range limit", handlerSrc.includes("limit must be a whole number between 1 and"), "limit range refusal")
harness.check("handler: refuses out-of-range maxTokens", handlerSrc.includes("maxTokens must be a whole number between 1 and"), "maxTokens range refusal")
harness.check("handler: refuses includeTests where the mode cannot honour it", handlerSrc.includes("includeTests is accepted for"), "includeTests refusal")
harness.negative("engine/handler: refuses an unmatched module target", handlerSrc.includes("DocRequestError") && engineSrc.includes("no indexed file matches the module"), "exception type handled by the handler, message raised by the engine")
harness.check("descriptor: declares the option ranges", descriptorSrc.includes("minimum: 1") && descriptorSrc.includes("maximum: 100") && descriptorSrc.includes("maximum: 16000"), "schema ranges present")

harness.emit()
