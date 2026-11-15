import type { Metadata } from "next"
import { TRUTH } from "@/data/truth.generated"
import { PARSERS, RELATIONSHIP_TYPES } from "@/data/brain-languages"

// /languages is a plain server-rendered page; metadata lives here so the counts
// come from generated truth, never hand-typed numbers.
//
// M56.L1 — the surface is named *Languages & analyzers*: the page is as much
// about what reads each grammar as it is about the grammar list, and the title's
// leading literal is gate-pinned.
//
// The description used to advertise "the depth grade it earned — symbols + call
// graph, structural symbols, or generic pass". Those three buckets described a
// `tier` field that never existed in src/ and ranked the product backwards; it
// has been removed from the dataset. The description now states what the console
// actually shows: the symbols each analyzer records and the relationship
// vocabulary it can construct, both derived from the analyzer modules.
export const metadata: Metadata = {
  // The leading literal "Languages & analyzers" is gate-pinned (L1); the second
  // count moved into the description so the <title> fits a search result.
  title: `Languages & analyzers — ${PARSERS.length} languages`,
  description: `An index of the ${PARSERS.length} language families bb reads — each analyzer's recorded symbols, its ${RELATIONSHIP_TYPES.length} relationship types, and where it stops.`,
  alternates: { canonical: "/languages" },
}

export default function LanguagesLayout({ children }: { children: React.ReactNode }) {
  return children
}
