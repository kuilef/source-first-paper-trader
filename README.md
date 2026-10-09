# Source-First Paper Trader

A rule-based research agent that verifies official Kraken listing evidence, then records a virtual trade or an explainable abstention. No funds, wallet, API key, exchange login, or language model.

This checkpoint contains the pure evidence schema, calendar-date policy, exact decimal accounting, and frozen illustrative cases. The live adapter and notebook interface are built in subsequent checkpoints.

## Run

Node.js 24 LTS. `npm ci`, then `npm run test:unit` and `npm run replay -- --case confirmed`.

Replay quotes are synthetic. A positive illustrative outcome is not evidence of historical returns. Dates, publication times, and quote observation times remain separate.

[Design](docs/DESIGN.md) · [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
