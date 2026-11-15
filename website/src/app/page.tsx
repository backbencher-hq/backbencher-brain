import type { Metadata } from "next"
import { AtlasNav } from "@/components/atlas/AtlasNav"
import { AtlasHero } from "@/components/atlas/AtlasHero"
import { RegisterPlate } from "@/components/atlas/RegisterPlate"
import { EvidencePlate } from "@/components/atlas/EvidencePlate"
import { AtlasClose } from "@/components/atlas/AtlasClose"
import { AtlasFooter } from "@/components/atlas/AtlasFooter"
import { JsonLd } from "@/components/JsonLd"

// The Evidence Atlas — homepage. One plate of provenance, one night register,
// one evidence spectrum, one closing. The old warm-dark sections are gone from
// this surface; their content survives on /tools, /languages, /docs, /editors
// until those pages are re-skinned (see docs/website/DESIGN.md).
export const metadata: Metadata = {
  alternates: { canonical: "/" },
}

export default function HomePage() {
  return (
    <div className="atlas">
      <AtlasNav />
      <main>
        <AtlasHero />
        <RegisterPlate />
        <EvidencePlate />
        <AtlasClose />
      </main>
      <AtlasFooter />
      <JsonLd />
    </div>
  )
}
