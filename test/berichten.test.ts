import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { accepteer, boekAfspraak, meldKlaar, sjabloonContext, verzet, weiger } from "../src/acties";
import { herprobeerMislukte, verstuurBericht } from "../src/berichten/dienst";
import * as sjabloon from "../src/berichten/sjablonen";
import { markeerReviewGeklikt, wijzigStatus } from "../src/db/afspraken";
import { bewaarFoto, meldAf } from "../src/db/overig";
import { voerGeplandeTakenUit } from "../src/planner";
import type { BerichtRij } from "../src/types";
import { leegDatabase, testApp, testConfig, zetAfspraak } from "./hulp";

const NU = "2026-11-02T09:00";
const DAG = "2026-11-09";

beforeEach(leegDatabase);

async function berichten(): Promise<BerichtRij[]> {
  return (await env.DB.prepare("SELECT * FROM berichten ORDER BY id").all<BerichtRij>()).results;
}

describe("sjablonen", () => {
  it("maakt een nette Nederlandse bevestiging met HTML- én tekstversie", async () => {
    const { app } = testApp(NU);
    const a = await zetAfspraak(app, `${DAG}T10:00`, { naam: "Sanne de Vries" });
    const m = sjabloon.bevestiging(sjabloonContext(app), a);
    expect(m.onderwerp).toBe("Bevestigd: Handwas buiten op maandag 9 november 2026 om 10:00");
    expect(m.html).toContain("Hoi Sanne,");
    expect(m.html).toContain("Poetsstraat 7");
    expect(m.html).toContain(`https://boeken.test/afspraak/${a.token}/agenda.ics`);
    expect(m.html).toContain('lang="nl"');
    expect(m.tekst).toContain("Goed nieuws: je afspraak is bevestigd!");
    expect(m.tekst).not.toMatch(/<[a-z]/i);
    // Een bevestiging is transactioneel: geen afmeldlink.
    expect(m.html).not.toContain("/afmelden/");
  });

  it("ontsnapt HTML in klantgegevens (geen injectie in e-mails)", async () => {
    const { app } = testApp(NU);
    const a = await zetAfspraak(app, `${DAG}T10:00`, { naam: '<img src=x onerror="alert(1)">' });
    const m = sjabloon.nieuweAanvraag(sjabloonContext(app), a, 0);
    expect(m.html).not.toContain("<img src=x");
    expect(m.html).toContain("&lt;img src=x");
  });

  it("gebruikt eigen teksten met plaatshouders uit de config, inclusief extra velden", async () => {
    const config = testConfig((c) => {
      c.berichten.teksten = { klaar: { onderwerp: "{hond} is klaar!", tekst: "Hoi {voornaam},\n\n{hond} wacht op je bij {bedrijf}." } };
    });
    const { app } = testApp(NU, config);
    const a = await zetAfspraak(app, `${DAG}T10:00`, { naam: "Piet Jansen", extraVelden: { hond: "Bobbie" } });
    const m = sjabloon.klaar(sjabloonContext(app), a);
    expect(m.onderwerp).toBe("Bobbie is klaar!");
    expect(m.tekst).toContain("Bobbie wacht op je bij Glans & Co.");
    expect(m.html).toContain("Glans &amp; Co");
  });

  it("stuurt bij een review iedereen dezelfde link naar Google, zonder voorselectie (geen review-gating)", async () => {
    const { app } = testApp(NU);
    const a = await zetAfspraak(app, `${DAG}T10:00`);
    const m = sjabloon.review(sjabloonContext(app), a);
    const links = [...m.html.matchAll(/href="([^"]+)"/g)].map((x) => x[1]);
    expect(links).toContain(`https://boeken.test/r/${a.token}`);
    // Alleen de reviewlink, de afmeldlink en geen "niet tevreden?"-route.
    expect(links.filter((l) => !l!.includes("/afmelden/"))).toEqual([`https://boeken.test/r/${a.token}`]);
    expect(m.html.toLowerCase()).not.toMatch(/tevreden|ontevreden|sterren/);
    expect(m.html).toContain(`/afmelden/${a.token}`);
  });
});

