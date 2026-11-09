/* nearswaps checkout: the one line a merchant adds.
 *
 *   <script src="https://nearswaps.com/checkout.js" data-to="shop.near" data-amount="25" data-asset="usdc"
 *           data-label="Order 1042"></script>
 *
 * It draws a "Pay 25 USDC" button where the tag sits. A click opens nearswaps' pay page in a popup (a new tab on
 * phones); the buyer pays from any wallet on any chain and NEAR Intents delivers exactly the invoiced amount.
 *
 * Options (data-*):
 *   to       who is paid: a NEAR account, or an address on the chain of `asset`              (required)
 *   amount   the invoiced amount in `asset`, e.g. "25" or "12.50"                             (required)
 *   asset    usdc (USDC on NEAR, the default), usdt, near, usdc-base, usdc-sol, usdc-arb, usdc-eth
 *   label    shown on the invoice, at most 80 characters, e.g. "Order 1042"
 *   theme    "light" for light pages (a deeper mint with white text); dark by default
 *   onpaid   the name of a function on window to call when the pay page reports the payment, e.g. "onPaid"
 *
 * When the pay page reports a delivered payment, the button dispatches a "nearswaps:paid" event (it bubbles to
 * document) with detail { depositAddress, amount, asset, label, to, statusUrl }.
 * The event is a convenience, not proof: before shipping anything, ask statusUrl from your server and check the
 * recipient, the asset and the amount delivered.
 *
 * From code:  NearswapsCheckout.open({ to, amount, asset, label, theme, onpaid })
 * No iframe, no stylesheet: the button carries its own inline styles, and the pay page runs on nearswaps.com.
 */
