/** @jsxImportSource hono/jsx */
/**
 * Fluks Boeken – ingang van de Worker.
 *  - fetch: de website (klantkant, beheer, iCal-feed)
 *  - scheduled: geplande berichten en opruimtaken (Cron Trigger)
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type AppOpties, maakApp } from "./app";
import { controleerConfig } from "./config/laden";
import { leesInstelling, schrijfInstelling } from "./db/overig";
import { vulDemoIndienNodig } from "./demo/vullen";
import { voerGeplandeTakenUit } from "./planner";
import { beheer } from "./routes/beheer";
import { type Omgeving, toon } from "./routes/hulp";
import { ical } from "./routes/ical";
import { klant } from "./routes/klant";
import type { Bindings } from "./types";
import { FoutPagina } from "./views/layout";

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "form-action 'self'",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join("; ");

export function maakWorker(opties: AppOpties = {}) {
  const hono = new Hono<Omgeving>();

  hono.use("*", async (c, next) => {
    const app = maakApp(c.env, opties);
    c.set("app", app);

    const controle = controleerConfig(app.config);
    if (controle.fouten.length) {
      console.error("Configuratiefouten:", controle.fouten);
      return toon(c, 
        <html lang="nl">
          <head>
            <meta charset="utf-8" />
            <title>Configuratiefout</title>
          </head>
          <body style="font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem">
            <h1>Configuratiefout</h1>
            <p>Deze installatie van Fluks Boeken is nog niet goed ingesteld. Pas klant.config.ts aan en controleer met npm run check-config:</p>
            <ul>
              {controle.fouten.map((f) => (
                <li>{f}</li>
              ))}
            </ul>
          </body>
        </html>,
        500,
      );
    }

    if (app.demo) {
      try {
        // Zonder BASIS_URL: links in de demo-e-mails wijzen naar het adres waarop de demo bezocht wordt.
        if (!c.env.BASIS_URL) {
          const herkomst = new URL(c.req.url).origin;
          app.config = { ...app.config, basisUrl: herkomst };
          if ((await leesInstelling(app.db, "demo_basis_url")) !== herkomst) await schrijfInstelling(app.db, "demo_basis_url", herkomst);
        }
        await vulDemoIndienNodig(app, true);
      } catch (e) {
        console.error("Demodata vullen mislukt:", e);
      }
    }

    await next();

    if (!c.res.headers.has("Content-Security-Policy")) c.res.headers.set("Content-Security-Policy", CSP);
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    c.res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
    if (!c.res.headers.has("X-Frame-Options")) c.res.headers.set("X-Frame-Options", "DENY");
    if (new URL(c.req.url).pathname.startsWith("/beheer")) c.res.headers.set("X-Robots-Tag", "noindex, nofollow");

    // E-mails e.d. afronden nadat het antwoord al naar de bezoeker is.
    if (app.achtergrond.length) {
      const werk = Promise.allSettled(app.achtergrond).then(() => app.verzender.sluit());
      try {
        c.executionCtx.waitUntil(werk);
      } catch {
        await werk;
      }
    }
  });

  hono.get("/gezond", (c) => c.json({ ok: true }));
  hono.route("/beheer", beheer);
  hono.route("/", ical);
  hono.route("/", klant);

  hono.notFound((c) => {
    const app = c.get("app");
    return toon(c, <FoutPagina config={app.config} demo={app.demo} titel="Pagina niet gevonden" tekst="Deze pagina bestaat niet (meer)." />, 404);
  });

  hono.onError((fout, c) => {
    if (fout instanceof HTTPException) return fout.getResponse(); // bijv. 403 van de CSRF-controle
    console.error("Onverwachte fout:", fout);
    const app = c.get("app");
    if (!app) return c.text("Er ging iets mis.", 500);
    return toon(c, 
      <FoutPagina config={app.config} demo={app.demo} titel="Er ging iets mis" tekst="Probeer het over een paar minuten opnieuw. Lukt het dan nog niet, neem dan contact met ons op." />,
      500,
    );
  });

  return {
    fetch: hono.fetch,
    async scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
      const app = maakApp(env, opties);
      const werk = (async () => {
        if (app.demo && !env.BASIS_URL) {
          const basisUrl = await leesInstelling(app.db, "demo_basis_url");
          if (basisUrl) app.config = { ...app.config, basisUrl };
        }
        if (app.demo && Number(app.nu().slice(11, 13)) >= 3) await vulDemoIndienNodig(app, false);
        const r = await voerGeplandeTakenUit(app);
        console.log("Geplande taken uitgevoerd:", JSON.stringify(r));
      })();
      ctx.waitUntil(werk);
      await werk;
    },
  } satisfies ExportedHandler<Bindings>;
}

export default maakWorker();
