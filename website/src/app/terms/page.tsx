import Link from "next/link"
import type { Metadata } from "next"
import { AtlasPage, PageHead } from "@/components/atlas/AtlasPage"

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms that cover backbencher.cc and the Backbencher software: license, no warranty, acceptable use, and contact details.",
  alternates: { canonical: "https://backbencher.cc/terms" },
}

const EFFECTIVE = "September 7, 2026"

const SECTIONS: { h: string; body: React.ReactNode }[] = [
  {
    h: "What these terms cover",
    body: (
      <p>
        These terms govern your use of the backbencher.cc website and the Backbencher software ({" "}
        <strong>bb</strong>), developed by Muhammad Ishaq Khan (ishaq2321). By using either, you accept these terms.
      </p>
    ),
  },
  {
    h: "The website",
    body: (
      <p>
        The site describes the product and its documentation honestly — including what the software cannot do. Nothing
        on the site is a guarantee of specific results for your codebase.
      </p>
    ),
  },
  {
    h: "The software license",
    body: (
      <>
        <p>
          bb is proprietary software distributed as installable binaries. You receive a limited, non-exclusive,
          non-transferable license to install and use bb for your own purposes. The source code is not currently
          published; that may change in a future release.
        </p>
        <p className="mt-3">
          You may not resell or redistribute bb, or offer it as a hosted service to third parties, without written
          permission.
        </p>
      </>
    ),
  },
  {
    h: "Third-party services (embedding providers)",
    body: (
      <p>
        High-quality semantic search is optional and uses an embedding provider you configure with your own API key.
        That provider is a separate service governed by its own terms; Backbencher is not affiliated with it. Any usage
        costs are yours.
      </p>
    ),
  },
  {
    h: "Your responsibility",
    body: (
      <p>
        You are responsible for the code you index and the choices you make with it — including what you send to an
        embedding provider and which providers you trust.
      </p>
    ),
  },
  {
    h: "No warranty",
    body: (
      <p>
        bb and this website are provided “as is,” without warranty of any kind, express or implied — including fitness
        for a particular purpose. The engine indexes what it can parse and says so when it cannot; treat its output as
        evidence to verify, not as certainty.
      </p>
    ),
  },
  {
    h: "Limitation of liability",
    body: (
      <p>
        To the maximum extent permitted by law, the developer is not liable for damages arising from your use of bb or
        this website — including data loss from edits made through the software. Use the built-in dry-run previews
        before risky changes, and keep backups of anything important.
      </p>
    ),
  },
  {
    h: "Changes and termination",
    body: (
      <p>
        These terms may be updated; the effective date above is changed in the same update. You may stop using bb at
        any time by uninstalling it and deleting its local index and configuration.
      </p>
    ),
  },
  {
    h: "Contact",
    body: (
      <p>
        Questions about these terms:{" "}
        <a className="text-[#F5A18C] underline underline-offset-4" href="mailto:info@backbencher.cc">info@backbencher.cc</a>.
        Help with the software:{" "}
        <a className="text-[#F5A18C] underline underline-offset-4" href="mailto:support@backbencher.cc">support@backbencher.cc</a>.
      </p>
    ),
  },
]

export default function TermsPage() {
  return (
    <AtlasPage>
      <div className="container">
        <PageHead title="Terms of Service" lead={`Effective ${EFFECTIVE}. Plain-language terms for using backbencher.cc and Backbencher (bb).`} />
        <div className="reading atlas-legacy">
        <div className="space-y-8">
          {SECTIONS.map((s) => (
            <section key={s.h}>
              <h2 className="font-display mb-3 text-[1.35rem] font-medium text-[#F1E9DD]">{s.h}</h2>
              <div className="space-y-3 text-[14.5px] leading-[1.8] text-[#C2B5A2]">{s.body}</div>
            </section>
          ))}
        </div>
        <p className="mt-12 border-t border-[rgba(241,233,221,0.09)] pt-6 text-[13px] text-[#8C8070]">
          Also read the{" "}
          <Link href="/privacy" className="text-[#9A8F7D] underline underline-offset-4 transition-colors hover:text-[#F1E9DD]">Privacy Policy</Link>.
        </p>
        </div>
      </div>
    </AtlasPage>
  )
}
