#!/usr/bin/env node
/**
 * language-matrix.cjs — THE DERIVED LANGUAGE MATRIX.
 *
 * Author: Muhammad Ishaq Khan.
 *
 * WHAT THIS IS. A 48-row x 10-type table where every cell is derived from INSTRUMENT OUTPUT, never asserted:
 *   coverage     script/m14/spec/<lane>-completeness.json via coverage-block-gate.ts  (implemented / excluded / silent)
 *   emission     validation/m14/results/firing-laptop-b.current.log                   (per-type counts, whole population)
 *   resolution   script/m14/incoming-gate.ts <lane> <ext> <cap>                       (per-type edges/resolved/collRes/unresolved)
 *
 * THE FOUR CELL STATES, AND WHY A TICK CANNOT BE TYPED BY HAND:
 *   Y  implemented AND emitting AND every edge of that type resolves           -> the cell is DONE
 *   ~  implemented AND emitting, but unresolved edges remain                   -> residual, with the count
 *   X  declared implemented AND emits NOTHING                                  -> a real silence
 *   -  not applicable (excluded, with its class)                               -> leaves the denominator
 *   !  in NO list at all                                                       -> the silent-sink defect
 *
 * A CELL IS TICKED BY MAKING THE INSTRUMENTS PASS. There is no editing path into this file's output.
 *
 * RUN: node script/m14/language-matrix.cjs [cap]        (cap default 200; pass 0 for the whole population)
 */
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

const ROOT = path.resolve(__dirname, "..", "..")
const CAP = process.argv[2] ?? "200"
const TYPES = ["calls","uses","contains","imports","references","exports","extends","implements","overrides","instantiates"]

// ---- 1. coverage gate -> implemented / exempt / silent, per lane
const gate = execFileSync("bun", ["run", "script/m14/coverage-block-gate.ts"], { cwd: ROOT, encoding: "utf8" })
const cov = {}
for (const line of gate.split("\n")) {
  const m = line.match(/^([a-z][a-z_0-9]*)\s+yes\s+(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)
  if (!m) continue
  const rest = m[5].trim()
  const silentPart = rest.split(/\s{2,}/)[0].trim()
  cov[m[1]] = { impl: +m[2], appl: +m[3], exempt: +m[4], silent: silentPart === "-" ? [] : silentPart.split(/\s+/).filter(t => TYPES.includes(t.replace(/[~?]$/,""))) }
}

// ---- 2. spec -> which types are excluded, and with what class
const spec = {}
for (const f of fs.readdirSync(path.join(ROOT, "script/m14/spec")).filter(f => f.endsWith("-completeness.json"))) {
  const lane = f.replace("-completeness.json", "")
  try {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, "script/m14/spec", f), "utf8"))
    const c = d.coverage ?? {}
    spec[lane] = {
      implemented: c.implemented ?? [],
      excluded: Object.fromEntries((c.excluded ?? []).map(e => [e.label ?? e, e.evidence ?? e.class ?? "?"])),
      unex: Object.fromEntries((c.corpusUnexercised ?? []).map(e => [typeof e === "string" ? e : e.label, (typeof e === "object" && (e.evidence ?? e.class)) || "corpus-unexercised"]))
    }
  } catch {}
}

// ---- 3. firing log -> per-type emission, per lane, with the evidence basis
const log = fs.readFileSync(path.join(ROOT, "validation/m14/results/firing-laptop-b.current.log"), "utf8")
const fire = {}
for (const m of log.matchAll(/^([A-Z][A-Z0-9_-]*)[ \t]+\d+ types fired(.*?)(?=^[A-Z][A-Z0-9_-]*[ \t]+\d+ types fired|\Z)/gms)) {
  let k = m[1].toLowerCase(); if (k.endsWith("_b")) k = k.slice(0, -2)
  k = { r_lang: "r", visual_basic: "vb", objective_c: "objc" }[k] ?? k
  const body = m[2]
  const fired = new Set([...body.matchAll(/\b(calls|uses|contains|imports|references|exports|extends|implements|overrides|instantiates):[\d,]+/g)].map(x => x[1]))
  const basis = /WHOLE|whole population|no cap/.test(body) ? "WHOLE" : "stride"
  fire[k] = { fired, basis }
}

// ---- 4. per-lane per-type resolution, from one bounded incoming-gate run
/**
 * THE MAP IN language-detection.ts IS `EXTENSION -> LANGUAGE`, NOT THE OTHER WAY ROUND. The first version of
 * this function looked for `${lane}: "ext"` and found nothing for every lane whose language name is not also
 * its extension (bash, csharp, objc, ...), so it passed `bash bash 200` to the gate, got no table, and marked
 * every cell `?`. JSON was the ONE lane that appeared to work, because `json: "json"` happens to match in
 * both directions — which is exactly how a parser bug survives a spot check.
 *
 * THE SECOND TABLE ON THE SAME OUTPUT IS THE POOLED INTENT SPLIT, and its first row is also `calls`. So
 * parsing stops at the first TOTAL line; a reader that kept going would overwrite the real row with the
 * intent row and quietly report a different number under the same name.
 */
function extensionFor(lane) {
  const det = fs.readFileSync(path.join(ROOT, "src/ast/language-detection.ts"), "utf8")
  const block = det.slice(0, det.indexOf("} as const") > 0 ? det.indexOf("} as const") : 8000)
  const pairs = [...block.matchAll(/([a-z0-9_+.-]+)\s*:\s*"([a-z0-9_+.-]+)"/g)].map(m => [m[1], m[2]])
  const hit = pairs.find(([, lang]) => lang === lane)
  return hit ? hit[0] : lane
}

