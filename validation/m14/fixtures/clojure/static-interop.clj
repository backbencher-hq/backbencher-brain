(ns clj.fixture.staticinterop)

;; CLJ-D32 — STATIC interop `Class/.member` is a MEMBER ACCESS, not a call to a
;; function named `Class/.member`.
;;
;; It used to fall through to the generic-call branch and produce
;; `f -[calls]-> String/.toUpperCase`: an edge whose target is not a symbol in
;; the file, is not an export, and is in no `contains` — a dangling
;; relationship, the one thing the "all extracted, resolved and emitted" contract
;; exists to prevent. Invisible to F5 by construction: the `calls` truth derives
;; calls, the analyzer emitted a call, and the two agreed perfectly on an edge
;; that pointed at nothing. 23 real sites in clojure's own test suite.
;;
;; TWO edges, because the static form carries one fact the instance form does
;; not: WHICH CLASS. `(.method obj)` gets the class from its receiver;
;; `String/.toUpperCase` names it in the head.
(defn static-call [s]
  (String/.toUpperCase s))

(defn static-with-args [s n]
  (Integer/.parseInt s n))

;; A qualified class in the head resolves fully, and both edges are emitted.
(defn static-qualified [f]
  (java.io.File./getName f))

;; NOT static interop: a bare `/` qualifies a NAMESPACE, so these stay ordinary
;; calls and must not gain `uses` edges.
(defn namespaced-call [s]
  (str/join "," s))

;; Nor is the instance form: `(.method obj)` gets the class from its receiver, so
;; it emits one `uses` edge and no class edge — which is exactly what makes the
;; static form's second edge meaningful.
(defn instance-call [s]
  (.toUpperCase s))

;; `Class.` with a TRAILING dot is a constructor, which is an `instantiates`
;; edge — a third shape, and the one the static form must not be confused with.
(defn ctor [] (java.io.File. "x"))
