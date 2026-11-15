(ns ^{:no-doc true} clj.fixture.typerel
  (:require [clj.fixture.typerel.base
             [protocols :as p]
             [shapes :as shapes]]
            [clojure.string :as string]))

;; CLJ-D48 — THE SOURCE OF A TYPE RELATION IS THE ANALYZER'S `activeFunction`, WHICH
;; IS SET BY FUNCTION FORMS AND NOT BY `def`.
;;
;; `reify` attributes to the ENCLOSING DEFINITION: the analyzer publishes
;; `future-call -> clojure.lang.IDeref` for the `(reify clojure.lang.IDeref …)` at
;; core.clj:7291, nested inside `(defn future-call …)`.
(defprotocol p/Marker (mark [this]))

(defn builds-a-future []
  (reify
    clojure.lang.IDeref
    (deref [_] :v)))

;; …and a `proxy` inside a `def` INITIALISER has no enclosing function at all, so the
;; analyzer falls back to the NAMESPACE: instant.clj:162's
;; `(def ^ThreadLocal thread-local-utc-date-format (proxy [ThreadLocal] [] …))` is
;; published as `clojure.instant -> ThreadLocal`, not as the var it builds.
(def ^java.util.concurrent.Callable builds-a-thread
  (proxy [java.util.concurrent.Callable] []
    (call [_] :ran)))

;; CLJ-D49 — A NAMESPACE'S ALIASES, INCLUDING THE TWO SHAPES THAT ARE NOT PLAIN.
;;
;; The `ns` form carries METADATA between the head and the name, and the `:require`
;; mixes a PREFIX LIST with a plain spec. Both were unread: the metadata made the name
;; come back as `^{:no-doc true} clj.fixture.typerel`, and the prefix list was tested
;; by asking whether its first child was a symbol — which a prefix list ALSO has — so
;; `[p :as ...]`-style nested aliases were silently skipped. Measured: an alias table
;; of size 1 where two aliases existed.
(defrecord tagged [v]
  p/Marker
  (mark [_] :tagged)
  shapes/Shape
  (area [_] 1))

(defn label-it [s] (string/upper-case s))
