export function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg className={`arrow ${className}`} viewBox="0 0 12 12" aria-hidden="true" fill="none">
      <path d="M2.5 9.5 9.5 2.5M4 2.4h5.6v5.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
