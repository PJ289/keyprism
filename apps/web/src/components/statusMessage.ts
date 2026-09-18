// Mensaje de estado con color/icono según el tipo — reemplaza los <p
// class="hint"> planos para que un error, un aviso y una confirmación se
// distingan de un vistazo en vez de tener todos el mismo gris neutro.
import { el } from "../lib/dom.js";

export type StatusKind = "info" | "success" | "warning" | "error";

const ICONS: Record<StatusKind, string> = {
  info: "ℹ️",
  success: "✅",
  warning: "⚠️",
  error: "❌",
};

export interface StatusMessage {
  element: HTMLElement;
  set(kind: StatusKind, text: string): void;
  clear(): void;
}

export function createStatusMessage(): StatusMessage {
  const icon = el("span", { class: "status__icon" }, []);
  const text = el("span", { class: "status__text" }, []);
  const element = el("p", { class: "status hidden" }, [icon, text]);

  function set(kind: StatusKind, message: string): void {
    element.className = `status status--${kind}`;
    icon.textContent = ICONS[kind];
    text.textContent = message;
  }

  function clearStatus(): void {
    element.className = "status hidden";
    icon.textContent = "";
    text.textContent = "";
  }

  return { element, set, clear: clearStatus };
}
