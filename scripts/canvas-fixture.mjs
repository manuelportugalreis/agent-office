// Canvas de ensaio para testes ao vivo (nunca toca no teu Canvas real). Imita as páginas que os agentes leem:
// Dashboard com To Do, entregas com enunciado, rubrica, regras de ajuda e anexos, um quiz, e um modo "sessão expirada".
// Uso: node scripts/canvas-fixture.mjs [porta] [fuso]     (ex.: node scripts/canvas-fixture.mjs 8899 America/Phoenix)
// Modo login (sessão expirada): GET /__mode/login ; voltar ao normal: GET /__mode/normal
// Feed do calendário: GET /feeds/calendars/user_ensaio.ics (para AGENT_OFFICE_CANVAS_FEED nos ensaios)
// Os prazos são calculados a cada pedido: duas entregas para hoje (uma daqui a 90 min, outra às 23:59), uma amanhã.

import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8899);
const zone = process.argv[3] ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
let mode = "normal";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Partes de uma data no fuso do curso. */
function parts(date) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).formatToParts(date);
  const get = (t) => f.find((p) => p.type === t)?.value ?? "";
  return {
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    ampm: get("dayPeriod").toLowerCase(),
    tz: get("timeZoneName"),
  };
}
const canvasDate = (d) => {
  const p = parts(d);
  return `${p.month} ${p.day} at ${p.hour}:${p.minute}${p.ampm}`;
};

