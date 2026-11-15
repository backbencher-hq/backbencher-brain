(ns clj.fixture.docblocks)

(def a 1) ;; trailing on a

;; separated header

(defn b [] a)

; single semicolon
(defn c [] a)

;; proper block
(defn d [] a)
