(ns clj.fixture.casecomment)

;; CLJ-D36 — the `case` CONSTANT POSITION parity is computed over EXECUTABLE
;; CHILDREN ONLY.
;;
;; A `comment` node is a named child, so one comment inside a `case` shifts every
;; later index by one — and then a BODY lands on an even index and is skipped as
;; if it were an unevaluated constant, taking every relationship inside it with
;; it. metabase/dev/src/dev/kondo_ratchet.clj:343 is the proof: its `case` has
;; TEN named children because of one `;;` comment at index 6, so the body at
;; index 8 — `(do (when … (.charAt sb (inc i)) …))` — was dropped, and the `uses`
;; edges at 348-349 vanished from the graph.
;;
;; Two edges in one file is a small loss. The rule is wrong for every `case` in
;; every corpus that has a comment in one, and it was invisible because the
;; differential mirror had the IDENTICAL bug: both sides agreed on a body that
;; neither one walked. Two wrong implementations of one rule is not a check.

(defn with-comment [k sb i]
  (case k
    :a 1
    ;; this comment shifts every later child index by one
    :b (helper-b sb i)
    :c (helper-c sb i)
    (helper-default sb i)))

;; The same shape with no comment, to show the parity itself is unchanged.
(defn without-comment [k sb i]
  (case k
    :a 1
    :b (helper-b sb i)
    :c (helper-c sb i)
    (helper-default sb i)))

;; A LIST-shaped default is an EXPRESSION, never a constant group, and is never
;; skipped even though it lands on an even index (W23).
(defn list-default [k sb i]
  (case k
    :a (helper-default sb i)))

;; A list in a genuine CONSTANT position is still a group of unevaluated
;; constants and is still skipped (F7) — the fix narrowed the parity, it did not
;; remove it.
(defn constant-group [k]
  (case k
    (a b c) (helper-group k)
    :z (helper-z k)))
