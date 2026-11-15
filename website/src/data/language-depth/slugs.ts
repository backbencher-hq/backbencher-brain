// The slug contract — one URL per display family, authored once.
//
// WHY AN EXPLICIT MAP AND NOT A SLUGIFIER
// ---------------------------------------
// A mechanical slugifier collides. "C", "C++" and "C#" all reduce to "c";
// "HCL / Terraform" mechanically reduces to
// "hcl-terraform", which is nobody's idea of the name. A detail page whose
// address is wrong is a permanent wart, so the 45 URLs are written down here
// and every language surface reads them from this one map.
//
// Contract:
//   - one entry per family in brain-languages.ts PARSERS, keyed by that
//     family's exact display `name`;
//   - lowercase, hyphen-separated, no dots, no slashes, no `+`;
//   - stable forever: changing a slug breaks inbound links, so treat this map
//     as frozen once it lands;
//   - slug is NOT derived from `ids` — those are registry names and are
//     gate-pinned; the display name is what a human typed in a URL bar.
//
// The inverse map (`slugToFamily`) is what the dynamic route uses to resolve
// an incoming param, so a request for an unknown slug can 404 instead of
// rendering an empty page.
//
// This module deliberately imports NOTHING. The sitemap and three verification
// gates all need this list, and importing `../brain-languages` here would drag
// the icon library into a build-time sitemap and into repo-root scripts that
// cannot resolve `website/node_modules`. Drift against the language dataset is
// caught by the import-time validation in ./index.ts, which does have the
// dataset; this file stays a pure declaration.

export const FAMILY_SLUGS: Record<string, string> = {
  // ── Application & systems ────────────────────────────────────────────
  TypeScript: "typescript",
  JavaScript: "javascript",
  Python: "python",
  Rust: "rust",
  Go: "go",
  Java: "java",
  "C++": "cpp",
  C: "c",
  "C#": "csharp",
  Swift: "swift",
  Kotlin: "kotlin",
  Dart: "dart",
  Zig: "zig",
  "Objective-C": "objective-c",
  "Visual Basic": "visual-basic",
  // Added with the M60 VBA lane: `vba` is its own registry key with its own
  // analyzer (real-vba-analyzer.ts), separate from `vb` (VB.NET). It was a
  // registry language with no display family until the language dataset became
  // generated; /languages/vba exists from this line, and hasDepth("VBA") is
  // false until an authored record lands.
  VBA: "vba",

  // ── Functional & declarative ─────────────────────────────────────────
  Elixir: "elixir",
  Clojure: "clojure",
  Haskell: "haskell",
  Scala: "scala",
  Erlang: "erlang",
  "F#": "fsharp",
  Clean: "clean",
  Nim: "nim",
  // Added with Julia: tree-sitter-julia and real-julia-analyzer.ts were wired in
  // the engine before any display family claimed them.
  Julia: "julia",
  // Added with the MATLAB lane: same story as Julia — the grammar, the analyzer
  // and the registry key existed before any display family claimed them. The
  // `.m` extension is content-sniffed (MATLAB declaration forms) because
  // Objective-C uses it too; see src/ast/language-detection.ts.
  MATLAB: "matlab",
  // Solidity arrived the same way and sat in the DATASET (brain-languages.ts) with
  // no address here, so ./index.ts threw `no detail URL for Solidity` at import
  // and `next build` failed on /languages — for every page of the site, since the
  // throw is at module evaluation. It is grouped here as the dataset groups it
  // (the "Functional & declarative" band's names list), and it has no authored
  // depth record yet: hasDepth("Solidity") is false by design, so /languages
  // shows it as a family without depth rather than inventing claims for it.
  Solidity: "solidity",

  // ── Scripting & shell ────────────────────────────────────────────────
  Ruby: "ruby",
  PHP: "php",
  Bash: "bash",
  PowerShell: "powershell",
  Lua: "lua",
  R: "r",
  Perl: "perl",
  Groovy: "groovy",

  // ── Web, data & config ───────────────────────────────────────────────
  Vue: "vue",
  Svelte: "svelte",
  HTML: "html",
  CSS: "css",
  GraphQL: "graphql",
  SQL: "sql",
  JSON: "json",
  YAML: "yaml",
  "HCL / Terraform": "terraform",
  TOML: "toml",
  XML: "xml",
  Markdown: "markdown",
  Make: "makefile",
  Protobuf: "protobuf",
  // CSS and SCSS are two families with two analyzer modules, so they get two
  // addresses. `css-scss` was the old combined slug and is intentionally gone.
  "SCSS / Sass": "scss",
}

// The two directions, derived once so no surface can disagree.
export const slugToFamily: Record<string, string> = Object.fromEntries(
  Object.entries(FAMILY_SLUGS).map(([family, slug]) => [slug, family]),
)

export function slugFor(familyName: string): string {
  return FAMILY_SLUGS[familyName] ?? ""
}

/** The canonical detail URL for a display family. */
export function languageHref(familyName: string): string {
  const slug = slugFor(familyName)
  return slug ? `/languages/${slug}` : "/languages"
}
