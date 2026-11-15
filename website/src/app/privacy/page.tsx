import Link from "next/link"
import type { Metadata } from "next"
import { AtlasPage, PageHead } from "@/components/atlas/AtlasPage"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How backbencher.cc and the Backbencher software handle data: cookieless analytics, a local-first index, and what leaves your machine with embedding providers.",
  alternates: { canonical: "https://backbencher.cc/privacy" },
}

// Written in the same honesty contract as the rest of the site: only claims
// that are true today. Effective date is pinned (not auto-rolling) so the
// page stays reviewable; bump it in the same commit as any content change.
const EFFECTIVE = "September 7, 2026"

const SECTIONS: { h: string; body: React.ReactNode }[] = [
  {
    h: "Short version",
    body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li>The website uses a cookieless, privacy-friendly analytics counter (GoatCounter) — no accounts, no cookies, no personal identifiers collected by us.</li>
        <li>The bb software is local-first: indexing, storage, and analysis happen on your machine. There is no Backbencher cloud.</li>
        <li>The only optional network calls are embedding-provider requests you configure yourself with your own API key.</li>
        <li>Your embedding keys are stored in your config with owner-only permissions and are displayed as fingerprints only.</li>
      </ul>
    ),
  },
  {
    h: "Who is behind this",
    body: (
      <p>
        Backbencher (also called <strong>bb</strong>) and backbencher.cc are developed by Muhammad Ishaq Khan
        (ishaq2321). Questions about this policy go to{" "}
        <a className="text-[#F5A18C] underline underline-offset-4" href="mailto:info@backbencher.cc">info@backbencher.cc</a>.
      </p>
    ),
  },
  {
    h: "The website (backbencher.cc)",
    body: (
      <>
        <p>
          The site runs GoatCounter (account <code className="rounded bg-[rgba(0,0,0,0.3)] px-1.5 py-0.5 font-mono text-[13px] text-[#F59E8A]">bbstats</code>) for page-view
          counts. GoatCounter is cookieless: it does not set tracking cookies and we collect no names, email addresses,
          or account data on the site. The counter receives standard request information (page path and title, referrer,
          browser/user-agent, approximate country) so we can see which pages people actually read.
        </p>
        <p className="mt-3">
          You can opt out at any time at{" "}
          <a className="text-[#F5A18C] underline underline-offset-4" href="https://www.goatcounter.com/optout">goatcounter.com/optout</a>,
          or block the counter script — the site works fully without it.
        </p>
      </>
    ),
  },
  {
    h: "The bb software — what stays on your machine",
    body: (
      <>
        <p>
          When you index a project, the parsed symbols, relationships, and derived data are written to a local,
          per-project database on your machine. The CLI configuration lives in{" "}
          <code className="rounded bg-[rgba(0,0,0,0.3)] px-1.5 py-0.5 font-mono text-[13px] text-[#F59E8A]">~/.bb/config.json</code>{" "}
          with owner-only permissions (0600). Embedding provider keys are stored there and are shown as fingerprints, not
          plaintext, by inspection commands like{" "}
          <code className="rounded bg-[rgba(0,0,0,0.3)] px-1.5 py-0.5 font-mono text-[13px] text-[#F59E8A]">bb setup show</code>.
        </p>
        <p className="mt-3">
          We do not operate any service that receives your index, your config, or your keys.
        </p>
      </>
    ),
  },
  {
    h: "What leaves your machine",
    body: (
      <>
        <p>Exactly two kinds of network activity exist, both under your control:</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>
            <strong>Installer downloads</strong> — when you install or rerun the installer, it downloads the release
            binary from backbencher.cc (or the URL you point it at).
          </li>
          <li>
            <strong>Embedding provider requests</strong> — only if you enable high-quality semantic search by configuring
            a provider key with <code className="rounded bg-[rgba(0,0,0,0.3)] px-1.5 py-0.5 font-mono text-[13px] text-[#F59E8A]">bb setup</code>.
            The content being embedded is sent to that provider in small vector requests under that provider&apos;s own
            terms, not to us. If you do not configure a key, semantic search falls back to weaker local vectors and
            nothing is sent.
          </li>
        </ul>
      </>
    ),
  },
  {
    h: "Email",
    body: (
      <p>
        Messages you send to{" "}
        <a className="text-[#F5A18C] underline underline-offset-4" href="mailto:support@backbencher.cc">support@backbencher.cc</a>{" "}
        or{" "}
        <a className="text-[#F5A18C] underline underline-offset-4" href="mailto:info@backbencher.cc">info@backbencher.cc</a>{" "}
        are used only to respond to you and to improve the product. We do not sell or share them.
      </p>
    ),
  },
  {
    h: "Changes to this policy",
    body: (
      <p>
        If this policy changes, the effective date above is updated in the same change. Significant changes are called
        out here rather than buried.
      </p>
    ),
  },
]

export default function PrivacyPage() {
  return (
    <AtlasPage>
      <div className="container">
        <PageHead title="Privacy Policy" lead={`Effective ${EFFECTIVE}. This covers backbencher.cc and the Backbencher software (bb). It is short on purpose — if a claim here is not true, that is a bug worth reporting.`} />
        <div className="reading atlas-legacy">
        <div className="space-y-8">
          {SECTIONS.map((s) => (
            <section key={s.h}>
              <h2 className="font-display mb-3 text-[1.35rem] font-medium text-[#F1E9DD]">{s.h}</h2>
              <div className="space-y-3 text-[14.5px] leading-[1.8] text-[#C2B5A2] [&_code]:text-[13px] [&_a]:underline-offset-4">
                {s.body}
              </div>
            </section>
          ))}
        </div>
        <p className="mt-12 border-t border-[rgba(241,233,221,0.09)] pt-6 text-[13px] text-[#8C8070]">
          Also read the{" "}
          <Link href="/terms" className="text-[#9A8F7D] underline underline-offset-4 transition-colors hover:text-[#F1E9DD]">Terms of Service</Link>.
        </p>
        </div>
      </div>
    </AtlasPage>
  )
}
