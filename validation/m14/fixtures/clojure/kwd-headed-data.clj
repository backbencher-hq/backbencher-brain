(ns clj.fixture.kwddata
  (:require [clojure.string :as s]))

(defn use-alias [] (s/join "," []))

(defn data-form [] (:ns (meta var)))

(defn still-resolves [] (s/join ";" []))
