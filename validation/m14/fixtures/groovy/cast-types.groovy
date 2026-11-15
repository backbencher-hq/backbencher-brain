class CastSvc {
  def run(Object o) {
    def s = (String) o
    def t = (List<String>) s
    return t
  }
}
