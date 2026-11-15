(ns clj.fixture.containswowner)

;; CLJ-D33 — WHICH SYMBOL a `contains` edge points at is DETERMINISTIC, and it is
;; the DEFINITION.
;;
;; It used to be "whichever the walk pushed first", and push order is not source
;; order: a protocol's methods are symbolized when the protocol is met, so a name
;; with two symbols could land on the later declaration. 667 edges across the
;; three corpora were affected.
;;
;; A definition always displaces a NON-definition. Two things announce a name
;; without defining it:

;; A FORWARD DECLARATION. clojure/core/reducers.clj and gen_math.clj both do
;; `(declare HEADER)` then `(def ^String HEADER …)`, and the edge pointed at the
;; declare — claiming the namespace defines the var where it only PROMISES to.
;; The forward-declaration SYMBOL is still published (the graph needs a node for
;; the call target, and `declare` skips core names entirely); only the EDGE moves.
(declare promised-later)

(def promised-later
  "The real definition."
  42)

;; A SPEC ANNOTATION. `(s/fdef my-inc …)` annotates a var; `(defn my-inc [x] …)`
;; defines it. Same shape as the forward declaration, same consequence: the edge
;; pointed at the spec.
(s/fdef spec-first :args (clojure.core/cat :x integer?))

(defn spec-first [x] (+ 1 x))

;; The ordinary single-declaration case is unchanged.
(defn plain-definition [x] x)

;; A name declared TWICE with no forward declaration anywhere: the EARLIEST
;; declaration wins, read off source order rather than push order.
(defn dup-name [x] x)
(defn dup-name* [x] x)
