/**
 * Inloggen en ondertekenen.
 *
 * - Het beheerwachtwoord staat als versleuteld geheim bij Cloudflare
 *   (BEHEER_WACHTWOORD) en wordt in constante tijd vergeleken.
 * - De sessie is een cookie met een vervaldatum en een HMAC-handtekening
 *   (GEHEIME_SLEUTEL). Alle sessies intrekken = de sleutel vervangen.
 * - De iCal-link bevat een token dat ook met die sleutel is afgeleid.
 */
import type { Bindings } from "../types";

export const SESSIE_COOKIE = "fluks_sessie";
export const SESSIE_DUUR_MS = 14 * 24 * 3600_000;
const DEMO_SLEUTEL = "demo-sleutel-niet-voor-productie-gebruiken-0123456789";

const enc = new TextEncoder();

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(sleutel: string, tekst: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(sleutel), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(tekst)));
}

/** Vergelijkt twee teksten in constante tijd (via hun SHA-256-hash). */
export async function gelijkInConstanteTijd(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let verschil = 0;
  for (let i = 0; i < x.length; i++) verschil |= x[i]! ^ y[i]!;
  return verschil === 0;
}

export interface Geheimen {
  wachtwoord: string;
  sleutel: string;
}

/**
 * Het wachtwoord en de ondertekensleutel voor deze omgeving.
 * In de demo is het wachtwoord "demo"; in productie moeten beide geheimen gezet zijn.
 */
export function geheimen(env: Bindings, demo: boolean): Geheimen | { fout: string } {
  if (demo) return { wachtwoord: env.BEHEER_WACHTWOORD || "demo", sleutel: env.GEHEIME_SLEUTEL || DEMO_SLEUTEL };
  if (!env.BEHEER_WACHTWOORD || env.BEHEER_WACHTWOORD.length < 10) {
    return { fout: "Het geheim BEHEER_WACHTWOORD ontbreekt of is korter dan 10 tekens. Zet het met: npx wrangler secret put BEHEER_WACHTWOORD" };
  }
  if (!env.GEHEIME_SLEUTEL || env.GEHEIME_SLEUTEL.length < 32) {
    return { fout: "Het geheim GEHEIME_SLEUTEL ontbreekt of is korter dan 32 tekens. Zet het met: npx wrangler secret put GEHEIME_SLEUTEL" };
  }
  return { wachtwoord: env.BEHEER_WACHTWOORD, sleutel: env.GEHEIME_SLEUTEL };
}

export async function maakSessie(sleutel: string, nuMs = Date.now()): Promise<string> {
  const geldigTot = nuMs + SESSIE_DUUR_MS;
  const inhoud = `v1.${geldigTot}`;
  return `${inhoud}.${await hmac(sleutel, `sessie:${inhoud}`)}`;
}

export async function controleerSessie(sleutel: string, waarde: string | undefined, nuMs = Date.now()): Promise<boolean> {
  if (!waarde) return false;
  const delen = waarde.split(".");
  if (delen.length !== 3 || delen[0] !== "v1") return false;
  const geldigTot = Number(delen[1]);
  if (!Number.isFinite(geldigTot) || geldigTot < nuMs) return false;
  const verwacht = await hmac(sleutel, `sessie:v1.${delen[1]}`);
  return gelijkInConstanteTijd(verwacht, delen[2]!);
}

/** Token voor de iCal-feed (geheim; wie de link heeft, ziet de agenda). */
export async function icalToken(sleutel: string): Promise<string> {
  return (await hmac(sleutel, "ical-feed-v1")).slice(0, 32);
}
