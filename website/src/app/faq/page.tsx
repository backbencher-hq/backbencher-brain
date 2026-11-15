import { redirect } from "next/navigation"
import { REDIRECTS } from "@/lib/redirects"

// /faq — M56.S1. The FAQ lives on /support (one surface, one source:
// website/faq.md). This path is permanently redirected; the old URL stays
// valid for bookmarks and search-engine results.
export default function FaqPage(): never {
  redirect(REDIRECTS["/faq"])
}