(function (root) {
  "use strict";
  var doc = root.document;
  var script = doc && doc.currentScript;
  var DEFAULT_ORIGIN = "https://nearswaps.com";
  // The pay page's origin is the origin this file was loaded from (nearswaps.com, or a preview of it).
  var ORIGIN = (function () {
    try { if (script && script.src) return new URL(script.src, root.location.href).origin; } catch (e) {}
    return DEFAULT_ORIGIN;
  })();
  var SYMBOL = { usdc: "USDC", usdt: "USDT", near: "NEAR", "usdc-base": "USDC", "usdc-sol": "USDC", "usdc-arb": "USDC", "usdc-eth": "USDC" };
  var MARK = "M50.6 305.7C47.2 302.3 34.7 289.5 22.6 277.3C1.7 256.1 0.8 255 0.3 250.7C-0.2 246.4 0 246 5.6 239.9C8.7 236.4 18.2 226.5 26.5 218C34.9 209.5 43.6 200.4 45.9 197.9C52.2 190.8 57.2 187.7 60.9 188.5C65.1 189.4 66 191.5 66 200.7C66 205 66.3 211.5 66.7 215.2L67.3 222L93.5 222L113.7 242.5C125 253.9 134.2 264.1 134.6 265.5C135.5 269.1 134.3 272.7 131.6 274.5C129.7 275.8 124.1 276.1 98.7 276.3C81.9 276.4 67.8 276.9 67.4 277.3C67 277.7 66.6 284.8 66.5 293.1C66.4 307.7 66.3 308.3 64.1 310.1C60 313.5 57.2 312.6 50.6 305.7ZM221 290C211.5 288 206.9 284.7 194.8 271.2C182.7 257.8 161.3 233.3 142 210.9C135.7 203.6 128.2 195.1 125.5 192C122.8 188.9 116.7 182 112 176.6C107.3 171.2 101 163.9 98 160.5C95 157.1 88.5 149.5 83.5 143.6C74.5 133.1 72 131.3 67.8 132.4C66.4 132.7 60.9 138.6 54.5 146.6C48.5 154.1 41 163.2 38 166.9C35 170.6 27.3 180.1 20.9 188.1C5.4 207.3 4.7 208 2.1 207.3L0 206.8L0 120.6C0 23.6 -0.4 29 7.6 20.1C10.2 17.2 14.1 14.3 17.2 12.9C22.3 10.6 23.3 10.5 46.5 10.5L70.5 10.5L77.5 13.9C84.4 17.3 94.3 26.6 107.6 42.2C110.3 45.3 119.9 56.1 129 66.2C138.1 76.2 147.3 86.5 149.5 89C151.7 91.6 160.9 101.9 169.9 112.1C178.9 122.2 190.4 135.2 195.4 140.9C210.4 158 217.3 165.4 219.1 166.4C222.3 168 225.5 166.1 231.5 158.8C234.8 154.8 240 148.8 243 145.5C246 142.1 252.6 134.7 257.5 129C287.1 94.9 287.6 94.4 289.7 96.1C290.8 97.1 291 110.4 290.8 182.4L290.5 267.5L288.2 272.1C284.8 279.1 279.5 284.6 273.2 287.7C267.6 290.5 267.3 290.5 246.5 290.7C234.9 290.8 223.5 290.5 221 290ZM229.1 113.2C227.2 111.7 227 110.3 226.8 98.5L226.5 85.5L214.9 84.9C208.5 84.5 202.5 84 201.4 83.6C200.4 83.3 191.1 74.3 180.8 63.6C163.9 46.1 162 43.8 162 40.8C162 38.4 162.8 36.6 164.6 34.9L167.2 32.5L197.1 32.2L227 31.9L227 17.5C227 3.8 227.1 3 229.2 1.6C234.3 -2 235 -1.5 263.8 27.3C295.6 59.2 294.6 57.4 285.5 66.9C279 73.8 259.4 93.1 246 105.9C235.9 115.6 233.3 116.7 229.1 113.2Z";

  /** The pay page's address for an invoice. `ref` is the merchant page's origin (the pay page shows it once the
   *  browser vouches for it, and posts the "paid" message to that origin only). */
  function payUrl(origin, o, ref) {
    var q = new URLSearchParams();
    q.set("to", String(o.to || ""));
    q.set("amount", String(o.amount == null ? "" : o.amount));
    q.set("asset", String(o.asset || "usdc").toLowerCase());
    if (o.label) q.set("label", String(o.label));
    if (ref && /^https?:\/\//.test(ref)) q.set("ref", ref);
    if (o.theme === "light") q.set("theme", "light");
    return origin + "/pay?" + q.toString().replace(/\+/g, "%20");
  }
  /** Messages are taken from the pay page's origin only. */
  function originOk(eventOrigin, own) { return typeof eventOrigin === "string" && eventOrigin === own; }
  function isPhone(win) {
    try {
      var coarse = win.matchMedia && win.matchMedia("(pointer: coarse)").matches;
      var narrow = win.innerWidth && win.innerWidth < 768;
      var ua = /Android|iPhone|iPad|iPod|Mobi/i.test((win.navigator && win.navigator.userAgent) || "");
      return !!(ua || (coarse && narrow));
    } catch (e) { return false; }
  }
  function optsFrom(ds) {
    return { to: ds.to, amount: ds.amount, asset: ds.asset, label: ds.label, theme: ds.theme, onpaid: ds.onpaid };
  }
  function buttonText(o) {
    var sym = SYMBOL[String(o.asset || "usdc").toLowerCase()] || String(o.asset || "").toUpperCase();
    return "Pay " + String(o.amount) + " " + sym;
  }
  function resolveFn(name) {
    if (typeof name === "function") return name;
    if (typeof name !== "string" || !/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*){0,3}$/.test(name)) return null;
    var parts = name.split("."), cur = root;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || !Object.prototype.hasOwnProperty.call(cur, parts[i])) return null;
      cur = cur[parts[i]];
    }
    return typeof cur === "function" ? cur : null;
  }

  // Popups opened from this page: { win, el, opts }. A message is matched to the popup it came from.
  var opened = [];
  var paidSeen = {};

  function open(o, el) {
    o = o || {};
    if (!o.to || o.amount == null || o.amount === "") throw new Error("NearswapsCheckout.open needs to and amount");
    var ref = "";
    try { ref = root.location.origin; } catch (e) {}
    var url = payUrl(ORIGIN, o, ref && ref !== "null" ? ref : "");
    var win = null;
    if (isPhone(root)) win = root.open(url, "_blank");
    else {
      var w = 460, h = 780;
      var left = Math.max(0, Math.round((root.screenX || 0) + ((root.outerWidth || w) - w) / 2));
      var top = Math.max(0, Math.round((root.screenY || 0) + ((root.outerHeight || h) - h) / 2));
      win = root.open(url, "nearswaps_pay", "popup=yes,width=" + w + ",height=" + h + ",left=" + left + ",top=" + top);
    }
    if (win) {
      for (var i = opened.length - 1; i >= 0; i--) if (opened[i].win === win) opened.splice(i, 1);
      opened.push({ win: win, el: el || null, opts: o });
      try { win.focus(); } catch (e) {}
    }
    return win;
  }

  function onMessage(e) {
    if (!originOk(e.origin, ORIGIN)) return;
    var d = e.data;
    if (!d || typeof d !== "object" || d.ns !== "checkout") return;
    var entry = null;
    for (var i = 0; i < opened.length; i++) if (opened[i].win === e.source) entry = opened[i];
    if (d.type === "hello") {
      // The pay page asks who opened it; the answer carries this page's origin, vouched for by the browser.
      if (entry && e.source && e.source.postMessage) { try { e.source.postMessage({ ns: "checkout", type: "ready" }, ORIGIN); } catch (x) {} }
      return;
    }
    if (d.status !== "paid") return;
    var dep = typeof d.depositAddress === "string" && d.depositAddress.length <= 120 && /^[A-Za-z0-9._-]+$/.test(d.depositAddress) ? d.depositAddress : "";
    if (!dep || paidSeen[dep]) return;
    paidSeen[dep] = true;
    var detail = {
      depositAddress: dep,
      amount: String(d.amount == null ? "" : d.amount).slice(0, 60),
      asset: String(d.asset || "").slice(0, 20),
      label: d.label == null ? null : String(d.label).slice(0, 80),
      to: String(d.to || "").slice(0, 120),
      statusUrl: ORIGIN + "/api/intents?status=" + encodeURIComponent(dep),
    };
    var target = (entry && entry.el) || doc;
    var ev;
    try { ev = new root.CustomEvent("nearswaps:paid", { detail: detail, bubbles: true }); }
    catch (x) { ev = doc.createEvent("CustomEvent"); ev.initCustomEvent("nearswaps:paid", true, false, detail); }
    target.dispatchEvent(ev);
    var fn = resolveFn(entry && entry.opts ? entry.opts.onpaid : null);
    if (fn) { try { fn.call(root, detail); } catch (x) { if (root.console) root.console.error(x); } }
  }

  function drawButton(s) {
    var o = optsFrom(s.dataset || {});
    if (!o.to || !o.amount) { if (root.console) root.console.warn("nearswaps checkout: data-to and data-amount are needed"); return null; }
    var light = o.theme === "light";
    var bg = light ? "#007A5A" : "#01FAC0", fg = light ? "#FFFFFF" : "#060708";
    var b = doc.createElement("button");
    b.type = "button";
    b.className = "nearswaps-pay";
    b.setAttribute("aria-label", buttonText(o) + " with nearswaps checkout (opens a new window)");
    b.style.cssText = "display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 20px;margin:0;border:0;border-radius:999px;" +
      "background:" + bg + ";color:" + fg + ";font:700 15px/1 Manrope,system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:-0.01em;" +
      "cursor:pointer;-webkit-font-smoothing:antialiased;transition:filter 120ms cubic-bezier(0.2,0.8,0.2,1),transform 120ms cubic-bezier(0.2,0.8,0.2,1);";
    var NS = "http://www.w3.org/2000/svg";
    var svg = doc.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 291 312"); svg.setAttribute("width", "16"); svg.setAttribute("height", "16"); svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    var p = doc.createElementNS(NS, "path");
    p.setAttribute("fill", "currentColor"); p.setAttribute("fill-rule", "evenodd"); p.setAttribute("d", MARK);
    svg.appendChild(p);
    var t = doc.createElement("span");
    t.textContent = buttonText(o);
    b.appendChild(svg); b.appendChild(t);
    var mouse = false;
    b.addEventListener("mouseenter", function () { b.style.filter = "brightness(1.06)"; });
    b.addEventListener("mouseleave", function () { b.style.filter = ""; b.style.transform = ""; });
    b.addEventListener("mousedown", function () { mouse = true; b.style.transform = "scale(0.98)"; });
    b.addEventListener("mouseup", function () { b.style.transform = ""; });
    b.addEventListener("focus", function () { if (!mouse) { b.style.outline = "2px solid " + bg; b.style.outlineOffset = "2px"; } mouse = false; });
    b.addEventListener("blur", function () { b.style.outline = ""; });
    b.addEventListener("click", function () { open(o, b); });
    s.parentNode.insertBefore(b, s.nextSibling);
    return b;
  }

  var prev = root.NearswapsCheckout;
  if (!prev || !prev._listening) root.addEventListener("message", onMessage);
  // Several tags on one page share one listener and one list of popups.
  if (prev && prev._listening) { opened = prev._opened; paidSeen = prev._paidSeen; }
  root.NearswapsCheckout = {
    version: "1",
    origin: ORIGIN,
    open: function (o) { return open(o, null); },
    _listening: true,
    _opened: opened,
    _paidSeen: paidSeen,
    _internals: { payUrl: payUrl, originOk: originOk, isPhone: isPhone, buttonText: buttonText, resolveFn: resolveFn, onMessage: onMessage },
  };
  if (script && script.dataset && (script.dataset.to || script.dataset.amount)) drawButton(script);
})(typeof window !== "undefined" ? window : this);
