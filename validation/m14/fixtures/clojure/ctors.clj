(ns clj.fixture.ctors
  (:require [clj.fixture.recs :as p]))

(defn a [] (->probe.recs.Rec 1))

(defn b [] (probe.recs.Rec. 1))

(defn c [] (new probe.recs.Rec 1))

(defn d [] (->p/Rec 2))

(defn e [] (p/Rec. 3))
