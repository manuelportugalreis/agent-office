/** Datas e horas de parede num fuso (sem bibliotecas: só Intl). */

/** O dia de hoje (AAAA-MM-DD) num fuso. */
export const todayIn = (now: Date, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** Um instante, como hora de parede (AAAA-MM-DDTHH:MM) num fuso. */
export function wallTime(at: Date, timeZone: string): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const g = (t: string): string => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

/** O instante em que um fuso mostra esta hora de parede (AAAA-MM-DDTHH:MM). Duas passagens para acertar a mudança de hora. */
export function zonedInstant(wall: string, timeZone: string): Date {
  const target = Date.parse(`${wall}:00Z`);
  const shownAt = (t: number): number => Date.parse(`${wallTime(new Date(t), timeZone)}:00Z`);
  const first = target - (shownAt(target) - target);
  return new Date(first + (target - shownAt(first)));
}

/** O fuso existe (ex.: "America/Phoenix"). */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** AAAA-MM-DD mais n dias. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
