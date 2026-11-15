import { redirect } from "next/navigation"
import { REDIRECTS } from "@/lib/redirects"

// /contact — M56.S1. Contact channels live on /support (FAQ first, then the
// still-have-questions block). This path is permanently redirected; the old
// URL stays valid for bookmarks and search-engine results.
export default function ContactPage(): never {
  redirect(REDIRECTS["/contact"])
}
