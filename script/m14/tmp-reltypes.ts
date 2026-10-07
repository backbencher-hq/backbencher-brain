import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const engine: any = await import(path.join(ROOT, "src/ast/engine"));

// A `uses` target is EXTERNAL BY DESIGN when it is a URL, a mailto, or a path to
// another file. It is INTERNAL when it is a bare `#anchor` into this same file —
// that names a heading this analyzer published, and if it does not resolve, the
// edge is a fabricated endpoint. Everything else is classified, not excused.
const classify = (t: string): "absolute-url" | "mailto" | "bare-anchor" | "same-file-path" | "cross-file-path" | "other" => {
  if (/^https?:\/\//i.test(t)) return "absolute-url";
  if (/^mailto:/i.test(t)) return "mailto";
  if (t.startsWith("#")) return "bare-anchor";
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return "absolute-url";
  if (/^[./]?\//.test(t)) return t.replace(/^\.\//, "").split("/").length > 1 ? "cross-file-path" : "same-file-path";
  return "cross-file-path";
};

const tgtClass = new Map<string, number>();
const srcClass = new Map<string, number>();
const unresolved: string[] = [];
const srcUnresolved: string[] = [];
let uses = 0, contains = 0, files = 0;
let bareAnchorTotal = 0, bareAnchorResolved = 0;

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

for (const f of process.argv.slice(2)) {
  const content = fs.readFileSync(f, "utf8");
  const res: any = await engine.ASTEngine.parseFile(f, content);
  if (res?.language !== "markdown") continue;
  files++;
  const byName = new Map<string, number[]>();
  for (const s of res.symbols ?? []) bump2(byName, String(s.name), s.range?.startLine ?? -1);
  const base = path.basename(f);
  const dir = path.dirname(f);
  for (const r of res.relationships ?? []) {
    if (r.type === "contains") { contains++; continue; }
    uses++;
    const tgt = String(r.target ?? "");
    const src = String(r.source ?? "");
    bump(tgtClass, classify(tgt));
    // does a same-file relative path point at THIS file?
    if (/^[./]?\//.test(tgt) || /^\.?\//.test(tgt)) { /* path class already recorded */ }
    if (tgt.startsWith("#")) {
      bareAnchorTotal++;
      const frag = decodeURIComponent(tgt.slice(1)).toLowerCase();
      const hit = res.symbols.some((s: any) => {
        const n = String(s.name).toLowerCase();
        return n === frag || n.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") === frag;
      });
      if (hit) bareAnchorResolved++;
      else if (unresolved.length < 10) unresolved.push(`${base} -> ${tgt} (no heading matches the fragment)`);
    }
    if (!byName.has(src)) {
      bump(srcClass, src === "document" ? "document-pseudo" : src === base ? "file-name" : "other-unresolved");
      if (srcUnresolved.length < 10) srcUnresolved.push(`${base}: source "${src}" names no symbol (${classify(tgt)})`);
    } else {
      bump(srcClass, "resolves");
    }
  }
  void dir; void base;
}
function bump2(m: Map<string, number[]>, k: string, v: number) {
  m.set(k, [...(m.get(k) ?? []), v]);
}

console.log(`files=${files} contains=${contains} uses=${uses}\n`);
console.log("uses TARGET classes:");
for (const [k, v] of [...tgtClass].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(18)} ${v}`);
console.log("\nuses SOURCE classes:");
for (const [k, v] of [...srcClass].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(18)} ${v}`);
console.log(`\nbare #anchor targets: ${bareAnchorTotal}, resolving to a heading: ${bareAnchorResolved}`);
for (const u of unresolved) console.log("  UNRESOLVED " + u);
console.log("\nsources that name no symbol:");
for (const u of srcUnresolved) console.log("  " + u);
