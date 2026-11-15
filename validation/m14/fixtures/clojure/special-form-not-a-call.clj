(ns clj.fixture.special-forms)

;; CLJ-D41 — A SPECIAL FORM IS NOT A CALL, EVEN WHEN THE FILE REDEFINES IT.
;;
;; clojure/core.clj:4748 is `(defmacro fn …)`: core.clj redefines `fn` as a
;; bootstrap macro. So the CLJ-D39 shadow rule — a local definition wins over the
;; core list — says every `(fn …)` below that line is a call to the file's own
;; var, and it published 212 such edges. All 212 are wrong. `fn` is a special
;; form; a file defining it does not turn it into a var, and the compiler still
;; reads the head as a form. The check has to come BEFORE the shadow rule, not
;; after it.

(defmacro fn [& body] `(fn* ~@body))

;; Neither of these is a call. `fn` builds an anonymous function and `loop`
;; binds; both are heads the compiler handles and neither names a var.
(defn anon [] (fn [x] x))
(defn looped [] (loop [i 0] (if (< i 3) (recur (inc i)) i)))

;; NOT a special form: a name that merely STARTS WITH "fn" is an ordinary var,
;; and the check is on the whole head, not a prefix.
(defn fnan? [x] (nil? x))
(defn call-fnan? [x] (fnan? x))
