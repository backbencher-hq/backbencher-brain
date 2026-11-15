package app;

import jakarta.servlet.Filter;

/**
 * NEGATIVE half: the FILE declares a type with the imported name, so the bare name is a
 * PROJECT reference (a member type shadows the single-type import, JLS 6.4.1) and the
 * bare-symbol citation must NOT be attached. The DOTTED import row is still a genuine
 * library dependency and keeps its prefix citation — the two facts are independent.
 *
 * (The project-owns-FQN negative — a registry-rooted FQN the project itself declares — needs a
 * fixture index whose file paths mirror package directories; the fixture runner indexes one
 * flat sub-directory, so that half is measured on the whole-population arm where the 87
 * over-claimed pairs were found, and is recorded as a stated gap in JAVA-DEPTH-D7.md §C2.)
 */
public class ShadowedName {
  static class Filter {}

  Filter localFilter;
}
