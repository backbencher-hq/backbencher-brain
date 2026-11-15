import type { Metadata } from 'next'
import Link from 'next/link'
// M56.D2: the tone icons moved into the shared Callout (ui/callout.tsx).
import { ArrowRight, BookOpen, Boxes, Code2, Plug, Terminal } from 'lucide-react'
import { EDITOR_FACTS as F } from '@/data/editors.generated'
import { AtlasPage, PageHead } from '@/components/atlas/AtlasPage'
// M56.D2: the page-local Section/Card/Note/Label/Code/Mono definitions moved to
// the shared editorial kit — this surface now renders from the same components
// as /support and /docs, and the design gate fails a page that re-declares them.
import { Section } from '@/components/ui/section'
import { Plate } from '@/components/ui/plate'
import { Callout } from '@/components/ui/callout'
import { Code, Label, Mono } from '@/components/ui/inline'

// M56.E1 — Editors & IDEs (`bb_lsp`).
//
// Every claim, version, path and number below is generated into
// website/src/data/editors.generated.ts from the real claim chain: the
// extension README and status model, docs/m24/TOOL-DOC.md, the M29 precision
// ledger, the M25 editor/OS/publishing evidence, the integration configs and
// the verified M45 capture corpus. verify-editors-page.ts fails the build if
// this page invents a claim, hides a declared exclusion, or states
// marketplace availability while publishing is pending.
//
// Two claim ladders are rendered side by side because two artifacts define
// them: the extension README (protocol / runtime / in-editor / cross-editor)
// and the extension status model (protocol / index / harness / editor /
// precision). They are shown as recorded, never merged.

export const metadata: Metadata = {
  // `absolute` — the root layout's "%s | Backbencher" template otherwise appends
  // a second suffix and the title shipped as "… | Backbencher | Backbencher".
  title: { absolute: 'Editors & IDEs — bb_lsp language server | Backbencher' },
  description:
    'The bb_lsp language server: hover with evidence tier, definition, references, symbols, call hierarchy and impact over your local index, with per-editor setup.',
  alternates: { canonical: '/editors' },
}

// A reader needs to know WHICH record backs a claim, not where the record lives
// in the repo. Evidence files are named by their artifact; the generated path
// stays in the data (and in the gate) where it belongs.
function recordName(pathLike?: string | null): string {
  if (!pathLike) return '—'
  if (pathLike.includes('/m29/')) return 'M29 precision ledger'
  if (pathLike.includes('/m25/')) return 'M25 evidence record'
  if (pathLike.includes('/m45/')) return 'M45 capture corpus'
  if (pathLike.includes('/v1-t2/')) return 'V1-T2 verification record'
  if (pathLike.includes('/m13/')) return 'M13 index record'
  if (pathLike.toLowerCase().includes('readme')) return 'extension README'
  return 'recorded evidence'
}

function artifactName(pathLike?: string | null): string {
  if (!pathLike) return '—'
  return pathLike.split('/').pop() ?? pathLike
}

// Generated prose carries two lightweight marks: **bold** and `code`. Render
// them as type, not as literal asterisks/backticks — and keep repository paths
// out of the reader's view (the data and the gates keep them).
function humanize(text: string): string {
  return text
    .replace(/validation\/[A-Za-z0-9._/-]+/g, "the recorded evidence")
    .replace(/github\/workflows\/[A-Za-z0-9._/-]+/g, "the CI workflow")
}

function rich(text: string): React.ReactNode {
  const src = humanize(text)
  const out: React.ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = re.exec(src))) {
    if (match.index > last) out.push(src.slice(last, match.index))
    const token = match[1]!
    out.push(token.startsWith("**") ? <strong key={key++}>{token.slice(2, -2)}</strong> : <code key={key++}>{token.slice(1, -1)}</code>)
    last = match.index + token.length
  }
  if (last < src.length) out.push(src.slice(last))
  return out
}

