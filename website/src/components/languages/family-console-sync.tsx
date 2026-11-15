"use client"

import { useEffect } from "react"

// Fragment selection for the languages console.
//
// WHY THIS EXISTS
// ---------------
// Panels are shown by `:has(.lang-tab-N:checked)` and `:target`, and there is no
// URL that selects one by itself. A reader who arrived from a shared
// `/languages#elixir` link, or who copied the address bar after picking a family,
// got a page that silently showed whichever radio happened to be first. This is
// the piece that makes the console linkable:
//
//   · on load and on every hashchange, a hash naming a family checks its radio;
//   · when the reader picks a family, the hash is rewritten to that family's
//     slug, so the view they are looking at is the URL they can share.
//
// It is deliberately tiny and deliberately optional. Nothing here is required to
// read the console: the radios are plain HTML and every panel is in the built
// page, so with scripting disabled the console behaves exactly as it always did.
// The `:target` rules in ./family-data already reveal a deep-linked panel on
// their own; this only moves the checkbox so the two agree.
//
// The slug list arrives as a prop rather than importing the dataset, so the icon
// set and the language table stay on the server.

export function FamilyConsoleSync({ slugs }: { slugs: string[] }) {
  // A stable dependency: the array is rebuilt on every server render, and this
  // effect binds DOM listeners, so it must not re-run each time.
  const key = slugs.join("|")

  useEffect(() => {
    if (typeof window === "undefined" || !key) return
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
    const inputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name="lang-family"]'),
    )
    if (inputs.length === 0) return

    // The very first sync is a deep-link landing: the browser has already
    // scrolled to the :target panel, so revealing it again would fight the
    // browser's own anchor handling. Every change after that is the reader's.
    let landing = true

    const reveal = (input: HTMLInputElement) => {
      const slug = input.value
      if (!slug) return

      const panel = document.getElementById(slug)
      if (panel) {
        const box = panel.getBoundingClientRect()
        if (box.bottom < 0 || box.top > window.innerHeight) {
          panel.scrollIntoView({
            behavior: reduced.matches ? "auto" : "smooth",
            block: "start",
          })
        }
      }

      // Keep the selected row inside the rail's own scroll box without letting
      // the browser scroll the document behind it.
      const rail = input.closest<HTMLElement>(".console-index")
      const row = input.closest<HTMLElement>("label")
      if (rail && row && rail.scrollHeight > rail.clientHeight + 4) {
        const railBox = rail.getBoundingClientRect()
        const rowBox = row.getBoundingClientRect()
        if (rowBox.top < railBox.top) rail.scrollTop -= railBox.top - rowBox.top + 10
        else if (rowBox.bottom > railBox.bottom) rail.scrollTop += rowBox.bottom - railBox.bottom + 10
      }
    }

    const onChange = (event: Event) => {
      const input = event.target as HTMLInputElement
      if (!input.value) return
      const next = `#${input.value}`
      if (window.location.hash !== next) {
        // replaceState, not push: walking the families with the rail should not
        // fill the back button with 45 near-identical entries.
        window.history.replaceState(null, "", next)
      }
      if (!landing) reveal(input)
    }

    const sync = () => {
      const hash = window.location.hash
      if (!hash) return
      const match = inputs.find((input) => input.value && `#${input.value}` === hash)
      if (match && !match.checked) match.click()
    }

    for (const input of inputs) input.addEventListener("change", onChange)
    window.addEventListener("hashchange", sync)
    sync()
    landing = false

    return () => {
      for (const input of inputs) input.removeEventListener("change", onChange)
      window.removeEventListener("hashchange", sync)
    }
  }, [key])

  return null
}
