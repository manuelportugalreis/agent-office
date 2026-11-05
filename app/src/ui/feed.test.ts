import { describe, expect, it } from "vitest";
import { pushFeed, type FeedEntry } from "./feed";

const entry = (text: string): FeedEntry => ({ time: "10:00", who: "Lena", text });

describe("feed de atividade", () => {
  it("só guarda o que interessa e põe o mais recente primeiro", () => {
    let feed: readonly FeedEntry[] = [];
    feed = pushFeed(feed, entry("Read: notas.md"));
    expect(feed).toHaveLength(0);
    feed = pushFeed(feed, entry("Rascunho à espera da tua aprovação"));
    feed = pushFeed(feed, entry("Concluído (custo equivalente $0.100)"));
    expect(feed.map((e) => e.text)).toEqual(["Concluído (custo equivalente $0.100)", "Rascunho à espera da tua aprovação"]);
  });
  it("não muda a lista antiga e limita o tamanho", () => {
    const first: readonly FeedEntry[] = [];
    const next = pushFeed(first, entry("Falhou: erro"));
    expect(first).toHaveLength(0);
    expect(next).toHaveLength(1);
    let big: readonly FeedEntry[] = [];
    for (let i = 0; i < 100; i++) big = pushFeed(big, entry(`Concluído ${i}`));
    expect(big).toHaveLength(60);
    expect(big[0].text).toBe("Concluído 99");
  });
});