function resolution(lane) {
  const ext = extensionFor(lane)
  let out = {}
  try {
    const txt = execFileSync("bun", ["run", "script/m14/incoming-gate.ts", lane, ext, CAP], { cwd: ROOT, encoding: "utf8", timeout: 600000 })
    for (const line of txt.split("\n")) {
      const r = line.trim().split(/\s+/)
      if (r[0] === "TOTAL") break            // the FIRST table only; the next one is the intent split
      if (r.length >= 8 && TYPES.includes(r[0])) {
        out[r[0]] = { edges: +r[1].replace(/,/g,""), resolved: +r[2].replace(/,/g,""), collRes: +r[3].replace(/,/g,""), unresolved: +(r[6] ?? "0").replace(/,/g,"") || 0 }
      }
    }
    if (!Object.keys(out).length) out.__error = `no table for ext "${ext}"`
  } catch (e) { out = { __error: String(e.message).slice(0, 80) } }
  return out
}

const lanes = Object.keys(cov).sort()
const rows = []
for (const lane of lanes) {
  const res = resolution(lane)
  const s = spec[lane] ?? { implemented: [], excluded: {}, unex: {} }
  const cells = []
  for (const t of TYPES) {
    const excluded = s.excluded[t] ?? s.unex[t]
    const impl = s.implemented.includes(t)
    const f = fire[lane]
    if (excluded) { cells.push({ t, mark: "-", note: excluded }); continue }
    if (!impl) { cells.push({ t, mark: "!", note: "in no list" }); continue }
    if (!f || !f.fired.has(t)) {
      // declared implemented; does the firing row call it silent?
      cells.push({ t, mark: "X", note: f ? "emits nothing" : "no firing row" }); continue
    }
    const r = res[t]
    if (!r) { cells.push({ t, mark: "?", note: "no per-type reading" }); continue }
    if (r.unresolved === 0) cells.push({ t, mark: "Y", note: `${r.edges} edges, all resolved` })
    else cells.push({ t, mark: "~", note: `${r.unresolved}/${r.edges} unresolved` })
  }
  rows.push({ lane, basis: fire[lane]?.basis ?? "NONE", cells })
}

const done = rows.filter(r => r.cells.every(c => c.mark === "Y" || c.mark === "-"))
const ticked = rows.reduce((n, r) => n + r.cells.filter(c => c.mark === "Y").length, 0)
const total = rows.reduce((n, r) => n + r.cells.filter(c => c.mark !== "-").length, 0)

let md = `# THE LANGUAGE MATRIX — DERIVED, NEVER ASSERTED\n\n`
md += `**Generated by \`script/m14/language-matrix.cjs\` at cap ${CAP}. DO NOT EDIT THIS FILE BY HAND — it is regenerated.**\n\n`
md += `Every cell comes from instrument output: coverage from \`coverage-block-gate.ts\`, emission from the canonical\nfiring log, resolution from \`incoming-gate.ts\`. **A cell is ticked by making the instruments pass.**\n\n`
md += `| mark | meaning |\n|---|---|\n`
md += `| **Y** | implemented, emitting, and every edge resolves — the cell is DONE |\n`
md += `| **~** | implemented and emitting, but unresolved edges remain (count shown) |\n`
md += `| **X** | declared implemented and emits NOTHING — a real silence |\n`
md += `| **-** | not applicable (excluded, with its class) |\n`
md += `| **!** | in NO list at all — the silent-sink defect |\n`
md += `| **?** | no per-type resolution reading |\n\n`
md += `## FLEET TOTALS\n\n\`\`\`\nApplicable cells  ${total}\nDONE cells (Y)    ${ticked}   (${(100*ticked/total).toFixed(1)}%)\nLANGUAGES WHOLLY DONE  ${done.length} of ${rows.length}${done.length ? "  -> " + done.map(d=>d.lane).join(" ") : ""}\n\`\`\`\n\n`
md += `## THE MATRIX\n\n| lane | evidence | ${TYPES.join(" | ")} |\n|---|---|${TYPES.map(()=>"---").join("|")}|\n`
for (const r of rows) md += `| \`${r.lane}\` | ${r.basis} | ${r.cells.map(c => c.mark).join(" | ")} |\n`
md += `\n## THE DETAIL — why each non-DONE cell is not done\n\n`
for (const r of rows) {
  const bad = r.cells.filter(c => c.mark !== "Y" && c.mark !== "-")
  if (!bad.length) continue
  md += `**\`${r.lane}\`** (${r.basis}): ` + bad.map(c => `${c.t} \`${c.mark}\` (${c.note})`).join(" · ") + `\n\n`
}
fs.writeFileSync(path.join(ROOT, "validation/m14/results/LANGUAGE-MATRIX.md"), md)
console.log(`WROTE validation/m14/results/LANGUAGE-MATRIX.md`)
console.log(`  languages wholly done: ${done.length}/${rows.length}`)
console.log(`  applicable cells: ${total} · done: ${ticked} (${(100*ticked/total).toFixed(1)}%)`)
console.log(`  Y=${rows.reduce((n,r)=>n+r.cells.filter(c=>c.mark==="Y").length,0)} ~=${rows.reduce((n,r)=>n+r.cells.filter(c=>c.mark==="~").length,0)} X=${rows.reduce((n,r)=>n+r.cells.filter(c=>c.mark==="X").length,0)} - =${rows.reduce((n,r)=>n+r.cells.filter(c=>c.mark==="-").length,0)} !=${rows.reduce((n,r)=>n+r.cells.filter(c=>c.mark==="!").length,0)}`)
