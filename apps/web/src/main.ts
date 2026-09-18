import { el, clear } from "./lib/dom.js";
import { renderCreateView } from "./views/createView.js";
import { renderDecryptView } from "./views/decryptView.js";

type Tab = "crear" | "descifrar";

function currentTab(): Tab {
  return window.location.hash === "#descifrar" ? "descifrar" : "crear";
}

function render(): void {
  const app = document.getElementById("app");
  if (!app) return;
  clear(app);

  const tab = currentTab();
  const view = el("main", { class: "view" });

  const nav = el("nav", { class: "tabs" }, [
    el("a", { href: "#crear", class: tab === "crear" ? "active" : "" }, ["📦 Crear cápsula"]),
    el("a", { href: "#descifrar", class: tab === "descifrar" ? "active" : "" }, ["🔓 Descifrar"]),
  ]);

  app.append(
    el("header", { class: "app-header" }, [
      el("div", { class: "brand" }, [
        el("span", { class: "brand-icon" }, ["🔐"]),
        el("h1", {}, ["Keyprism"]),
      ]),
      el("p", { class: "tagline" }, [
        "Cifra claves de recuperación con una combinación maestra memorizable.",
      ]),
      el("span", { class: "badge-local" }, ["🖥️ 100% local — nada se envía a ningún servidor"]),
      nav,
    ]),
    view
  );

  if (tab === "crear") renderCreateView(view);
  else renderDecryptView(view);
}

window.addEventListener("hashchange", render);
render();
