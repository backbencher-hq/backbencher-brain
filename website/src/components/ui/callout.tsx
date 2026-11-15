import type { ReactNode } from "react"
import { AlertTriangle, CheckCircle2, Info } from "lucide-react"

// Callout — the shared inline note (M56.D2). Three tones, each meaning
// something specific and none decorative:
//   default · neutral context ("how this works")
//   warn    · a real limitation or a way to lose data
//   safe    · a guarantee the verifier enforces
// `title` renders the icon + heading row; without it the note is a single
// icon-and-text row, so both page idioms (titled notes and bare asides) come
// from one component.
export type CalloutTone = "default" | "warn" | "safe"

export function Callout({
  tone = "default",
  title,
  children,
}: {
  tone?: CalloutTone
  title?: string
  children: ReactNode
}) {
  const cls =
    tone === "warn"
      ? "border-[rgba(226,85,59,0.3)] bg-[rgba(226,85,59,0.06)]"
      : tone === "safe"
        ? "border-[rgba(216,162,74,0.22)] bg-[rgba(216,162,74,0.05)]"
        : "border-[rgba(241,233,221,0.12)] bg-[#16110B]"
  const icon =
    tone === "warn" ? (
      <AlertTriangle className="h-4 w-4 text-[#E2553B]" />
    ) : tone === "safe" ? (
      <CheckCircle2 className="h-4 w-4 text-[#D8A24A]" />
    ) : (
      <Info className="h-4 w-4 text-[#8C8070]" />
    )
  return (
    <div className={`rounded-lg border px-5 py-4 ${cls}`}>
      {title ? <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[#CFC2AE]">{icon}{title}</p> : null}
      <div className={title ? "text-sm leading-6 text-[#C2B5A2]" : "flex items-start gap-2.5 text-[13.5px] leading-[1.7] text-[#C2B5A2]"}>
        {title ? children : (<><span className="mt-[3px] shrink-0">{icon}</span><div className="space-y-2">{children}</div></>)}
      </div>
    </div>
  )
}
