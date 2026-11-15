import { redirect } from "next/navigation"
import { REDIRECTS } from "@/lib/redirects"

// /demos — M56.I1. RETIRED. The two films were withdrawn by the owner after
// review (pacing and craft, not truth); M45.T1's scope changed accordingly and
// the change is recorded in docs/m56/M56-MASTER-PLAN.md, not deleted. The
// machine-verified session stills from the same capture harness are the proof
// that survives, and they live on /editors.
export default function DemosPage(): never {
  redirect(REDIRECTS["/demos"])
}
