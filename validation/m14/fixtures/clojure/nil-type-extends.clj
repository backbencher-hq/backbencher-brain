;; CLJ-D59 — `nil` IS A TYPE in `extend-protocol`, and it parses as `nil_lit`.
;;
;; The reader walked back from a method implementation looking for a `sym_lit`.
;; `(extend-protocol P nil (m [_] …))` puts a `nil_lit` where the reader wanted a
;; symbol, so the walk skipped it and landed on the PROTOCOL head. Everything
;; downstream was then attributed to the protocol it implements:
;;
;;   * `overrides P.m -> P.m` — a self-edge, published 8 times over the 633-file
;;     corpus (core/protocols.clj x3, core/reducers.clj, data.clj, java/io.clj x2,
;;     clj-kondo/corpus/defprotocol.clj) and 4.30% of the type. The lane's own
;;     ontology ruling calls that shape inexpressible: "a self-loop carrying no
;;     information, which the differential's own `push` refuses for any
;;     `calls`-only label".
;;   * the method SYMBOL's container: `coll-reduce` was published with
;;     `ownerName: clojure.core.CollReduce`, colliding with the protocol's own
;;     declaration of that name and folded into it by the CLJ-D33 dedupe — so
;;     the `contains` edge for `nil`'s implementation never existed either.
;;   * the type-level `implements nil -> P` edge was absent from every file that
;;     wrote it, for the same reason: the loop required a `sym_lit`.
;;
;; `(satisfies? P nil)` is true, so `nil` is a real dispatch target and the edges
;; are facts about the source rather than inventions. It is also NOT a var this
;; file interns, so the `nil` endpoints do not resolve to a symbol — which is the
;; same position `String` and `java.util.Date` are already in, and is declared in
;; the analyzer doc as a limitation class rather than papered over.
(ns clj.fixture.nil-type)

(defprotocol P
  (m [this]))

(defprotocol Q
  (n [this]))

;; 1. the shape the defect was found on: `nil` first.
(extend-protocol P
  nil
  (m [_] 1))

;; 2. `nil` AFTER a real type — the walk must stop at `nil`, not run on to the
;;    protocol head, whichever order the groups appear in.
(extend-protocol Q
  String
  (n [s] 2)
  nil
  (n [_] 3))

;; 3. the control: an ordinary symbol type keeps its own owner, so a regression
;;    that made EVERY group read as `nil` would be caught here.
(extend-protocol P
  java.util.Date
  (m [d] 4))
;; 4. a DECORATED type name — the decoration is not part of the name, so this is
;;    `java.util.Date`'s sibling `Tagged` and not `^{:doc "x"}Tagged`.
(deftype ^{:doc "decorated"} Tagged [n]
  Q
  (n [_] 5))
