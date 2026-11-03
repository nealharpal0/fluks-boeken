/** @jsxImportSource hono/jsx */
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { csrf } from "hono/csrf";
import {
  accepteer,
  annuleerDoorBedrijf,
  maakAfspraakDoorBeheer,
  markeerNietVerschenen,
  meldKlaar,
  planningRond,
  schoon,
  stuurTestmail,
  vandaag,
  verzet,
  vindBehandeling,
  weiger,
} from "../acties";
import { berichtenVanAfspraak } from "../berichten/dienst";
import { controleerConfig } from "../config/laden";
import {
  afsprakenIn,
  afsprakenVanKlant,
  alleToekomstigeBlokkades,
  anonimiseerKlant,
  blokkadesIn,
  haalAfspraak,
  maakBlokkade,
  openAanvragen,
  verwijderBlokkade,
  zetNotitie,
} from "../db/afspraken";
import { binnenLimiet, fotoAantallen, fotosVan, haalFoto, wisLimiet } from "../db/overig";
import { vulDemo } from "../demo/vullen";
import { vrijeTijdsloten } from "../lib/beschikbaarheid";
import { controleerSessie, gelijkInConstanteTijd, geheimen, icalToken, maakSessie, SESSIE_COOKIE, SESSIE_DUUR_MS } from "../lib/beveiliging";
import { datumVan, isGeldigeDatum, maakMoment, maandagVan, plusDagen } from "../lib/tijd";
import type { BerichtRij } from "../types";
import {
  AfspraakDetailPagina,
  AgendaPagina,
  BerichtenPagina,
  BerichtPagina,
  BlokkadesPagina,
  InlogPagina,
  InstellingenPagina,
  NieuweAfspraakPagina,
  OverzichtPagina,
} from "../views/beheer";
import { FoutPagina } from "../views/layout";
import { bezoekerIp, type Ctx, leesMelding, nummer, type Omgeving, tekstVeld, toon, zetMelding } from "./hulp";

export const beheer = new Hono<Omgeving>();

// Formulieren in het beheer mogen alleen vanaf onze eigen site komen.
beheer.use("*", csrf());

// Geen caching van beheerpagina's.
beheer.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

function veiligTerug(pad: string | undefined): string {
  return pad && pad.startsWith("/beheer") && !pad.startsWith("//") ? pad : "/beheer";
}

beheer.get("/inloggen", async (c) => {
  const app = c.get("app");
  const g = geheimen(c.env, app.demo);
  return toon(c, 
    <InlogPagina config={app.config} demo={app.demo} terug={veiligTerug(c.req.query("terug"))} configFout={"fout" in g ? g.fout : undefined} melding={leesMelding(c)} />,
  );
});

beheer.post("/inloggen", async (c) => {
  const app = c.get("app");
  const g = geheimen(c.env, app.demo);
  const body = await c.req.parseBody();
  const terug = veiligTerug(tekstVeld(body, "terug"));
  if ("fout" in g) return toon(c, <InlogPagina config={app.config} demo={app.demo} terug={terug} configFout={g.fout} />, 500);
  const ip = bezoekerIp(c);
  if (!(await binnenLimiet(app.db, "inloggen", ip, 10, 15 * 60_000))) {
    return toon(c, <InlogPagina config={app.config} demo={app.demo} terug={terug} fout="Te veel pogingen. Wacht een kwartier en probeer het opnieuw." />, 429);
  }
  if (!(await gelijkInConstanteTijd(tekstVeld(body, "wachtwoord"), g.wachtwoord))) {
    return toon(c, <InlogPagina config={app.config} demo={app.demo} terug={terug} fout="Dit wachtwoord klopt niet." />, 401);
  }
  await wisLimiet(app.db, "inloggen", ip);
  setCookie(c, SESSIE_COOKIE, await maakSessie(g.sleutel), {
    path: "/",
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Strict",
    maxAge: Math.floor(SESSIE_DUUR_MS / 1000),
  });
  return c.redirect(terug, 303);
});

// Alles hieronder vereist een geldige sessie.
beheer.use("*", async (c, next) => {
  const app = c.get("app");
  const g = geheimen(c.env, app.demo);
  if ("fout" in g || !(await controleerSessie(g.sleutel, getCookie(c, SESSIE_COOKIE)))) {
    if (c.req.method === "GET") {
      const url = new URL(c.req.url);
      return c.redirect(`/beheer/inloggen?terug=${encodeURIComponent(url.pathname + url.search)}`, 303);
    }
    return c.text("Niet ingelogd", 401);
  }
  await next();
});

