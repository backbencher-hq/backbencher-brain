class Repo {
  def load(x: Int): Int = {
    if (x < 0) throw new IllegalArgumentException("negative: " + x)
    if (x == 0) throw ex
    x
  }
  val ex = new IllegalArgumentException("cached")
}
