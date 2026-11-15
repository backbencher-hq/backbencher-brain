class Vis {
  public val pub = 1
  private val priv = 2
  protected def prot(): Int = priv

  def plain(): Int = pub
}

private object Hidden
