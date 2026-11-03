/**
 * Databasefuncties voor afspraken en blokkades.
 *
 * DUBBELE BOEKINGEN
 * D1 (SQLite) voert elke SQL-instructie atomisch uit en schrijft nooit
 * gelijktijdig. Daarom controleren we "is dit tijdslot nog vrij?" en
 * "sla de afspraak op" in één en dezelfde instructie (INSERT ... SELECT ...
 * WHERE <geen conflict>, of UPDATE ... WHERE <geen conflict>). Twee klanten
 * die tegelijk op hetzelfde slot klikken: de eerste instructie slaagt, de
 * tweede vindt een conflict en wijzigt niets.
 */
import type { BezetteTijd, BlokkadeTijd } from "../lib/beschikbaarheid";
import type { Moment } from "../lib/tijd";
import { type Afspraak, type AfspraakStatus, BEZETTENDE_STATUSSEN, type Blokkade } from "../types";

const BEZET_SQL = `(${BEZETTENDE_STATUSSEN.map((s) => `'${s}'`).join(", ")})`;

/**
 * SQL-voorwaarde: het interval [start, bezetTot) botst niet met een blokkade
 * en er lopen nergens binnen dat interval al `capaciteit` afspraken tegelijk.
 * Parameters: start, bezetTot, negeerId (-1 = niets negeren), capaciteit.
 */
function geenConflict(p: { start: string; bezetTot: string; negeer: string; capaciteit: string }): string {
  return `
    NOT EXISTS (
      SELECT 1 FROM blokkades b WHERE b.start < ${p.bezetTot} AND b.eind > ${p.start}
    )
    AND NOT EXISTS (
      SELECT 1 FROM (
        SELECT ${p.start} AS punt
        UNION
        SELECT a.start FROM afspraken a
         WHERE a.status IN ${BEZET_SQL} AND a.id != ${p.negeer}
           AND a.start > ${p.start} AND a.start < ${p.bezetTot}
      ) punten
      WHERE (
        SELECT COUNT(*) FROM afspraken c
         WHERE c.status IN ${BEZET_SQL} AND c.id != ${p.negeer}
           AND c.start <= punten.punt AND c.bezet_tot > punten.punt
      ) >= ${p.capaciteit}
    )`;
}

export function nieuwToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface NieuweAfspraak {
  behandelingId: string;
  behandelingNaam: string;
  start: Moment;
  eind: Moment;
  bezetTot: Moment;
  status: "aangevraagd" | "bevestigd";
  naam: string;
  email: string;
  telefoon: string;
  opmerking: string;
  extraVelden: Record<string, string>;
  toestemmingHerinnering: boolean;
  toestemmingReview: boolean;
  toestemmingOnderhoud: boolean;
  bron: "online" | "beheer" | "demo";
  /** Lokale tijd van bevestigen (alleen bij status "bevestigd"). */
  bevestigdOp?: Moment | null;
  interneNotitie?: string;
}

/**
 * Slaat een nieuwe afspraak op, maar alleen als het tijdslot nog vrij is.
 * Geeft `null` terug als het slot (inmiddels) bezet is.
 */
export async function maakAfspraak(db: D1Database, a: NieuweAfspraak, capaciteit: number): Promise<Afspraak | null> {
  const metToestemming = a.toestemmingHerinnering || a.toestemmingReview || a.toestemmingOnderhoud;
  const rij = await db
    .prepare(
      `INSERT INTO afspraken (
         token, behandeling_id, behandeling_naam, start, eind, bezet_tot, status,
         naam, email, telefoon, opmerking, extra_velden,
         toestemming_herinnering, toestemming_review, toestemming_onderhoud, toestemming_op,
         bron, bevestigd_op, interne_notitie
       )
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19
       WHERE ${geenConflict({ start: "?4", bezetTot: "?6", negeer: "-1", capaciteit: "?20" })}
       RETURNING *`,
    )
    .bind(
      nieuwToken(),
      a.behandelingId,
      a.behandelingNaam,
      a.start,
      a.eind,
      a.bezetTot,
      a.status,
      a.naam,
      a.email,
      a.telefoon,
      a.opmerking,
      JSON.stringify(a.extraVelden),
      a.toestemmingHerinnering ? 1 : 0,
      a.toestemmingReview ? 1 : 0,
      a.toestemmingOnderhoud ? 1 : 0,
      metToestemming ? new Date().toISOString() : null,
      a.bron,
      a.status === "bevestigd" ? (a.bevestigdOp ?? null) : null,
      a.interneNotitie ?? "",
      capaciteit,
    )
    .first<Afspraak>();
  return rij ?? null;
}

export type WijzigUitkomst = { ok: true; afspraak: Afspraak } | { ok: false; reden: "niet_gevonden" | "status" | "bezet" };

