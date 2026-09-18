// Verifica que el Service Worker deja la app usable 100% offline tras la
// primera carga: navega online (para que se registre y precachee), espera
// a que el SW esté "activated", pasa el contexto a offline, recarga, y
// repite el flujo crear→descifrar sin red.
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:4174/";
const SECRET = "secreto-offline-pwa";

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
page.on("pageerror", (err) => console.error("[pageerror]", err));

await page.goto(BASE_URL);
await page.waitForFunction(
  async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg?.active?.state === "activated";
  },
  { timeout: 15000 }
);
console.log("Service Worker activo y precacheando.");

// Nota de metodología: tanto `context.setOffline(true)` como
// `page.route().abort()` interceptan a nivel de Playwright/CDP ANTES de
// que la petición llegue al Service Worker, así que "matan" la navegación
// antes de que el SW tenga oportunidad de responder desde caché — no son
// representativos de un dispositivo realmente sin red. La prueba fiel es
// apagar el servidor real (de verdad, el proceso) y recargar contra ese
// mismo origen: si el SW sirve desde precache, la recarga funciona igual
// pese a que el servidor ya no existe. Coordinado con un archivo señal
// porque matar el proceso desde fuera de este script (para no auto-matarse
// por coincidencia de patrón con pkill -f).
import { writeFileSync, existsSync } from "node:fs";
writeFileSync(".ready-to-kill-server", "");
console.log("Esperando señal externa de que el servidor real está apagado...");
while (!existsSync(".go-after-server-killed")) {
  await new Promise((r) => setTimeout(r, 200));
}

await page.reload();
await page.waitForSelector("h2", { timeout: 15000 });
console.log("Página recargada 100% offline (sin red) — carga OK.");

await page.fill("textarea", SECRET);
await page.click("text=Generar combinación diceware (recomendado)");
await page.waitForSelector(".combo-box:not(.hidden)");
const combo = await page.$eval(".combo-text", (n) => n.textContent);
await page.click("button.primary:has-text('Crear cápsula')");
await page.waitForSelector(".result:not(.hidden)", { timeout: 15000 });
const printPayload = await page.$eval(".print-payload", (n) => n.textContent);

await page.click("text=Descifrar");
await page.fill("textarea[placeholder*='Pega aquí el código']", printPayload);
await page.fill("input[placeholder='Combinación maestra']", combo);
await page.click("button.primary:has-text('Descifrar')");
await page.waitForSelector(".result:not(.hidden) textarea", { timeout: 15000 });
const decrypted = await page.$eval(".result:not(.hidden) textarea", (n) => n.value);

if (decrypted !== SECRET) {
  throw new Error(`Mismatch offline PWA: esperado "${SECRET}", obtenido "${decrypted}"`);
}

await browser.close();
console.log("\n✅ PWA OFFLINE SMOKE TEST OK");
