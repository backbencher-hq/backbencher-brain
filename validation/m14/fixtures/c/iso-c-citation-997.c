/* c/iso-c-citation-997 — D7 CLAIMED: the ISO-C CITATION (`metadata.languageNamespace`).
 *
 * D7 rule (§18.1 b): a CLAIMED wall needs a claim kind that the ARBITER can verify/refute from evidence it
 * already has, an OWN column (`extOK`, never merged into `resolved`), refuted claims = failure, and positive
 * AND negative fixtures. The Lead landed the citation mechanism as the existing namespace claim kind
 * (`metadata.languageNamespace`); the C lane emits it for the `iso-c-stdlib-name` class with roots copied as
 * a SUBSET of the committed vocabulary `ISO_C_STDLIB` (id "iso-c-stdlib", script/m14/citations.ts). The edge
 * cites exactly its target (`languageNamespace: [target]`), which is a valid subset and reviewable in place.
 *
 * THIS FIXTURE PINS BOTH DIRECTIONS:
 *   POSITIVES — a listed ISO-C name not declared in this file gets the citation
 *               (`strlen`, `malloc`, `memcpy`).
 *   NEGATIVES — (a) a SAME-FILE DECLARATION of a listed name (`free`) must stay UNCITED: the claim can
 *                   never excuse a name the project itself declares, and it must not be able to;
 *               (b) an UNLISTED library name (`strlcpy`, BSD not ISO) must stay UNCITED — the vocabulary is
 *                   the authority and a lane may not invent names into a citation;
 *               (c) a non-listed third-party function (`PyObject_Call`) likewise stays uncited.
 * The call edges themselves are unchanged by the citation (the claim is metadata on the same edge); the
 * fixture pins the EDGE for every row and the CITATION (or its absence) via meta.languageNamespace.
 */

int c997_listed_strlen(void) {
  return (int) strlen ("x");
}

void *c997_listed_malloc(void) {
  return malloc (8);
}

void c997_listed_memcpy(void *d, const void *s) {
  memcpy (d, s, 1);
}

/* NEGATIVE (a): this file DECLARES `free`; the call below must not be cited. */
static int free(int x) {
  return x;
}

int c997_samefile_free(void) {
  return free (1);
}

/* NEGATIVE (b): a BSD library name, not in the ISO-C vocabulary. */
int c997_unlisted_library(void) {
  return strlcpy (0, 0, 0);
}

/* NEGATIVE (c): a third-party name outside the vocabulary. */
int c997_third_party(void) {
  return PyObject_Call (0);
}
