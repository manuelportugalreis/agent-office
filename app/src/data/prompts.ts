/** Sugestões de conversa por agente (aparecem no ecrã inicial do chat). */
export const SUGGESTIONS: Readonly<Record<string, readonly string[]>> = {
  ceo: ["Quais são as prioridades desta semana?", "O que está cada pessoa da equipa a fazer?", "Planeia 20 candidaturas para esta semana"],
  rhea: ["Faz uma pesquisa de fundo sobre uma empresa", "Que empresas devia priorizar?", "Resume o que a Mira encontrou"],
  mira: [
    "Pesquisa a cultura e as notícias de uma empresa",
    "Encontra recrutadores de AI numa empresa",
    "Que sinais de contratação vês nesta empresa?",
  ],
  vera: ["Que critérios usamos para filtrar vagas?", "Prioriza estas vagas por encaixe", "Ajusta o filtro para Business Analyst"],
  scout: ["Procura vagas de AI Business Analyst", "Vagas de Data Analyst em regime remoto", "Pontua estas vagas de 0 a 100"],
  nina: ["Revê este rascunho de carta", "Melhora o tom deste email", "O que falta neste rascunho?"],
  lena: ["Escreve um email curto a um recrutador", "Escreve uma carta de motivação", "Dá-me duas versões deste email"],
  theo: [
    "Prepara as respostas deste formulário",
    "O que falta para fechar esta candidatura?",
    "Que campos costuma ter um formulário destes?",
  ],
  dean: ["Sincroniza o Canvas", "O que está por entregar esta semana?"],
  ada: ["O que entrego primeiro?", "Faz-me um plano para esta semana", "Há alguma entrega em risco?"],
  turing: ["Prioriza as minhas entregas", "Plano de estudo para a semana", "O que pede o próximo módulo?"],
};

const MODEL_NAMES: Readonly<Record<string, string>> = { opus: "Opus 5.5", sonnet: "Sonnet 5.5", haiku: "Haiku 5.5" };

export const modelLabel = (alias: string | undefined): string => (alias ? (MODEL_NAMES[alias] ?? alias) : "");

export function greeting(hour: number): string {
  if (hour < 6) return "Boa noite";
  if (hour < 13) return "Bom dia";
  if (hour < 20) return "Boa tarde";
  return "Boa noite";
}
