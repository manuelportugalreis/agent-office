export interface Mentionable {
  readonly id: string;
  readonly name: string;
}

export interface Mention {
  readonly agentId: string;
  readonly text: string;
}

/**
 * "@lena escreve o email" → passa a conversa à Lena. Só conta no início da mensagem e se houver texto a seguir.
 * Aceita o id ou o nome (sem distinguir maiúsculas). Devolve null se não for uma menção válida.
 */
export function parseMention(text: string, agents: readonly Mentionable[]): Mention | null {
  const m = /^@([\p{L}\p{N}_-]+)\s+([\s\S]*\S[\s\S]*)$/u.exec(text.trim());
  if (!m) return null;
  const wanted = m[1].toLowerCase();
  const agent = agents.find((a) => a.id === wanted || a.name.toLowerCase() === wanted);
  return agent ? { agentId: agent.id, text: m[2].trim() } : null;
}
