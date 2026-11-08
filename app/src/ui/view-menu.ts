import type { Stage, TimeMode } from "../scene/stage";
import { byId, isDark, toast } from "./dom";

/** O menu ⚙ Vista: qualidade gráfica, hora do dia e tema; fecha-se ao clicar fora dele. */

const TIME_CYCLE: Record<TimeMode, { label: string; next: TimeMode }> = {
  auto: { label: "🕒 Auto", next: "day" },
  day: { label: "☀ Dia", next: "night" },
  night: { label: "🌙 Noite", next: "auto" },
};

export function installViewMenu(stage: Stage, onThemeChange: () => void): void {
  byId("themeBtn").onclick = () => {
    document.documentElement.dataset.theme = isDark() ? "light" : "dark";
    onThemeChange();
  };
  const showQuality = (): void => {
    byId("qualBtn").textContent = stage.quality() === "alta" ? "✨ Alta" : "Normal";
  };
  byId("qualBtn").onclick = () => {
    stage.setQuality(stage.quality() === "alta" ? "normal" : "alta");
    showQuality();
  };
  showQuality();
  // A cena estava lenta e o palco aliviou-a sozinho: diz-se o que mudou (e o botão mostra a qualidade atual).
  stage.onAutoAdjust((message) => {
    showQuality();
    toast(message);
  });
  let timeMode: TimeMode = "auto";
  byId("timeBtn").onclick = () => {
    timeMode = TIME_CYCLE[timeMode].next;
    stage.setTimeMode(timeMode);
    byId("timeBtn").textContent = TIME_CYCLE[timeMode].label;
  };
  document.addEventListener("pointerdown", (e) => {
    const menu = byId<HTMLDetailsElement>("viewMenu");
    if (menu.open && !menu.contains(e.target as Node)) menu.open = false;
  });
}
