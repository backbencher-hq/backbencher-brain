namespace Ns {
  public class Unrelated { }
  public class Base { public virtual string M() => ""; }
  public class Derived : Unrelated, Base { public override string M() => ""; }
}