/** Accepteert een aanvraag – alleen als die nog openstaat en er (nog steeds) plek is. */
export async function accepteerAfspraak(db: D1Database, id: number, capaciteit: number, nu: Moment): Promise<WijzigUitkomst> {
  const huidig = await haalAfspraak(db, id);
  if (!huidig) return { ok: false, reden: "niet_gevonden" };
  if (huidig.status !== "aangevraagd") return { ok: false, reden: "status" };
  const rij = await db
    .prepare(
      `UPDATE afspraken
          SET status = 'bevestigd', bevestigd_op = ?5, gewijzigd_op = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?1 AND status = 'aangevraagd' AND start = ?2 AND bezet_tot = ?3
          AND ${geenConflict({ start: "?2", bezetTot: "?3", negeer: "?1", capaciteit: "?4" })}
        RETURNING *`,
    )
    .bind(id, huidig.start, huidig.bezet_tot, capaciteit, nu)
    .first<Afspraak>();
  if (rij) return { ok: true, afspraak: rij };
  const opnieuw = await haalAfspraak(db, id);
  return { ok: false, reden: opnieuw?.status !== "aangevraagd" ? "status" : "bezet" };
}

/** Verzet een afspraak naar een nieuw tijdstip – alleen als dat tijdstip vrij is. */
export async function verzetAfspraak(
  db: D1Database,
  id: number,
  nieuw: { start: Moment; eind: Moment; bezetTot: Moment },
  capaciteit: number,
): Promise<WijzigUitkomst> {
  const rij = await db
    .prepare(
      `UPDATE afspraken
          SET start = ?2, eind = ?3, bezet_tot = ?4, gewijzigd_op = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?1 AND status IN ('aangevraagd', 'bevestigd')
          AND ${geenConflict({ start: "?2", bezetTot: "?4", negeer: "?1", capaciteit: "?5" })}
        RETURNING *`,
    )
    .bind(id, nieuw.start, nieuw.eind, nieuw.bezetTot, capaciteit)
    .first<Afspraak>();
  if (rij) return { ok: true, afspraak: rij };
  const huidig = await haalAfspraak(db, id);
  if (!huidig) return { ok: false, reden: "niet_gevonden" };
  if (huidig.status !== "aangevraagd" && huidig.status !== "bevestigd") return { ok: false, reden: "status" };
  return { ok: false, reden: "bezet" };
}

/** Zet de status om, maar alleen vanuit een van de toegestane statussen. */
export async function wijzigStatus(
  db: D1Database,
  id: number,
  van: AfspraakStatus[],
  naar: AfspraakStatus,
  extra: { reden?: string; klaarOp?: Moment } = {},
): Promise<Afspraak | null> {
  const plekken = van.map((_, i) => `?${i + 5}`).join(", ");
  return await db
    .prepare(
      `UPDATE afspraken
          SET status = ?2,
              reden = COALESCE(?3, reden),
              klaar_op = COALESCE(?4, klaar_op),
              gewijzigd_op = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?1 AND status IN (${plekken})
        RETURNING *`,
    )
    .bind(id, naar, extra.reden ?? null, extra.klaarOp ?? null, ...van)
    .first<Afspraak>();
}

export async function haalAfspraak(db: D1Database, id: number): Promise<Afspraak | null> {
  return await db.prepare("SELECT * FROM afspraken WHERE id = ?1").bind(id).first<Afspraak>();
}

export async function haalAfspraakOpToken(db: D1Database, token: string): Promise<Afspraak | null> {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(token)) return null;
  return await db.prepare("SELECT * FROM afspraken WHERE token = ?1").bind(token).first<Afspraak>();
}

/** Bezette tijden (actieve afspraken) die het interval [van, tot) raken. */
export async function bezetteTijden(db: D1Database, van: Moment, tot: Moment): Promise<BezetteTijd[]> {
  const { results } = await db
    .prepare(
      `SELECT id, start, bezet_tot AS bezetTot FROM afspraken
        WHERE status IN ${BEZET_SQL} AND start < ?2 AND bezet_tot > ?1`,
    )
    .bind(van, tot)
    .all<BezetteTijd>();
  return results;
}

export async function blokkadesIn(db: D1Database, van: Moment, tot: Moment): Promise<Blokkade[]> {
  const { results } = await db
    .prepare("SELECT id, start, eind, reden FROM blokkades WHERE start < ?2 AND eind > ?1 ORDER BY start")
    .bind(van, tot)
    .all<Blokkade>();
  return results;
}

export async function alleToekomstigeBlokkades(db: D1Database, vanaf: Moment): Promise<Blokkade[]> {
  const { results } = await db
    .prepare("SELECT id, start, eind, reden FROM blokkades WHERE eind > ?1 ORDER BY start")
    .bind(vanaf)
    .all<Blokkade>();
  return results;
}

