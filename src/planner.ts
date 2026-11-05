/**
 * Geplande taken (Cron Trigger, standaard elke 15 minuten):
 *
 *  1. aanvragen waarvan het tijdstip voorbij is → "verlopen" (+ bericht)
 *  2. herinnering X uur vooraf (alleen met toestemming)
 *  3. reviewverzoek na afloop + precies één herinnering (alleen met toestemming)
 *  4. onderhoudsherinnering na X weken (alleen met toestemming)
 *  5. seizoensherinneringen (alleen met toestemming)
 *  6. mislukte e-mails opnieuw proberen
 *  7. AVG-opruiming: foto's verwijderen, oude klantgegevens anonimiseren
 *
 * Elke e-mail heeft een unieke sleutel (zie berichten/dienst.ts), dus als deze
 * taak vaker draait dan nodig wordt er nooit iets dubbel verstuurd.
 */
import { sjabloonContext } from "./acties";
import type { App } from "./app";
import { berichtBestaat, herprobeerMislukte, verstuurBericht, type VerstuurUitkomst } from "./berichten/dienst";
import * as sjabloon from "./berichten/sjablonen";
import type { BerichtSoort } from "./config/schema";
import { anonimiseerOud, leesInstelling, ruimFotosOp, ruimLimietenOp, schrijfInstelling } from "./db/overig";
import { datumVan, isGeldigeDatum, plusDagen, plusUren } from "./lib/tijd";
import type { Afspraak } from "./types";

/** Maximaal aantal e-mails per run, om binnen de limieten van het gratis plan te blijven. */
export const MAX_PER_RUN = 25;

export interface PlannerResultaat {
  verlopen: number;
  verstuurd: Partial<Record<BerichtSoort, number>>;
  herprobeerd: number;
  fotosVerwijderd: number;
  geanonimiseerd: number;
}

const NIET_AFGEMELD = "a.email != '' AND a.geanonimiseerd = 0 AND a.email NOT IN (SELECT email FROM afmeldingen)";