describe("berichten bij acties", () => {
  it("stuurt bij een aanvraag een ontvangstbevestiging aan de klant en een melding aan de beheerder", async () => {
    const { app, verzender, wacht } = testApp(NU);
    const r = await boekAfspraak(app, {
      behandelingId: "coating",
      datum: DAG,
      tijd: "13:00",
      naam: "Mo Bakker",
      email: "Mo@Voorbeeld.nl",
      telefoon: "0612345678",
      opmerking: "Graag ook de velgen",
      extraVelden: { kenteken: "AB-123-C" },
      toestemmingHerinnering: true,
      toestemmingReview: false,
      toestemmingOnderhoud: false,
      fotos: [],
    });
    expect(r.ok).toBe(true);
    await wacht();
    expect(verzender.verzonden.map((v) => [v.aan, v.onderwerp]).sort()).toEqual([
      ["eigenaar@glansenco.example", "Nieuwe aanvraag: Keramische coating op maandag 9 november 2026 om 13:00"],
      ["mo@voorbeeld.nl", "We hebben je aanvraag ontvangen"],
    ]);
    const melding = verzender.verzonden.find((v) => v.aan === "eigenaar@glansenco.example")!;
    expect(melding.tekst).toContain("AB-123-C");
    expect(melding.tekst).toContain("Graag ook de velgen");
  });

  it("stuurt bevestiging, afwijzing, verzet- en klaar-berichten", async () => {
    const { app, verzender, wacht } = testApp(NU);
    const a = await zetAfspraak(app, `${DAG}T10:00`, { status: "aangevraagd" });
    const b = await zetAfspraak(app, `${DAG}T14:00`, { status: "aangevraagd", email: "b@voorbeeld.nl" });
    await accepteer(app, a.id);
    await weiger(app, b.id, "Die dag zijn we op cursus.");
    await verzet(app, a.id, DAG, "15:30");
    await meldKlaar(app, a.id);
    await wacht();
    const onderwerpen = verzender.verzonden.map((v) => v.onderwerp).sort();
    expect(onderwerpen).toEqual(
      [
        "Bevestigd: Handwas buiten op maandag 9 november 2026 om 10:00",
        "Je aanvraag voor maandag 9 november 2026 kunnen we helaas niet inplannen",
        "Je afspraak is verzet naar maandag 9 november 2026 om 15:30",
        "Je auto staat glanzend voor je klaar",
      ].sort(),
    );
    expect(verzender.verzonden.find((v) => v.aan === "b@voorbeeld.nl")!.tekst).toContain("Die dag zijn we op cursus.");
  });

  it("verstuurt een bericht met dezelfde sleutel nooit twee keer", async () => {
    const { app, verzender } = testApp(NU);
    const a = await zetAfspraak(app, `${DAG}T10:00`);
    const opdracht = { sleutel: `bevestiging:${a.id}`, soort: "bevestiging" as const, afspraakId: a.id, aan: a.email, inhoud: sjabloon.bevestiging(sjabloonContext(app), a) };
    const uitkomsten = await Promise.all([verstuurBericht(app, opdracht), verstuurBericht(app, opdracht), verstuurBericht(app, opdracht)]);
    expect(uitkomsten.filter((u) => u === "verzonden")).toHaveLength(1);
    expect(verzender.verzonden).toHaveLength(1);
  });

  it("probeert mislukte e-mails later opnieuw, maximaal drie keer", async () => {
    const { app, verzender } = testApp(NU);
    const a = await zetAfspraak(app, `${DAG}T10:00`);
    verzender.faalMet = "SMTP-server niet bereikbaar";
    const opdracht = { sleutel: "x:1", soort: "bevestiging" as const, afspraakId: a.id, aan: a.email, inhoud: sjabloon.bevestiging(sjabloonContext(app), a) };
    expect(await verstuurBericht(app, opdracht)).toBe("mislukt");
    expect((await berichten())[0]).toMatchObject({ status: "mislukt", pogingen: 1, fout: "SMTP-server niet bereikbaar" });
    await herprobeerMislukte(app, 10);
    await herprobeerMislukte(app, 10);
    await herprobeerMislukte(app, 10); // derde poging is al gedaan: niets meer
    expect((await berichten())[0]).toMatchObject({ status: "mislukt", pogingen: 3 });
    verzender.faalMet = null;
    await herprobeerMislukte(app, 10);
    expect(verzender.verzonden).toHaveLength(0);

    // Een nieuw bericht dat in de tweede poging lukt.
    verzender.faalMet = "tijdelijk";
    await verstuurBericht(app, { ...opdracht, sleutel: "x:2" });
    verzender.faalMet = null;
    await herprobeerMislukte(app, 10);
    const tweede = (await berichten())[1]!;
    expect(tweede).toMatchObject({ status: "verzonden", pogingen: 2, inhoud_html: null });
    expect(verzender.verzonden).toHaveLength(1);
  });
});

