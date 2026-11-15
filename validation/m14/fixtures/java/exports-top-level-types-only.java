package com.acme.exports;

/**
 * EXPORTS_JAVA2 fixture: an export is a TOP-LEVEL TYPE, never a member.
 *
 * The guard that defines the export set has TWO halves and this fixture exists
 * because dropping either one is a measured defect, not a hypothetical:
 *
 *   `!ownerName` alone        admits every symbol whose owner the scope stack
 *                             lost. Measured over java-lib's 3,275 files: 60
 *                             such symbols, every one a `method_declaration`, in
 *                             2 files. The name dedupe collapses them to 14
 *                             distinct names and the export surface published 14
 *                             METHODS as importable units — caught by the lane's
 *                             oracle at 14 false positives, 0 false negatives.
 *
 *   nodeType alone            admits every NESTED type, because a nested type's
 *                             node type is the same `class_declaration`. Measured
 *                             at 300 corpus files: 479 exports edges against the
 *                             oracle's 294, i.e. +185 nested types published.
 *
 * So the export set is `!ownerName AND a top-level type declaration`, and this
 * fixture pins BOTH directions:
 *
 *   Api           public top-level CLASS        -> exported, 1.0
 *   Api.Nested    a nested class                -> NOT exported; membership is
 *                                                  `contains` (M49 ruling: a
 *                                                  member export cannot identify
 *                                                  its provider)
 *   Api.helper    a top-level METHOD's... no:   -> NOT exported, and
 *                                                  JLS 7.6 makes importability a
 *                                                  property of a type. There is no
 *                                                  `import ...aMethod` in java.
 *   Holder.inner  a nested RECORD               -> NOT exported
 *   Deep          an interface nested in a class-> NOT exported
 */
public class Api {
  /** A member type is not an importable unit — membership rides `contains`. */
  public static class Nested {}

  public void aMethod() {}

  public interface Deep {}
}

public record Holder(int x) {
  public record inner() {}
}

public enum Color { RED, GREEN }

public @interface Marker {}
