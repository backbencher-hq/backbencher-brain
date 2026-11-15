package demo

import scala.annotation.tailrec

class Annotated {
  @tailrec
  def loop(i: Int): Int = if (i == 0) 0 else loop(i - 1)

  @Deprecated
  def oldApi(): Unit = ()

  // Traps for the old text.includes heuristic: none of these identifiers
  // may fabricate a pattern flag.
  def hasTestString(s: String): Boolean = s.contains("Test")
  def mymain(s: String): String = s.substring(1)
  def specializedWord(s: String): String = s.trim
}
