/** Limita quantos pedidos uma ligação pode fazer numa janela de tempo (janela deslizante). */
export function createRateLimiter(max: number, windowMs: number, now: () => number = Date.now): () => boolean {
  const hits: number[] = [];
  return () => {
    const t = now();
    while (hits.length > 0 && t - hits[0] >= windowMs) hits.shift();
    if (hits.length >= max) return false;
    hits.push(t);
    return true;
  };
}
