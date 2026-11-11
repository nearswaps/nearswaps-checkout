// Browser test for the pay page and the loader, at 1440 and 390 px, against the mocked /api of tools/serve-local.mjs
// (nothing reaches nearswaps.com, 1Click or NEAR). Written for @playwright/test; it was NOT run on the PC it was
// written on (Playwright cannot start there). Run elsewhere:
//   npm i -D @playwright/test && npx playwright install chromium && npx playwright test -c tests/browser
import { test, expect } from "@playwright/test";
import { start } from "../../tools/serve-local.mjs";

let srv;
test.beforeAll(async () => { srv = await start({ port: 0, shopPort: 0 }); });
test.afterAll(async () => { await srv.close(); });

const SIZES = [{ name: "desktop", width: 1440, height: 900 }, { name: "phone", width: 390, height: 844 }];
const invoice = "/pay?to=shop.near&amount=25&asset=usdc&label=Order%201042";

for (const size of SIZES) {
  test.describe(`at ${size.width} px`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("invoice card and the pay-with list with dry quotes and disabled rows", async ({ page }) => {
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(srv.payOrigin + invoice);
      await expect(page.locator("#invTo")).toHaveText("shop.near");
      await expect(page.locator("#invAmt")).toHaveText("25 USDC");
      await expect(page.locator("#invLabel")).toHaveText("Order 1042");
      await expect(page.locator("#invOrigin")).toHaveText("requested by a page with no origin");
      const btc = page.locator('[data-asset="nep141:btc.omft.near"]');
      await expect(btc.locator(".q b")).toContainText("BTC");
      await expect(btc.locator(".q small")).toHaveText("dry quote");
      await expect(page.locator('[data-asset="nep141:zec.omft.near"]')).toBeDisabled();
      await expect(page.locator('[data-asset="nep141:zec.omft.near"] .why')).toContainText("smallest payment");
      await expect(page.locator('[data-asset="nep141:wrap.near"] .q b')).toContainText("NEAR");
      await expect(page.locator("#feeLine")).toContainText("0.5% is included in the quote");
      // one column, nothing wider than the screen
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      // 44 px targets
      for (const h of await page.locator("#coins .row").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(44);
      expect(errors).toEqual([]);
    });

    test("refund address, deposit card, reload survival, timeline and receipt", async ({ page, request }) => {
      await request.get(srv.payOrigin + "/__mock?speed=fast&checkout=on");
      await page.goto(srv.payOrigin + invoice);
      await page.locator('[data-asset="nep141:sol.omft.near"]').click();
      await expect(page.locator("#refundLbl")).toHaveText("Your Solana address for refunds");
      await page.locator("#refundIn").fill("0x742d35Cc6634C0532925a3b844Bc454e4438f44e");
      await page.locator("#getBtn").click();
      await expect(page.locator("#refundErr")).toHaveText("That doesn't look like a Solana address.");
      await page.locator("#refundIn").fill("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
      await page.locator("#getBtn").click();
      await expect(page.locator("#deposit")).toBeVisible();
      await expect(page.locator("#sendAmt")).toContainText("SOL");
      await expect(page.locator("#changed")).toBeVisible();          // the mock moves the live price a little on purpose
      await expect(page.locator("#qr svg")).toBeVisible();
      await expect(page.locator("#openWallet")).toHaveAttribute("href", /^solana:[1-9A-HJ-NP-Za-km-z]{44}\?amount=/);
      await expect(page.locator("#countdown")).toContainText("Send within 29:");
      const dep = await page.locator("#depAddr").textContent();
      expect(page.url()).toContain("dep=" + dep);
      await page.reload();
      await expect(page.locator("#depAddr")).toHaveText(dep);        // reload survival
      await expect(page.locator("#payWith")).toBeHidden();
      await expect(page.locator("#steps li.now")).toHaveCount(1);
      await expect(page.locator("#receipt")).toBeVisible({ timeout: 20000 });
      await expect(page.locator("#rcAmt")).toHaveText("25 USDC");
      await expect(page.locator("#rcTx")).toHaveAttribute("href", /^https:\/\/nearblocks\.io\/txns\//);
      await expect(page.locator("#steps li.done")).toHaveCount(5);
      const saved = await page.evaluate((d) => JSON.parse(localStorage.getItem("nearswaps-pay:" + d)).status, dep);
      expect(saved).toBe("SUCCESS");
      await request.get(srv.payOrigin + "/__mock?speed=normal");
    });

    test("about mode: ?mode=dry, and a 400 naming the action", async ({ page, request }) => {
      await page.goto(srv.payOrigin + invoice + "&mode=dry");
      await expect(page.locator("#modeNote")).toBeVisible();
      await expect(page.locator("#invAbout")).toBeVisible();
      await expect(page.locator('[data-asset="nep141:btc.omft.near"] .q b')).toContainText(/^about /);
      await expect(page.locator('[data-asset="nep141:wrap.near"]')).toBeDisabled();
      await page.locator('[data-asset="nep141:btc.omft.near"]').click();
      await expect(page.locator("#getBtn")).toBeDisabled();
      await request.get(srv.payOrigin + "/__mock?checkout=off");
      await page.goto(srv.payOrigin + invoice);
      await expect(page.locator("#modeNote")).toBeVisible();
      await request.get(srv.payOrigin + "/__mock?checkout=on");
    });

    test("a broken link says why", async ({ page }) => {
      await page.goto(srv.payOrigin + "/pay?to=shop.near&amount=25&asset=usdc-base");
      await expect(page.locator("#invErr")).toContainText("is not a Base address");
      await expect(page.locator("#payWith")).toBeHidden();
    });

    test("NEAR-origin payment hides the refund field and offers Connect wallet", async ({ page }) => {
      await page.goto(srv.payOrigin + invoice);
      await page.locator('[data-asset="nep141:wrap.near"]').click();
      await expect(page.locator("#refundBox")).toBeHidden();
      await expect(page.locator("#nearBtn")).toHaveText("Connect wallet");
    });

    test("wallet row: Pay with Phantom sends at once; MetaMask cancel keeps the card with Try again; no wallet says so", async ({ page }) => {
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      let approve = true;
      page.on("dialog", (d) => (approve || !/send this transaction/.test(d.message()) ? d.accept() : d.dismiss()));
      // No wallet in the browser: today's flow plus one line.
      await page.goto(srv.payOrigin + "/pay?to=shop.near&amount=1&asset=usdc");
      await page.locator('[data-asset="nep141:sol.omft.near"]').click();
      await expect(page.locator("#noWallet")).toHaveText("No Solana wallet found in this browser; send from any wallet by hand.");
      await expect(page.locator("#refundBox")).toBeVisible();
      // Mocked Phantom: one click, the deposit is sent, the status starts at Deposit seen with a Solscan link.
      await page.goto(srv.payOrigin + "/pay?to=shop.near&amount=1&asset=usdc&wallets=mock");
      await page.locator('[data-asset="nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near"]').click();
      await expect(page.locator("#refundBox")).toBeHidden();
      await page.locator("#wallets .wbtn", { hasText: "Pay with Phantom" }).click();
      await expect(page.locator("#steps li.now")).toHaveText("Deposit seen");
      await expect(page.locator("#depTxLink")).toHaveAttribute("href", /^https:\/\/solscan\.io\/tx\//);
      await expect(page.locator("#refundShown")).toContainText("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
      // Mocked MetaMask, cancelled: the card stays with the address and Try again to the same address.
      approve = false;
      await page.goto(srv.payOrigin + "/pay?to=shop.near&amount=1&asset=usdc&wallets=mock");
      await page.locator('[data-asset="nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near"]').click();
      await page.locator("#byHand").click();
      await expect(page.locator("#refundBox")).toBeVisible();
      await page.locator("#walletAgain").click();
      await page.locator("#wallets .wbtn", { hasText: "Pay with MetaMask" }).click();
      await expect(page.locator("#sendMsg")).toContainText("You cancelled in MetaMask, so nothing was sent");
      const dep = await page.locator("#depAddr").textContent();
      approve = true;
      await page.locator("#retryBtn").click();
      await expect(page.locator("#depTxLink")).toHaveAttribute("href", /^https:\/\/basescan\.org\/tx\/0x[0-9a-f]{64}$/);
      await expect(page.locator("#depAddr")).toHaveText(dep);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    });
  });
}

test("merchant page: button, popup, the opener's origin, and the paid event targeted at the shop", async ({ page, context, request }) => {
  await request.get(srv.payOrigin + "/__mock?speed=fast&checkout=on");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(srv.shopOrigin + "/");
  const btn = page.getByRole("button", { name: /Pay 25 USDC/ });
  await expect(btn).toBeVisible();
  expect(await btn.evaluate((b) => getComputedStyle(b).borderRadius)).toBe("999px");
  const [popup] = await Promise.all([context.waitForEvent("page"), btn.click()]);
  await popup.waitForLoadState();
  expect(new URL(popup.url()).searchParams.get("ref")).toBe(srv.shopOrigin);
  await expect(popup.locator("#invOrigin")).toHaveText("requested by " + srv.shopOrigin);   // the opener answered "hello"
  await popup.locator('[data-asset="nep141:eth.omft.near"]').click();
  await popup.locator("#refundIn").fill("0x742d35Cc6634C0532925a3b844Bc454e4438f44e");
  await popup.locator("#getBtn").click();
  await expect(popup.locator("#openWallet")).toHaveAttribute("href", /^ethereum:0x[0-9a-f]{40}@1\?value=\d+$/);
  await expect(popup.locator("#receipt")).toBeVisible({ timeout: 20000 });
  await expect(popup.locator("#backBtn")).toHaveText("Back to " + srv.shopOrigin.replace("http://", ""));
  await expect(page.locator("#paid")).toContainText("Paid: 25 usdc (Order 1042)");
  await expect(page.locator("#log")).toContainText('"statusUrl": "' + srv.payOrigin + "/api/intents?status=");
  await request.get(srv.payOrigin + "/__mock?speed=normal");
});

test("a paid message from another origin does nothing on the merchant page", async ({ page }) => {
  await page.goto(srv.shopOrigin + "/");
  await page.evaluate(() => window.postMessage({ ns: "checkout", status: "paid", depositAddress: "abc", amount: "25", asset: "usdc" }, "*"));
  await page.waitForTimeout(300);
  await expect(page.locator("#paid")).toBeHidden();
});
