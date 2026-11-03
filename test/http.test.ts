import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppOpties } from "../src/app";
import { GeheugenVerzender } from "../src/berichten/verzender";
import { icalToken } from "../src/lib/beveiliging";
import { maakWorker } from "../src/index";
import type { Afspraak } from "../src/types";
import { leegDatabase, testConfig } from "./hulp";

const NU = "2026-11-02T09:00";
const DAG = "2026-11-09";
const BASIS = "https://boeken.test";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

let verzender: GeheugenVerzender;
let klok: string;

function worker(opties: Partial<AppOpties> = {}) {
  return maakWorker({ config: testConfig(), verzender, nu: () => klok, ...opties });
}

async function vraag(pad: string, init: RequestInit = {}, w = worker(), omgeving: Cloudflare.Env = env): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await w.fetch(new Request(BASIS + pad, { redirect: "manual", ...init }), omgeving, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

function boekFormulier(over: Record<string, string> = {}, fotos: File[] = []): FormData {
  const f = new FormData();
  const velden = { datum: DAG, tijd: "10:00", naam: "Sanne de Vries", email: "sanne@voorbeeld.nl", telefoon: "0612345678", ...over };
  for (const [k, v] of Object.entries(velden)) f.set(k, v);
  for (const foto of fotos) f.append("fotos", foto);
  return f;
}

async function inloggen(): Promise<string> {
  const res = await vraag("/beheer/inloggen", {
    method: "POST",
    headers: { Origin: BASIS, "Content-Type": "application/x-www-form-urlencoded" },
    body: "wachtwoord=test-wachtwoord-123&terug=/beheer",
  });
  expect(res.status).toBe(303);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

async function afspraken(): Promise<Afspraak[]> {
  return (await env.DB.prepare("SELECT * FROM afspraken ORDER BY id").all<Afspraak>()).results;
}

beforeEach(async () => {
  await leegDatabase();
  verzender = new GeheugenVerzender();
  klok = NU;
});

describe("klantkant", () => {
  it("toont de startpagina met behandelingen, doctype en beveiligingsheaders", async () => {
    const res = await vraag("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<html lang="nl">');
    expect(html).toContain("Keramische coating");
    expect(html).toContain("vanaf € 649");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("toont vrije tijden voor een dag en houdt rekening met bestaande afspraken", async () => {
    let html = await (await vraag(`/boeken/handwas?datum=${DAG}`)).text();
    expect(html).toContain(`datum=${DAG}&amp;tijd=10%3A00`);
    await vraag("/boeken/handwas", { method: "POST", body: boekFormulier() });
    html = await (await vraag(`/boeken/handwas?datum=${DAG}`)).text();
    expect(html).not.toContain(`datum=${DAG}&amp;tijd=10%3A00`);
    expect(html).toContain(`datum=${DAG}&amp;tijd=11%3A15`);
  });

  it("verwerkt een aanvraag van begin tot eind", async () => {
    const res = await vraag("/boeken/handwas", {
      method: "POST",
      body: boekFormulier({ extra_kenteken: "AB-123-C", toestemming_review: "ja" }, [new File([JPEG], "auto.jpg", { type: "image/jpeg" })]),
    });
    expect(res.status).toBe(303);
    const [a] = await afspraken();
    expect(a).toMatchObject({ status: "aangevraagd", start: `${DAG}T10:00`, toestemming_review: 1, toestemming_herinnering: 0 });
    expect(JSON.parse(a!.extra_velden)).toEqual({ kenteken: "AB-123-C" });
    expect(res.headers.get("location")).toBe(`/afspraak/${a!.token}?nieuw=1`);
    const fotos = await env.DB.prepare("SELECT COUNT(*) AS n FROM fotos").first<{ n: number }>();
    expect(fotos!.n).toBe(1);
    expect(verzender.verzonden.map((v) => v.aan).sort()).toEqual(["eigenaar@glansenco.example", "sanne@voorbeeld.nl"]);

    const pagina = await (await vraag(`/afspraak/${a!.token}?nieuw=1`)).text();
    expect(pagina).toContain("Bedankt! We hebben je aanvraag ontvangen");
    expect(pagina).toContain("maandag 9 november 2026");
  });

  it("geeft bij een al bezet tijdstip een nette melding en behoudt de ingevulde gegevens", async () => {
    await vraag("/boeken/handwas", { method: "POST", body: boekFormulier() });
    const res = await vraag("/boeken/handwas", { method: "POST", body: boekFormulier({ naam: "Tweede Klant", email: "twee@voorbeeld.nl" }) });
    expect(res.status).toBe(409);
    const html = await res.text();
    expect(html).toContain("niet (meer) beschikbaar");
    expect(html).toContain('value="Tweede Klant"');
    expect(html).toMatch(/type="radio" name="tijd" value="11:15"/); // direct een andere tijd kiezen
    expect(html).not.toMatch(/name="tijd" value="10:00"/);
    expect(await afspraken()).toHaveLength(1);
  });

  it("weigert bestanden die geen foto zijn", async () => {
    const nep = new File([new TextEncoder().encode("<script>alert(1)</script>")], "foto.jpg", { type: "image/jpeg" });
    const res = await vraag("/boeken/handwas", { method: "POST", body: boekFormulier({}, [nep]) });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("Upload alleen foto");
    expect(await afspraken()).toHaveLength(0);
  });

  it("toont veldfouten toegankelijk (label, aria-invalid, foutoverzicht)", async () => {
    const res = await vraag("/boeken/handwas", { method: "POST", body: boekFormulier({ naam: "", email: "fout" }) });
    expect(res.status).toBe(422);
    const html = await res.text();
    expect(html).toContain('id="fouten"');
    expect(html).toMatch(/id="veld-email"[^>]*aria-invalid="true"|aria-invalid="true"[^>]*id="veld-email"/);
    expect(html).toContain('href="#veld-naam"');
  });

  it("laat de klant zelf annuleren tot de ingestelde termijn", async () => {
    await vraag("/boeken/handwas", { method: "POST", body: boekFormulier() });
    const [a] = await afspraken();
    klok = `${DAG}T08:00`; // binnen 24 uur: niet meer online
    let res = await vraag(`/afspraak/${a!.token}/annuleren`, { method: "POST" });
    expect((await afspraken())[0]!.status).toBe("aangevraagd");
    klok = NU;
    res = await vraag(`/afspraak/${a!.token}/annuleren`, { method: "POST" });
    expect(res.status).toBe(303);
    expect((await afspraken())[0]!.status).toBe("geannuleerd");
    expect(verzender.verzonden.some((v) => v.onderwerp.startsWith("Geannuleerd door klant"))).toBe(true);
  });

  it("geeft 404 voor onbekende afspraken en behandelingen", async () => {
    expect((await vraag("/afspraak/bestaat-niet-1234")).status).toBe(404);
    expect((await vraag("/boeken/bestaat-niet")).status).toBe(404);
    expect((await vraag("/iets-anders")).status).toBe(404);
  });

  it("registreert een klik op de reviewlink en stuurt door naar Google", async () => {
    await vraag("/boeken/handwas", { method: "POST", body: boekFormulier() });
    const [a] = await afspraken();
    const res = await vraag(`/r/${a!.token}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(testConfig().bedrijf.googleReviewUrl);
    expect((await afspraken())[0]!.review_geklikt_op).toBe(NU);
  });

  it("meldt pas af na bevestigen (niet bij alleen openen), ook via one-click", async () => {
    await vraag("/boeken/handwas", { method: "POST", body: boekFormulier({ toestemming_onderhoud: "ja" }) });
    const [a] = await afspraken();
    await vraag(`/afmelden/${a!.token}`);
    expect((await afspraken())[0]!.toestemming_onderhoud).toBe(1);
    const res = await vraag(`/afmelden/${a!.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });
    expect(res.status).toBe(200);
    expect((await afspraken())[0]!.toestemming_onderhoud).toBe(0);
    expect(await env.DB.prepare("SELECT email FROM afmeldingen").first()).toEqual({ email: "sanne@voorbeeld.nl" });
  });

  it("biedt een agenda-bestand voor de klant", async () => {
    await vraag("/boeken/handwas", { method: "POST", body: boekFormulier() });
    const [a] = await afspraken();
    const res = await vraag(`/afspraak/${a!.token}/agenda.ics`);
    expect(res.headers.get("content-type")).toContain("text/calendar");
    const ics = await res.text();
    expect(ics).toContain("DTSTART:20261109T090000Z"); // 10:00 in Amsterdam (wintertijd) = 09:00 UTC
    expect(ics).toContain("STATUS:TENTATIVE");
  });
});

describe("beheer", () => {
  it("vraagt om in te loggen en weigert een fout wachtwoord", async () => {
    const res = await vraag("/beheer");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/beheer/inloggen?terug=%2Fbeheer");
    const fout = await vraag("/beheer/inloggen", {
      method: "POST",
      headers: { Origin: BASIS, "Content-Type": "application/x-www-form-urlencoded" },
      body: "wachtwoord=fout",
    });
    expect(fout.status).toBe(401);
  });

  it("zet een veilige sessiecookie en blokkeert na te veel pogingen", async () => {
    const res = await vraag("/beheer/inloggen", {
      method: "POST",
      headers: { Origin: BASIS, "Content-Type": "application/x-www-form-urlencoded" },
      body: "wachtwoord=test-wachtwoord-123",
    });
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    for (let i = 0; i < 10; i++) {
      await vraag("/beheer/inloggen", { method: "POST", headers: { Origin: BASIS, "Content-Type": "application/x-www-form-urlencoded" }, body: "wachtwoord=fout" });
    }
    const geblokkeerd = await vraag("/beheer/inloggen", {
      method: "POST",
      headers: { Origin: BASIS, "Content-Type": "application/x-www-form-urlencoded" },
      body: "wachtwoord=test-wachtwoord-123",
    });
    expect(geblokkeerd.status).toBe(429);
  });

  it("accepteert met één klik en weigert formulieren van andere sites (CSRF)", async () => {
    await vraag("/boeken/handwas", { method: "POST", body: boekFormulier() });
    const [a] = await afspraken();
    const cookie = await inloggen();
    const vreemd = await vraag(`/beheer/afspraak/${a!.id}/accepteren`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://kwaadaardig.example", "Content-Type": "application/x-www-form-urlencoded" },
      body: "",
    });
    expect(vreemd.status).toBe(403);
    expect((await afspraken())[0]!.status).toBe("aangevraagd");

    const res = await vraag(`/beheer/afspraak/${a!.id}/accepteren`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: BASIS, "Content-Type": "application/x-www-form-urlencoded" },
      body: "",
    });
    expect(res.status).toBe(303);
    expect((await afspraken())[0]!.status).toBe("bevestigd");
    expect(verzender.verzonden.some((v) => v.onderwerp.startsWith("Bevestigd:"))).toBe(true);
  });

  it("toont alle beheerpagina's", async () => {
    await vraag("/boeken/handwas", { method: "POST", body: boekFormulier({}, [new File([JPEG], "a.jpg", { type: "image/jpeg" })]) });
    const [a] = await afspraken();
    const cookie = await inloggen();
    const fotoId = (await env.DB.prepare("SELECT id FROM fotos").first<{ id: number }>())!.id;
    for (const pad of [
      "/beheer",
      "/beheer/agenda",
      `/beheer/agenda?weergave=dag&datum=${DAG}`,
      `/beheer/afspraak/${a!.id}`,
      `/beheer/afspraak/${a!.id}?verzetDatum=2026-11-10`,
      "/beheer/blokkades",
      "/beheer/berichten",
      "/beheer/instellingen",
      "/beheer/nieuw?behandeling=coating&datum=2026-11-10",
    ]) {
      const res = await vraag(pad, { headers: { Cookie: cookie } });
      expect(res.status, pad).toBe(200);
      expect(res.headers.get("cache-control"), pad).toBe("no-store");
    }
    const foto = await vraag(`/beheer/foto/${fotoId}`, { headers: { Cookie: cookie } });
    expect(foto.headers.get("content-type")).toBe("image/jpeg");
    expect((await vraag(`/beheer/foto/${fotoId}`)).status).toBe(303); // zonder login niet
  });

  it("blokkeert tijden via het beheer, waarna klanten niet meer kunnen boeken", async () => {
    const cookie = await inloggen();
    const res = await vraag("/beheer/blokkades", {
      method: "POST",
      headers: { Cookie: cookie, Origin: BASIS, "Content-Type": "application/x-www-form-urlencoded" },
      body: `van_datum=${DAG}&tot_datum=${DAG}&reden=Vakantie`,
    });
    expect(res.status).toBe(303);
    const html = await (await vraag(`/boeken/handwas?datum=${DAG}`)).text();
    expect(html).toContain("Op deze dag zijn geen tijden meer vrij");
    expect((await vraag("/boeken/handwas", { method: "POST", body: boekFormulier() })).status).toBe(409);
  });

  it("verzet een afspraak en voert telefonische afspraken in zonder dubbele boekingen", async () => {
    const cookie = await inloggen();
    const kop = { Cookie: cookie, Origin: BASIS, "Content-Type": "application/x-www-form-urlencoded" };
    let res = await vraag("/beheer/nieuw", { method: "POST", headers: kop, body: `behandeling=handwas&datum=${DAG}&tijd=10:00&naam=Bellende+Klant&email=&bevestiging=ja` });
    expect(res.status).toBe(303);
    res = await vraag("/beheer/nieuw", { method: "POST", headers: kop, body: `behandeling=velgen&datum=${DAG}&tijd=10:30&naam=Tweede` });
    expect(res.status).toBe(422);
    const [a] = await afspraken();
    res = await vraag(`/beheer/afspraak/${a!.id}/verzetten`, { method: "POST", headers: kop, body: `datum=${DAG}&tijd=14:00` });
    expect(res.status).toBe(303);
    expect((await afspraken())[0]!.start).toBe(`${DAG}T14:00`);
  });
});

describe("agenda-feed (iCal)", () => {
  it("is alleen bereikbaar met het geheime token en levert geldige iCalendar", async () => {
    await vraag("/boeken/handwas", { method: "POST", body: boekFormulier({ opmerking: "Komma's, puntkomma's; en een\nnieuwe regel" }) });
    expect((await vraag("/ical/fout-token.ics")).status).toBe(404);
    const token = await icalToken(env.GEHEIME_SLEUTEL!);
    const res = await vraag(`/ical/${token}.ics`);
    expect(res.status).toBe(200);
    const ics = await res.text();
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("SUMMARY:[Aanvraag] Handwas buiten – Sanne de Vries");
    expect(ics).toContain("DTSTART:20261109T090000Z");
    for (const regel of ics.split("\r\n")) expect(new TextEncoder().encode(regel).length).toBeLessThanOrEqual(75);
    const ontvouwen = ics.replace(/\r\n /g, "");
    expect(ontvouwen).toContain("Opmerking: Komma's\\, puntkomma's\\; en een\\nnieuwe regel");
  });
});

describe("geplande taken en configuratie", () => {
  it("voert de cron-taak uit via de scheduled-handler", async () => {
    await vraag("/boeken/handwas", { method: "POST", body: boekFormulier() });
    klok = `${DAG}T10:00`;
    const ctx = createExecutionContext();
    await worker().scheduled(createScheduledController(), env, ctx);
    await waitOnExecutionContext(ctx);
    expect((await afspraken())[0]!.status).toBe("verlopen");
  });

  it("toont een duidelijke foutpagina bij een ongeldige configuratie", async () => {
    const kapot = testConfig((c) => {
      c.huisstijl.primaireKleur = "blauw";
    });
    const res = await vraag("/", {}, worker({ config: kapot }));
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("huisstijl.primaireKleur");
  });

  it("vult in demo-modus automatisch voorbeelddata en accepteert het demowachtwoord", async () => {
    const demoEnv = { ...env, MODUS: "demo", BEHEER_WACHTWOORD: undefined, GEHEIME_SLEUTEL: undefined };
    const w = maakWorker({ verzender, nu: () => klok });
    const html = await (await vraag("/", {}, w, demoEnv)).text();
    expect(html).toContain("Glans &amp; Co");
    expect(html).toContain("demo-balk");
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM afspraken").first<{ n: number }>();
    expect(n!.n).toBeGreaterThan(10);
    const berichten = await env.DB.prepare("SELECT COUNT(*) AS n FROM berichten WHERE inhoud_html IS NOT NULL").first<{ n: number }>();
    expect(berichten!.n).toBeGreaterThan(10);
    // Zonder BASIS_URL wijzen links in de demo-e-mails naar het adres waarop de demo bezocht wordt.
    const voorbeeld = await env.DB.prepare("SELECT inhoud_html FROM berichten WHERE soort = 'bevestiging' LIMIT 1").first<{ inhoud_html: string }>();
    expect(voorbeeld!.inhoud_html).toContain(`${BASIS}/afspraak/`);
    expect(voorbeeld!.inhoud_html).not.toContain("localhost");
    const login = await vraag(
      "/beheer/inloggen",
      { method: "POST", headers: { Origin: BASIS, "Content-Type": "application/x-www-form-urlencoded" }, body: "wachtwoord=demo" },
      w,
      demoEnv,
    );
    expect(login.status).toBe(303);
    // Tweede bezoek vult niet opnieuw.
    await vraag("/", {}, w, demoEnv);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM afspraken").first<{ n: number }>())!.n).toBe(n!.n);
  });

  it("weigert in productie het beheer als de geheimen ontbreken", async () => {
    const zonder = { ...env, BEHEER_WACHTWOORD: undefined };
    const res = await vraag("/beheer/inloggen", {}, worker(), zonder);
    expect(await res.text()).toContain("BEHEER_WACHTWOORD ontbreekt");
  });
});
