// Curated tool notes cite their evidence by repository path. A reader needs the
// record's identity, not its location in the repo — so the rendered surface
// names the record and the generated data keeps the path. This is display-only:
// the curated text in docs/tools/*.md and the generated data are unchanged, and
// the T1 gate still compares them verbatim.
const RECORDS: Array<[RegExp, string]> = [
  [/validation\/tools\/([a-z_]+)\/LATENCY\.json/g, "the $1 latency record"],
  [/validation\/tools\/([a-z_]+)\/AUDIT\.md/g, "the $1 audit record"],
  [/validation\/tools\/([a-z_]+)\/results\/[A-Za-z0-9._-]+/g, "the $1 verification record"],
  [/validation\/release\/[A-Za-z0-9._-]+/g, "the campaign baseline record"],
  [/validation\/m\d+\/results\/[A-Za-z0-9._-]+/g, "an evidence record"],
  [/validation\/[A-Za-z0-9._/-]+/g, "a recorded run"],
]

export function humanizeEvidence(text: string): string {
  return RECORDS.reduce((result, [pattern, label]) => result.replace(pattern, label), text)
}
