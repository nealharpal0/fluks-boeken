/** Kleine databasehulpjes: foto's, afmeldingen, rate limiting en instellingen. */
import type { Moment } from "../lib/tijd";

// ---------- Foto's ----------

export interface FotoInfo {
  id: number;
  afspraak_id: number;
  mime: string;
  grootte: number;
}

/** D1 staat waarden tot 2 MB toe; we houden wat marge. */
export const MAX_FOTO_BYTES = 1_900_000;

/** Herkent JPEG, PNG en WebP aan de eerste bytes (niet alleen aan de bestandsnaam). */
export function herkenAfbeelding(bytes: Uint8Array): string | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (
    bytes.length > 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export async function bewaarFoto(db: D1Database, afspraakId: number, mime: string, data: Uint8Array): Promise<void> {
  await db
    .prepare("INSERT INTO fotos (afspraak_id, mime, grootte, data) VALUES (?1, ?2, ?3, ?4)")
    .bind(afspraakId, mime, data.byteLength, data)
    .run();
}

export async function fotosVan(db: D1Database, afspraakId: number): Promise<FotoInfo[]> {
  const { results } = await db
    .prepare("SELECT id, afspraak_id, mime, grootte FROM fotos WHERE afspraak_id = ?1 ORDER BY id")
    .bind(afspraakId)
    .all<FotoInfo>();
  return results;
}

export async function haalFoto(db: D1Database, id: number): Promise<{ mime: string; data: ArrayBuffer } | null> {
  const rij = await db.prepare("SELECT mime, data FROM fotos WHERE id = ?1").bind(id).first<{ mime: string; data: ArrayBuffer | number[] }>();
  if (!rij) return null;
  const data = Array.isArray(rij.data) ? new Uint8Array(rij.data).buffer : rij.data;
  return { mime: rij.mime, data };
}

/** Aantal foto's per afspraak, voor lijsten. */
export async function fotoAantallen(db: D1Database, ids: number[]): Promise<Map<number, number>> {
  const uit = new Map<number, number>();
  if (!ids.length) return uit;
  const plekken = ids.map((_, i) => `?${i + 1}`).join(", ");
  const { results } = await db
    .prepare(`SELECT afspraak_id, COUNT(*) AS n FROM fotos WHERE afspraak_id IN (${plekken}) GROUP BY afspraak_id`)
    .bind(...ids)
    .all<{ afspraak_id: number; n: number }>();
  for (const r of results) uit.set(r.afspraak_id, r.n);
  return uit;
}

// ---------- Afmeldingen ----------

export async function meldAf(db: D1Database, email: string): Promise<void> {
  if (!email) return;
  await db.batch([
    db.prepare("INSERT INTO afmeldingen (email) VALUES (?1) ON CONFLICT (email) DO NOTHING").bind(email),
    db.prepare(
      "UPDATE afspraken SET toestemming_herinnering = 0, toestemming_review = 0, toestemming_onderhoud = 0 WHERE email = ?1",
    ).bind(email),
  ]);
}

export async function isAfgemeld(db: D1Database, email: string): Promise<boolean> {
  const r = await db.prepare("SELECT 1 AS x FROM afmeldingen WHERE email = ?1").bind(email).first();
  return !!r;
}

/** Een nieuwe boeking met toestemming heft een eerdere afmelding op (de klant kiest opnieuw). */
export async function heffAfmeldingOp(db: D1Database, email: string): Promise<void> {
  await db.prepare("DELETE FROM afmeldingen WHERE email = ?1").bind(email).run();
}

// ---------- Rate limiting ----------

/**
 * Telt een poging en geeft `false` terug als er in het venster al `max` pogingen waren.
 * Simpel maar voldoende tegen botjes en wachtwoord-raden.
 */
export async function binnenLimiet(
  db: D1Database,
  soort: string,
  sleutel: string,
  max: number,
  vensterMs: number,
  nuMs = Date.now(),
): Promise<boolean> {
  const telling = await db
    .prepare("SELECT COUNT(*) AS n FROM limieten WHERE soort = ?1 AND sleutel = ?2 AND tijd > ?3")
    .bind(soort, sleutel, nuMs - vensterMs)
    .first<{ n: number }>();
  if ((telling?.n ?? 0) >= max) return false;
  await db.prepare("INSERT INTO limieten (soort, sleutel, tijd) VALUES (?1, ?2, ?3)").bind(soort, sleutel, nuMs).run();
  return true;
}

export async function wisLimiet(db: D1Database, soort: string, sleutel: string): Promise<void> {
  await db.prepare("DELETE FROM limieten WHERE soort = ?1 AND sleutel = ?2").bind(soort, sleutel).run();
}

export async function ruimLimietenOp(db: D1Database, ouderDanMs: number): Promise<void> {
  await db.prepare("DELETE FROM limieten WHERE tijd < ?1").bind(ouderDanMs).run();
}

// ---------- Instellingen ----------

export async function leesInstelling(db: D1Database, sleutel: string): Promise<string | null> {
  const r = await db.prepare("SELECT waarde FROM instellingen WHERE sleutel = ?1").bind(sleutel).first<{ waarde: string }>();
  return r?.waarde ?? null;
}

export async function schrijfInstelling(db: D1Database, sleutel: string, waarde: string): Promise<void> {
  await db
    .prepare("INSERT INTO instellingen (sleutel, waarde) VALUES (?1, ?2) ON CONFLICT (sleutel) DO UPDATE SET waarde = excluded.waarde")
    .bind(sleutel, waarde)
    .run();
}

// ---------- Opruimen (AVG) ----------

/** Verwijdert foto's van afspraken die langer dan `dagen` geleden waren. */
export async function ruimFotosOp(db: D1Database, grens: Moment): Promise<number> {
  const r = await db
    .prepare("DELETE FROM fotos WHERE afspraak_id IN (SELECT id FROM afspraken WHERE eind < ?1)")
    .bind(grens)
    .run();
  return r.meta.changes;
}

/** Anonimiseert afspraken die vóór `grens` eindigden. */
export async function anonimiseerOud(db: D1Database, grens: Moment): Promise<number> {
  const [, r] = await db.batch([
    db.prepare(
      "UPDATE berichten SET ontvanger = '', inhoud_html = NULL, inhoud_tekst = NULL WHERE afspraak_id IN (SELECT id FROM afspraken WHERE eind < ?1 AND geanonimiseerd = 0)",
    ).bind(grens),
    db.prepare(
      `UPDATE afspraken SET naam = 'Verwijderd', email = '', telefoon = '', opmerking = '', extra_velden = '{}',
              interne_notitie = '', reden = '', toestemming_herinnering = 0, toestemming_review = 0,
              toestemming_onderhoud = 0, geanonimiseerd = 1
        WHERE eind < ?1 AND geanonimiseerd = 0`,
    ).bind(grens),
  ]);
  return r?.meta.changes ?? 0;
}
