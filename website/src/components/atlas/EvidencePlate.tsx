const TIERS = [
  { name: "Structural", body: "Stored directly, from the declaration: containment, inheritance, implementation." },
  { name: "Import-based", body: "Followed through an import or export edge the indexer recorded." },
  { name: "Usage-contextual", body: "Resolved from a call, instantiation or usage site the analyzer saw." },
  { name: "Reference-qualified", body: "A qualified reference resolved to one definition — the closest, strongest evidence." },
  { name: "Inferred", body: "Derived at query time, always declared, never dressed as stored." },
]

export function EvidencePlate() {
  return (
    <section className="plate-3" id="evidence">
      <div className="container">
        <div className="ev-head">
          <h2 className="ink">Every claim states how it is <i>known.</i></h2>
          <p>
            Each stored relationship is classified once, at the moment it is stored. The
            classification is part of the answer: colour is a label, never decoration — and every
            tier is also named in text wherever it appears.
          </p>
        </div>
        <div className="spectrum">
          {TIERS.map((tier) => (
            <div className="tier" key={tier.name}>
              <div className="bar" />
              <h3>{tier.name}</h3>
              <p>{tier.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
