# The checkout API

The pay page talks to one endpoint of the nearswaps backend, `https://nearswaps.com/api/intents`, which asks NEAR
Intents (1Click) on its behalf. The backend is part of the nearswaps site and is not in this repository; this page is
its contract for checkout, as written when the `checkout` action was added (9 Nov 2026, live on nearswaps.com since
11 Nov 2026). CORS `*`. Bodies at most 4096 bytes. All amounts are integer strings in base units.

## POST checkout

Request:

```json
{
  "action": "checkout",
  "dry": true,
  "originAsset": "nep141:eth.omft.near",
  "destinationAsset": "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  "amount": "25000000",
  "recipient": "shop.near",
  "refundTo": "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
  "label": "Order 1042"
}
```

- `dry`: anything but `false` is a dry quote (no deposit address, nothing stored, not rate limited). `false` opens a
  deposit address, stores it and counts against the caps below.
- `originAsset` (what the buyer pays with): NEAR, USDC or USDT on NEAR (`nep141:wrap.near`,
  `nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`, `nep141:usdt.tether-token.near`), or any
  pay-in coin of `GET ?tokens=1` whose `chain` is not `near` (BTC, ETH on Ethereum, Base and Arbitrum, SOL, ZEC, USDC
  on Ethereum, Solana, Base and Arbitrum, USDT on Ethereum, Tron and Solana). Anything else: 400.
- `destinationAsset` (what the merchant receives), a fixed list:

  | asset id | merchant gets | `recipient` must be |
  |---|---|---|
  | `nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` | USDC on NEAR (6 decimals) | NEAR account or 64-hex implicit |
  | `nep141:usdt.tether-token.near` | USDT on NEAR (6) | NEAR account or 64-hex implicit |
  | `nep141:wrap.near` | NEAR (24) | NEAR account or 64-hex implicit |
  | `nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near` | USDC on Base (6) | `0x` + 40 hex |
  | `nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near` | USDC on Solana (6) | base58, 32 to 44 chars |
  | `nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near` | USDC on Arbitrum (6) | `0x` + 40 hex |
  | `nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near` | USDC on Ethereum (6) | `0x` + 40 hex |

- `amount`: the merchant's amount in the destination asset's base units (25 USDC is `"25000000"`),
  `^[1-9][0-9]{0,38}$`. At most 5,000 USD at 1Click's price (checked with 1Click's token price before asking, and with
  the quote's `amountOutUsd` after). The minimum is 1Click's (see the error below).
- `refundTo`: the buyer's address on the origin chain (same patterns as `recipient`, per chain: Bitcoin bc1, 1 or 3;
  Zcash t1, t3 or u1; Tron T...; EVM 0x; Solana base58; a NEAR account). Required for dry quotes too: the pay page
  uses an ordinary example wallet per chain for previews (1Click refuses burn and program addresses).
- `label`: optional, at most 80 characters, no control or format characters (Unicode category C). Stored and echoed;
  not sent to 1Click, not signed by 1Click. Escape it when you render it.
- Ignored if sent: `appFeeBps`, `slippageTolerance`, `swapType`, `deadline`, anything else.

What the server sends to 1Click: `swapType: "EXACT_OUTPUT"`, `slippageTolerance: 100` (input side only),
`depositType: "ORIGIN_CHAIN"`, `recipientType: "DESTINATION_CHAIN"`, `refundType: "ORIGIN_CHAIN"`, a deadline 30
minutes away, the site's referral, the nearswaps app fee of 50 bps (no discounts), `quoteWaitingTimeMs: 2000`. The
1Click signature on the answer is checked as for every quote.

Response 200 (dry):

```json
{
  "kind": "checkout",
  "dry": true,
  "correlationId": "04708ba4-22d3-4f42-a24f-38cf9772967d",
  "signature": "ed25519:2wRw9P876NJqCDRDGK5rbj95mu3M4AzpqJEFaLK4i6QakoifP4QdqYzTiQEMN3hKHeddiKTK4ANzR31aFoS9i2ke",
  "timestamp": "2026-11-09T20:58:49.149Z",
  "quote": {
    "amountIn": "11914211299611062",
    "amountInFormatted": "0.011914211299611062",
    "amountInUsd": "25.365951567437",
    "minAmountIn": "11795069186614951",
    "amountOut": "25000000",
    "amountOutFormatted": "25.0",
    "amountOutUsd": "24.986425000000",
    "minAmountOut": "25000000",
    "timeEstimate": 45,
    "refundFee": "35000000000000",
    "withdrawFee": "0"
  },
  "appFeeBps": 50,
  "originAsset": "nep141:eth.omft.near",
  "destinationAsset": "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  "amount": "25000000",
  "recipient": "shop.near",
  "refundTo": "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
  "label": "Order 1042",
  "deadline": "2026-11-09T21:28:49.030Z"
}
```

(The quote is a real dry quote of 9 Nov 2026, 25 USDC on NEAR paid with ETH; the outer fields are what the backend
adds.) A live quote (`"dry": false`) is the same with `"dry": false` and three more quote fields from 1Click:
`quote.depositAddress` (on the origin chain: a 64-hex implicit account for NEAR-origin payments, else an address of
that chain), `quote.deadline` and `quote.timeWhenInactive`.

