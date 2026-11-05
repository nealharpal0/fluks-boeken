import { Hono } from "hono";
import { afsprakenIn, blokkadesIn } from "../db/afspraken";
import { gelijkInConstanteTijd, geheimen, icalToken } from "../lib/beveiliging";
import { type IcalEvent, maakIcal } from "../lib/ical";
import { datumVan, plusDagen } from "../lib/tijd";
import type { Omgeving } from "./hulp";

export const ical = new Hono<Omgeving>();

/**
 * Agenda-feed voor het bedrijf: /ical/<geheim-token>.ics
 * Google/Apple/Outlook halen deze periodiek op. Bevat afspraken van 60 dagen
 * terug tot een jaar vooruit, plus blokkades.
 */
ical.get("/ical/:bestand", async (c) => {
  const app = c.get("app");
  const bestand = c.req.param("bestand");
  const g = geheimen(c.env, app.demo);
  if (!bestand.endsWith(".ics") || "fout" in g) return c.text("Niet gevonden", 404);
  if (!(await gelijkInConstanteTijd(bestand.slice(0, -4), await icalToken(g.sleutel)))) return c.text("Niet gevonden", 404);

  const vandaag = datumVan(app.nu());
  const van = `${plusDagen(vandaag, -60)}T00:00`;
  const tot = `${plusDagen(vandaag, 366)}T00:00`;
  const [afspraken, blokkades] = await Promise.all([
    afsprakenIn(app.db, van, tot, ["aangevraagd", "bevestigd", "afgerond"]),
    blokkadesIn(app.db, van, tot),
  ]);
  const host = new URL(app.config.basisUrl).host;
  const metKlant = app.config.ical.metKlantgegevens;
  const events: IcalEvent[] = [
    ...afspraken.map(
      (a): IcalEvent => ({
        uid: `afspraak-${a.id}@${host}`,
        start: a.start,
        eind: a.eind,
        titel: `${a.status === "aangevraagd" ? "[Aanvraag] " : ""}${a.behandeling_naam}${metKlant ? ` – ${a.naam}` : ""}`,
        beschrijving: metKlant
          ? [a.telefoon && `Telefoon: ${a.telefoon}`, a.email && `E-mail: ${a.email}`, a.opmerking && `Opmerking: ${a.opmerking}`, `Beheer: ${app.config.basisUrl}/beheer/afspraak/${a.id}`]
              .filter(Boolean)
              .join("\n")
          : `Beheer: ${app.config.basisUrl}/beheer/afspraak/${a.id}`,
        status: a.status === "aangevraagd" ? "TENTATIVE" : "CONFIRMED",
        gewijzigd: a.gewijzigd_op,
      }),
    ),
    ...blokkades.map(
      (b): IcalEvent => ({
        uid: `blokkade-${b.id}@${host}`,
        start: b.start,
        eind: b.eind,
        titel: `Geblokkeerd${b.reden ? `: ${b.reden}` : ""}`,
        status: "CONFIRMED",
      }),
    ),
  ];
  return c.body(maakIcal({ naam: `Afspraken ${app.config.bedrijf.naam}`, tijdzone: app.tijdzone, events, feed: true }), 200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Cache-Control": "private, max-age=300",
  });
});
