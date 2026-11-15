'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { FaGithub } from 'react-icons/fa';

// M56.I1 — the final nav set, owner-decided: six items, one per public
// surface. Retired paths (/faq, /contact, /troubleshooting, /demos) never
// appear here — only their canonical destinations do. verify-ia.ts requires
// this list to equal its contract exactly, so a link can't be added silently.
const NAV_LINKS = [
  { href: '/install', label: 'Install' },
  { href: '/docs', label: 'Docs' },
  { href: '/tools', label: 'Tools' },
  { href: '/languages', label: 'Languages' },
  { href: '/editors', label: 'Editors' },
  { href: '/support', label: 'Support' },
];

export function Navigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  // The mobile menu is a conditional render, so an open state would survive a
  // route change and Escape did nothing. Both are keyboard expectations the
  // MENU-ARIA audit (B4 / D-52) named. Escaping closes and returns nothing to
  // focus: the toggle button is still in the header and is the next tab stop.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileMenuOpen]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Every converted Evidence Atlas surface renders the paper AtlasNav itself, so
  // the global fixed dark nav must not appear over it. Prefix matching covers the
  // language detail pages (/languages/<slug>) as well as the top-level surfaces.
  // Adding a route here is the last step of converting it — a route that renders
  // AtlasPage without an entry here would show two navigations, and a route
  // listed here before it is converted would lose its navigation entirely.
  // `/editors` is deliberately absent: it is still the legacy surface.
  const ATLAS_ROUTES = ["/", "/install", "/docs", "/tools", "/languages", "/editors", "/support", "/privacy", "/terms"]
  const onAtlasSurface = ATLAS_ROUTES.some((route) =>
    route === "/" ? pathname === "/" : pathname === route || pathname.startsWith(route + "/"),
  )
  if (onAtlasSurface) return null

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-[rgba(241,233,221,0.08)] bg-[#0E0A07]/85 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Wordmark */}
          <Link href="/" className="flex items-center gap-2.5">
            <span className="font-mono text-lg font-bold tracking-tight text-[#E2553B] leading-none">
              bb
            </span>
            <span className="hidden sm:block h-4 w-px bg-[rgba(241,233,221,0.16)]" />
            <span className="hidden sm:block text-[15px] font-medium tracking-tight text-[#F1E9DD]">
              backbencher
            </span>
          </Link>

          {/* Desktop nav */}
          <nav aria-label="Primary" className="hidden md:flex items-center gap-7">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={pathname === link.href ? 'page' : undefined}
                className={`text-[13.5px] transition-colors ${
                  pathname === link.href
                    ? 'text-[#F1E9DD]'
                    : 'text-[#9A8F7D] hover:text-[#D9CDBC]'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Right side */}
          <div className="hidden md:flex items-center gap-5">
            <a
              href="https://github.com/ishaq2321/bb"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              className="text-[#9A8F7D] hover:text-[#F1E9DD] transition-colors"
            >
              <FaGithub className="w-[18px] h-[18px]" />
            </a>
            <Link
              href="/install"
              className="btn-ember px-4 py-2"
            >
              Get started
            </Link>
          </div>

          {/* Mobile menu button */}
          <button
            type="button"
            className="md:hidden p-2 text-[#9A8F7D]"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-menu"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div id="mobile-menu" className="md:hidden py-4 border-t border-[rgba(241,233,221,0.08)]">
            <nav aria-label="Mobile" className="flex flex-col gap-4">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={pathname === link.href ? 'page' : undefined}
                  className={`text-[15px] ${
                    pathname === link.href ? 'text-[#F1E9DD]' : 'text-[#9A8F7D]'
                  }`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
              <div className="pt-3 border-t border-[rgba(241,233,221,0.08)] flex gap-3 items-center">
                <Link href="/install" onClick={() => setMobileMenuOpen(false)}>
                  <span className="btn-ember px-4 py-2 text-sm">Get started</span>
                </Link>
                <a
                  href="https://github.com/ishaq2321/bb"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="GitHub"
                  className="p-2 text-[#9A8F7D]"
                >
                  <FaGithub className="w-5 h-5" />
                </a>
              </div>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
