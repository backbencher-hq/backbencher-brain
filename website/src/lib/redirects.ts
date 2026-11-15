// website/src/lib/redirects.ts — M56.I1. The ONE declaration of every retired
// route and where it now lives.
//
// Three consumers read this file and nothing else declares a redirect:
//   - the stub pages (app/faq, app/contact, app/troubleshooting, app/demos),
//     which redirect to REDIRECTS[theirOwnPath];
//   - website/src/app/sitemap.ts, which excludes RETIRED_ROUTES (a sitemap lists
//     canonical URLs only) while still listing them in its route-parity contract
//     (their directories exist on disk);
//   - script/m56/verify-ia.ts, which parses this file and requires the stub
//     sources, the sitemap and the rendered routes to agree with it.
//
// A retired path is never deleted outright: the URL stays valid for bookmarks
// and search results pointing at it, and the rendered site links the canonical
// destination instead.
export const REDIRECTS = {
  // M56.S1 — FAQ and contact became one surface generated from website/faq.md.
  "/faq": "/support",
  "/contact": "/support",
  // M56.I1 — troubleshooting content moved into the docs page so there is one
  // source of truth for symptom-based fixes.
  "/troubleshooting": "/docs#troubleshooting",
  // M56.I1 — /demos is retired: the owner withdrew both films after review
  // (pacing and craft, not truth). The machine-verified session stills that
  // survived now serve as proof on /editors.
  "/demos": "/editors",
} as const

export type RetiredRoute = keyof typeof REDIRECTS

export const RETIRED_ROUTES = Object.keys(REDIRECTS) as RetiredRoute[]
