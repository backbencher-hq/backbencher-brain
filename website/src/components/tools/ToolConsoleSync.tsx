'use client'

import { useEffect } from 'react'

// Progressive enhancement for /tools, and only that.
//
// The console is a radio set driven by :has(). With JavaScript disabled it
// works exactly as it always has: click a row, read the panel. This component
// adds the one thing CSS cannot do — bind a URL fragment to a radio — and it
// adds the reverse direction too, so a reader who has just clicked their way to
// a tool can copy the address bar and send it to somebody.
//
// It can only ever improve selection. Every branch refuses rather than guesses:
// an unrecognised fragment is left alone, a missing radio is left alone, and
// the whole effect is wrapped so that a failure here leaves the page exactly as
// the server rendered it. The deep link still resolves without it, because the
// stylesheet makes the targeted panel visible on its own.

const RADIO_GROUP = 'tool-reference'
const INPUT_PREFIX = 't-'

export function ToolConsoleSync() {
  useEffect(() => {
    try {
      const shell = document.querySelector('.tools-shell')
      if (!shell) return
      const inputs = Array.from(shell.querySelectorAll<HTMLInputElement>(`input[name="${RADIO_GROUP}"]`))
      if (inputs.length === 0) return

      const nameOf = (input: HTMLInputElement): string => input.id.slice(INPUT_PREFIX.length)
      const hashName = (): string => window.location.hash.replace(/^#/, '')
      // Nothing is checked on arrival (see ToolRail), so an unvisited console
      // still has a tool to name: the first one the rail lists.
      const currentInput = (): HTMLInputElement | undefined => inputs.find((input) => input.checked) ?? inputs[0]

      // The index is taller than a laptop viewport and scrolls inside its own
      // column, so a deep link can select a row the reader cannot see. Bring the
      // row into view by moving that column's scrollTop and nothing else —
      // scrollIntoView would also be free to move the document, and the browser
      // has just positioned that on the panel the fragment named.
      const revealRow = (input: HTMLInputElement): void => {
        try {
          const scroller = shell.querySelector<HTMLElement>('[data-rail-scroll]')
          if (!scroller || scroller.scrollHeight <= scroller.clientHeight) return
          const row = input.closest<HTMLElement>('label') ?? input
          const offset = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top
          if (offset < 0) scroller.scrollTop += offset - 8
          else if (offset + row.offsetHeight > scroller.clientHeight) {
            scroller.scrollTop += offset + row.offsetHeight - scroller.clientHeight + 8
          }
        } catch {
          // A row out of sight is still a selected row; nothing to repair.
        }
      }

      // A fragment names a tool; tick its radio so the rail follows.
      const selectFromHash = (): void => {
        const wanted = hashName()
        if (!wanted) return
        const input = inputs.find((candidate) => nameOf(candidate) === wanted)
        if (!input) return
        if (!input.checked) input.click()
        revealRow(input)
      }

      // Selection names itself in the URL, so the visible panel is always the
      // linkable one. replaceState, not a navigation: it must not scroll and
      // must not stack a history entry per click.
      //
      // If the address bar cannot be written the console still works — the
      // stylesheet never lets a fragment outrank the radio — so the failure is
      // contained rather than repaired.
      const writeHash = (): void => {
        const input = currentInput()
        if (!input) return
        const next = `#${nameOf(input)}`
        if (window.location.hash === next) return
        try {
          window.history.replaceState(null, '', next)
        } catch {
          // Left alone on purpose; see above.
        }
      }

      const onChange = (): void => {
        writeHash()
        const input = currentInput()
        if (input) revealRow(input)
      }
      shell.addEventListener('change', onChange)
      window.addEventListener('hashchange', selectFromHash)

      // A visit with no fragment still deserves a URL worth copying.
      if (!hashName()) writeHash()
      // A visit WITH a fragment has to override the first row.
      selectFromHash()

      return () => {
        shell.removeEventListener('change', onChange)
        window.removeEventListener('hashchange', selectFromHash)
      }
    } catch {
      // Nothing to repair: the console is a working radio set without this.
    }
  }, [])

  return null
}
