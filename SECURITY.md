# Security

nearswaps checkout moves real money between strangers: a merchant who wrote one script tag and a buyer who opened a
popup. This page says what the pay page checks, what the merchant must check, and how to tell us about a problem.

## What the pay page checks before a wallet is asked to sign

A wallet is only ever asked for two things: its address, and **one transfer of the quoted amount to the quote's
deposit address**. Nothing else is signed from the pay page.

Before a deposit address is shown or sent to (the wallet path and the by-hand path are the same up to here):

1. **The backend's answer fits what was asked** (`checkLiveQuote` in `web/assets/pay.js`): a live quote, not a dry
   one; the amount for the merchant equal to the invoice; a positive amount to send; a deposit address of the right
   shape for the chain paid from; no deposit memo.
2. **1Click confirms it directly.** The page asks 1Click's own status endpoint for that deposit address, from the
   buyer's browser and not through the nearswaps backend (`confirmCheck`), and compares: the address is waiting for a
   deposit; the same amount to send; the merchant's amount equal to the invoice; the same deadline; the same coins;
   the invoice's recipient; the buyer's refund address; an EXACT_OUTPUT quote with origin-chain deposit and refund and
   destination-chain payout; app fees of at most 1% in total. Any difference and the address is not shown. This is the
   same check the nearswaps bridge makes (review D-2 of 1 Nov 2026), turned around for EXACT_OUTPUT.
3. **The quote is fresh.** A live quote is sent from a wallet within 60 seconds of being asked and not when its deadline
   is less than a minute away; otherwise the page asks again. "Try again" after a cancel re-sends to the same address
   only while that holds.

Then, per chain:

- **Ethereum, Base, Arbitrum** (`evmSend`): the deposit address must be `0x` and 40 hex. The page asks the wallet for
  its network, switches it if needed (adding Base or Arbitrum from fixed settings on error 4902), and checks the
  network again: still on another network, nothing is sent. The transaction is built in the page: ETH as a plain
  value to the deposit address, or USDC and USDT as `transfer(deposit address, amount)` to the token's contract; a
  token row without a known contract sends nothing.
- **Solana** (`solTxCheck`): the unsigned transfer comes from the nearswaps backend (`soltx`) and is decoded in the
  page before the wallet sees it. It must be exactly one transfer of the quoted amount to the deposit address: a
  System transfer for SOL, or for USDC and USDT a `TransferChecked` between this wallet's and the deposit address's
  token accounts of that coin, with at most an idempotent creation of the deposit address's token account first;
  signed by this wallet alone; plus at most the two compute-budget settings, with a priority fee of at most 0.0001
  SOL. Anything else (another instruction, recipient or amount, a second signer, a versioned transaction) is refused
  and nothing is signed. The tests check this against a transfer built by the site's own builder and against altered
  copies.
- **Bitcoin, Zcash, Tron**: no wallet send from the page. The buyer sends by hand to the address shown.
- **NEAR**: the NEAR wallet selector sends one transfer, as on the nearswaps bridge.

The wallet code is ported from the nearswaps swap page with its checks unchanged; a test compares the ported parts with
the swap page's source word for word where that source is present.

## The opener-origin rule

The pay page is opened by a merchant page it does not know. So:

- **The requesting origin is shown in full only when the browser vouches for it**: either `checkout.js` in the
  opener answers the pay page's "hello" (the answer's origin is set by the browser, not by the message), or the
  referrer's origin equals the link's `ref`. Otherwise the invoice says "a page that did not confirm its origin" or
  "a page with no origin". The link's `ref` alone could say anything.
- **The "paid" message is posted to the origin named in the link**, with `postMessage`'s target origin, so if the
  opener is any other page the browser drops it. `checkout.js` accepts messages only from the nearswaps.com origin,
  checks the deposit address's shape and cuts every field to length.
- **The pay page is a popup, never an iframe.** It cannot be framed by a third party, so there is no clickjacking
  surface and no list of allowed parents to keep.
- **No merchant logos.** The invoice shows the recipient address and the origin as text, never an image from the
  merchant. The label is shown as text, never as HTML.

Anyone can make a pay link to any address (there are no merchant accounts in v1). The buyer's check is the recipient
and the origin on the invoice; the docs page says so.

## No inline scripts

nearswaps.com sends a Content-Security-Policy that runs scripts from its own origin only (plus two hashed scripts of
the site's own). The pay page, the docs page and the demo shop load every script from a file; `tools/sync-to-site.mjs`
refuses to copy any HTML file that has an inline script, and the tests check that. The loader draws the merchant's
button with inline styles only: no iframe and no stylesheet on the merchant's page.

## The status call is the only proof

The `nearswaps:paid` event, the `data-onpaid` callback and the pay page's receipt are conveniences: a merchant page can
be scripted, and a message can be faked by anyone who controls that page. Before shipping, the merchant's server asks
`GET https://nearswaps.com/api/intents?status=<depositAddress>` (public, read-only) and checks that the status is
`SUCCESS`, the kind is `checkout`, the quote type is `EXACT_OUTPUT`, and the recipient, destination asset and amount
equal the order, with `swapDetails.amountOut` at least the amount. `verify-payment.mjs` makes exactly these checks.
Accept each deposit address for one order only.

## Reporting a problem

If you find a way to make the pay page send a different amount or to a different address than the invoice, to show an
origin the browser did not vouch for, to make a merchant page accept a payment that the status call does not confirm,
or anything else that moves money where it should not go, please tell us before you tell anyone else. Write to
tomeblazevski@gmail.com with "nearswaps checkout" in the subject. Say what you did, what you expected and what happened,
with the page address, the steps and the commit hash.

This is a one-person project. We read every report and answer as soon as we can, and we will credit you in the fix if
you want that. We do not run a bounty and cannot promise a payment or a response time. Please test with the local copy
(`npm run serve`, mocked backend and mocked wallets) or with small payments to an address you own, and do not test
against other people's payments, wallets or the live backend's caps.

Problems in nearswaps.com itself, or in its backend, can be reported to the same address. The backend is not in this
repository; its contract is [docs/api.md](docs/api.md).