export async function voerGeplandeTakenUit(app: App): Promise<PlannerResultaat> {
  const nu = app.nu();
  const ctx = sjabloonContext(app);
  const cfg = app.config.berichten;
  const res: PlannerResultaat = { verlopen: 0, verstuurd: {}, herprobeerd: 0, fotosVerwijderd: 0, geanonimiseerd: 0 };
  let budget = MAX_PER_RUN;

  const stuur = async (soort: BerichtSoort, sleutel: string, a: Afspraak, inhoud: () => ReturnType<typeof sjabloon.review>, afmelden = true) => {
    if (budget <= 0) return;
    if (await berichtBestaat(app, sleutel)) return;
    budget--;
    const uitkomst: VerstuurUitkomst = await verstuurBericht(app, {
      sleutel,
      soort,
      afspraakId: a.id,
      aan: a.email,
      inhoud: inhoud(),
      afmeldUrl: afmelden ? sjabloon.links.afmelden(ctx, a) : undefined,
    });
    if (uitkomst === "verzonden" || uitkomst === "gelogd") res.verstuurd[soort] = (res.verstuurd[soort] ?? 0) + 1;
  };

  try {
    // 1. Verlopen aanvragen
    const { results: verlopen } = await app.db
      .prepare("UPDATE afspraken SET status = 'verlopen', gewijzigd_op = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE status = 'aangevraagd' AND start <= ?1 RETURNING *")
      .bind(nu)
      .all<Afspraak>();
    res.verlopen = verlopen.length;
    for (const a of verlopen) {
      if (a.email) await stuur("verlopen", `verlopen:${a.id}`, a, () => sjabloon.verlopen(ctx, a), false);
    }

    // 2. Herinneringen vooraf
    if (cfg.herinnering.aan) {
      const uren = cfg.herinnering.urenVooraf;
      const { results } = await app.db
        .prepare(
          `SELECT a.* FROM afspraken a
            WHERE a.status = 'bevestigd' AND a.toestemming_herinnering = 1 AND ${NIET_AFGEMELD}
              AND a.start > ?1 AND a.start <= ?2
            ORDER BY a.start`,
        )
        .bind(nu, plusUren(nu, uren))
        .all<Afspraak>();
      for (const a of results) {
        // Wie pas kort van tevoren een bevestiging kreeg, heeft geen herinnering nodig.
        if (a.bevestigd_op && a.bevestigd_op > plusUren(a.start, -(uren + 12))) continue;
        await stuur("herinnering", `herinnering:${a.id}:${a.start}`, a, () => sjabloon.herinnering(ctx, a, datumVan(nu)));
      }
    }

    // 3. Reviewverzoeken (zonder review-gating: iedereen met toestemming krijgt dezelfde link)
    if (cfg.review.aan && app.config.bedrijf.googleReviewUrl) {
      const grens = plusUren(nu, -cfg.review.urenNaAfloop);
      const { results } = await app.db
        .prepare(
          `SELECT a.* FROM afspraken a
            WHERE a.status IN ('bevestigd', 'afgerond') AND a.toestemming_review = 1 AND ${NIET_AFGEMELD}
              AND a.start <= ?3 AND a.start > ?4
              AND COALESCE(a.klaar_op, a.eind) <= ?1 AND a.eind > ?2
              AND NOT EXISTS (SELECT 1 FROM berichten b WHERE b.sleutel = 'review:' || a.id)
            ORDER BY a.eind`,
        )
        .bind(grens, plusUren(nu, -7 * 24), nu, plusUren(nu, -8 * 24))
        .all<Afspraak>();
      const nietVaker = cfg.review.nietVakerDanDagen;
      for (const a of results) {
        const recent = await app.db
          .prepare(
            "SELECT 1 AS x FROM berichten b WHERE b.soort = 'review' AND b.ontvanger = ?1 AND b.aangemaakt_op > ?2 LIMIT 1",
          )
          .bind(a.email, plusUren(nu, -nietVaker * 24))
          .first();
        if (recent) continue;
        await stuur("review", `review:${a.id}`, a, () => sjabloon.review(ctx, a));
      }

      // Eén herinnering, alleen als er nog niet op de reviewlink is geklikt.
      const { results: herinneren } = await app.db
        .prepare(
          `SELECT a.* FROM berichten b JOIN afspraken a ON a.id = b.afspraak_id
            WHERE b.soort = 'review' AND b.verzonden_op <= ?1 AND b.verzonden_op > ?2 AND b.status IN ('verzonden', 'gelogd')
              AND a.review_geklikt_op IS NULL AND a.toestemming_review = 1 AND ${NIET_AFGEMELD}
              AND NOT EXISTS (SELECT 1 FROM berichten r WHERE r.sleutel = 'review_herinnering:' || a.id)`,
        )
        .bind(plusUren(nu, -cfg.review.herinneringNaDagen * 24), plusUren(nu, -30 * 24))
        .all<Afspraak>();
      for (const a of herinneren) {
        await stuur("review_herinnering", `review_herinnering:${a.id}`, a, () => sjabloon.reviewHerinnering(ctx, a));
      }
    }

    // 4. Onderhoudsherinneringen
    if (cfg.onderhoud.aan) {
      for (const b of app.config.behandelingen.filter((x) => x.onderhoudNaWeken)) {
        const weken = b.onderhoudNaWeken!;
        const grens = plusUren(nu, -weken * 7 * 24);
        const { results } = await app.db
          .prepare(
            `SELECT a.* FROM afspraken a
              WHERE a.behandeling_id = ?1 AND a.status IN ('bevestigd', 'afgerond') AND a.toestemming_onderhoud = 1
                AND ${NIET_AFGEMELD}
                AND a.start <= ?2 AND a.start > ?4
                AND a.eind <= ?2 AND a.eind > ?3
                AND NOT EXISTS (
                  SELECT 1 FROM afspraken later
                   WHERE later.email = a.email AND later.start > a.start
                     AND later.status IN ('aangevraagd', 'bevestigd', 'afgerond')
                )
                AND NOT EXISTS (SELECT 1 FROM berichten m WHERE m.sleutel = 'onderhoud:' || a.id)`,
          )
          .bind(b.id, grens, plusUren(grens, -14 * 24), plusUren(grens, -15 * 24))
          .all<Afspraak>();
        for (const a of results) {
          await stuur("onderhoud", `onderhoud:${a.id}`, a, () => sjabloon.onderhoud(ctx, a, weken, b.onderhoudTekst));
        }
      }
    }

    // 5. Seizoensherinneringen: in de 7 dagen vanaf de ingestelde datum.
    if (cfg.onderhoud.aan) {
      const jaar = Number(nu.slice(0, 4));
      const vandaag = datumVan(nu);
      for (const s of cfg.seizoen ?? []) {
        const datum = `${jaar}-${s.datum}`;
        if (!isGeldigeDatum(datum) || vandaag < datum || vandaag > plusDagen(datum, 6)) continue;
        const klaarSleutel = `seizoen_klaar:${s.id}:${jaar}`;
        if (await leesInstelling(app.db, klaarSleutel)) continue;
        // De meest recente afspraak per klant bepaalt of er (nog) toestemming is.
        const { results } = await app.db
          .prepare(
            `SELECT a.* FROM afspraken a
              WHERE a.toestemming_onderhoud = 1 AND ${NIET_AFGEMELD}
                AND a.status IN ('aangevraagd', 'bevestigd', 'afgerond')
                AND a.start > ?1
                AND a.id = (SELECT x.id FROM afspraken x WHERE x.email = a.email ORDER BY x.start DESC, x.id DESC LIMIT 1)
                AND NOT EXISTS (SELECT 1 FROM berichten m WHERE m.sleutel = ?2 || a.email)
              LIMIT ?3`,
          )
          .bind(plusUren(nu, -548 * 24), `seizoen:${s.id}:${jaar}:`, budget)
          .all<Afspraak>();
        for (const a of results) {
          await stuur("seizoen", `seizoen:${s.id}:${jaar}:${a.email}`, a, () => sjabloon.seizoen(ctx, a, s));
        }
        // Iedereen gehad? Dan hoeft deze (zwaardere) zoekopdracht dit jaar niet meer te draaien.
        if (budget > 0 && results.length === 0) await schrijfInstelling(app.db, klaarSleutel, nu);
      }
    }

    // 6. Mislukte e-mails opnieuw proberen
    if (budget > 0) res.herprobeerd = await herprobeerMislukte(app, budget);
  } finally {
    await app.verzender.sluit();
  }

  // 7. Privacy-opruiming: één keer per dag is genoeg.
  if ((await leesInstelling(app.db, "opruiming_op")) === datumVan(nu)) return res;
  await schrijfInstelling(app.db, "opruiming_op", datumVan(nu));
  res.fotosVerwijderd = await ruimFotosOp(app.db, plusUren(nu, -app.config.privacy.fotosBewarenDagen * 24));
  res.geanonimiseerd = await anonimiseerOud(app.db, plusDagen(datumVan(nu), -Math.round(app.config.privacy.gegevensBewarenMaanden * 30.44)) + "T00:00");
  await ruimLimietenOp(app.db, Date.now() - 24 * 3600_000);

  return res;
}
