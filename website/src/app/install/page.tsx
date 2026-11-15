import Link from "next/link"
import type { Metadata } from "next"
import { TRUTH } from "@/data/truth.generated"
import { AtlasPage, PageHead } from "@/components/atlas/AtlasPage"
import { InstallTabs } from "@/components/InstallTabs"

export const metadata: Metadata = {
  title: "Install",
  description:
    "Install the Backbencher CLI with npm, or with the shell/PowerShell installers on macOS, Linux, or Windows. Local-first code intelligence: your code never leaves your machine.",
  alternates: { canonical: "https://backbencher.cc/install" },
}

// 2026-11-07 — Evidence Atlas surface. The install *claims* come from generated
// truth (TRUTH.install is parsed from the shipped install.sh), so the page cannot
// describe a release the scripts do not serve.
// 2026-11-08 — 0.1.0 is the first published release, so npm is the primary path;
// the curl/irm installers are alternatives that prefer npm themselves.

export default function InstallPage() {
  return (
    <AtlasPage>
      <div className="container">
        <PageHead
          title="Install Backbencher"
          lead={
            <>
              Install the published package with <code>npm install -g @backbencher/brain</code> (Node.js &gt;= 18), or
              use the shell/PowerShell installer if you would rather not manage a global npm package. Everything — the
              index, the analysis, the MCP server — runs locally. Your source code never leaves your machine.
            </>
          }
          meta={TRUTH.install.version ? `installer release ${TRUTH.install.version} · engine ${TRUTH.version}` : `engine ${TRUTH.version}`}
        />

        <div className="reading" style={{ paddingBottom: 0 }}>
          <InstallTabs />

          <h2>Verify the install</h2>
          <pre><code>bb --version</code></pre>
          <p>
            With npm, <code>bb</code> lands in your npm global prefix (<code>npm prefix -g</code>); make sure that
            directory's <code>bin</code> is on your PATH. The installers put it in <code>~/.local/bin</code>{" "}
            (<code>%USERPROFILE%\.local\bin</code> on Windows) when they fall back to a release binary.
          </p>

          <div className="note-plate">
            <h2>What gets installed</h2>
            <p>
              The npm package <code>@backbencher/brain</code>. Unpinned, the installers resolve the newest published
              release at run time — npm <code>@latest</code>, or the latest GitHub release when they fall back to a
              release binary — so installing again is how you move to a newer version, with no site change and no
              installer edit. That fallback only happens when npm is unavailable, and only after the binary&apos;s
              sha256 verifies against the release&apos;s <code>checksums.txt</code>. Pin with <code>VERSION</code> to
              hold an exact release.
            </p>
          </div>

          <h2>Pin or upgrade</h2>
          <p>
            npm installs an exact version when you ask for one; re-run the install to move to a newer release:
          </p>
          <pre><code>{`# current release
npm install -g @backbencher/brain@latest

# pin an exact release
npm install -g @backbencher/brain@${TRUTH.version}`}</code></pre>
          <p>
            The installer scripts accept the same pin through <code>VERSION</code>, and install the same npm package:
          </p>
          <pre><code>{`# current release
curl -fsSL https://backbencher.cc/install.sh | bash

# pin an exact release
VERSION=${TRUTH.version} curl -fsSL https://backbencher.cc/install.sh | bash`}</code></pre>
          <p>
            On Windows: <code>irm https://backbencher.cc/install.ps1 | iex</code>, pinned with{" "}
            <code>$env:VERSION=&quot;{TRUTH.version}&quot;</code>. Upgrading keeps your data: the schema migrates in
            place and the index is never wiped.
          </p>

          <h2>Next steps</h2>
          <ul>
            <li>
              Index a project: <code>bb index</code> — see the <Link href="/docs#first-index">first index guide</Link>.
            </li>
            <li>
              Connect an MCP client: <code>bb mcp</code> — see the <Link href="/docs#mcp">MCP server docs</Link>.
            </li>
            <li>
              Enable semantic search: <code>bb setup</code> — see <Link href="/docs#embeddings">embeddings setup</Link>.
            </li>
          </ul>

          <div className="page-actions">
            <Link className="btn" href="/docs">Read the docs <span aria-hidden>→</span></Link>
            <Link className="btn-ghost" href="/support">Common questions</Link>
          </div>
        </div>
      </div>
    </AtlasPage>
  )
}
