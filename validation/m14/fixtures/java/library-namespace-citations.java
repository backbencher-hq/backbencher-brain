package com.acme.cite;

import androidx.media3.common.C;
import com.google.common.base.Preconditions;
import jakarta.persistence.Entity;
import jakarta.servlet.Filter;
import jakarta.servlet.http.*;
import org.yaml.snakeyaml.Yaml;

/**
 * LIBRARY-NAMESPACE CITATIONS (Lead ruling 2026-10-19, vocabulary `java-platform-libraries`
 * in `script/m14/citations.ts`). A target whose LEADING SEGMENTS name a registry root is claimed
 * through the arbiter's `namespace` channel — a CITATION counted in extOK with
 * `verifiedBy: "namespace"`, never in resolved. The declared list must be a SUBSET of the
 * registry: an undeclared root REFUTES, so the negatives are as important as the positives.
 *
 * POSITIVE: `jakarta`, `androidx` and `org.yaml` module paths are cited.
 * NEGATIVE: `com.google.*` is NOT in the registry — it must carry no namespace claim.
 * POSITIVE (bare symbol): `Filter` is imported by SINGLE-TYPE import from `jakarta.servlet`, so
 * the file states where the bare name comes from; the claim's declared root is then the TARGET
 * itself (namespaceMatchOf's bare-symbol form), which is only sound because the import path's
 * root is in the registry.
 * POSITIVE (bare symbols): `Entity` and `Filter` are imported by SINGLE-TYPE imports from
 * `jakarta`, so each bare name is cited with the TARGET itself (namespaceMatchOf's bare-symbol
 * form).
 * NEGATIVE: a bare name whose import root is NOT in the registry (`Preconditions` from
 * com.google.common.base) carries no namespace claim; a bare name reached only through a
 * WILDCARD import (`HttpServletRequest` under `jakarta.servlet.http.*`) also carries none — the
 * file does not state which library type a wildcard brings in. No claim may name an undeclared
 * root (the arbiter REFUTES one; the gate selfTest pins that polarity).
 */
public class LibraryNamespaceCitations {
  Entity entity;
  Filter filter;
  HttpServletRequest servletRequest;
  Yaml yaml;
  int index = C.INDEX;

  void googleCase() {
    Preconditions.checkNotNull(entity);
  }
}