/** Hoje às hh:mm no fuso do curso, como instante UTC. */
function localToday(hh, mm) {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const guess = Date.parse(`${ymd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
  // Desvio do fuso: a hora de parede nesse instante, lida como se fosse UTC, menos o instante.
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(guess));
  const g = (t) => Number(p.find((x) => x.type === t)?.value);
  const wall = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
  return new Date(guess - (wall - guess));
}

/** O prazo do quiz fixa-se quando o Canvas de ensaio arranca (90 min depois): não muda de leitura para leitura. */
const QUIZ_DUE = new Date(Math.min(Date.now() + 90 * 60000, localToday(23, 0).getTime()));

function schedule() {
  const now = new Date();
  const endOfDay = localToday(23, 59);
  const quizDue = QUIZ_DUE;
  const tomorrow = new Date(endOfDay.getTime() + 24 * 3600000);
  const yesterday = new Date(endOfDay.getTime() - 24 * 3600000);
  return { quizDue, reportDue: endOfDay, tomorrow, yesterday, tz: parts(now).tz };
}

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;max-width:900px;margin:24px auto;color:#2d3b45}h1{font-size:24px}
.card{border:1px solid #c7cdd1;border-radius:6px;padding:12px 16px;margin:12px 0}table{border-collapse:collapse}td,th{border:1px solid #c7cdd1;padding:6px 10px;text-align:left}
.banner{background:#fff3cd;padding:6px 12px;border-radius:4px;font-size:13px}</style></head>
<body><div class="banner">Canvas de ENSAIO do Agent Office (dados fictícios, nada aqui é real).</div>${body}</body></html>`;

function dashboard() {
  const s = schedule();
  return page(
    "Dashboard",
    `<h1>Dashboard</h1>
<p>All times are shown in ${esc(s.tz)} (${esc(zone)}).</p>
<h2>Courses</h2>
<div class="card"><b>TST 101</b>: Análise de Dados (ensaio) · <a href="/courses/101">Open course</a></div>
<div class="card"><b>TST 102</b>: Engenharia de Software (ensaio) · <a href="/courses/102">Open course</a></div>
<h2>To Do</h2>
<ul>
<li><a href="/courses/101/quizzes/42">Quiz 4: Leitura</a> · TST 101 · Quiz · 10 points · Due ${esc(canvasDate(s.quizDue))}</li>
<li><a href="/courses/101/assignments/41">Exercício 4: Relatório de churn</a> · TST 101 · Assignment · 40 points · Due ${esc(canvasDate(s.reportDue))}</li>
<li><a href="/courses/102/assignments/7">Reflexão 2: o teu papel na equipa</a> · TST 102 · Assignment · 14 points · Due ${esc(canvasDate(s.tomorrow))}</li>
</ul>
<h2>Recent Feedback</h2>
<ul><li><a href="/courses/102/assignments/6">Reflexão 1</a> · TST 102 · Submitted · was due ${esc(canvasDate(s.yesterday))}</li></ul>`,
  );
}

function report() {
  const s = schedule();
  return page(
    "Exercício 4: Relatório de churn",
    `<h1>Exercício 4: Relatório de churn</h1>
<p><b>Course:</b> TST 101 · <b>Due:</b> ${esc(canvasDate(s.reportDue))} (${esc(s.tz)}) · <b>Points:</b> 40 · <b>Submitting:</b> a file upload (.md or .docx)</p>
<p><b>Submission status:</b> Not submitted</p>
<h2>Instructions</h2>
<p>Using the dataset <a href="/files/dados_churn.csv">dados_churn.csv</a>, write a report of 300 to 500 words that:</p>
<ol><li>Computes the overall churn rate.</li><li>Compares churn by contract type (month-to-month, one-year, two-year).</li>
<li>Gives two recommendations to reduce churn, each justified by a number from the data.</li></ol>
<p>Use the report template <a href="/files/modelo_relatorio.docx">modelo_relatorio.docx</a> (headings: Resumo, Dados, Análise, Recomendações).</p>
<h2>AI policy for this assignment</h2>
<p>You MAY use generative AI tools to help draft and revise this report. If you do, add a short "Declaração de uso de IA" section at the end stating which tool you used and for what. You are responsible for checking every number.</p>
<h2>Rubric</h2>
<table><tr><th>Criterion</th><th>Points</th></tr>
<tr><td>Overall churn rate computed correctly</td><td>10</td></tr>
<tr><td>Churn compared by contract type, with numbers</td><td>10</td></tr>
<tr><td>Two recommendations, each justified by the data</td><td>10</td></tr>
<tr><td>Clarity, structure (template headings) and length 300–500 words</td><td>5</td></tr>
<tr><td>AI use statement (if AI was used)</td><td>5</td></tr></table>`,
  );
}

function quiz() {
  const s = schedule();
  return page(
    "Quiz 4: Leitura",
    `<h1>Quiz 4: Leitura</h1>
<p><b>Course:</b> TST 101 · <b>Due:</b> ${esc(canvasDate(s.quizDue))} (${esc(s.tz)}) · <b>Points:</b> 10 · <b>Questions:</b> 5 · <b>Time limit:</b> 20 minutes</p>
<p><b>Submission status:</b> Not submitted</p>
<h2>Instructions</h2>
<p>This quiz covers chapter 4 (customer retention metrics: churn rate, retention rate, customer lifetime value).</p>
<p><b>Academic integrity:</b> this is an individual, closed-book quiz. The use of generative AI tools, notes or other people is NOT permitted while taking it. You may study beforehand with any resource.</p>
<p><i>The questions are only shown after you start the quiz.</i></p>`,
  );
}

function reflection() {
  const s = schedule();
  return page(
    "Reflexão 2: o teu papel na equipa",
    `<h1>Reflexão 2: o teu papel na equipa</h1>
<p><b>Course:</b> TST 102 · <b>Due:</b> ${esc(canvasDate(s.tomorrow))} (${esc(s.tz)}) · <b>Points:</b> 14 · <b>Submitting:</b> a text entry</p>
<p><b>Submission status:</b> Not submitted</p>
<h2>Instructions</h2><p>Write 200 words about the role you played in your team project this week and one thing you would change.</p>
<p><i>This assignment has no rubric.</i></p>`,
  );
}

const CSV = `customer_id,contract,tenure_months,monthly_charge,churned
C01,month-to-month,2,70,yes
C02,month-to-month,5,65,yes
C03,month-to-month,1,80,yes
C04,month-to-month,12,60,no
C05,month-to-month,3,75,yes
C06,month-to-month,8,55,no
C07,month-to-month,4,85,yes
C08,month-to-month,20,50,no
C09,month-to-month,6,72,yes
C10,month-to-month,15,58,no
C11,one-year,14,62,no
C12,one-year,18,60,no
C13,one-year,11,70,yes
C14,one-year,24,55,no
C15,one-year,13,66,no
C16,one-year,22,59,no
C17,two-year,30,52,no
C18,two-year,40,49,no
C19,two-year,36,54,no
C20,two-year,48,47,no
`;

const loginPage = () =>
  page(
    "Log In to Canvas",
    `<h1>Log In to Canvas</h1><p>Your session has expired. Please sign in to continue.</p>
<form><label>Username <input name="u"></label><br><label>Password <input type="password" name="p"></label><br><button type="button">Log In</button></form>`,
  );

/** Lista de trabalhos de uma disciplina (como /courses/:id/assignments no Canvas). */
function assignmentsOf(course) {
  const s = schedule();
  const rows =
    course === "101"
      ? [
          ["/courses/101/quizzes/42", "Quiz 4: Leitura", "Quiz", s.quizDue, "10", "Not submitted"],
          ["/courses/101/assignments/41", "Exercício 4: Relatório de churn", "Assignment", s.reportDue, "40", "Not submitted"],
        ]
      : [
          ["/courses/102/assignments/7", "Reflexão 2: o teu papel na equipa", "Assignment", s.tomorrow, "14", "Not submitted"],
          ["/courses/102/assignments/6", "Reflexão 1", "Assignment", s.yesterday, "14", "Submitted"],
        ];
  return page(
    `Assignments: TST ${course}`,
    `<h1>Assignments: TST ${course}</h1><p>All times are shown in ${esc(s.tz)}.</p><ul>${rows
      .map(
        ([href, t, kind, due, pts, st]) =>
          `<li><a href="${href}">${esc(t)}</a> · ${kind} · Due ${esc(canvasDate(due))} · ${pts} pts · ${st}</li>`,
      )
      .join("")}</ul>`,
  );
}

/** O feed do calendário (Calendar › Calendar Feed), como o Canvas o dá: trabalhos e uma aula, horas em UTC. */
function calendarFeed() {
  const s = schedule();
  const stamp = (d) => `${d.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
  const text = (v) => v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  // Linhas dobradas a 70 caracteres (RFC 5545), como o Canvas faz.
  const fold = (line) => line.match(/.{1,70}/gu).join("\r\n ");
  const origin = `http://127.0.0.1:${port}`;
  const event = (uid, due, summary, course, id, description) =>
    [
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(due)}`,
      `DTEND:${stamp(due)}`,
      fold(`SUMMARY:${text(summary)}`),
      ...(description ? [fold(`DESCRIPTION:${text(description)}`)] : []),
      fold(`URL;VALUE=URI:${origin}/calendar?include_contexts=course_${course}&month=11&year=2026#assignment_${id}`),
      "END:VEVENT",
    ].join("\r\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Agent Office//Canvas de ensaio//PT",
    "X-WR-CALNAME:Calendário (ensaio)",
    event(
      "event-assignment-42",
      s.quizDue,
      "Quiz 4: Leitura [TST 101]",
      101,
      42,
      "This quiz covers chapter 4 (customer retention metrics).\nAcademic integrity: individual, closed-book quiz. The use of generative AI tools, notes or other people is NOT permitted while taking it.",
    ),
    event(
      "event-assignment-41",
      s.reportDue,
      "Exercício 4: Relatório de churn [TST 101]",
      101,
      41,
      'Using the dataset dados_churn.csv, write a report of 300 to 500 words that: 1. Computes the overall churn rate. 2. Compares churn by contract type. 3. Gives two recommendations, each justified by a number from the data.\nUse the report template modelo_relatorio.docx.\nAI policy: You MAY use generative AI tools to help draft and revise this report. If you do, add a short "Declaração de uso de IA" section.',
    ),
    event(
      "event-assignment-7",
      s.tomorrow,
      "Reflexão 2: o teu papel na equipa [TST 102]",
      102,
      7,
      "Write 200 words about the role you played in your team project this week.",
    ),
    event("event-assignment-6", s.yesterday, "Reflexão 1 [TST 102]", 102, 6, ""),
    [
      "BEGIN:VEVENT",
      "UID:event-calendar-event-900",
      `DTSTART:${stamp(s.quizDue)}`,
      "SUMMARY:Aula teórica (não é uma entrega) [TST 101]",
      "END:VEVENT",
    ].join("\r\n"),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

const routes = {
  "/": dashboard,
  "/courses/101/assignments": () => assignmentsOf("101"),
  "/courses/102/assignments": () => assignmentsOf("102"),
  "/courses/101/assignments/41": report,
  "/courses/101/quizzes/42": quiz,
  "/courses/102/assignments/7": reflection,
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const send = (status, type, body) => {
    res.writeHead(status, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" });
    res.end(body);
  };
  if (url.pathname === "/__mode/login") return ((mode = "login"), send(200, "text/plain", "modo: sessão expirada"));
  if (url.pathname === "/__mode/normal") return ((mode = "normal"), send(200, "text/plain", "modo: normal"));
  if (url.pathname === "/favicon.ico") return send(204, "text/plain", "");
  // O feed do calendário não precisa de sessão (o link é o segredo), como no Canvas real.
  if (url.pathname === "/feeds/calendars/user_ensaio.ics") return send(200, "text/calendar", calendarFeed());
  if (mode === "login") return send(200, "text/html", loginPage());
  if (url.pathname === "/files/dados_churn.csv") return send(200, "text/plain", CSV);
  if (url.pathname === "/files/modelo_relatorio.docx")
    return send(
      404,
      "text/html",
      page("Page Not Found", "<h1>Page Not Found</h1><p>The file modelo_relatorio.docx was not found or has been deleted.</p>"),
    );
  const route = routes[url.pathname];
  if (route) return send(200, "text/html", route());
  if (/^\/courses\/10[12]$/.test(url.pathname)) return send(200, "text/html", dashboard());
  return send(404, "text/html", page("Page Not Found", "<h1>Page Not Found</h1>"));
}).listen(port, "127.0.0.1", () => console.log(`Canvas de ensaio em http://127.0.0.1:${port} (fuso ${zone})`));
