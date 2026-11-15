package com.acme.imp;

import static java.util.Arrays.asList;
import static java.util.Collections.sort;
import static com.acme.own.ProjectUtil.projectHelper;
import static jakarta.persistence.Persistence.createEntityManagerFactory;

import java.util.List;

/**
 * IMPORTED-BINDING CLAIM for STATIC imports (Lead claim kind, live 2026-10-19).
 *
 * POSITIVE: `import static java.util.Collections.sort;` binds the name `sort`; the unqualified call
 * `sort(xs)` publishes `metadata.importedBinding = {specifier:"java.util.Collections", binding:"sort"}`
 * and the IMPORT edge publishes the evidence the arbiter verifies it against
 * (`metadata.importedBindings: ["sort"]`, `metadata.module: "java.util.Collections"`). extOK stays
 * untouched and `resolved` must NOT move: a file-scoped import binding OCCUPIES the name.
 *
 * NEGATIVES, each a way the claim would be FALSE:
 *  - `import static com.acme.own.ProjectUtil.projectHelper;` — the container is NOT external (JVM
 *    roots + java-platform-libraries only), so the name is project code and must resolve internally;
 *  - a name the FILE declares (`asList`) shadows its static import — the call is the local method;
 *  - a RECEIVER-CARRYING call (`ProjectUtil.projectHelper()`) — its target is a member leaf, not a
 *    bound name (and a receiver call to an EXTERNAL static member is filtered by the lane's builtin
 *    policy before emission, so the receiver branch is exercised with the project container).
 */
public class LibraryImportBinding {
  void positiveSortCase(List<String> xs) {
    sort(xs);
  }

  void positiveJakartaCase() {
    createEntityManagerFactory("unit");
  }

  static void asList(Object... xs) {}

  void shadowedCase(String a) {
    asList(a);
  }

  void projectStaticCase() {
    projectHelper();
  }

  void receiverProjectCase() {
    ProjectUtil.projectHelper();
  }
}
