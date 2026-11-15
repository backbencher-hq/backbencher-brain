(ns clj.fixture.sf-vs-macro)

;; CLJ-D44 — A SPECIAL FORM IS NOT A CALL. A MACRO THE FILE DEFINES IS.
;;
;; The truth's special-form list had `loop`, `letfn` and `case` in it. They are
;; MACROS, not special forms; core.clj defines every one of them; and CLJ-D43 says a
;; call to a macro the file defines IS a call. The analyzer was right about all
;; three and the truth was wrong — which is what happens when a language fact is
;; recalled from memory instead of derived, and the reason the two lists are now
;; compared against each other rather than trusted.

(defmacro my-case [e & clauses] `(case ~e ~@clauses))
(defn use-case [x] (my-case x 1 :one))

;; `fn*` and `let` ARE special forms, and both are invisible to the core-list gate:
;; `fn*` is a compiler intrinsic with no public var, and `let` is shadowed in
;; core.clj. Both must be silent even though the file redefines `fn`.
(defn build [] (fn* [x] x))
(defn binds [] (let [y 1] y))

;; `loop` is a macro, and core.clj defines it, so a call to it IS a call — which is
;; the line CLJ-D44 moved. Publishing it is the correct answer, not a regression.
(defmacro loop [& body] `(loop* nil nil nil nil ~@body))
(defn uses-loop [] (loop [i 0] (if (< i 2) (recur (inc i)) i)))
