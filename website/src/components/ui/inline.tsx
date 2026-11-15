import type { ReactNode } from "react"

// Inline text primitives (M56.D2). These were declared inside the editors page;
// they are the site's inline vocabulary — a mono kicker, inline code, a dim mono
// span — and are now shared so every surface renders them identically.

export function Label({ children }: { children: ReactNode }) {
  return <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8C8070]">{children}</p>
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[12.5px] text-[#F59E8A]">{children}</code>
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[11.5px] text-[#8F8472]">{children}</span>
}