describe("geplande berichten (cron)", () => {
  it("stuurt 24 uur vooraf precies één herinnering, alleen met toestemming", async () => {
    const { app, verzender, zetNu } = testApp(NU);
    const met = await zetAfspraak(app, `${DAG}T10:00`, { bevestigdOp: NU });
    await zetAfspraak(app, `${DAG}T13:00`, { bevestigdOp: NU, email: "zonder@voorbeeld.nl", toestemmingHerinnering: false });

    zetNu("2026-11-08T09:45"); // nog meer dan 24 uur
    await voerGeplandeTakenUit(app);
    expect(verzender.verzonden).toHaveLength(0);

    zetNu("2026-11-08T10:00");
    const r = await voerGeplandeTakenUit(app);
    expect(r.verstuurd.herinnering).toBe(1);
    expect(verzender.verzonden).toHaveLength(1);
    expect(verzender.verzonden[0]).toMatchObject({ aan: met.email, onderwerp: "Herinnering: morgen om 10:00 handwas buiten" });
    expect(verzender.verzonden[0]!.afmeldUrl).toBe(`https://boeken.test/afmelden/${met.token}`);

    zetNu("2026-11-08T10:15");
    await voerGeplandeTakenUit(app);
    expect(verzender.verzonden).toHaveLength(1);
  });

  it("stuurt geen herinnering aan wie zich afmeldde of pas net een bevestiging kreeg, en wel opnieuw na verzetten", async () => {
    const { app, verzender, zetNu } = testApp(NU);
    const afgemeld = await zetAfspraak(app, `${DAG}T10:00`, { bevestigdOp: NU, email: "weg@voorbeeld.nl" });
    await meldAf(app.db, afgemeld.email);
    await zetAfspraak(app, `${DAG}T13:00`, { bevestigdOp: "2026-11-08T08:00", email: "laat@voorbeeld.nl" });
    const verzetbaar = await zetAfspraak(app, `${DAG}T15:00`, { bevestigdOp: NU, email: "verzet@voorbeeld.nl" });

    zetNu("2026-11-08T15:00");
    await voerGeplandeTakenUit(app);
    expect(verzender.verzonden.map((v) => v.aan)).toEqual(["verzet@voorbeeld.nl"]);

    // Verzetten naar de dag erna: nieuwe herinnering op het nieuwe moment.
    await verzet(app, verzetbaar.id, "2026-11-10", "15:00");
    zetNu("2026-11-09T15:00");
    await voerGeplandeTakenUit(app);
    expect(verzender.verzonden.filter((v) => v.onderwerp.startsWith("Herinnering"))).toHaveLength(2);
  });

  it("stuurt na afloop een reviewverzoek met precies één herinnering", async () => {
    const { app, verzender, zetNu } = testApp(NU);
    const a = await zetAfspraak(app, `${DAG}T10:00`, { bevestigdOp: NU, toestemmingHerinnering: false });
    await zetAfspraak(app, `${DAG}T13:00`, { bevestigdOp: NU, email: "geen-review@voorbeeld.nl", toestemmingReview: false, toestemmingHerinnering: false });

    zetNu(`${DAG}T13:30`); // 2,5 uur na afloop: nog niet
    await voerGeplandeTakenUit(app);
    expect(verzender.verzonden).toHaveLength(0);

    zetNu(`${DAG}T14:00`);
    await voerGeplandeTakenUit(app);
    expect(verzender.verzonden.map((v) => [v.aan, v.onderwerp])).toEqual([[a.email, "Hoe was je ervaring bij Glans & Co?"]]);

    zetNu("2026-11-12T14:00"); // na 3 dagen: nog geen herinnering
    await voerGeplandeTakenUit(app);
    expect(verzender.verzonden).toHaveLength(1);

    zetNu("2026-11-13T14:15");
    await voerGeplandeTakenUit(app);
    expect(verzender.verzonden.map((v) => v.onderwerp)).toEqual(["Hoe was je ervaring bij Glans & Co?", "Nog even over je bezoek aan Glans & Co"]);

    zetNu("2026-11-25T14:00"); // nooit een tweede herinnering
    await voerGeplandeTakenUit(app);
    expect(verzender.verzonden).toHaveLength(2);
  });

  it("stuurt geen reviewherinnering na een klik op de reviewlink, en niet vaker dan ingesteld", async () => {
    const { app, verzender, zetNu } = testApp(NU);
    const a = await zetAfspraak(app, `${DAG}T10:00`, { bevestigdOp: NU, toestemmingHerinnering: false });
    zetNu(`${DAG}T15:00`);
    await voerGeplandeTakenUit(app);
    await markeerReviewGeklikt(app.db, a.id, `${DAG}T16:00`);
    zetNu("2026-11-14T15:00");
    await voerGeplandeTakenUit(app);
    expect(verzender.verzonden).toHaveLength(1);

    // Zelfde klant komt een maand later terug: binnen 180 dagen geen nieuw reviewverzoek.
    await zetAfspraak(app, "2026-12-09T10:00", { bevestigdOp: NU, toestemmingHerinnering: false });
    zetNu("2026-12-09T15:00");
    await voerGeplandeTakenUit(app);
    expect(verzender.verzonden).toHaveLength(1);
  });

  it("stuurt geen reviewverzoek bij 'niet verschenen' of zonder Google-link", async () => {
    const zonderLink = testConfig((c) => {
      c.bedrijf.googleReviewUrl = undefined;
    });
    const { app, verzender, zetNu } = testApp(NU, zonderLink);
    await zetAfspraak(app, `${DAG}T10:00`, { bevestigdOp: NU, toestemmingHerinnering: false });
    zetNu(`${DAG}T15:00`);
    await voerGeplandeTakenUit(app);
    expect(verzender.verzonden).toHaveLength(0);

    await leegDatabase();
    const t = testApp(NU);
    const a = await zetAfspraak(t.app, "2026-11-10T10:00", { bevestigdOp: NU, toestemmingHerinnering: false });
    await wijzigStatus(t.app.db, a.id, ["bevestigd"], "niet_verschenen");
    t.zetNu("2026-11-10T15:00");
    await voerGeplandeTakenUit(t.app);
    expect(t.verzender.verzonden).toHaveLength(0);
  });

  it("stuurt een onderhoudsherinnering alleen met toestemming en als de klant nog niet terugkwam", async () => {
    const { app, verzender, zetNu } = testApp(NU);
    const opties = { bevestigdOp: NU, toestemmingHerinnering: false, toestemmingReview: false };
    const met = await zetAfspraak(app, `${DAG}T10:00`, { ...opties, email: "met@voorbeeld.nl" });
    await zetAfspraak(app, `${DAG}T13:00`, { ...opties, email: "zonder@voorbeeld.nl", toestemmingOnderhoud: false });
    await zetAfspraak(app, `${DAG}T15:00`, { ...opties, email: "terug@voorbeeld.nl" });
    await zetAfspraak(app, "2026-12-01T10:00", { ...opties, email: "terug@voorbeeld.nl" });

    zetNu("2026-12-20T10:00"); // handwas: na 6 weken (21 december)
    await voerGeplandeTakenUit(app);
    expect(verzender.verzonden).toHaveLength(0);

    zetNu("2026-12-21T12:00");
    await voerGeplandeTakenUit(app);
    expect(verzender.verzonden.map((v) => [v.aan, v.onderwerp])).toEqual([[met.email, "Tijd voor een nieuwe handwas buiten?"]]);
    expect(verzender.verzonden[0]!.tekst).toContain("zes weken");

    zetNu("2026-12-22T12:00");
    await voerGeplandeTakenUit(app);
    expect(verzender.verzonden).toHaveLength(1);
  });

  it("stuurt seizoensherinneringen eenmalig, alleen naar klanten met toestemming", async () => {
    const { app, verzender, zetNu } = testApp("2027-01-10T09:00");
    const opties = { bevestigdOp: NU, toestemmingHerinnering: false, toestemmingReview: false };
    await zetAfspraak(app, "2026-11-09T10:00", { ...opties, email: "ja@voorbeeld.nl", naam: "Ja Klant" });
    await zetAfspraak(app, "2026-11-10T10:00", { ...opties, email: "nee@voorbeeld.nl", toestemmingOnderhoud: false });
    // Eerst toestemming, later bij een nieuwe boeking niet meer: de laatste keuze telt.
    await zetAfspraak(app, "2026-10-01T10:00", { ...opties, email: "later-nee@voorbeeld.nl" });
    await zetAfspraak(app, "2026-11-11T10:00", { ...opties, email: "later-nee@voorbeeld.nl", toestemmingOnderhoud: false });

    zetNu("2027-03-14T10:00");
    await voerGeplandeTakenUit(app);
    expect(verzender.verzonden.filter((v) => v.onderwerp.includes("wintervuil"))).toHaveLength(0);

    zetNu("2027-03-15T10:00");
    await voerGeplandeTakenUit(app);
    zetNu("2027-03-16T10:00");
    await voerGeplandeTakenUit(app);
    const seizoen = verzender.verzonden.filter((v) => v.onderwerp === "Tijd om het wintervuil eraf te halen");
    expect(seizoen.map((v) => v.aan)).toEqual(["ja@voorbeeld.nl"]);
    expect(seizoen[0]!.tekst).toContain("Hoi Ja,");
  });

  it("zet onbeantwoorde aanvragen op verlopen en laat de klant dat weten", async () => {
    const { app, verzender, zetNu } = testApp(NU);
    const a = await zetAfspraak(app, `${DAG}T10:00`, { status: "aangevraagd" });
    zetNu(`${DAG}T10:00`);
    const r = await voerGeplandeTakenUit(app);
    expect(r.verlopen).toBe(1);
    const nu = await env.DB.prepare("SELECT status FROM afspraken WHERE id = ?").bind(a.id).first<{ status: string }>();
    expect(nu!.status).toBe("verlopen");
    expect(verzender.verzonden[0]!.onderwerp).toBe("We konden je aanvraag niet op tijd bevestigen");
  });

  it("verwijdert oude foto's en anonimiseert oude klantgegevens (AVG)", async () => {
    const { app, zetNu } = testApp(NU);
    const a = await zetAfspraak(app, `${DAG}T10:00`, { toestemmingReview: false, toestemmingHerinnering: false, toestemmingOnderhoud: false });
    await bewaarFoto(app.db, a.id, "image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0x00]));

    zetNu("2026-12-08T12:00"); // 29 dagen later
    expect((await voerGeplandeTakenUit(app)).fotosVerwijderd).toBe(0);
    zetNu("2026-12-10T12:00");
    expect((await voerGeplandeTakenUit(app)).fotosVerwijderd).toBe(1);

    zetNu("2028-11-20T12:00"); // ruim 24 maanden later
    expect((await voerGeplandeTakenUit(app)).geanonimiseerd).toBe(1);
    const rij = await env.DB.prepare("SELECT naam, email, telefoon FROM afspraken WHERE id = ?").bind(a.id).first();
    expect(rij).toEqual({ naam: "Verwijderd", email: "", telefoon: "" });
  });

  it("blijft binnen het maximum aantal e-mails per run", async () => {
    const { app, verzender, zetNu } = testApp("2026-10-01T09:00");
    for (let i = 0; i < 30; i++) {
      const dag = `2026-11-${String(2 + Math.floor(i / 6) * 1).padStart(2, "0")}`;
      await zetAfspraak(app, `${dag}T${String(8 + (i % 6)).padStart(2, "0")}:00`, {
        duur: 30,
        bevestigdOp: "2026-10-01T09:00",
        email: `klant${i}@voorbeeld.nl`,
        toestemmingHerinnering: false,
        toestemmingOnderhoud: false,
      });
    }
    zetNu("2026-11-07T12:00");
    await voerGeplandeTakenUit(app);
    expect(verzender.verzonden).toHaveLength(25);
    await voerGeplandeTakenUit(app);
    expect(verzender.verzonden).toHaveLength(30);
  });
});
