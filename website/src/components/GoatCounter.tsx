"use client"

// GoatCounter analytics — cookieless, no personal data (matches the site's
// privacy story). bbstats.goatcounter.com is the site code created for
// backbencher.cc in the owner's GoatCounter account.
//
// Counting contract (no double counts, no lost navigations):
//   - The count.js script auto-counts the INITIAL pageview when it loads.
//   - This component counts only SUBSEQUENT client-side navigations
//     (Next.js App Router doesn't reload the page, so the script alone
//     would miss every route change after the first).
//   - If the script hasn't loaded yet when a navigation happens (slow
//     network, or an adblocker that eventually gives up), the count is
//     retried a bounded number of times and then abandoned silently.

import Script from "next/script"
import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"

const GC_ENDPOINT = "https://bbstats.goatcounter.com/count"
const MAX_RETRIES = 10
const RETRY_MS = 250

type GoatCounterApi = { count: (opts: { path: string; title: string }) => void }

export function GoatCounter() {
  const pathname = usePathname()
  const firstRender = useRef(true)

  useEffect(() => {
    // The script's own auto-count covers the initial load; counting here too
    // would record every visit twice.
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    let tries = 0
    const count = () => {
      const api = (window as unknown as { goatcounter?: GoatCounterApi }).goatcounter
      if (api?.count) {
        api.count({ path: pathname, title: document.title })
      } else if (tries++ < MAX_RETRIES) {
        window.setTimeout(count, RETRY_MS)
      }
      // else: script blocked/unavailable — give up quietly.
    }
    count()
  }, [pathname])

  return (
    <Script
      data-goatcounter={GC_ENDPOINT}
      src="https://gc.zgo.at/count.js"
      strategy="afterInteractive"
    />
  )
}
