/* global window, WebGL2RenderingContext, WebGLRenderingContext */
// Capturas de verificação visual do exterior (Lisboa): dia/noite, vários ângulos e zoom, com draw calls e FPS.
// Uso: node scripts/lisbon-shots.mjs <pasta-de-saida> [url]  (precisa do Vite ou do servidor a correr)
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? "shots";
const url = process.argv[3] ?? "http://127.0.0.1:5174/?q=alta";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
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
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(url);
await page.waitForTimeout(6000);
const canvas = page.locator("#stage canvas");
const box = await canvas.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

async function setTime(label) {
  for (let i = 0; i < 3; i++) {
    const t = await page.locator("#timeBtn").textContent();
    if (t.includes(label)) break;
    await page.locator("#timeBtn").click();
  }
  await page.waitForTimeout(2500);
}
async function zoom(steps) {
  await page.mouse.move(cx, cy);
  for (let i = 0; i < Math.abs(steps); i++) {
    await page.mouse.wheel(0, steps > 0 ? -100 : 100);
    await page.waitForTimeout(40);
  }
}
async function pan(dx, dy) {
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 5 });
  await page.mouse.move(cx + dx, cy + dy, { steps: 5 });
  await page.mouse.up();
}
async function spin(n) {
  for (let i = 0; i < Math.abs(n); i++) await page.keyboard.press(n > 0 ? "e" : "q");
}
async function shot(name) {
  await page.waitForTimeout(700);
  await canvas.screenshot({ path: join(out, `${name}.png`) });
}
async function perf() {
  const s = await page.evaluate(() => [window.__draws, window.__frames, performance.now()]);
  await page.waitForTimeout(3000);
  const e = await page.evaluate(() => [window.__draws, window.__frames, performance.now()]);
  const frames = e[1] - s[1];
  return { fps: +((frames * 1000) / (e[2] - s[2])).toFixed(1), drawsPerFrame: Math.round((e[0] - s[0]) / Math.max(1, frames)) };
}

await page
  .locator("#stage")
  .click({ position: { x: 5, y: 5 } })
  .catch(() => {});
const metrics = {};
await setTime("Dia");
await shot("01-day-default");
metrics.dayDefault = await perf();
await zoom(5);
await pan(-250, -330);
await shot("02-day-street-zoom");
await pan(250, 330);
await zoom(-5);
await spin(4);
await shot("03-day-rotated");
await spin(-8);
await shot("04-day-rotated-other");
await spin(4);
await zoom(4);
await pan(350, -250);
await shot("05-day-neighbours-zoom");
await pan(-350, 250);
await zoom(-4);
await setTime("Noite");
await shot("06-night-default");
metrics.nightDefault = await perf();
await zoom(5);
await pan(-250, -330);
await shot("07-night-street-zoom");
const report = JSON.stringify({ metrics, errors }, null, 2);
writeFileSync(join(out, "metrics.json"), `${report}\n`);
console.log(report);
await browser.close();