beheer.post("/uitloggen", (c) => {
  deleteCookie(c, SESSIE_COOKIE, { path: "/" });
  zetMelding(c, { soort: "info", tekst: "Je bent uitgelogd." });
  return c.redirect("/beheer/inloggen", 303);
});

function basis(c: Ctx) {
  const app = c.get("app");
  return { config: app.config, demo: app.demo, melding: leesMelding(c) };
}

function nietGevonden(c: Ctx) {
  const app = c.get("app");
  return toon(c, <FoutPagina config={app.config} demo={app.demo} titel="Niet gevonden" tekst="Deze afspraak bestaat niet (meer)." terug="/beheer" />, 404);
}

// ---------------------------------------------------------------------------
// Overzicht en agenda
// ---------------------------------------------------------------------------

beheer.get("/", async (c) => {
  const app = c.get("app");
  const dag = vandaag(app);
  const [aanvragen, vandaagLijst, komend] = await Promise.all([
    openAanvragen(app.db),
    afsprakenIn(app.db, `${dag}T00:00`, `${plusDagen(dag, 1)}T00:00`, ["aangevraagd", "bevestigd", "afgerond", "niet_verschenen"]),
    afsprakenIn(app.db, `${plusDagen(dag, 1)}T00:00`, `${plusDagen(dag, 8)}T00:00`, ["bevestigd"]),
  ]);
  const controle = controleerConfig(app.config);
  return toon(c, 
    <OverzichtPagina
      {...basis(c)}
      aanvragen={aanvragen}
      vandaag={vandaagLijst}
      komend={komend}
      fotoAantallen={await fotoAantallen(app.db, aanvragen.map((a) => a.id))}
      waarschuwingen={[...controle.fouten, ...(app.demo ? [] : controle.waarschuwingen)]}
      datumVandaag={dag}
    />,
  );
});

beheer.get("/agenda", async (c) => {
  const app = c.get("app");
  const weergave = c.req.query("weergave") === "dag" ? "dag" : "week";
  const gevraagd = c.req.query("datum");
  const datum = gevraagd && isGeldigeDatum(gevraagd) ? gevraagd : vandaag(app);
  const van = weergave === "week" ? maandagVan(datum) : datum;
  const tot = plusDagen(van, weergave === "week" ? 7 : 1);
  const [afspraken, blokkades] = await Promise.all([
    afsprakenIn(app.db, `${van}T00:00`, `${tot}T00:00`, ["aangevraagd", "bevestigd", "afgerond", "niet_verschenen"]),
    blokkadesIn(app.db, `${van}T00:00`, `${tot}T00:00`),
  ]);
  return toon(c, <AgendaPagina {...basis(c)} weergave={weergave} datum={datum} vandaag={vandaag(app)} afspraken={afspraken} blokkades={blokkades} />);
});

// ---------------------------------------------------------------------------
// Afspraak
// ---------------------------------------------------------------------------

beheer.get("/afspraak/:id", async (c) => {
  const app = c.get("app");
  const id = nummer(c.req.param("id"));
  const a = id ? await haalAfspraak(app.db, id) : null;
  if (!a) return nietGevonden(c);
  const gevraagd = c.req.query("verzetDatum");
  const verzetDatum = gevraagd && isGeldigeDatum(gevraagd) ? gevraagd : datumVan(a.start);
  const planning = await planningRond(app, verzetDatum, verzetDatum);
  const verzetTijden = vrijeTijdsloten({
    config: app.config,
    behandeling: { duurMinuten: Math.round((Date.parse(`${a.eind}Z`) - Date.parse(`${a.start}Z`)) / 60_000) },
    datum: verzetDatum,
    nu: app.nu(),
    ...planning,
    negeerId: a.id,
    zonderTermijnen: true,
  }).filter((t) => maakMoment(verzetDatum, Number(t.slice(0, 2)) * 60 + Number(t.slice(3))) !== a.start);
  const [fotos, berichten, andere] = await Promise.all([fotosVan(app.db, a.id), berichtenVanAfspraak(app, a.id), afsprakenVanKlant(app.db, a.email, a.id)]);
  return toon(c, <AfspraakDetailPagina {...basis(c)} a={a} fotos={fotos} berichten={berichten} andere={andere} verzetDatum={verzetDatum} verzetTijden={verzetTijden} />);
});

