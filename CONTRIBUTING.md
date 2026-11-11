# Contributing

Issues and pull requests are welcome. Please open an issue first for anything that changes what the pay page asks a
wallet to sign, what it checks before showing a deposit address, or the shape of the `nearswaps:paid` event.

## Tests

```bash
npm test
```

Node 18 or later, no packages, no network: the pay page's pure half (`web/assets/pay.js`), the wallet code with mocked
EIP-6963 and Wallet Standard wallets, the Solana transfer check against a transaction from the site's own builder,
the loader, the sync, the verifier against status fixtures and the first real payment's status answer, and the wording
rules below. A change to the quote checks, the wallet send, the Solana check, the opener-origin rule or the verifier
needs a test that fails without it.

`npm run test:browser` runs the Playwright specs in `tests/browser` at 1440 and 390 px against the local mock. It
needs `npm install` and `npx playwright install chromium` first; the Node tests are what gate a change.

## The local copy

```bash
npm run serve
```

`tools/serve-local.mjs` serves the pay page on http://127.0.0.1:8787 with a mocked backend and mocked 1Click (every
quote, address and payment is made up), a test shop on http://127.0.0.1:8788/ and the demo shop on
http://127.0.0.1:8788/demo-shop.

- Add `&wallets=mock` to a pay link, e.g. http://127.0.0.1:8787/pay?to=shop.near&amount=1&wallets=mock, for a mocked
  Phantom and MetaMask that ask with the browser's confirm box; start with `--mock-wallets` to give every `/pay`
  (and so the shops' buttons) the mocks.
- `--site <path to the nearswaps site folder>` serves the site's fonts, colours, coin icons and NEAR wallet selector
  too, and the docs page at http://127.0.0.1:8787/docs/accept-payments.html. Without it the page uses fallback colours.
- Open the shops over http, not from disk: a page opened from disk has no origin, so the pay page cannot send it the
  "paid" message.

The in-app browsers of some editors turn `window.open` into a same-tab navigation; the opener handshake and the
"paid" message are covered by the Node tests and the Playwright spec.

## Wording

The pay page, the docs, the README and these files keep one vocabulary: "pay", "invoice", "deposit address", "refund
address", "delivered", "verify". The fee is "included in the quote", never hidden. Amounts, addresses and hashes are
in a mono font on the pages and in backticks in Markdown. Never invent an amount, a hash or a date: the README and
`docs/runs/` quote real outputs only.

<!-- wording-rules: the test skips this block, which names the words it refuses elsewhere -->
`tests/sync.test.mjs` fails on any of these in the repository's own files: an em dash (use a colon, a comma or two
sentences), an emoji, and the words "safe", "secure", "verified", "audited", "guaranteed" and "instant" in the pay
page, the loader, the docs page, the demo shop, the verifier, the README, SECURITY.md, this file and the diagram. A
payment page should promise what it checks, not how it feels.
<!-- /wording-rules -->

## What stays out

No runtime libraries: the pay page and the loader are plain files, and the QR encoder is bundled by
`tools/build-qr.mjs` from MIT packages with their licences. No inline scripts in any HTML file (the site's
Content-Security-Policy would not run them, and the sync refuses them). `tools/sync-to-site.mjs` writes only the files
its list names and never into the site's `assets/vendor/`.
