'use client'

import { useState } from 'react'
import { Apple, Terminal, AppWindow, Package, Copy, Check, ArrowRight } from 'lucide-react'
import Link from 'next/link'

// Install-method switcher (M41.D1 revision, republished for the 0.1.0 release).
// The user demand: the install page should feel like modern CLI products — pick
// your platform, copy the command. What gets a tab is what the release ACTUALLY
// serves: npm was omitted while the package was unpublished; it is now the
// published, version-exact artifact, so it is the first tab and the default.
// macOS/Linux (install.sh) and Windows (install.ps1) stay as the alternatives —
// those scripts prefer npm themselves and only fall back to a checksum-verified
// GitHub release binary. Homebrew is still omitted: no formula is published,
// and an install command that cannot succeed violates the honesty contract.
// The tab data is a list, so a future channel is a one-entry change.
//
// SSR: every panel is rendered (hidden via CSS), so the prerendered HTML
// carries all gate-pinned strings and no-JS visitors still see the default.

type Platform = {
  id: string
  label: string
  icon: typeof Terminal
  note: string
  command: string
}

const PLATFORMS: Platform[] = [
  {
    id: 'npm',
    label: 'npm',
    icon: Package,
    note: 'The primary path: the published npm package (Node.js >= 18 required). Version-exact, and the one artifact every release ships.',
    command: 'npm install -g @backbencher/brain',
    },
  {
    id: 'macos',
    label: 'macOS',
    icon: Apple,
    note: 'Shell installer alternative. It prefers npm and only falls back to a checksum-verified GitHub release binary; pin a version with VERSION=0.1.0 in front.',
    command: 'curl -fsSL https://backbencher.cc/install.sh | bash',
    },
  {
    id: 'linux',
    label: 'Linux',
    icon: Terminal,
    note: 'Same shell installer — prefers npm, falls back to a checksum-verified release binary for x86_64 and arm64. Pin with VERSION=0.1.0.',
    command: 'curl -fsSL https://backbencher.cc/install.sh | bash',
    },
  {
    id: 'windows',
    label: 'Windows',
    icon: AppWindow,
    note: 'PowerShell installer alternative for x64 and ARM64. It prefers npm; a release binary lands in %USERPROFILE%\\.local\\bin — pin with $env:VERSION="0.1.0".',
    command: 'irm https://backbencher.cc/install.ps1 | iex',
    },
]

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={copied ? 'Copied' : 'Copy command'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        } catch {
          /* clipboard unavailable (http / permissions) — silently keep the icon */
        }
      }}
      className="copy"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

export function InstallTabs() {
  // npm is the published primary path, so it is the tab a visitor lands on.
  const [active, setActive] = useState('npm')

  return (
    <div className="platform">
      <div role="tablist" aria-label="Installation platform" className="tabs">
        {PLATFORMS.map((p) => {
          const Icon = p.icon
          const selected = active === p.id
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`panel-${p.id}`}
              id={`tab-${p.id}`}
              onClick={() => setActive(p.id)}
              className="tab"
            >
              <Icon className="h-4 w-4" aria-hidden />
              {p.label}
            </button>
          )
        })}
      </div>

      {/* all panels stay in the HTML; hidden ones via [hidden] so no-JS and the
          prerendered output still carry every command verbatim */}
      {PLATFORMS.map((p) => {
        const selected = active === p.id
        return (
          <div role="tabpanel" id={`panel-${p.id}`} aria-labelledby={`tab-${p.id}`} hidden={!selected} className="panel" key={p.id}>
            <p className="note-line">{p.note}</p>

            <div className="cmd">
              <code>
                <span className="prompt">$ </span>
                {p.command}
              </code>
              <CopyButton text={p.command} />
            </div>

          </div>
        )
      })}

      <div className="panel-foot">
        <Link href="/docs#first-index">
          Index your first project <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </div>
  )
}