export function alsBlokkadeTijden(b: Blokkade[]): BlokkadeTijd[] {
  return b.map(({ start, eind }) => ({ start, eind }));
}

export async function maakBlokkade(db: D1Database, start: Moment, eind: Moment, reden: string): Promise<Blokkade> {
  const rij = await db
    .prepare("INSERT INTO blokkades (start, eind, reden) VALUES (?1, ?2, ?3) RETURNING id, start, eind, reden")
    .bind(start, eind, reden)
    .first<Blokkade>();
  return rij!;
}

export async function verwijderBlokkade(db: D1Database, id: number): Promise<boolean> {
  const r = await db.prepare("DELETE FROM blokkades WHERE id = ?1").bind(id).run();
  return r.meta.changes > 0;
}

/** Afspraken (alle statussen of een selectie) die het interval [van, tot) raken. */
export async function afsprakenIn(
  db: D1Database,
  van: Moment,
  tot: Moment,
  statussen: AfspraakStatus[] = BEZETTENDE_STATUSSEN,
): Promise<Afspraak[]> {
  const plekken = statussen.map((_, i) => `?${i + 3}`).join(", ");
  const { results } = await db
    .prepare(`SELECT * FROM afspraken WHERE start < ?2 AND eind > ?1 AND status IN (${plekken}) ORDER BY start, id`)
    .bind(van, tot, ...statussen)
    .all<Afspraak>();
  return results;
}

export async function openAanvragen(db: D1Database): Promise<Afspraak[]> {
  const { results } = await db
    .prepare("SELECT * FROM afspraken WHERE status = 'aangevraagd' ORDER BY start, id")
    .all<Afspraak>();
  return results;
}

export async function zetNotitie(db: D1Database, id: number, notitie: string): Promise<void> {
  await db
    .prepare("UPDATE afspraken SET interne_notitie = ?2, gewijzigd_op = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1")
    .bind(id, notitie)
    .run();
}

export async function markeerReviewGeklikt(db: D1Database, id: number, nu: Moment): Promise<void> {
  await db
    .prepare("UPDATE afspraken SET review_geklikt_op = COALESCE(review_geklikt_op, ?2) WHERE id = ?1")
    .bind(id, nu)
    .run();
}

export function extraVeldenVan(a: Pick<Afspraak, "extra_velden">): Record<string, string> {
  try {
    const v = JSON.parse(a.extra_velden) as unknown;
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Andere afspraken van dezelfde klant (op e-mailadres). */
export async function afsprakenVanKlant(db: D1Database, email: string, behalveId?: number): Promise<Afspraak[]> {
  if (!email) return [];
  const { results } = await db
    .prepare("SELECT * FROM afspraken WHERE email = ?1 AND id != ?2 ORDER BY start DESC LIMIT 20")
    .bind(email, behalveId ?? -1)
    .all<Afspraak>();
  return results;
}

/**
 * AVG: wist de persoonsgegevens van alle afspraken met dit e-mailadres
 * (of alleen deze afspraak als er geen e-mailadres is). Foto's worden verwijderd.
 */
export async function anonimiseerKlant(db: D1Database, afspraak: Afspraak, nu: Moment): Promise<number> {
  const waar = afspraak.email ? "email = ?1" : "id = ?2";
  const ids = await db
    .prepare(`SELECT id FROM afspraken WHERE ${waar}`)
    .bind(afspraak.email, afspraak.id)
    .all<{ id: number }>();
  const lijst = ids.results.map((r) => r.id);
  if (!lijst.length) return 0;
  const plekken = lijst.map((_, i) => `?${i + 1}`).join(", ");
  await db.batch([
    db.prepare(`DELETE FROM fotos WHERE afspraak_id IN (${plekken})`).bind(...lijst),
    db.prepare(
      `UPDATE afspraken SET naam = 'Verwijderd', email = '', telefoon = '', opmerking = '', extra_velden = '{}',
              interne_notitie = '', reden = '', toestemming_herinnering = 0, toestemming_review = 0,
              toestemming_onderhoud = 0, geanonimiseerd = 1,
              status = CASE WHEN status IN ('aangevraagd', 'bevestigd') AND start > ?${lijst.length + 1} THEN 'geannuleerd' ELSE status END,
              gewijzigd_op = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id IN (${plekken})`,
    ).bind(...lijst, nu),
    db.prepare(`UPDATE berichten SET ontvanger = '', inhoud_html = NULL, inhoud_tekst = NULL WHERE afspraak_id IN (${plekken})`).bind(...lijst),
  ]);
  return lijst.length;
}
