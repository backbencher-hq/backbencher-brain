namespace Ns {
  public class Unrelated { }
  public class A { public virtual string M() => ""; }
  public class B { public virtual string M(int x) => ""; }
  public class C : Unrelated, A { public override string M(int x) => ""; }
}
