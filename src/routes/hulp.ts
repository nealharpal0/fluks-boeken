import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { App } from "../app";
import type { Bindings } from "../types";
import type { Melding } from "../views/layout";

export type Omgeving = { Bindings: Bindings; Variables: { app: App } };
export type Ctx = Context<Omgeving>;

const MELDING_COOKIE = "fluks_melding";

/** Bewaart een melding voor de volgende pagina (na een redirect). */
export function zetMelding(c: Ctx, melding: Melding): void {
  setCookie(c, MELDING_COOKIE, encodeURIComponent(JSON.stringify(melding)), {
    path: "/",
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    maxAge: 60,
  });
}

export function leesMelding(c: Ctx): Melding | null {
  const ruw = getCookie(c, MELDING_COOKIE);
  if (!ruw) return null;
  deleteCookie(c, MELDING_COOKIE, { path: "/" });
  try {
    const m = JSON.parse(decodeURIComponent(ruw)) as Melding;
    if (["succes", "fout", "info"].includes(m.soort) && typeof m.tekst === "string") return { soort: m.soort, tekst: m.tekst.slice(0, 300) };
  } catch {
    // ongeldige cookie negeren
  }
  return null;
}

/** Het IP-adres van de bezoeker (Cloudflare zet dit in een header). */
export function bezoekerIp(c: Ctx): string {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "onbekend";
}

export function nummer(s: string | undefined): number | null {
  if (!s || !/^\d{1,10}$/.test(s)) return null;
  return Number(s);
}

/** Een veld uit een geparste formulierbody als tekst. */
export function tekstVeld(body: Record<string, unknown>, naam: string): string {
  const v = body[naam];
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : "";
  return typeof v === "string" ? v : "";
}

export function bestandenVeld(body: Record<string, unknown>, naam: string): File[] {
  const v = body[naam];
  const lijst = Array.isArray(v) ? v : v === undefined ? [] : [v];
  return lijst.filter((x): x is File => typeof x === "object" && x !== null && "arrayBuffer" in x && "size" in x);
}

/** Stuurt een JSX-pagina als HTML, mét doctype (anders rendert de browser in quirks mode). */
export function toon(c: Ctx, pagina: unknown, status: ContentfulStatusCode = 200) {
  return c.html(`<!DOCTYPE html>${String(pagina)}`, status);
}
