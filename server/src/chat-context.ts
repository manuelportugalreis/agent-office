/** Contexto para uma sessão nova depois de editar/regenerar: o Claude Code não consegue "voltar atrás", por isso reenvia-se a conversa. */
export function withHistory(transcript: string, text: string): string {
  return transcript ? `Conversa até agora (para contexto):\n${transcript}\n\nMensagem atual do utilizador:\n${text}` : text;
}
