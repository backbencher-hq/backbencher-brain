;; CLJ-D57 (R7) — a def-family form with NO NAME defines nothing.
;;
;; `(s/defn)` in clj-kondo's `corpus/schema/defs.clj` published a symbol literally
;; called `unknown`, a `contains` edge into it, and (from CLJ-D53) an `exports`
;; edge into it: a placeholder LITERAL in a name-bearing field and at two edge
;; endpoints, which is the standing rule R7. CLJ-D35 ruled the same way for
;; `(s/fdef 1 :args)` — whose argument is a literal rather than an absence.
;;
;; The forms here are the whole family: each is a def head whose name argument is
;; missing, is a literal, or is a literal collection. None of them names a var, so
;; none of them may publish a symbol, a `contains` edge or an `exports` edge.
(ns clj.fixture.placeholder-def)

;; A def macro invoked with no arguments at all.
(s/defn)

;; The core family, same shape.
(defn)

(defmacro)

(defrecord)

(deftype)

(defprotocol)

(defmulti)

;; A LITERAL in name position — `namedChild(1)` is a number, not a symbol.
(s/fdef 1 :args)

(s/def 2 :string?)

;; And the control: a form that DOES name something still declares it, or the
;; sweep would be indistinguishable from "drop every def".
(defn real-fn [x] x)