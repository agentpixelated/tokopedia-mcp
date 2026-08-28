# Tokopedia MCP

Evidence-first Tokopedia product research for MCP clients.

This project is a clean-room reimplementation focused on **shopping decisions**, not merely mirroring marketplace pages. It treats the parent product card and the concrete purchasable SKU as different entities, returns machine-readable output, records provenance/freshness, flags contradictions, and ranks only normalized SKU candidates.

## Why this approach

The previous MCP was useful for discovery but created avoidable ambiguity:

- headline prices could belong to a different/default variant;
- large Markdown blobs were truncated and hard to compose;
- title, description, condition, RAM, storage, and selected SKU could disagree;
- there was no first-class shortlist workflow or transparent rejection trail;
- successful HTTP responses were sometimes treated as sufficient evidence even when extraction was partial.

This implementation makes uncertainty explicit instead of silently choosing one field as “truth.”

## Tools

| Tool | Purpose |
|---|---|
| `search_products` | Listing-level discovery with numeric prices, pagination, canonical URLs, filters, and live provenance |
| `inspect_product` | One fetch that separates parent listing metadata from every concrete SKU and runs contradiction analysis |
| `analyze_listing` | Deterministically re-analyze an inspection snapshot without another network request |
| `build_shortlist` | Apply hard constraints, SKU-level deduplication, transparent scoring, risk penalties, and retained rejection reasons |
| `hunt_products` | Bounded end-to-end discovery, listing deduplication, SKU expansion, constraint filtering, and ranking |

All tools are read-only and return both MCP `structuredContent` and a JSON text fallback.

## Data model principles

1. **Listing ≠ SKU.** Search results are discovery leads. A listing is not ranked as a deal until its concrete SKU price, stock, and options are inspected.
2. **Evidence stays attached.** Contradiction findings carry the conflicting fields, not just a warning label.
3. **Unknown is not zero.** Missing stock and missing ratings remain explicit unknowns where applicable.
4. **Freshness is visible.** Live network responses include retrieval timestamps and source/operation metadata.
5. **No physical-condition fiction.** Marketplace evidence cannot verify battery health, panel defects, hinges, stylus inclusion, or the shipped unit. The tool emits seller-verification questions for those boundaries.
6. **Ranking is reproducible.** Hard constraints run before scoring; duplicate keys are `productId:skuId`; rejected candidates are retained with reasons.

## Install and run

```bash
npm install
npm run check
npm run test:live
npm run build
node build/index.js
```

Example Hermes MCP configuration:

```json
{
  "mcpServers": {
    "tokopedia": {
      "command": "node",
      "args": ["/absolute/path/to/tokopedia-mcp/build/index.js"]
    }
  }
}
```

## Recommended hunt flow

1. For the standard path, call `hunt_products` with relevant model queries and hard criteria.
2. For manual control, call `search_products` and then `inspect_product` on plausible listings.
3. Convert each buyable inspected SKU into a `HuntCandidate`, enriching seller transaction/review fields when available.
4. Call `build_shortlist` with hard budget/spec constraints.
5. Ask the generated verification questions in Tokopedia chat before checkout.
6. Re-inspect immediately before purchasing because price, stock, and campaigns can change.

## Development

```bash
npm test          # deterministic offline tests
npm run typecheck
npm run build
npm run check     # all offline gates
npm run test:live # live Tokopedia search + product-page extraction
```

CI runs offline verification on Node 20, 22, and 24. Live drift checks run weekly and manually so marketplace availability does not make pull requests flaky.

## Scope and ethics

- Public, unauthenticated discovery data only.
- No login, cart, checkout, messaging, or purchasing actions.
- Bounded retries and conservative request volume.
- Tokopedia may change public page/cache or GraphQL shapes without notice; weekly live checks detect drift.

## Current limits

- Seller statistics and reviews are not yet folded directly into `inspect_product`; `build_shortlist` accepts normalized evidence for them. `hunt_products` therefore reports seller transaction history as unknown rather than mislabeling product sales.
- Attribute extraction is intentionally conservative. Conflicts are surfaced rather than guessed away.
- This is an initial evidence-first core, not a one-for-one recreation of every legacy browsing tool.

## License

MIT. The historical upstream implementation was also MIT licensed; see `LICENSE`.
