;; CLJ-D53 — `imports`: `require` / `use` / `import` / `require-macros` are the
;; ONLY way Clojure states a dependency, so the `imports` relationship and the
;; libspec are the same fact.
;;
;; The endpoint set is deliberately identical to the `references` edge already
;; emitted at each of these sites: `imports` asserts a DECLARATION and
;; `references` asserts a RESOLUTION, and emitting them from one site is what
;; stops the two labels drifting onto different graphs — the defect CLJ-D49/50
;; record for `references` when a shared alias table started leaking one
;; derivation into the other.
;;
;; `refer-clojure` is included because it names clojure.core's own surface, which
;; IS a statement about another namespace.
(ns clj.fixture.imports
  (:require [clojure.string :as str]
            [clojure.set :refer [union]]
            [clojure.walk :as walk])
  (:require-macros [clojure.core.match :refer [matcher]])
  (:use [clojure.zip :only [zipfile]])
  (:import (java.util Date UUID)
           [java.io File]))

(require '[clojure.java.io :as jio])

(use '[clojure.edn :as edn])

(import 'clojure.lang.ExceptionInfo)

(import (java.util.concurrent TimeUnit))

(defn read-it [f]
  (str/join (edn/read-string (slurp (jio/file f)))))

(defn stamp [] (Date.))

(defn uuid-now [] (UUID/randomUUID))