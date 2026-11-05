/* global window, WebGL2RenderingContext, WebGLRenderingContext */
// Desempenho da cena (Chromium sem ecrã com GPU via ANGLE): FPS e chamadas de desenho por fotograma, em qualidade
// alta e normal, de dia e de noite, na vista por defeito. Mediana de 3 medições de 4 s.
// Uso: node scripts/lisbon-perf.mjs [url-base]  (precisa do Vite ou do servidor a correr)
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://127.0.0.1:5174/";
const browser = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });

async function measure(quality) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.addInitScript(() => {
    const w = window;
    w.__draws = 0;
    w.__frames = 0;
    for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
      for (const fn of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"]) {
        const orig = C.prototype[fn];
        if (!orig) continue;
        C.prototype[fn] = function (...a) {
          w.__draws++;
          return orig.apply(this, a);
        };
      }
    }
    const raf = w.requestAnimationFrame.bind(w);
    w.requestAnimationFrame = (cb) =>
      raf((t) => {
        w.__frames++;
        cb(t);
      });
  });
  const t0 = Date.now();
  await page.goto(`${base}?q=${quality}`);
  await page.waitForFunction(() => window.__frames > 5, null, { timeout: 60000 });
  const firstFrameMs = Date.now() - t0;
  await page.waitForTimeout(4000);
  const result = { firstFrameMs };
  for (const mode of ["Dia", "Noite"]) {
    for (let i = 0; i < 3; i++) {
      const t = await page.locator("#timeBtn").textContent();
      if (t.includes(mode)) break;
      await page.locator("#timeBtn").click();
    }
    await page.waitForTimeout(2500);
    const runs = [];
    for (let r = 0; r < 3; r++) {
      const s = await page.evaluate(() => [window.__draws, window.__frames, performance.now()]);
      await page.waitForTimeout(4000);
      const e = await page.evaluate(() => [window.__draws, window.__frames, performance.now()]);
      const frames = e[1] - s[1];
      runs.push({ fps: (frames * 1000) / (e[2] - s[2]), draws: (e[0] - s[0]) / Math.max(1, frames) });
    }
    runs.sort((a, b) => a.fps - b.fps);
    result[mode] = { fps: +runs[1].fps.toFixed(1), drawsPerFrame: Math.round(runs[1].draws) };
  }
  await page.close();
  return result;
}

const report = { alta: await measure("alta"), normal: await measure("normal") };
console.log(JSON.stringify(report, null, 2));
await browser.close();
