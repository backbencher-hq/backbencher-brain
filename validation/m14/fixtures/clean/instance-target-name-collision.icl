// Clean fixture: a TYPE and an INSTANCE for it, and the name they used to share.
//
// `instance == Collision where ...` publishes a CONTAINER for the implementation.
// It used to be named exactly the instance TARGET type, so this file declared
// `Collision` twice — once as the type, once as the implementation — and every
// `references -> Collision` edge in the project became ambiguous. The container is
// now `Collision::instance` with kind `impl`, the naming the Rust lane uses for
// `impl Foo` (`Foo::impl`): the implementation is addressable without asserting
// that its target is declared here. Members keep the NOMINAL owner, so the
// `implements` and `contains` endpoints are unchanged.
implementation module InstanceTargetNameCollision

import StdEnv

:: Collision = CollisionA | CollisionB

instance == Collision where
	(==) CollisionA CollisionA = True
	(==) _ _ = False