type Uitkomst = { ok: true; melding: string } | { ok: false; fout: string };

async function naActie(c: Ctx, id: number, uitkomst: Uitkomst, terug?: string) {
  zetMelding(c, uitkomst.ok ? { soort: "succes", tekst: uitkomst.melding } : { soort: "fout", tekst: uitkomst.fout });
  const verwijzer = c.req.header("referer");
  const vanOverzicht = verwijzer && new URL(verwijzer, c.req.url).pathname === "/beheer";
  return c.redirect(terug ?? (vanOverzicht ? "/beheer" : `/beheer/afspraak/${id}`), 303);
}

beheer.post("/afspraak/:id/accepteren", async (c) => {
  const id = nummer(c.req.param("id"));
  if (!id) return nietGevonden(c);
  return naActie(c, id, await accepteer(c.get("app"), id));
});

beheer.post("/afspraak/:id/weigeren", async (c) => {
  const id = nummer(c.req.param("id"));
  if (!id) return nietGevonden(c);
  const body = await c.req.parseBody();
  return naActie(c, id, await weiger(c.get("app"), id, tekstVeld(body, "reden")));
});

beheer.post("/afspraak/:id/annuleren", async (c) => {
  const id = nummer(c.req.param("id"));
  if (!id) return nietGevonden(c);
  const body = await c.req.parseBody();
  return naActie(c, id, await annuleerDoorBedrijf(c.get("app"), id, tekstVeld(body, "reden")));
});

beheer.post("/afspraak/:id/klaar", async (c) => {
  const id = nummer(c.req.param("id"));
  if (!id) return nietGevonden(c);
  return naActie(c, id, await meldKlaar(c.get("app"), id));
});

beheer.post("/afspraak/:id/niet-verschenen", async (c) => {
  const id = nummer(c.req.param("id"));
  if (!id) return nietGevonden(c);
  return naActie(c, id, await markeerNietVerschenen(c.get("app"), id));
});

beheer.post("/afspraak/:id/verzetten", async (c) => {
  const id = nummer(c.req.param("id"));
  if (!id) return nietGevonden(c);
  const body = await c.req.parseBody();
  const datum = tekstVeld(body, "datum");
  const r = await verzet(c.get("app"), id, datum, tekstVeld(body, "tijd"));
  return naActie(c, id, r, r.ok ? undefined : `/beheer/afspraak/${id}?verzetDatum=${encodeURIComponent(datum)}#verzetten`);
});

beheer.post("/afspraak/:id/notitie", async (c) => {
  const app = c.get("app");
  const id = nummer(c.req.param("id"));
  if (!id) return nietGevonden(c);
  const body = await c.req.parseBody();
  await zetNotitie(app.db, id, schoon(tekstVeld(body, "notitie"), 2000));
  return naActie(c, id, { ok: true, melding: "Notitie opgeslagen." });
});

beheer.post("/afspraak/:id/wissen", async (c) => {
  const app = c.get("app");
  const id = nummer(c.req.param("id"));
  const a = id ? await haalAfspraak(app.db, id) : null;
  if (!a) return nietGevonden(c);
  const n = await anonimiseerKlant(app.db, a, app.nu());
  return naActie(c, a.id, { ok: true, melding: `Gegevens gewist van ${n} afspra${n === 1 ? "ak" : "ken"}.` });
});

beheer.get("/foto/:id", async (c) => {
  const app = c.get("app");
  const id = nummer(c.req.param("id"));
  const foto = id ? await haalFoto(app.db, id) : null;
  if (!foto) return c.text("Niet gevonden", 404);
  return c.body(foto.data, 200, {
    "Content-Type": foto.mime,
    "Cache-Control": "private, max-age=3600",
    "Content-Disposition": "inline",
  });
});

// ---------------------------------------------------------------------------
// Nieuwe afspraak
// ---------------------------------------------------------------------------

async function toonNieuw(c: Ctx, waarden: Record<string, string> = {}, fout?: string) {
  const app = c.get("app");
  const behandeling = vindBehandeling(app, waarden.behandeling ?? c.req.query("behandeling") ?? "", true) ?? app.config.behandelingen[0]!;
  const gevraagd = waarden.datum ?? c.req.query("datum");
  const datum = gevraagd && isGeldigeDatum(gevraagd) ? gevraagd : vandaag(app);
  const planning = await planningRond(app, datum, datum);
  const tijden = vrijeTijdsloten({ config: app.config, behandeling, datum, nu: app.nu(), ...planning, zonderTermijnen: true });
  return toon(c, 
    <NieuweAfspraakPagina {...basis(c)} datum={datum} tijden={tijden} behandelingId={behandeling.id} fout={fout} waarden={waarden} />,
    fout ? 422 : 200,
  );
}