What the pay page shows: send `quote.amountIn` (`amountInFormatted`) to `quote.depositAddress` before `deadline`.
`amountIn` carries a 1% buffer over `minAmountIn`; 1Click returns what the route does not use to `refundTo`. A deposit
under `minAmountIn` is refunded after the deadline. `quote.amountOut` and `minAmountOut` always equal `amount` (the
backend refuses any other answer with 502). The fee (`appFeeBps`, 0.5%) is inside `amountIn`.

Errors: `{ "error": "<sentence>" }` with 400 (bad input), 429 (`"This address asked for 20 live quotes today..."`, or
the per-caller limit `"Too many requests. Try again in a minute."` with `Retry-After: 60`), 503 (the site-wide hourly
budget), 502 (1Click's answer refused) or 504 (1Click did not answer). Below 1Click's minimum:

```json
{ "error": "Below the smallest payment for this route: at least 0.149983 USDC", "minAmount": "149983" }
```

with status 400; `minAmount` is in the destination asset's base units.

Caps (live quotes only): 20 live quotes per refund address per UTC day (shared with the site's swap and bridge
quotes), 120 live quotes an hour site-wide, 30 writes a minute per caller.

After a live quote:
- Paid from NEAR (NEAR, USDC or USDT on NEAR): the buyer's wallet sends, then `POST { action: "submit",
  depositAddress, txHash, wallet: <refundTo> }`, as the site's bridge does.
- Paid from Solana: `POST { action: "soltx", depositAddress, from }` returns the unsigned transfer of exactly
  `amountIn`. The pay page reads it byte by byte before the wallet sees it (see [SECURITY.md](../SECURITY.md)).
- Any other chain: no submit (it is refused for these records); 1Click watches the address and `status` follows.

## GET status

`GET /api/intents?status=<depositAddress>` (public, read-only, no-store). For a checkout quoted here, the real answer
for the first payment (11 Nov 2026, [runs/01-first-payment-status.json](runs/01-first-payment-status.json)):

```json
{
  "status": "SUCCESS",
  "updatedAt": "2026-11-11T11:02:56.000Z",
  "swapDetails": {
    "amountOut": "2000000",
    "amountOutFormatted": "2.0",
    "amountOutUsd": "1.999204000000",
    "refundedAmountFormatted": "0.0103",
    "refundReason": null,
    "destinationChainTxHashes": [
      { "hash": "GvHFEnPF2CuXzuvEozrbFUWrXeCXwZiy9ZzAp25FcMga", "explorerUrl": "" },
      { "hash": "31CYDg9YSh6BPUz5fer8XEqqh7qF8WjvmGYsJacncs9PgSZR1oDwYn2wmKWWYs9UdwzxVEmTtAQq9MRjMDFuc1eh", "explorerUrl": "" }
    ],
    "nearTxHashes": [
      "4HZNTLBktfGeX4d8k4vs5XwLczkCLi168ex6qNJQXdJG",
      "8M56J1LnXRyjjqEwnaRzf2bZh4cY5q57qc7wbn6ovcT3",
      "CBtVe2LSo2wsaA2AuYvJ6ewNZnA6LaphpmokRGteaYHq",
      "GvHFEnPF2CuXzuvEozrbFUWrXeCXwZiy9ZzAp25FcMga"
    ]
  },
  "kind": "checkout",
  "label": "Demo shop: coffee",
  "recipient": "tome.near",
  "destinationAsset": "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  "amount": "2000000",
  "swapType": "EXACT_OUTPUT"
}
```

`status` is 1Click's: `PENDING_DEPOSIT`, `KNOWN_DEPOSIT_TX`, `INCOMPLETE_DEPOSIT`, `PROCESSING`, `SUCCESS`, `REFUNDED`,
`FAILED`. `recipient`, `destinationAsset`, `amount` and `swapType` come from 1Click's own status answer (its echoed
quote request) and fall back to the stored request. Any other deposit address (an ordinary swap, or one not quoted
here) answers `status`, `updatedAt` and `swapDetails` only.

The merchant's check before shipping: `status === "SUCCESS"`, `kind === "checkout"`, `swapType === "EXACT_OUTPUT"`,
`recipient`, `destinationAsset` and `amount` equal to the invoice, and `swapDetails.amountOut` at least `amount`.
`verify-payment.mjs` makes exactly these checks.

## Minimums seen in dry quotes on 9 Nov 2026

1Click's minimums, which move with fees and prices:

| paid with | merchant receives | smallest accepted |
|---|---|---|
| USDC on Base | USDC on NEAR | 0.149983 USDC |
| USDC on Base | USDT on NEAR | 0.150114 USDT |
| USDC on Base | NEAR | 0.0414 NEAR |
| USDC on Base | USDC on Solana | 0.139988 USDC |
| USDC on Base | USDC on Arbitrum | 0.149983 USDC |
| ETH, SOL, wNEAR | USDC on NEAR or Base | 0.1 USDC quoted |
| BTC | USDC on NEAR | 6.206565 USDC |

USDC on Ethereum as the payout quotes from 1 USDC, but the buyer pays about 0.32 USDC more for Ethereum's withdrawal
(1 USDC cost 1.32, 20 USDC cost 20.61). Time estimates: 20 to 50 s after the deposit confirms, Bitcoin about 13 minutes
(805 s); with the 30-minute deadline a slow Bitcoin confirmation means a refund.
