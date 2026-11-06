/**
 * Escolher uma pessoa pelo ecrã. As pessoas são pequenas na vista isométrica (10 a 20 px) e mexem-se: acertar na
 * malha exata falhava a maior parte dos cliques. Cada pessoa é um segmento no ecrã (dos pés à cabeça) e ganha a mais
 * próxima do clique, dentro de um raio.
 */

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface ScreenFigure {
  readonly id: string;
  readonly foot: ScreenPoint;
  readonly head: ScreenPoint;
}

/** Distância de um ponto a um segmento. */
export function distanceToSegment(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** A figura mais próxima do clique, se estiver a menos de `radius` píxeis; senão null. */
export function nearestFigure(click: ScreenPoint, figures: readonly ScreenFigure[], radius: number): string | null {
  let best: string | null = null;
  let bestDist = radius;
  for (const f of figures) {
    const d = distanceToSegment(click, f.foot, f.head);
    if (d <= bestDist) {
      bestDist = d;
      best = f.id;
    }
  }
  return best;
}

/** Raio de toque: pelo menos 14 px, ou metade da altura da figura no ecrã quando estás mais perto. */
export function pickRadius(figureHeightPx: number): number {
  return Math.max(14, figureHeightPx * 0.5);
}
