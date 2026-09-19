// Smoke test manual con Playwright para las funciones de lote de la vista
// "Crear": varios secretos en una misma hoja, importar una cápsula ya
// cifrada para combinarla, y que la impresión aísle solo `.printable`
// (regresión del bug "imprime toda la página").
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4173/";
const SECRET_A = "secreto-A-bitlocker-111222333";
const SECRET_B = "secreto-B-passbolt-privkey-444555";

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (msg) => msg.type() === "error" && console.log("[browser]", msg.text()));
page.on("pageerror", (err) => console.error("[pageerror]", err));

await page.goto(BASE_URL);
await page.waitForSelector("h2");

console.log("--- Lote: 2 secretos nuevos en la misma hoja ---");
const newRows = () => page.locator(".batch-item:not(.batch-item--imported)");
await newRows().nth(0).locator("textarea").fill(SECRET_A);
await page.click("text=Añadir otro secreto");
await newRows().nth(1).locator("input[type=text]").fill("Etiqueta B");
await newRows().nth(1).locator("textarea").fill(SECRET_B);
if ((await newRows().count()) !== 2) throw new Error("Esperaba 2 filas de secreto nuevo");

await page.click("text=Generar combinación diceware (recomendado)");
await page.waitForSelector(".combo-box:not(.hidden)");
const comboA = await page.$eval(".combo-text", (n) => n.textContent);
console.log("Combinación A:", comboA);

await page.click("button.primary:has-text('Crear cápsula')");
await page.waitForSelector(".result:not(.hidden)", { timeout: 15000 });

const canvasCount = await page.$$eval("canvas", (n) => n.length);
const printItemCount = await page.locator(".print-item").count();
console.log("QR renderizados:", canvasCount, "| print-items:", printItemCount);
if (canvasCount !== 2 || printItemCount !== 2) {
  throw new Error(`Esperaba 2 QR y 2 print-items, obtuve ${canvasCount} y ${printItemCount}`);
}

const payloads = await page.locator(".print-payload").allTextContents();
if (payloads.length !== 2) throw new Error("Esperaba 2 payloads de respaldo");
// Fila 0 = secreto A (sin etiqueta), fila 1 = secreto B ("Etiqueta B").
const [, payloadB] = payloads;
console.log("Payload B (primeros 40):", payloadB.slice(0, 40));

console.log("--- Impresión: solo .printable debe quedar visible ---");
await page.emulateMedia({ media: "print" });
const navVisibility = await page.$eval(".tabs a", (el) => getComputedStyle(el).visibility);
const printItemVisibility = await page.$eval(".print-item", (el) => getComputedStyle(el).visibility);
console.log("visibility nav:", navVisibility, "| visibility print-item:", printItemVisibility);
if (navVisibility !== "hidden" || printItemVisibility !== "visible") {
  throw new Error(
    `Aislamiento de impresión roto (nav=${navVisibility}, print-item=${printItemVisibility})`
  );
}
await page.emulateMedia({ media: "screen" });

console.log("--- Importar una cápsula ya creada en una hoja nueva ---");
await page.reload();
await page.waitForSelector("h2");
await page.click("text=Importar cápsula existente");
await page.fill(".import-panel textarea", payloadB);
await page.waitForSelector(".status--success:has-text('Código reconocido')");
await page.click(".import-panel >> text=Añadir a la hoja");

const importedRows = page.locator(".batch-item--imported");
if ((await importedRows.count()) !== 1) throw new Error("Esperaba 1 fila importada");
const importedText = await importedRows.first().textContent();
if (!importedText.includes("Etiqueta B")) {
  throw new Error(`La cápsula importada no muestra la etiqueta esperada: ${importedText}`);
}
console.log("Cápsula importada con etiqueta correcta:", importedText.trim());

// Añade además un secreto nuevo con una combinación DISTINTA, para probar
// que lo importado conserva su propia combinación original al combinarse.
await newRows().nth(0).locator("textarea").fill("otro-secreto-mas");
await page.click("text=Generar combinación diceware (recomendado)");
await page.waitForSelector(".combo-box:not(.hidden)");
const comboC = await page.$eval(".combo-text", (n) => n.textContent);

await page.click("button.primary:has-text('Crear cápsula')");
await page.waitForSelector(".result:not(.hidden)", { timeout: 15000 });
const combinedPayloads = await page.locator(".print-payload").allTextContents();
if (combinedPayloads.length !== 2) {
  throw new Error(`Esperaba 2 payloads (1 importado + 1 nuevo), obtuve ${combinedPayloads.length}`);
}
const reimportedPayloadB = combinedPayloads.find((p) => p.trim() === payloadB.trim());
if (!reimportedPayloadB) throw new Error("El payload importado no se conservó igual en la hoja combinada");
console.log("Payload importado se conserva igual byte a byte en la hoja combinada.");

console.log("--- Descifrar la cápsula importada con su combinación ORIGINAL (A, no C) ---");
await page.click("text=Descifrar");
await page.fill("textarea[placeholder*='Pega aquí el código']", reimportedPayloadB);
await page.fill("input[placeholder='Combinación maestra']", comboA);
await page.click("button.primary:has-text('Descifrar')");
await page.waitForSelector(".result:not(.hidden) textarea", { timeout: 15000 });
const decrypted = await page.$eval(".result:not(.hidden) textarea", (n) => n.value);
if (decrypted !== SECRET_B) {
  throw new Error(`Mismatch: esperado "${SECRET_B}", obtenido "${decrypted}"`);
}
console.log("Secreto B recuperado correctamente vía import + combinación original.");

await browser.close();
console.log("\n✅ BATCH SMOKE TEST OK");
