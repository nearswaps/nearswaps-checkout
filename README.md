# nearswaps checkout

Accept a payment from any wallet on any chain with one script tag. The buyer pays with the coin and chain they already hold; NEAR Intents (1Click) settles it; the merchant receives exactly the invoiced amount in the asset and on the chain they chose.

> README stub (session 1, 9 Nov 2026). The demo, the real payment output, the docs page and the hackathon section come in the next sessions. Nothing below is a recorded output yet.

## The one tag

```html
<script src="https://nearswaps.com/checkout.js"
        data-to="shop.near" data-amount="25" data-asset="usdc" data-label="Order 1042"></script>
```

That draws a "Pay 25 USDC" button where the tag sits. A click opens `https://nearswaps.com/pay` in a popup (a new tab on phones). No iframe and no stylesheet on your page: the button carries its own inline styles.

| Option | Meaning |
|---|---|
| `data-to` | who is paid: a NEAR account, or an address on the chain of `data-asset` (required) |
| `data-amount` | the invoiced amount, e.g. `25` or `12.50` (required) |
| `data-asset` | `usdc` (USDC on NEAR, the default), `usdt`, `near`, `usdc-base`, `usdc-sol`, `usdc-arb`, `usdc-eth` |
| `data-label` | shown on the invoice, at most 80 characters |
| `data-theme` | `light` for light pages |
| `data-onpaid` | the name of a function on `window` to call when the pay page reports the payment |

From code: `NearswapsCheckout.open({ to, amount, asset, label })`.

When the pay page sees the payment delivered, your page gets a `nearswaps:paid` event (it bubbles to `document`):

```js
document.addEventListener("nearswaps:paid", (e) => {
  // e.detail: { depositAddress, amount, asset, label, to, statusUrl }
});
```

## Verify before you ship

**The event is a convenience. The status call is the proof.** Before you ship anything, ask from your server:

```
GET https://nearswaps.com/api/intents?status=<depositAddress>
```

It is public and read-only, and answers the status (`SUCCESS` when delivered), the recipient, the destination asset and the amount delivered. Check all three against your order.

## How a payment works

1. The button opens `/pay?to=&amount=&asset=&label=&ref=<your page's origin>`.
2. The pay page shows the invoice (who is paid, the amount, the label, and your page's origin once the browser vouches for it) and a "Pay with" list: BTC, ETH, SOL, ZEC, USDC and USDT on their chains, plus NEAR, USDC and USDT on NEAR, each with a dry quote.
3. The buyer enters a refund address on the chain they pay from (or connects a NEAR wallet to pay from NEAR) and gets a one-time deposit address from 1Click, with the exact amount, a QR code, an "Open in wallet" link where the chain has one, and a 30-minute deadline. The page checks the address with 1Click directly before showing it.
4. The page follows the deposit every 5 seconds (waiting, seen, processing, delivered, or refunded / failed). It survives a reload for 24 hours.
5. Delivered: a receipt with the payout transaction, and the `nearswaps:paid` message to your page, posted to your origin only.

The quote is EXACT_OUTPUT: your amount is fixed and the buyer's amount carries the price, nearswaps' fee (included in the quote) and the route.

## What it does not do (v1)

No refunds beyond 1Click's own (a deposit that misses the deadline or can't be filled goes back to the buyer's refund address), no partial payments, no fiat, no webhook (the status endpoint is the webhook), no merchant accounts.

## This repository

| Path | What |
|---|---|
| `web/pay.html`, `web/assets/pay.js`, `web/assets/pay.css` | the pay page served at nearswaps.com/pay |
| `web/assets/vendor/qr.js` | the QR encoder: the MIT `qrcode` package's core and `dijkstrajs`, bundled unchanged by `tools/build-qr.mjs` (licences in `qr-LICENSE.txt`). **On nearswaps.com it is `/assets/pay-qr.js`** (with `pay-qr-LICENSE.txt`): the site's `assets/vendor/` folder holds only its own core files, so the sync copies the encoder under that name and points the synced `pay.js` at it |
| `web/checkout.js` | the loader merchants add |
| `tools/serve-local.mjs` | a local copy with a mocked backend: `npm run serve`, then open http://127.0.0.1:8787/pay?to=shop.near&amount=25 and the test shop at http://127.0.0.1:8788/ |
| `tools/sync-to-site.mjs` | copies `web/` into the nearswaps site folder: `pay.html`, `assets/pay.js`, `assets/pay.css`, `assets/pay-qr.js` (from `web/assets/vendor/qr.js`) and `assets/pay-qr-LICENSE.txt`, `checkout.js`, and the `/pay` line in `_redirects`; nothing else, and never into `assets/vendor/` |
| `tests/` | `npm test` (Node, no packages); `tests/browser` (Playwright at 1440 and 390 px, against the mock) |

The pay page uses nearswaps' shared files (brand tokens, fonts, coin icons, the NEAR wallet selector). Run the local copy with `--site <path to the nearswaps site folder>` to serve those too; without them the page still works with fallback colours.

## Licence

MIT, see `LICENSE`.
