/**
 * Het gratis D1-plan staat 5 miljoen gelezen rijen per dag toe (en dwingt dat af).
 * Deze tests controleren met D1's eigen meting (meta.rows_read) dat veelgebruikte
 * paden niet de hele afsprakenhistorie doorlopen, ook niet na jaren gebruik.
 */
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { boekAfspraak, planningRond } from "../src/acties";
import { vrijeTijdsloten } from "../src/lib/beschikbaarheid";
import { voerGeplandeTakenUit } from "../src/planner";
import { leegDatabase, testApp } from "./hulp";

const NU = "2026-11-02T09:00";
const DAG = "2026-11-09";

/** Een D1-database die bijhoudt hoeveel rijen er gelezen worden. */
function tellendeDb(db: D1Database) {
  const teller = { gelezen: 0 };
  const echt = new WeakMap<object, D1PreparedStatement>();
  const omhul = (st: D1PreparedStatement): D1PreparedStatement => {
    const p = new Proxy(st, {
      get(doel, sleutel) {
        if (sleutel === "bind") return (...args: unknown[]) => omhul(doel.bind(...args));
        if (sleutel === "all" || sleutel === "run") {
          return async () => {
            const r = await doel.all();
            teller.gelezen += r.meta.rows_read ?? 0;
            return r;
          };
        }
        if (sleutel === "first") {
          return async (kolom?: string) => {
            const r = await doel.all<Record<string, unknown>>();
            teller.gelezen += r.meta.rows_read ?? 0;
            const rij = r.results[0] ?? null;
            return kolom ? (rij?.[kolom] ?? null) : rij;
          };
        }
        const v = Reflect.get(doel, sleutel);
        return typeof v === "function" ? v.bind(doel) : v;
      },
    });
    echt.set(p, st);
    return p;
  };
  const omhulsel = {
    prepare: (sql: string) => omhul(db.prepare(sql)),
    batch: async (lijst: D1PreparedStatement[]) => {
      const r = await db.batch(lijst.map((s) => echt.get(s) ?? s));
      for (const x of r) teller.gelezen += x.meta.rows_read ?? 0;
      return r;
    },
    exec: (sql: string) => db.exec(sql),
  } as unknown as D1Database;
  return { db: omhulsel, teller };
}

beforeAll(async () => {
  await leegDatabase();
  // Ruim twee jaar historie: 3000 afgeronde afspraken van 3000 verschillende klanten.
  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 2999)
     INSERT INTO afspraken (token, behandeling_id, behandeling_naam, start, eind, bezet_tot, status, naam, email,
                            toestemming_review, toestemming_onderhoud, toestemming_herinnering)
     SELECT 'token-historie-' || i, 'handwas', 'Handwas buiten',
            strftime('%Y-%m-%dT%H:%M', '2024-01-01T08:00', '+' || (i * 6) || ' hours'),
            strftime('%Y-%m-%dT%H:%M', '2024-01-01T09:00', '+' || (i * 6) || ' hours'),
            strftime('%Y-%m-%dT%H:%M', '2024-01-01T09:15', '+' || (i * 6) || ' hours'),
            'afgerond', 'Klant ' || i, 'klant' || i || '@voorbeeld.nl', 1, 1, 1
       FROM n`,
  ).run();
});

describe("zuinig met D1-leesrijen bij veel historie", () => {
  it("beschikbaarheid voor twee weken leest maar een handvol rijen", async () => {
    const { app } = testApp(NU);
    const { db, teller } = tellendeDb(app.db);
    app.db = db;
    const planning = await planningRond(app, DAG, "2026-11-22");
    vrijeTijdsloten({ config: app.config, behandeling: { duurMinuten: 60 }, datum: DAG, nu: NU, ...planning });
    expect(teller.gelezen).toBeLessThan(50);
  });

  it("een boeking (inclusief atomische conflictcontrole) leest weinig rijen", async () => {
    const { app, wacht } = testApp(NU);
    const { db, teller } = tellendeDb(app.db);
    app.db = db;
    const r = await boekAfspraak(app, {
      behandelingId: "handwas",
      datum: DAG,
      tijd: "10:00",
      naam: "Nieuwe Klant",
      email: "nieuw@voorbeeld.nl",
      telefoon: "0612345678",
      opmerking: "",
      extraVelden: {},
      toestemmingHerinnering: false,
      toestemmingReview: false,
      toestemmingOnderhoud: false,
      fotos: [],
    });
    await wacht();
    expect(r.ok).toBe(true);
    expect(teller.gelezen).toBeLessThan(150);
  });

  it("een cron-run (elke 15 minuten) leest weinig rijen", async () => {
    const { app } = testApp(NU);
    const { db, teller } = tellendeDb(app.db);
    app.db = db;
    await voerGeplandeTakenUit(app); // eerste run van de dag: inclusief dagelijkse opruiming
    const eersteRun = teller.gelezen;
    teller.gelezen = 0;
    await voerGeplandeTakenUit(app);
    // 96 runs per dag × dit aantal moet ruim onder 5 miljoen blijven.
    expect(teller.gelezen).toBeLessThan(500);
    expect(eersteRun).toBeLessThan(15_000);
  });
});
