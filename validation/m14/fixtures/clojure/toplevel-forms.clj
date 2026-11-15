(ns clj.fixture.toplevel
  (:require [clojure.set :as set])
  (:import [java.time Instant]))

(require '[clojure.string :as s])
(import '(java.util Date))

(defn go [] (s/join "," []))
(defn mk [] (Date.))
