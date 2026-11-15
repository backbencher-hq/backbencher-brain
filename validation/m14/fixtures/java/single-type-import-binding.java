package com.acme.imp;

import java.util.List;
import java.util.Map;
import java.util.Set;
import com.acme.own.Own;

/**
 * THE EXTERNAL SINGLE-TYPE-IMPORT BINDING CLAIM — THE FAIL-CLOSED HALF (java lane, 2026-10-20).
 *
 * THE CLAIM IS A TIE-BREAKER, AND A TIE IS A FACT ABOUT THE PROJECT'S KEY SPACE. The project's
 * key space gives the simple name MORE THAN ONE answer, so the name-keyed resolver ties; inside
 * the file, the import decides it (JLS 6.4.1: a single-type import shadows every other top-level
 * type of that name in another compilation unit of the same package). **A TIE NEEDS THE PROJECT'S
 * KEY SPACE TO EXIST AT ALL** — and a FLAT fixture is a single file, so it has no project.
 *
 * **SO THIS FIXTURE PINS THE FAIL-CLOSED HALF: WITH NO PROJECT KEY SPACE, NO CLAIM AND NO
 * EVIDENCE.** Every import here is a genuine single-type import of an EXTERNAL type
 * (`java.util.List`, `java.util.Map`), and every reference to the bound name is a real reference —
 * but the analyzer may not claim them, because it cannot see whether the project declares the name
 * once (a resolution the claim must not displace) or many times (the tie the claim exists to
 * close). The rule is stated with the project's own key space, and the project is the whole
 * admitted file set of a repository.
 *
 * THE POSITIVE half — the claim, the tie, the externality test and the "do not displace a
 * resolution" refusal — is in the INDEXED fixture next door: `java/singleimportproject/`.
 *
 * THE OTHER REFUSALS THIS FILE ALSO PINS: a name the FILE declares (`static class Set {}` shadows
 * `import java.util.Set;` — JLS 6.4.1) and a PROJECT import (`com.acme.own.Own` is project code
 * and must resolve through the owner/name model).
 */
public class SingleTypeImportBinding {
  List<String> listField;
  Map<String, String> mapField;
  Set<String> setField;
  Own ownField;

  static class Set {}

  void use() {
    List<String> local = null;
    Map<String, String> localMap = null;
  }
}