beheer.get("/nieuw", (c) => toonNieuw(c));

beheer.post("/nieuw", async (c) => {
  const app = c.get("app");
  const body = await c.req.parseBody();
  const w = {
    behandeling: tekstVeld(body, "behandeling"),
    datum: tekstVeld(body, "datum"),
    tijd: tekstVeld(body, "tijd"),
    naam: schoon(tekstVeld(body, "naam"), 100),
    email: schoon(tekstVeld(body, "email"), 254),
    telefoon: schoon(tekstVeld(body, "telefoon"), 20),
    notitie: schoon(tekstVeld(body, "notitie"), 2000),
    bevestiging: tekstVeld(body, "bevestiging") === "ja" ? "ja" : "nee",
  };
  const r = await maakAfspraakDoorBeheer(app, {
    behandelingId: w.behandeling,
    datum: w.datum,
    tijd: w.tijd,
    naam: w.naam,
    email: w.email,
    telefoon: w.telefoon,
    notitie: w.notitie,
    stuurBevestiging: w.bevestiging === "ja",
  });
  if (!r.ok) return toonNieuw(c, w, r.fout);
  zetMelding(c, { soort: "succes", tekst: r.melding });
  return c.redirect(`/beheer/afspraak/${r.afspraak.id}`, 303);
});

// ---------------------------------------------------------------------------
// Blokkades
// ---------------------------------------------------------------------------

beheer.get("/blokkades", async (c) => {
  const app = c.get("app");
  const gevraagd = c.req.query("datum");
  const datum = gevraagd && isGeldigeDatum(gevraagd) ? gevraagd : vandaag(app);
  const blokkades = await alleToekomstigeBlokkades(app.db, `${vandaag(app)}T00:00`);
  return toon(c, <BlokkadesPagina {...basis(c)} blokkades={blokkades} datum={datum} />);
});

beheer.post("/blokkades", async (c) => {
  const app = c.get("app");
  const body = await c.req.parseBody();
  const vanDatum = tekstVeld(body, "van_datum");
  const totDatum = tekstVeld(body, "tot_datum") || vanDatum;
  const vanTijd = tekstVeld(body, "van_tijd") || "00:00";
  const totTijd = tekstVeld(body, "tot_tijd");
  const fout = (tekst: string) =>
    alleToekomstigeBlokkades(app.db, `${vandaag(app)}T00:00`).then((b) =>
      toon(c, <BlokkadesPagina {...basis(c)} blokkades={b} datum={isGeldigeDatum(vanDatum) ? vanDatum : vandaag(app)} fout={tekst} />, 422),
    );
  if (!isGeldigeDatum(vanDatum) || !isGeldigeDatum(totDatum)) return fout("Kies geldige datums.");
  if (!/^\d{2}:\d{2}$/.test(vanTijd) || (totTijd && !/^\d{2}:\d{2}$/.test(totTijd))) return fout("Kies geldige tijden.");
  const start = `${vanDatum}T${vanTijd}`;
  const eind = totTijd ? `${totDatum}T${totTijd}` : `${plusDagen(totDatum, 1)}T00:00`;
  if (eind <= start) return fout("Het einde moet na het begin liggen.");
  await maakBlokkade(app.db, start, eind, schoon(tekstVeld(body, "reden"), 200));
  const overlap = await afsprakenIn(app.db, start, eind, ["aangevraagd", "bevestigd"]);
  zetMelding(
    c,
    overlap.length
      ? {
          soort: "info",
          tekst: `Blokkade opgeslagen. Let op: ${overlap.length} bestaande afspra${overlap.length === 1 ? "ak valt" : "ken vallen"} in deze periode (${overlap.map((a) => a.naam).join(", ")}). Verzet of annuleer ${overlap.length === 1 ? "die" : "die"} zo nodig.`,
        }
      : { soort: "succes", tekst: "Blokkade opgeslagen. Klanten kunnen in deze periode niet boeken." },
  );
  return c.redirect("/beheer/blokkades", 303);
});

