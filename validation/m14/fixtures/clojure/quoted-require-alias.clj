(ns clj.fixture.quoted-require)

;; CLJ-D40 — `(require '[lib :as alias])` REGISTERS THE ALIAS. THE QUOTE IS THE
;; CONVENTION, NOT AN EXCEPTION.
;;
;; The alias timeline read the `ns` form's clauses and nothing else, so every
;; top-level `require` was invisible: `jio` at core.clj:7248, `str/replace` and
;; `ns/find-namespaces-in-dir` were the three surviving misses. Reading only the
;; unquoted `(require [lib :as a])` form finds nothing in real code, because
;; nobody writes that.
(require '[clojure.java.io :as jio])
(require '[clojure.string :as str])

(defn reader [p] (jio/file p))
(defn shout [s] (str/upper-case s))

;; The spec list is a VEC here, not a clause list — a top-level require's
;; children ARE the specs, where an `ns` form's clauses hold them. One reader,
;; two shapes.
(require '[clojure.set :as-set])

;; `:as-alias` takes the alias as a SEPARATE argument, and is the one shape that
;; has no `:as` keyword to read — so it needs the positional case as well.
(require '[clojure.set :as-alias aset])

(defn has-subset? [a b] (aset/subset? b a))
