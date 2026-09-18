// Smoke test manual con Playwright (no forma parte de la suite de CI,
// es una comprobación puntual de runtime en navegador real que el
// typecheck/vitest no puede cubrir: carga de WASM de libsodium, DOM,
// generación/lectura de QR).
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:4173/";
const SECRET = "48111-222333-444555-666777-888999-000111";

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (msg) => console.log("[browser]", msg.type(), msg.text()));
page.on("pageerror", (err) => console.error("[pageerror]", err));

await page.goto(BASE_URL);
await page.waitForSelector("h2");

console.log("--- Pestaña Crear ---");
await page.fill("textarea", SECRET);
await page.click("text=Generar combinación diceware (recomendado)");
await page.waitForSelector(".combo-box:not(.hidden)");
const combo = await page.$eval(".combo-text", (n) => n.textContent);
console.log("Combinación generada:", combo);

const btnDisabled = await page.$eval("button.primary:has-text('Crear cápsula')", (b) =>
  b.hasAttribute("disabled")
);
console.log("createBtn disabled?", btnDisabled);
await page.click("button.primary:has-text('Crear cápsula')");
await page.waitForTimeout(500);
console.log("status tras click:", await page.$eval("main", (m) => m.textContent.slice(-300)));
await page.waitForSelector(".result:not(.hidden)", { timeout: 15000 });
const printPayload = await page.$eval(".print-payload", (n) => n.textContent);
console.log("Payload impreso (primeros 60 chars):", printPayload.slice(0, 60));

const qrCanvasCount = await page.$$eval("canvas", (nodes) => nodes.length);
console.log("Canvas de QR renderizados:", qrCanvasCount);
if (qrCanvasCount < 1) throw new Error("No se renderizó ningún QR");

console.log("--- Pestaña Descifrar ---");
await page.click("text=Descifrar");
await page.waitForSelector("h2:has-text('Descifrar')");

await page.fill("textarea[placeholder*='Pega aquí el código']", printPayload);
await page.fill("input[placeholder='Combinación maestra']", combo);
await page.click("button.primary:has-text('Descifrar')");
await page.waitForSelector(".result:not(.hidden) textarea", { timeout: 15000 });
const decrypted = await page.$eval(".result:not(.hidden) textarea", (n) => n.value);
console.log("Secreto descifrado:", decrypted);

if (decrypted !== SECRET) {
  throw new Error(`Mismatch: esperado "${SECRET}", obtenido "${decrypted}"`);
}

console.log("--- Prueba: combinación incorrecta ---");
await page.reload();
await page.click("text=Descifrar");
await page.fill("textarea[placeholder*='Pega aquí el código']", printPayload);
await page.fill("input[placeholder='Combinación maestra']", "combinación equivocada");
await page.click("button.primary:has-text('Descifrar')");
await page.waitForFunction(
  () => document.querySelector(".status--error")?.textContent?.includes("incorrecta"),
  { timeout: 15000 }
);
console.log("Error de combinación incorrecta mostrado correctamente.");

await browser.close();
console.log("\n✅ SMOKE TEST OK");
