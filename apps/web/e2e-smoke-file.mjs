// Comprobación del requisito "sin peticiones de red en tiempo de ejecución"
// del export standalone: abre el .html directamente vía file:// (como se
// abriría desde el USB de emergencia, con o sin conexión) y confirma que
// el flujo completo funciona igual, vigilando cualquier intento de red.
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const filePath = path.join(here, "dist-standalone", "index.html");
const fileUrl = "file://" + filePath;
const SECRET = "48111-222333-444555-666777-888999-000111";

// Bloquea explícitamente cualquier salida de red (salvo el propio file://)
// para que un intento de fetch/XHR falle de forma visible en vez de
// colarse silenciosamente si hubiera alguna conexión disponible.
const browser = await chromium.launch();
const context = await browser.newContext({ offline: true });
const page = await context.newPage();

let networkAttempts = 0;
page.on("request", (req) => {
  if (!req.url().startsWith("file://")) {
    networkAttempts++;
    console.log("[RED INESPERADA]", req.method(), req.url());
  }
});
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("[console.error]", msg.text());
});
page.on("pageerror", (err) => console.error("[pageerror]", err));

await page.goto(fileUrl);
await page.waitForSelector("h2");

await page.fill("textarea", SECRET);
await page.click("text=Generar combinación diceware (recomendado)");
await page.waitForSelector(".combo-box:not(.hidden)");
const combo = await page.$eval(".combo-text", (n) => n.textContent);

await page.click("button.primary:has-text('Crear cápsula')");
await page.waitForSelector(".result:not(.hidden)", { timeout: 15000 });
const printPayload = await page.$eval(".print-payload", (n) => n.textContent);
const qrCanvasCount = await page.$$eval("canvas", (nodes) => nodes.length);
console.log("QR renderizados vía file://:", qrCanvasCount);

await page.click("text=Descifrar");
await page.fill("textarea[placeholder*='Pega aquí el código']", printPayload);
await page.fill("input[placeholder='Combinación maestra']", combo);
await page.click("button.primary:has-text('Descifrar')");
await page.waitForSelector(".result:not(.hidden) textarea", { timeout: 15000 });
const decrypted = await page.$eval(".result:not(.hidden) textarea", (n) => n.value);

if (decrypted !== SECRET) {
  throw new Error(`Mismatch vía file://: esperado "${SECRET}", obtenido "${decrypted}"`);
}
if (networkAttempts > 0) {
  throw new Error(`Se detectaron ${networkAttempts} peticiones de red inesperadas`);
}

await browser.close();
console.log(`\n✅ FILE:// SMOKE TEST OK (0 peticiones de red, secreto recuperado: "${decrypted}")`);
