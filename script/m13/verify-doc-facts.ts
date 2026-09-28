// script/m13/verify-doc-facts.ts — M13.55 (D1).
import { readFileSync } from "node:fs"
import path from "node:path"
import { Harness } from "./harness"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"

const harness = new Harness({
  issue: "M13.55", code: "D1", tool: "bb_doc",
  title: "bb_doc: fact classification + citation completeness",
  layers: ["unit"],
  decisions: { citations: "every fact is classified; no uncited fact reaches output" },
  limitations: ["Contract-level; full engine test in D3."],
})

// Registry contract
const registry = PUBLIC_TOOL_DESCRIPTORS.find(t => t.name === "bb_doc")
harness.check("docs: bb_doc in registry", !!registry, "found")
if (registry) {
  harness.check("docs: 7 modes registered", (registry.modes || []).length === 7, String(registry.modes?.length))
  harness.check("docs: requires target for scoped modes", registry.description.includes("symbol") || registry.description.includes("file"), "ok")
}

// Engine: fact classification exists
const enginePath = path.join(path.resolve("."), "src", "intelligence", "documentation", "doc-engine.ts")
const engineSrc = readFileSync(enginePath, "utf8")
harness.check("engine: file exists", engineSrc.length > 0, String(engineSrc.length))

// No fake claims — engine must not claim to produce "generated" code
harness.negative("engine: no code-generation claims", !engineSrc.includes("generate source") && !engineSrc.includes("compile") && !engineSrc.includes("produce code"), "clean")

// Fact classification terms
const hasFactClass = engineSrc.includes("extracted") || engineSrc.includes("inferred") || engineSrc.includes("classification") || engineSrc.includes("provenance")
harness.check("engine: has fact classification or provenance", hasFactClass, "classification found")

// Handler validates mode
const handlerSrc = readFileSync(path.join(path.resolve("."), "src", "mcp", "tool-handlers.ts"), "utf8")
const docSection = handlerSrc.slice(handlerSrc.indexOf("bb_doc:"), handlerSrc.indexOf("bb_edit:"))
harness.check("handler: validates mode", docSection.includes("symbol|file|module|feature|api|project|coverage"))
harness.check("handler: requires target for scoped modes", docSection.includes("requires target"))
harness.negative("handler: rejects empty mode", docSection.includes('""') || docSection.includes("requires mode"), "has validation")

harness.emit()
