/** JS pricing module — the cross-language target. */
function basePrice(item) {
  return item.price || 10;
}

function applyDiscount(price, pct) {
  return price - price * (pct / 100);
}
module.exports = { basePrice, applyDiscount };