beheer.post("/blokkades/:id/verwijderen", async (c) => {
  const app = c.get("app");
  const id = nummer(c.req.param("id"));
  const ok = id ? await verwijderBlokkade(app.db, id) : false;
  zetMelding(c, ok ? { soort: "succes", tekst: "Blokkade verwijderd." } : { soort: "fout", tekst: "Blokkade niet gevonden." });
  return c.redirect("/beheer/blokkades", 303);
});

// ---------------------------------------------------------------------------
// Berichten
// ---------------------------------------------------------------------------

beheer.get("/berichten", async (c) => {
  const app = c.get("app");
  const { results } = await app.db.prepare("SELECT * FROM berichten ORDER BY id DESC LIMIT 200").all<BerichtRij>();
  return toon(c, <BerichtenPagina {...basis(c)} berichten={results} smtp={app.verzender.soort === "smtp"} />);
});

beheer.get("/berichten/:id", async (c) => {
  const app = c.get("app");
  const id = nummer(c.req.param("id"));
  const b = id ? await app.db.prepare("SELECT * FROM berichten WHERE id = ?1").bind(id).first<BerichtRij>() : null;
  if (!b) return nietGevonden(c);
  return toon(c, <BerichtPagina {...basis(c)} b={b} />);
});

/** De e-mail zelf, in een afgeschermd iframe (geen scripts, geen formulieren). */
beheer.get("/berichten/:id/voorbeeld", async (c) => {
  const app = c.get("app");
  const id = nummer(c.req.param("id"));
  const b = id ? await app.db.prepare("SELECT inhoud_html FROM berichten WHERE id = ?1").bind(id).first<{ inhoud_html: string | null }>() : null;
  if (!b?.inhoud_html) return c.text("Geen voorbeeld beschikbaar", 404);
  return c.body(b.inhoud_html, 200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "sandbox; default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; frame-ancestors 'self'",
    "X-Frame-Options": "SAMEORIGIN",
  });
});

// ---------------------------------------------------------------------------
// Instellingen
// ---------------------------------------------------------------------------

beheer.get("/instellingen", async (c) => {
  const app = c.get("app");
  const g = geheimen(c.env, app.demo);
  const token = "fout" in g ? "" : await icalToken(g.sleutel);
  const smtp = app.config.email.smtp;
  const smtpTekst = app.demo
    ? "Demo-modus: e-mails worden niet verstuurd maar zijn te bekijken onder Berichten."
    : smtp
      ? `E-mails gaan via ${smtp.host}:${smtp.poort} (${smtp.beveiliging}) als ${app.config.email.afzenderAdres}.${c.env.SMTP_WACHTWOORD ? "" : " Let op: het geheim SMTP_WACHTWOORD is niet gezet."}`
      : "Er is geen SMTP-server ingesteld: e-mails worden alleen gelogd.";
  const controle = controleerConfig(app.config);
  return toon(c, 
    <InstellingenPagina
      {...basis(c)}
      icalUrl={`${new URL(c.req.url).origin}/ical/${token}.ics`}
      fouten={controle.fouten}
      waarschuwingen={app.demo ? [] : controle.waarschuwingen}
      smtpTekst={smtpTekst}
    />,
  );
});

beheer.post("/testmail", async (c) => {
  const app = c.get("app");
  const uitkomst = await stuurTestmail(app);
  const teksten: Record<string, { soort: "succes" | "fout" | "info"; tekst: string }> = {
    verzonden: { soort: "succes", tekst: `Testmail verstuurd naar ${app.config.email.beheerderAdres}. Kijk ook in je spammap.` },
    gelogd: { soort: "info", tekst: "Er is geen SMTP ingesteld (of dit is de demo): de testmail is alleen gelogd onder Berichten." },
    mislukt: { soort: "fout", tekst: "Versturen mislukt. Bekijk de foutmelding onder Berichten en controleer de SMTP-instellingen en het geheim SMTP_WACHTWOORD." },
    overgeslagen: { soort: "fout", tekst: "Er is geen beheerdersadres ingesteld." },
  };
  zetMelding(c, teksten[uitkomst]!);
  return c.redirect("/beheer/instellingen", 303);
});

beheer.post("/demo/opnieuw", async (c) => {
  const app = c.get("app");
  if (!app.demo) return c.text("Alleen beschikbaar in de demo", 403);
  await vulDemo(app);
  zetMelding(c, { soort: "succes", tekst: "Demodata opnieuw geladen." });
  return c.redirect("/beheer", 303);
});
