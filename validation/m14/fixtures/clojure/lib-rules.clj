;; CLJ-D21/D21b/D22/D23/D25/D6/D7/D8/D9 — the ns-clause and declaration surfaces.
;;
;;   D5  `(:use [lib :only (names)])` — `:only` is `:refer`'s legacy twin and
;;       its name list is a LIST, not a vector. 16 sites in the clojure corpus
;;       alone (`clojure.java.javadoc`, `clojure.java.shell`, `clojure.pprint`,
;;       …) registered no refer name, so every call to one dangled.
;;   D6  `(declare a b)` interns a var. It is a core form, so the form
;;       produced no symbol and no edge, and the names it introduces were not
;;       in-file declarations — 68 sites (mutual recursion in the compiler, in
;;       clj-kondo's compojure fixture, in core.async's dispatch). Every later
;;       call to a declared name had nothing to resolve to.
;;   D7  a second `(ns …)` in one file (45 sites: clj-kondo's corpus/ dialect
;;       files, test files that switch namespace) reset the alias table but not
;;       the refer table, so a call after the second `ns` could resolve against
;;       the FIRST namespace's `:refer`.
;;   D8  `:rename {old new}` is a referred name under a new spelling — the
;;       declared F17 limitation, now measured (7 sites in clj-kondo) and closed.
;;   D9  `(s/def ::kw …)` publishes the spec under the literal `::kw`; the
;;       reader qualifies `::` against the namespace, so the real name is
;;       `:current-ns/kw`.
(ns clj.fixture.librules
  (:require [clj.fixture.legacy :only (browse-up format-node)]
            [clj.fixture.renamed :as rn :rename {rewrite-text retype}]
            [clj.fixture.specs :as sp]))

(declare
  collect-rows
  normalize-rows)

(defn collect-rows [t] (t :rows))
(defn normalize-rows [rows] (rows))

(defn- mutually-recursive [n]
  (if (zero? n) n (mutually-recursive (dec n))))

(defn uses-only [url]
  (browse-up url)
  (format-node url))

(defn uses-rename [s]
  (retype s)
  (rewrite-text s))

(defn collect-then-call [t]
  (normalize-rows (collect-rows t)))

(defn spec-name [] sp/parse-long)
