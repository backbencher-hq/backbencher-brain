namespace Ns {
  public class Root { public virtual string M() => ""; }
  public class Mid : Root { }
  public class Leaf : Mid { public override string M() => ""; }
}
