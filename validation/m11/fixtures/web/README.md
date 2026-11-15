# Order API

The **Order API** manages orders and customers.

## Installation

```bash
npm install
npm run build
```

## Usage

```javascript
import { createOrder } from "./api/orders";

const order = createOrder({ customerId: 42 });
console.log(order.id);
```

## API Reference

### `createOrder(input)`

Creates a new order. See [orders](./docs/orders.md).

| Field       | Type    | Description          |
|-------------|---------|----------------------|
| customerId  | number  | Customer identifier  |
| items       | array   | Line items           |

## Configuration

Set `DB_HOST` and `DB_PORT` in your environment.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Submit a pull request

See [CONTRIBUTING](CONTRIBUTING.md) for details.
