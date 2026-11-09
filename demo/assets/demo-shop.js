// The demo shop's own script: the "Paid" banner, driven by the nearswaps:paid event that checkout.js dispatches.
// A file, not an inline script: nearswaps.com's Content-Security-Policy runs only the site's own script files.
// On the site this is /assets/demo-shop.js (tools/sync-to-site.mjs); in the repo, demo/assets/demo-shop.js.
(function () {
  "use strict";
  var LIVE = "https://nearswaps.com";
  var $ = function (id) { return document.getElementById(id); };
  var payOrigin = (window.NearswapsCheckout && window.NearswapsCheckout.origin) || LIVE;

  // Local mode (tools/serve-local.mjs serves this page with the tags pointed at the local pay page).
  if (payOrigin !== LIVE) {
    $("realNote").hidden = true;
    $("localNote").hidden = false;
    $("localOrigin").textContent = payOrigin;
    var docs = document.querySelectorAll('a[href="/learn/accept-payments.html"]');
    for (var i = 0; i < docs.length; i++) docs[i].href = payOrigin + "/docs/accept-payments.html";
  }

  // data-asset codes (the event's detail.asset is one of these) and what they read as.
  var NAMES = { usdc: "USDC", usdt: "USDT", near: "NEAR", "usdc-base": "USDC on Base", "usdc-sol": "USDC on Solana", "usdc-arb": "USDC on Arbitrum", "usdc-eth": "USDC on Ethereum" };
  function quoteArg(s) { return /^[A-Za-z0-9._:\/-]+$/.test(s) ? s : '"' + String(s).replace(/["\\$`]/g, "\\$&") + '"'; }

  document.addEventListener("nearswaps:paid", function (e) {
    var d = e.detail || {};
    // checkout.js dispatches the event on the button that opened the pay page; mark that product.
    var card = e.target && e.target.closest ? e.target.closest(".product") : null;
    if (card) card.classList.add("paid");
    var tag = card ? card.querySelector("script[data-to]") : null;
    // The verifier command checks the shop's own invoice (the tag), not what the message says.
    var to = (tag && tag.getAttribute("data-to")) || d.to || "";
    var amount = (tag && tag.getAttribute("data-amount")) || d.amount || "";
    var asset = String((tag && tag.getAttribute("data-asset")) || d.asset || "usdc").toLowerCase();

    $("paidLabel").textContent = d.label || (card ? card.getAttribute("data-product") : "");
    $("paidAmount").textContent = (d.amount || amount) + " " + (Object.prototype.hasOwnProperty.call(NAMES, asset) ? NAMES[asset] : asset.toUpperCase());
    $("paidTo").textContent = to;
    $("paidDep").textContent = d.depositAddress || "";
    var link = $("paidVerify");
    if (typeof d.statusUrl === "string" && /^https?:\/\//.test(d.statusUrl)) link.href = d.statusUrl;
    else link.removeAttribute("href");
    var api = payOrigin + "/api";
    $("paidCmd").textContent = "node verify-payment.mjs " + quoteArg(d.depositAddress || "<depositAddress>") + " --to " + quoteArg(to) +
      " --amount " + quoteArg(amount) + " --asset " + quoteArg(asset) + (api !== LIVE + "/api" ? " --api " + quoteArg(api) : "");
    var box = $("paid");
    box.classList.add("show");
    try { box.focus({ preventScroll: true }); box.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (x) {}
  });
})();
