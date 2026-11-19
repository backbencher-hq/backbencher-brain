# RED evidence — phase 1 probes (HEAD 75448b029, bb 0.1.6, 2026-11-18)
# Probe: .tools/triage-fix/go-imports/probe-phase1.ts via BB_DATA_DIR; two-file Go package + package-main file.
# (a) GO1 cross-file value read: NO row naming 'callback' (declared in sibling callbacks.go); only same-file 'Registry' row exists.
# (b) package-main attribution: 'calls' source bound to main.go:main:1 kind=module, NOT function main:3.