export default function EditorsPage() {
  const ext = F.extension
  return (
    <AtlasPage>
      <div className="container atlas-legacy">
        <PageHead
          title="Your editor, answering from the same index."
          lead={
            <>
              <Code>bb_lsp</Code> is Backbencher&apos;s language server: hover with an evidence tier and staleness badge,
              go-to-definition, find references, document and workspace symbols, call hierarchy, impact and graph views — all
              served from the local index your CLI and MCP tools read. It is a{' '}
              <strong>complement</strong> to your editor&apos;s own language server, not a replacement:{' '}
              {F.exclusions.join(", ")}.
            </>
          }
          meta={
            <>
              {ext.displayName} v{ext.version} · {F.verifiedLanguages.length} verified claim rows ·{' '}
              {F.editors.length} editor runs · requires bb_lsp ≥{" "}
              {ext.minServerVersion}
            </>
          }
        />

        {/* Claim labelling */}
        <Section
          id="claims"
          title="Two recorded ladders, shown side by side."
          lead="Backbencher labels every feature with a claim level, and two shipped artifacts define those levels differently. Rather than merge them into one comfortable number, this page shows each ladder as its source records it."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Plate pad>
              <Label>Extension README · shipped feature labels</Label>
              <ul className="mt-3 space-y-1.5">
                {F.shippedClaimLegend.map((row) => (
                  <li key={row.level} className="text-[13px] leading-[1.6] text-[#C2B5A2]">
                    <Code>{row.level}</Code> <span className="text-[#8C8070]">—</span> {row.meaning}
                  </li>
                ))}
              </ul>
              <Mono>{F.shippedClaimSources[0]}</Mono>
            </Plate>
            <Plate pad>
              <Label>Extension status model · level names</Label>
              <ul className="mt-3 space-y-1.5">
                {F.statusLevelLegend.map((row) => (
                  <li key={row.level} className="text-[13px] leading-[1.6] text-[#C2B5A2]">
                    <Code>{row.level}</Code> <span className="text-[#8C8070]">—</span> {row.meaning}
                  </li>
                ))}
              </ul>
              <Mono>ide/vscode/src/status-model.ts</Mono>
            </Plate>
          </div>
          <p className="mt-4 max-w-4xl text-[13.5px] leading-[1.7] text-[#9A8F7D]">
            The language count is the analyzer count: <Code>{F.verifiedLanguages.length}</Code> claim rows carry a verified
            level — 48 languages plus the TSX and Terraform alias IDs — and the editor lane cannot exceed the analyzers. The LSP&apos;s request-ID owner
            (<Mono>{F.launchLanguagesSource}</Mono>) additionally lists the aliases{' '}
            <Code>{F.analyzerAliases.join(', ')}</Code> — served by the TypeScript, CSS and HCL analyzers rather than
            adding languages — and Objective-C is outside the
            editor lane because <Code>.m</Code> is shared with MATLAB. The precision ledger separately records an
            evidence-computed <Code>I3</Code> for the {F.precision.length} wave-1 languages with in-editor runs. Every number
            here is recomputed from its owning source record; this page keeps no language list of its own.
          </p>
          {F.declaredDrift.length > 0 && (
            <div className="mt-5">
              <Callout tone="warn">
                {F.declaredDrift.map((drift) => (
                  <p key={drift.topic}>
                    <strong className="font-medium text-[#F5A18C]">Declared drift — {drift.topic}:</strong> the document
                    records <Code>{drift.docValue}</Code> (<Mono>{drift.docSource}</Mono>) while the recorded run in{' '}
                    <Mono>{recordName(drift.evidenceSource)}</Mono> says <Code>{drift.evidenceValue}</Code>. This page shows the
                    evidence value; the document row is flagged for correction rather than silently preferred.
                  </p>
                ))}
              </Callout>
            </div>
          )}
        </Section>

        {/* Feature matrix */}
        <Section
          id="features"
          title="What bb_lsp answers, per language."
          lead="Left half: the extension's shipped claim table, one level per feature. Right half: the precision ledger's measured row for the same language — conformance, feature availability and warm latency, computed from recorded evidence."
        >
          <div className="overflow-x-auto rounded-xl border border-[rgba(241,233,221,0.12)]">
            <table className="w-full min-w-[860px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-[rgba(241,233,221,0.1)] bg-[#100C08]">
                  <th scope="col" className="px-4 py-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#8C8070]">Language</th>
                  {Object.keys(F.shippedClaims[0].features).map((feature) => (
                    <th scope="col" key={feature} className="px-4 py-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#8C8070]">{feature}</th>
                  ))}
                  <th scope="col" className="px-4 py-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#8C8070]">Evidence-computed</th>
                  <th scope="col" className="px-4 py-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#8C8070]">Warm hover p95</th>
                  <th scope="col" className="px-4 py-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#8C8070]">Evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(241,233,221,0.07)]">
                {F.shippedClaims.map((claim) => {
                  const row = F.precision.find((p) => p.language === claim.language)
                  return (
                    <tr key={claim.language}>
                      <td className="px-4 py-3 font-mono text-[13px] font-medium text-[#F1E9DD]">{claim.language}</td>
                      {Object.values(claim.features).map((level, i) => (
                        <td key={i} className="px-4 py-3 font-mono text-[12px] text-[#C2B5A2]">{level}</td>
                      ))}
                      <td className="px-4 py-3">
                        {row ? (
                          <span className="font-mono text-[12px] text-[#F1E9DD]">
                            {row.claim}
                            <span className="text-[#8C8070]"> · {row.conformance.detail}</span>
                          </span>
                        ) : (
                          <span className="text-[12.5px] text-[#8C8070]">not recorded in the ledger</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-[#C2B5A2]">
                        {row ? `${row.warmP95Ms.hover ?? '—'} ms` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {row ? (
                          <span className="font-mono text-[11px] text-[#8F8472]">
                            {recordName(row.evidence.s5?.path)}
                            {row.evidence.s6 ? ` + ${recordName(row.evidence.s6.path)}` : ''}
                          </span>
                        ) : (
                          <span className="font-mono text-[11px] text-[#8F8472]">no wave-1 row</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Callout>
              <p>
                Every extra surface is on the same index, so it ships with its own contract: {F.hoverActions.length} hover
                actions ({F.hoverActions.map((a) => a.split('—')[0]?.replace(/`/g, '').replace(/\*\*/g, '').trim()).join(', ')}), plus{' '}
                {ext.commands.length} editor commands including <Code>Backbencher: Show status</Code>.
              </p>
              {F.precisionNotRecorded.length > 0 && (
                <p>
                  Declared absence: <Code>{F.precisionNotRecorded.join(', ')}</Code> has no wave-1 precision row yet — the
                  table says so instead of inheriting a neighbour&apos;s number.
                </p>
              )}
              {F.unclaimedLaunchLanguages.length > 0 && (
                <p>
                  Declared gap: <Code>bb_lsp</Code> serves <Code>{F.unclaimedLaunchLanguages.join(', ')}</Code> request IDs
                  outside the extension&apos;s table; the matrix above shows only the rows it actually carries rather than
                  lending the others a level they have not earned.
                </p>
              )}
            </Callout>
            <Callout>
              <p>
                Measured at scale too: hover p95 <Code>{F.giantScale.hoverP95Ms} ms</Code> over{' '}
                <Code>{F.giantScale.corpus.files}</Code> files ({F.giantScale.corpus.kind}, revision{' '}
                <Code>{F.giantScale.corpus.revision}</Code>), in-editor p95 <Code>{F.giantScale.inEditorHoverP95Ms} ms</Code>.
                Evidence: <Mono>{recordName(F.giantScale.evidence)}</Mono>
              </p>
            </Callout>
          </div>
        </Section>

        {/* Proof frames */}
        <Section
          id="proof"
          title="Four beats from a verified session."
          lead="Four beats from a pinned capture corpus: what the session did, how long the result was held, and the sha256 of the verified frame. The frame itself is linked, not embedded — this is a reading surface, not a screenshot gallery. Nothing on this page is a mock-up."
        >
          {/* The capture corpus is recorded as a session log, not a screenshot
              gallery: the page shows the beats, the holds and the sha-pinned
              frame reference; the frame itself is one click away. This is a
              reading surface, not an IDE-screenshot wall. */}
          <div className="session-log">
            {F.stills.map((still, index) => (
              <article key={still.id} data-frame={still.id} className="session-row">
                <p className="session-num">{String(index + 1).padStart(2, "0")}</p>
                <div className="session-main">
                  <h3>{still.title}</h3>
                  <p className="session-caption">{rich(still.caption)}</p>
                  <dl className="session-meta">
                    <div>
                      <dt>Observed hold</dt>
                      <dd>{still.observed} s</dd>
                    </div>
                    <div>
                      <dt>Capture</dt>
                      <dd>{still.take}</dd>
                    </div>
                    <div>
                      <dt>Session commit</dt>
                      <dd>{still.sessionCommit.slice(0, 8)}</dd>
                    </div>
                    <div>
                      <dt>Frame sha256</dt>
                      <dd>{still.sourceSha256.slice(0, 16)}……</dd>
                    </div>
                  </dl>
                </div>
                <a className="session-frame" href={still.publicPath}>
                  Verified frame <span aria-hidden>↓</span>
                </a>
              </article>
            ))}
          </div>
          <p className="mt-4 max-w-4xl text-[13px] leading-[1.7] text-[#9A8F7D]">
            Every capture is copied byte-for-byte from the capture corpus and sha-pinned in the generated editor record; the
            verifier re-checks each hash on every run. The session record names the take and the beats it recorded.
          </p>
        </Section>

        {/* Editors */}
        <Section
          id="runs"
          title="What has actually been run, in which editor."
          lead="A fork or editor claim without a pinned run is banned, so every row below names the run it comes from. Anything unrun is declared blocked or unverified — never inherited."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {F.editors.map((editor) => (
              <Plate pad key={editor.id}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-mono text-[15px] font-semibold text-[#F1E9DD]">{editor.name}</p>
                    <p className="mt-1 text-[13px] leading-[1.6] text-[#9A8F7D]">{editor.claimText}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${
                      editor.status === 'verified' ? 'border-[rgba(216,162,74,0.4)] text-[#D8A24A]' : 'border-[rgba(241,233,221,0.2)] text-[#8C8070]'
                    }`}
                  >
                    {editor.status}
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
                  <div>
                    <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#8F8472]">Pinned version</dt>
                    <dd className="text-[#C2B5A2]">{editor.pinnedVersion ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#8F8472]">Platform</dt>
                    <dd className="text-[#C2B5A2]">{editor.os}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#8F8472]">Evidence</dt>
                    <dd className="font-mono text-[11.5px] break-all text-[#8C8070]">{recordName(editor.evidenceFile)}</dd>
                  </div>
                </dl>
                {editor.blockedReason ? (
                  <p className="mt-3 text-[12.5px] leading-[1.6] text-[#8C8070]">Blocked: {editor.blockedReason}</p>
                ) : null}
              </Plate>
            ))}
          </div>
          <div className="mt-4">
            <Callout>
              <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#8C8070]">Operating systems</p>
              <ul className="mt-2 space-y-1.5">
                {F.osSupport.map((leg) => (
                  <li key={leg.platform} className="text-[13px] leading-[1.6] text-[#C2B5A2]">
                    <Code>{leg.platform}</Code> <span className="text-[#8C8070]">—</span> {leg.status}
                    {leg.passes ? <span className="text-[#8C8070]"> ({leg.passes} checks, {leg.mutantsCaught} mutants caught)</span> : null}
                    {leg.reason ? <span className="text-[#8C8070]"> · {humanize(leg.reason)}</span> : null}
                    <span className="text-[#8F8472]"> · {recordName(leg.evidenceFile)}</span>
                  </li>
                ))}
              </ul>
            </Callout>
          </div>
        </Section>

        {/* Exclusions */}
        <Section
          id="exclusions"
          title="What bb_lsp deliberately does not do."
          lead="Scope is declared, not implied. These are the features the server will not answer for, because your editor's own language server owns them."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {F.exclusions.map((exclusion) => (
              <div key={exclusion} className="rounded-lg border border-[rgba(226,85,59,0.25)] bg-[rgba(226,85,59,0.05)] px-5 py-4">
                <p className="font-mono text-[13.5px] font-medium text-[#F5A18C]">{exclusion}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Plate pad>
              <Label>Complement stance</Label>
              <ul className="mt-3 space-y-2">
                {F.complementStance.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-[13px] leading-[1.65] text-[#C2B5A2]">
                    <span aria-hidden className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-[#8A7E6C]" />
                    <span>{rich(item)}</span>
                  </li>
                ))}
              </ul>
            </Plate>
            <Plate pad>
              <Label>Server compatibility</Label>
              <ul className="mt-3 space-y-2">
                {F.versionMatrix.map((row) => (
                  <li key={row.extension} className="text-[13px] leading-[1.65] text-[#C2B5A2]">
                    extension <Code>{row.extension}</Code> ↔ server <Code>{row.minServer}</Code> — {rich(row.notes)}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[13px] leading-[1.65] text-[#8C8070]">
                A version mismatch disables features <em>with a visible message and a restart action</em>, never silent absence.
              </p>
            </Plate>
          </div>
        </Section>

        {/* Install */}
        <Section
          id="install"
          title="Four editors, one server."
          lead="All four integrations run the same server against the same index; they differ only in how the editor is told to launch it."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {F.integrations.map((integration) => (
              <Plate pad key={integration.id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <Plug className="h-4 w-4 text-[#E2553B]" />
                    <p className="font-mono text-[14.5px] font-semibold text-[#F1E9DD]">{integration.name}</p>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-[#8C8070]">{integration.kind}</span>
                </div>
                <p className="mt-3 text-[13px] leading-[1.65] text-[#C2B5A2]">
                  Languages: <span className="text-[#F1E9DD]">{integration.languages.join(', ')}</span>
                </p>
                <p className="mt-2 text-[12.5px] leading-[1.65] text-[#9A8F7D]">{rich(integration.launch)}</p>
                <pre className="mt-3 overflow-x-auto rounded-lg border border-[rgba(241,233,221,0.1)] bg-[#100C08] px-4 py-3 font-mono text-[12px] leading-relaxed text-[#D9CDBC]">
                  {integration.install}
                </pre>
                <Mono>{integration.configFile}</Mono>
              </Plate>
            ))}
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <Callout tone="safe">
              <p>
                <strong className="font-medium text-[#F1E9DD]">Install the built extension today:</strong>{' '}
                <Code>{F.publishing.installCommand}</Code> from a built checkout. The published artifact is identical to the
                packaged one.
              </p>
              <p>
                First run, in a throwaway profile (never over your daily driver): <Code>{F.publishing.freshProfileCommand}</Code>
              </p>
            </Callout>
            <Callout>
              <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#8C8070]">Settings</p>
              <ul className="mt-2 space-y-1.5">
                {ext.settings.map((setting) => (
                  <li key={setting.key} className="text-[12.5px] leading-[1.6] text-[#C2B5A2]">
                    <Code>{setting.key}</Code> <span className="text-[#8C8070]">default</span> <Code>{setting.default || '(empty)'}</Code>
                    <span className="text-[#8C8070]"> — {setting.meaning}</span>
                  </li>
                ))}
              </ul>
            </Callout>
          </div>
        </Section>

        {/* Publishing + limits */}
        <Section
          id="publishing"
          title="Built and installable — not on a marketplace."
          lead="The packaging pipeline runs on every release and its evidence is committed. Publishing to the registry is blocked, and this page says so instead of linking to a listing that does not exist."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Callout tone="warn">
              <p>
                <strong className="font-medium text-[#F5A18C]">Not published:</strong> {humanize(F.publishing.reason)}
              </p>
              <p>
                Extension <Code>{F.publishing.extensionVersion}</Code> · artifact <Mono>{artifactName(F.publishing.artifactPath)}</Mono> ·
                target registry <Mono>{F.publishing.targetRegistry}</Mono>
              </p>
              <p>
                The publish command that will run once credentials exist: <Code>{F.publishing.publishCommand}</Code>
              </p>
              <p>
                Recorded state: <Mono>{recordName(F.publishing.recordPath)}</Mono> (mode {F.publishing.blocked ? 'blocked' : 'live'} — a live
                listing appears here only after that record flips).
              </p>
            </Callout>
            <Plate pad>
              <Label>Declared limitations</Label>
              <ul className="mt-3 space-y-2">
                {F.limitations.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-[13px] leading-[1.65] text-[#C2B5A2]">
                    <span aria-hidden className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-[#E2553B]" />
                    <span>{rich(item)}</span>
                  </li>
                ))}
              </ul>
            </Plate>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-[rgba(241,233,221,0.09)] pt-6">
            <Link href="/docs#how-the-index-works" className="inline-flex items-center gap-2 font-medium text-[#F5A18C] transition-colors hover:text-[#FFB09A]">
              How the index works <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link href="/languages" className="inline-flex items-center gap-2 font-medium text-[#F5A18C] transition-colors hover:text-[#FFB09A]">
              <Boxes className="h-3.5 w-3.5" /> Languages &amp; analyzers
            </Link>
            <Link href="/tools" className="inline-flex items-center gap-2 font-medium text-[#F5A18C] transition-colors hover:text-[#FFB09A]">
              <Code2 className="h-3.5 w-3.5" /> Agent tools
            </Link>
            <Link href="/docs" className="inline-flex items-center gap-2 font-medium text-[#F5A18C] transition-colors hover:text-[#FFB09A]">
              <BookOpen className="h-3.5 w-3.5" /> Guide
            </Link>
            <p className="meta-mono text-[12.5px] text-[#9A8F7D]">
              <Terminal className="mr-1.5 inline h-3.5 w-3.5" /> everything on this page is generated from the editor
              claim record — claims, versions and hashes included.
            </p>
          </div>
        </Section>
      </div>
    </AtlasPage>
  )
}
