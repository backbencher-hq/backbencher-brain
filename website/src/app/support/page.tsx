import Link from "next/link"
import type { Metadata } from "next"
import { FAQ_SECTIONS, SUPPORT_QA, SUPPORT_CHANNELS } from "@/data/support.generated"
import { SupportJsonLd } from "@/components/SupportJsonLd"
import { AtlasPage, PageHead } from "@/components/atlas/AtlasPage"
import { RichText } from "@/components/atlas/RichText"

// /support — M56.S1. The single support surface: the FAQ (generated from
// website/faq.md — see SUPPORT_SOURCE), then the still-have-questions block.
// /faq and /contact redirect here; the FAQPage structured data is derived from
// the same array this page renders, so search engines are never told anything
// a reader cannot see. Every count in the answers was cross-checked against
// the engine truth at generation time.
//
// 2026-11-07 — Evidence Atlas surface: paper reading page, hairline FAQ rows,
// no cards. Content is unchanged and still generated; only the presentation
// moved.

export const metadata: Metadata = {
  title: "Support & FAQ",
  description:
    "Answers to common questions about Backbencher — indexing, freshness, embeddings, MCP clients, your data — and how to reach a human when the answer is not here.",
  alternates: { canonical: "https://backbencher.cc/support" },
}

const SECTION_ANCHORS: Record<string, string> = {
  "The product": "the-product",
  Indexing: "indexing",
  "Re-indexing after changes": "keeping-it-fresh",
  "Updates, uninstalling, and your data": "your-data",
  "MCP / agent integration": "mcp-agent",
}

let counter = 0

export default function SupportPage() {
  return (
    <AtlasPage>
      <SupportJsonLd />
      <div className="container">
        <PageHead
          title="Support"
          lead="Straight answers first — including the ones that are easier to dodge — then the people behind them."
          meta={`${SUPPORT_QA.length} questions · ${FAQ_SECTIONS.length} sections`}
        />

        <nav aria-label="FAQ sections" className="section-nav">
          {FAQ_SECTIONS.map((section) => (
            <a key={section.name} href={`#${SECTION_ANCHORS[section.name] ?? "faq"}`}>
              {section.name}
            </a>
          ))}
        </nav>

        {FAQ_SECTIONS.map((section) => (
          <section key={section.name} id={SECTION_ANCHORS[section.name] ?? "faq"} className="reading" style={{ paddingBottom: 0 }}>
            <h2>{section.name}</h2>
            <div className="faq">
              {SUPPORT_QA.filter((item) => item.section === section.name).map((item) => {
                counter += 1
                return (
                  <details key={item.q}>
                    <summary>
                      <span className="num">{String(counter).padStart(2, "0")}</span>
                      <span className="q"><RichText text={item.q} /></span>
                      <span className="marker" aria-hidden />
                    </summary>
                    <div className="a"><RichText text={item.a} /></div>
                  </details>
                )
              })}
            </div>
          </section>
        ))}

        <section id="still-have-questions" className="reading">
          <h2>Still have questions?</h2>
          <p>
            The answer you need is not above? Write to a human — both inboxes are read by the people building
            Backbencher.
          </p>
          <div className="channels">
            {SUPPORT_CHANNELS.map((channel) => (
              <div className="channel" key={channel.title}>
                <h3>{channel.title}</h3>
                <div>
                  <p>{channel.body}</p>
                  <a href={`mailto:${channel.email}`}>{channel.email}</a>
                </div>
              </div>
            ))}
          </div>

          <p style={{ marginTop: 28 }}>
            First time here? Start with <Link href="/install">installing Backbencher</Link>, or browse the{" "}
            <Link href="/docs">docs</Link>.
          </p>
          <p>
            Elsewhere: <a href="https://ishaq2321.github.io">portfolio (ishaq2321)</a> ·{" "}
            <a href="https://www.linkedin.com/in/2321ishaq">LinkedIn (2321ishaq)</a> ·{" "}
            <a href="https://github.com/ishaq2321">GitHub</a> · <Link href="/privacy">Privacy Policy</Link> ·{" "}
            <Link href="/terms">Terms of Service</Link>
          </p>
        </section>
      </div>
    </AtlasPage>
  )
}
