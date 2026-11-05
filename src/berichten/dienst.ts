/**
 * Versturen met boekhouding: elk bericht krijgt een unieke sleutel in de
 * tabel `berichten`. Bestaat die sleutel al, dan wordt er niets verstuurd.
 * Zo kan een cron-run die twee keer draait (of een dubbele klik) nooit
 * dubbele e-mails opleveren. Mislukte berichten worden later opnieuw geprobeerd.
 */
import type { App } from "../app";
import type { BerichtSoort } from "../config/schema";
import { plusMinuten } from "../lib/tijd";
import type { BerichtRij } from "../types";
import type { BerichtInhoud } from "./opmaak";

export const MAX_POGINGEN = 3;

export interface VerstuurOpdracht {
  /** Unieke sleutel, bijv. "bevestiging:12". */
  sleutel: string;
  soort: BerichtSoort;
  afspraakId: number | null;
  aan: string;
  inhoud: BerichtInhoud;
  afmeldUrl?: string;
}

export type VerstuurUitkomst = "verzonden" | "gelogd" | "mislukt" | "overgeslagen";

async function verzendEnBoek(app: App, id: number, opdracht: { aan: string; inhoud: BerichtInhoud; afmeldUrl?: string }): Promise<VerstuurUitkomst> {
  const nu = app.nu();
  if (app.verzender.soort === "log") {
    await app.db
      .prepare(
        `UPDATE berichten SET status = 'gelogd', verzonden_op = ?2,
                inhoud_html = CASE WHEN ?3 THEN inhoud_html ELSE NULL END,
                inhoud_tekst = CASE WHEN ?3 THEN inhoud_tekst ELSE NULL END
          WHERE id = ?1`,
      )
      .bind(id, nu, app.demo ? 1 : 0)
      .run();
    return "gelogd";
  }
  try {
    await app.verzender.verstuur({ aan: opdracht.aan, ...opdracht.inhoud, afmeldUrl: opdracht.afmeldUrl });
    await app.db
      .prepare(
        `UPDATE berichten SET status = 'verzonden', verzonden_op = ?2, fout = '',
                inhoud_html = CASE WHEN ?3 THEN inhoud_html ELSE NULL END,
                inhoud_tekst = CASE WHEN ?3 THEN inhoud_tekst ELSE NULL END
          WHERE id = ?1`,
      )
      .bind(id, nu, app.demo ? 1 : 0)
      .run();
    return "verzonden";
  } catch (fout) {
    const melding = (fout as Error)?.message ?? String(fout);
    console.error(`E-mail ${id} mislukt: ${melding}`);
    await app.db
      .prepare("UPDATE berichten SET status = 'mislukt', fout = ?2 WHERE id = ?1")
      .bind(id, melding.slice(0, 500))
      .run();
    return "mislukt";
  }
}

/** Verstuurt een bericht precies één keer (per sleutel). */
export async function verstuurBericht(app: App, o: VerstuurOpdracht): Promise<VerstuurUitkomst> {
  if (!o.aan) return "overgeslagen";
  const rij = await app.db
    .prepare(
      `INSERT INTO berichten (sleutel, soort, afspraak_id, ontvanger, onderwerp, status, pogingen, inhoud_html, inhoud_tekst, aangemaakt_op)
       VALUES (?1, ?2, ?3, ?4, ?5, 'bezig', 1, ?6, ?7, ?8)
       ON CONFLICT (sleutel) DO NOTHING
       RETURNING id`,
    )
    .bind(o.sleutel, o.soort, o.afspraakId, o.aan, o.inhoud.onderwerp, o.inhoud.html, o.inhoud.tekst, app.nu())
    .first<{ id: number }>();
  if (!rij) return "overgeslagen";
  return verzendEnBoek(app, rij.id, o);
}

/** Bestaat er al een bericht met deze sleutel? */
export async function berichtBestaat(app: App, sleutel: string): Promise<boolean> {
  return !!(await app.db.prepare("SELECT 1 AS x FROM berichten WHERE sleutel = ?1").bind(sleutel).first());
}

/** Probeert mislukte berichten opnieuw (maximaal MAX_POGINGEN keer in totaal). */
export async function herprobeerMislukte(app: App, max: number): Promise<number> {
  const nu = app.nu();
  // Berichten die al een half uur "bezig" zijn, zijn waarschijnlijk onderbroken.
  await app.db
    .prepare("UPDATE berichten SET status = 'mislukt', fout = 'Onderbroken tijdens versturen' WHERE status = 'bezig' AND aangemaakt_op < ?1")
    .bind(plusMinuten(nu, -30))
    .run();
  const { results } = await app.db
    .prepare(
      `SELECT * FROM berichten
        WHERE status = 'mislukt' AND pogingen < ?1 AND inhoud_html IS NOT NULL AND ontvanger != ''
          AND aangemaakt_op > ?2
        ORDER BY id LIMIT ?3`,
    )
    .bind(MAX_POGINGEN, plusMinuten(nu, -2 * 24 * 60), max)
    .all<BerichtRij>();
  let aantal = 0;
  for (const b of results) {
    const claim = await app.db
      .prepare("UPDATE berichten SET status = 'bezig', pogingen = pogingen + 1 WHERE id = ?1 AND status = 'mislukt' RETURNING id")
      .bind(b.id)
      .first();
    if (!claim) continue;
    await verzendEnBoek(app, b.id, {
      aan: b.ontvanger,
      inhoud: { onderwerp: b.onderwerp, html: b.inhoud_html ?? "", tekst: b.inhoud_tekst ?? "" },
    });
    aantal++;
  }
  return aantal;
}

export async function berichtenVanAfspraak(app: App, afspraakId: number): Promise<BerichtRij[]> {
  const { results } = await app.db
    .prepare("SELECT * FROM berichten WHERE afspraak_id = ?1 ORDER BY id")
    .bind(afspraakId)
    .all<BerichtRij>();
  return results;
}
