# nearswaps checkout

Accept a payment from any wallet on any chain with one script tag. The buyer pays with the coin and chain they already hold; NEAR Intents (1Click) settles it; the merchant receives exactly the invoiced amount in the asset and on the chain they chose.

> README stub (sessions 1 and 2, 9 Nov 2026). The merchant docs page, the demo shop and the verifier are in; the real payment output and the hackathon section come next. Nothing below is a recorded output yet.

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

It is public and read-only, and answers the status (`SUCCESS` when delivered), the recipient, the destination asset and the amount delivered. Check all three against your order, and accept each deposit address for one order only.

Or, with Node 18 or later and no packages:

```
node verify-payment.mjs <depositAddress> --to shop.near --amount 25 --asset usdc
```

It prints one fact per line (status, kind, quote type, recipient, destination asset, invoiced, delivered) and exits 0 when paid, 1 otherwise. `--label "Order 1042"` checks the label too; `--api <url>` points it at another copy of the API (the local one is `http://127.0.0.1:8787/api`). The full merchant guide is `web/docs/accept-payments.html`, on the site at nearswaps.com/learn/accept-payments.html.

## Try the demo shop

`demo/shop.html` is a small shop with three products (1, 2 and 5 USDC) and the real tag, paying `tome.near`. When the pay page reports a payment, a "Paid" banner shows the deposit address, a link to its status call and the verifier command.

- **Locally, nothing real:** `npm run serve`, then open http://127.0.0.1:8788/demo-shop. The local server serves the same file with its tags pointed at the local pay page and a mocked backend, so every quote, address and payment there is made up. Add `--site <path to the nearswaps site folder>` for the site's fonts and colours on the pay page and the docs page (http://127.0.0.1:8787/docs/accept-payments.html).
- **On nearswaps.com:** the sync copies it to nearswaps.com/demo-shop (also /demo-shop.html). There the buttons pay `tome.near` for real, and the page says so. You can see the quote and the deposit address without sending anything.

Open it over http or https: a page opened from disk has no origin, so the pay page cannot send it the "paid" message.

## How a payment works

1. The button opens `/pay?to=&amount=&asset=&label=&ref=<your page's origin>`.
2. The pay page shows the invoice (who is paid, the amount, the label, and your page's origin once the browser vouches for it) and a "Pay with" list: BTC, ETH, SOL, ZEC, USDC and USDT on their chains, plus NEAR, USDC and USDT on NEAR, each with a dry quote.
3. The buyer enters a refund address on the chain they pay from (or connects a NEAR wallet to pay from NEAR) and gets a one-time deposit address from 1Click, with the exact amount, a QR code, an "Open in wallet" link where the chain has one, and a 30-minute deadline. The page checks the address with 1Click directly before showing it.
   With a browser wallet on Ethereum, Base, Arbitrum or Solana (MetaMask, Rabby, Phantom, Solflare and others, found by EIP-6963 and Wallet Standard) it is one click: "Pay with Phantom" takes the refund address from the wallet, gets the deposit address and sends exactly that amount to it with one confirmation (an ETH value or an ERC-20 `transfer` on EVM; on Solana a transfer the server builds and the page reads byte by byte before the wallet signs). Cancelled or failed, the deposit card stays with "Try again" to the same address; a quote older than 60 seconds is asked again first. "Pay by hand instead" and Bitcoin, Zcash and Tron keep the copy and QR path.
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
| `web/docs/accept-payments.html` | the merchant docs page, in the nearswaps learn-page style, as the README and the local server show it. **On nearswaps.com it is `/learn/accept-payments.html`**, which the site generates itself from its own content file (the sync never overwrites that copy) |
| `demo/shop.html`, `demo/assets/demo-shop.js` | the demo shop: three products, the real tag, a "Paid" banner from the `nearswaps:paid` event. On nearswaps.com: `/demo-shop.html` and `/assets/demo-shop.js` (a file, because the site's Content-Security-Policy runs no inline script) |
| `verify-payment.mjs` | the payment verifier: Node 18 or later, no packages, exit code 0 when paid |
| `tests/fixtures/status/` | status answers for the verifier's tests (pending, success, refunded, wrong recipient, short amount), in the shape of the backend contract; not recorded from the live site |
| `tools/serve-local.mjs` | a local copy with a mocked backend: `npm run serve`, then open http://127.0.0.1:8787/pay?to=shop.near&amount=25, the test shop at http://127.0.0.1:8788/ and the demo shop at http://127.0.0.1:8788/demo-shop. Add `&wallets=mock` to a pay link (or start it with `--mock-wallets`) for a mocked Phantom and MetaMask that ask with the browser's confirm box |
| `tools/mock-soltx.mjs` | the unsigned Solana transfer the mock's `soltx` answers, in the site builder's layout (the tests check it rebuilds `tests/fixtures/soltx.json`, made by the site's own builder, byte for byte) |
| `tools/sync-to-site.mjs` | copies into the nearswaps site folder: `pay.html`, `assets/pay.js`, `assets/pay.css`, `assets/pay-qr.js` (from `web/assets/vendor/qr.js`) and `assets/pay-qr-LICENSE.txt`, `checkout.js`, `learn/accept-payments.html` (from `web/docs/`), `demo-shop.html` and `assets/demo-shop.js` (from `demo/`), and the `/pay` and `/demo-shop` lines in `_redirects`; nothing else, never into `assets/vendor/`, and never an HTML file with an inline script |
| `tests/` | `npm test` (Node, no packages); `tests/browser` (Playwright at 1440 and 390 px, against the mock) |

The pay page uses nearswaps' shared files (brand tokens, fonts, coin icons, the NEAR wallet selector). Run the local copy with `--site <path to the nearswaps site folder>` to serve those too; without them the page still works with fallback colours.

## Licence

MIT, see `LICENSE`.
