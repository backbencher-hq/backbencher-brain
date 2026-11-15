object MacroShape {
  def target(): Int = 1
  def MacroCaller(): Int = summon(target)
}
