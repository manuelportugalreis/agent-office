import { expect, test, type Page } from "@playwright/test";

interface Placement {
  x: number;
  z: number;
  turns: number;
}

/** Ganchos que a app só expõe com `?debug`, para arrastar uma peça sem adivinhar píxeis no ecrã. */
async function dragPiece(page: Page, id: string, to: { x: number; z: number }): Promise<void> {
  const points = await page.evaluate(
    ({ id, to }) => {
      const office = (window as unknown as { __office: OfficeDebug }).__office;
      const piece = office.editables().find((e) => e.id === id);
      if (!piece) throw new Error(`peça desconhecida: ${id}`);
      const rect = office.stage.dom.getBoundingClientRect();
      const PICK_Y = 0.9; // a altura do corpo da impressora: mais abaixo o raio passava entre os pés
      const at = (x: number, z: number) => {
        const p = office.stage.project(x, PICK_Y, z);
        return { x: rect.left + p.x, y: rect.top + p.y };
      };
      return { from: at(piece.placement.x, piece.placement.z), to: at(to.x, to.z) };
    },
    { id, to },
  );
  await page.mouse.move(points.from.x, points.from.y);
  await page.mouse.down();
  await page.mouse.move(points.to.x, points.to.y, { steps: 4 });
  await page.mouse.up();
}

interface OfficeDebug {
  editables(): { id: string; placement: Placement }[];
  stage: { dom: HTMLCanvasElement; project(x: number, y: number, z: number): { x: number; y: number } };
}

const placementOf = (page: Page, id: string): Promise<Placement | undefined> =>
  page.evaluate((id) => (window as unknown as { __office: OfficeDebug }).__office.editables().find((e) => e.id === id)?.placement, id);

test.beforeEach(async ({ page }) => {
  // Qualidade normal: sem GPU, a qualidade alta demora demasiado a desenhar cada imagem.
  await page.goto("/?debug&q=normal");
  await expect(page.locator("#stage canvas")).toBeVisible();
});

test("a interface abre e liga ao servidor", async ({ page }) => {
  await expect(page.locator("#conn")).toHaveText(/online/, { timeout: 15_000 });
  await expect(page.locator("#naBtn")).toBeVisible();
});

test("o modo andar liga e desliga", async ({ page }) => {
  const btn = page.locator("#walkBtn");
  await btn.click({ force: true });
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#hint")).toContainText("WASD");
  await btn.click({ force: true });
  await expect(btn).toHaveAttribute("aria-pressed", "false");
});

test.describe("modo mobília", () => {
  // A impressora é uma peça com colisão; (15, 3.8) é chão livre na sala Job Application.
  const PIECE = "impressora-1";
  const FREE = { x: 15, z: 3.8 };

  test("a barra abre e fecha, e sair pelo botão Concluir volta ao normal", async ({ page }) => {
    await page.locator("#editBtn").click({ force: true });
    await expect(page.locator("#editBar")).toBeVisible();
    await page.locator("#editDone").click({ force: true });
    await expect(page.locator("#editBar")).toBeHidden();
    await expect(page.locator("#hint")).toBeVisible();
  });

  test("uma peça arrastada fica no sítio novo e sobrevive a recarregar a página", async ({ page }) => {
    await page.locator("#editBtn").click({ force: true });
    await dragPiece(page, PIECE, FREE);
    await expect(page.locator("#editInfo")).toContainText("Impressora");
    const moved = await placementOf(page, PIECE);
    expect(moved?.x).toBeCloseTo(FREE.x, 0);
    expect(moved?.z).toBeCloseTo(FREE.z, 0);

    await page.reload();
    await expect(page.locator("#stage canvas")).toBeVisible();
    const after = await placementOf(page, PIECE);
    expect(after?.x).toBeCloseTo(moved?.x ?? NaN);

    await page.locator("#editBtn").click({ force: true });
    await page.locator("#editReset").click({ force: true });
    expect((await placementOf(page, PIECE))?.x).toBeCloseTo(12.8);
  });

  test("não deixa pousar uma peça no corredor: volta para onde estava", async ({ page }) => {
    await page.locator("#editBtn").click({ force: true });
    const before = await placementOf(page, PIECE);
    await dragPiece(page, PIECE, { x: 12, z: 6 });
    await expect(page.locator("#editInfo")).toContainText("Impressora");
    expect(await placementOf(page, PIECE)).toEqual(before);
  });
});
