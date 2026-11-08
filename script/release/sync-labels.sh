#!/usr/bin/env bash
# script/release/sync-labels.sh — create/update the repository's label taxonomy.
#
#   script/release/sync-labels.sh [owner/repo]
#
# Source of truth:
#   - .github/labels.yml                  the 34 taxonomy labels (type/*, area/*, claim/*,
#                                         workflow, platform/*, priority/*)
#   - src/ast/engine.ts SUPPORTED_LANGUAGES  the lang:<name> labels, one per analyzer
#
# Every label is created OR updated with `gh label create --force`, so the script is
# idempotent: run it again after adding a language and only the new label is created.
#
# Requirements: gh authenticated with permission to manage repository labels
# (`gh auth status`); node to parse the two sources.
#
# Preview without touching the repo:  DRY_RUN=1 script/release/sync-labels.sh owner/repo

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LABELS_FILE="${REPO_ROOT}/.github/labels.yml"
ENGINE_FILE="${REPO_ROOT}/src/ast/engine.ts"

command -v gh >/dev/null 2>&1 || {
    echo "sync-labels.sh: gh (GitHub CLI) is not on PATH — install it from https://cli.github.com" >&2
    exit 1
}
command -v node >/dev/null 2>&1 || {
    echo "sync-labels.sh: node is not on PATH — it parses labels.yml and src/ast/engine.ts" >&2
    exit 1
}
[ -f "$LABELS_FILE" ] || { echo "sync-labels.sh: missing $LABELS_FILE" >&2; exit 1; }
[ -f "$ENGINE_FILE" ] || { echo "sync-labels.sh: missing $ENGINE_FILE" >&2; exit 1; }

REPO="${1:-${GH_REPO:-}}"
if [ -z "$REPO" ]; then
    REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)" || {
        echo "sync-labels.sh: no repo given and none detectable from the current directory." >&2
        echo "               Usage: script/release/sync-labels.sh owner/repo" >&2
        exit 1
    }
fi

echo "Syncing labels to ${REPO} (from ${LABELS_FILE} + SUPPORTED_LANGUAGES)…"

# Emit "<name>\t<color>\t<description>" lines for the taxonomy labels.
read_taxonomy() {
    LABELS_FILE="$LABELS_FILE" node <<'NODE'
const fs = require("fs")
const text = fs.readFileSync(process.env.LABELS_FILE, "utf8")
const unquote = (v) => v.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1")
const labels = []
let cur = null
for (const raw of text.split("\n")) {
  const line = raw.trim()
  if (!line || line.startsWith("#") || line === "labels:") continue
  const name = line.match(/^-\s+name:\s*(.+)$/)
  if (name) {
    if (cur) labels.push(cur)
    cur = { name: unquote(name[1]), color: "", description: "" }
    continue
  }
  if (!cur) continue
  const color = line.match(/^color:\s*(.+)$/)
  if (color) { cur.color = unquote(color[1]); continue }
  const description = line.match(/^description:\s*(.+)$/)
  if (description) { cur.description = unquote(description[1]) }
}
if (cur) labels.push(cur)
for (const label of labels) {
  if (!/^[0-9a-f]{6}$/i.test(label.color)) {
    console.error(`sync-labels.sh: label ${label.name} has malformed color "${label.color}"`)
    process.exit(1)
  }
  if (label.description.length > 100) {
    console.error(`sync-labels.sh: label ${label.name} description is ${label.description.length} chars (max 100)`)
    process.exit(1)
  }
  console.log(`${label.name}\t${label.color}\t${label.description}`)
}
NODE
}

# Emit "<name>\t<color>\t<description>" lines for lang:<language> labels, parsed from
# the SUPPORTED_LANGUAGES map in src/ast/engine.ts — the same map the analyzers use.
read_languages() {
    ENGINE_FILE="$ENGINE_FILE" node <<'NODE'
const fs = require("fs")
const src = fs.readFileSync(process.env.ENGINE_FILE, "utf8")
const start = src.indexOf("const SUPPORTED_LANGUAGES = {")
if (start < 0) {
  console.error("sync-labels.sh: could not find `const SUPPORTED_LANGUAGES = {` in src/ast/engine.ts")
  process.exit(1)
}
const open = src.indexOf("{", start)
let depth = 0
let end = -1
for (let i = open; i < src.length; i++) {
  if (src[i] === "{") depth++
  else if (src[i] === "}") { depth--; if (depth === 0) { end = i; break } }
}
if (end < 0) {
  console.error("sync-labels.sh: unbalanced braces after SUPPORTED_LANGUAGES in src/ast/engine.ts")
  process.exit(1)
}
const body = src.slice(open + 1, end)
const names = [...body.matchAll(/^\s+"?([a-z][a-z0-9-]*)"?:\s*"/gm)].map((m) => m[1])
const unique = [...new Set(names)].sort()
if (unique.length === 0) {
  console.error("sync-labels.sh: parsed zero languages from SUPPORTED_LANGUAGES — refusing to sync an empty language set")
  process.exit(1)
}
for (const name of unique) {
  const description = `Language: ${name} (analyzer issue)`.slice(0, 100)
  console.log(`lang:${name}\t8250df\t${description}`)
}
NODE
}

DRY_RUN="${DRY_RUN:-0}"
TOTAL=0

create_label() {
    local name="$1" color="$2" description="$3"
    if [ "$DRY_RUN" = "1" ]; then
        printf '  would sync: %-24s #%s  %s\n' "$name" "$color" "$description"
    else
        gh label create "$name" --repo "$REPO" --color "$color" --description "$description" --force >/dev/null
        printf '  synced: %s\n' "$name"
    fi
    TOTAL=$((TOTAL + 1))
}

while IFS=$'\t' read -r NAME COLOR DESCRIPTION; do
    [ -n "$NAME" ] || continue
    create_label "$NAME" "$COLOR" "$DESCRIPTION"
done < <(read_taxonomy)

TAXONOMY_COUNT="$TOTAL"

while IFS=$'\t' read -r NAME COLOR DESCRIPTION; do
    [ -n "$NAME" ] || continue
    create_label "$NAME" "$COLOR" "$DESCRIPTION"
done < <(read_languages)

LANGUAGE_COUNT=$((TOTAL - TAXONOMY_COUNT))

if [ "$DRY_RUN" = "1" ]; then
    echo "Dry run: ${TAXONOMY_COUNT} taxonomy labels + ${LANGUAGE_COUNT} language labels = ${TOTAL} labels; nothing was changed."
else
    echo "Done: ${TAXONOMY_COUNT} taxonomy labels + ${LANGUAGE_COUNT} language labels = ${TOTAL} labels synced to ${REPO}."
fi
