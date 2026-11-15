(ns clj.fixture.specname)

;; CLJ-D35 — A SPEC FORM NAMES A VAR, SO ITS ARGUMENT MUST BE A NAME.
;;
;; `(s/fdef 1 :args)` — a clj-kondo corpus fixture for reader recovery — published
;; a symbol literally called `1`, with a `contains` edge `spec-syntax->1` beside
;; it. A symbol named after a literal is not a var, and nothing can ever resolve
;; it, so it is a placeholder identity in a table whose whole contract is that
;; every name in it is referable.

;; A keyword spec name is auto-resolved by the reader: `::email` really names
;; `:current-ns/email`, and publishing it under the literal `::email` left the
;; spec with no resolvable identity any other file could reference (CLJ-D26).
(s/def ::email :string?)

;; A symbol spec name is used as written.
(s/def plain-spec :int?)

;; Not a name: these must mint NO symbol and NO containment. The var they
;; annotate is defined once, below, and that definition is what the edge names.
(s/fdef target-var :args (clojure.core/cat :x integer?))
(s/fdef 1 :args)
(s/fdef "string-name" :args)

(defn target-var [x] x)
