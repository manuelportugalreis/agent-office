/**
 * Sítios do escritório para onde se pode mandar alguém, com os nomes e as alcunhas que se usam a falar.
 * O servidor usa-os para perceber "vai ao meu gabinete"; a cena traduz cada sítio em lugares reais do mapa.
 */

export interface Place {
  readonly id: string;
  /** Nome que se mostra ("a sala de reuniões"). */
  readonly name: string;
  /** Formas de dizer (sem artigo; comparadas sem acentos nem maiúsculas). */
  readonly aliases: readonly string[];
}

/** O gabinete do utilizador: é um dos sítios abaixo, escolhido por ele (sem escolha, a ordem pergunta qual). */
export const MY_OFFICE = "my-office";

/** Alcunhas do gabinete do utilizador. */
export const MY_OFFICE_ALIASES: readonly string[] = [
  "meu gabinete",
  "o meu gabinete",
  "meu escritorio",
  "minha sala",
  "minha secretaria",
  "minha mesa",
  "meu posto",
  "beira de mim",
  "pe de mim",
  "ter comigo",
  "onde eu estou",
];

/** Salas e zonas (os lugares exatos de cada uma estão na cena). */
export const ROOM_PLACES: readonly Place[] = [
  // Nomes que também são palavras de trabalho ("os projetos", "as candidaturas", "o mestrado") só contam com "gabinete" ou "sala".
  {
    id: "pesquisa",
    name: "o gabinete de Projetos",
    aliases: ["gabinete de projetos", "gabinete dos projetos", "sala de projetos", "sala dos projetos", "sala de pesquisa"],
  },
  {
    id: "search",
    name: "o gabinete de Job Search",
    aliases: ["gabinete de job search", "gabinete do job search", "sala de job search", "sala do job search", "sala das vagas"],
  },
  {
    id: "apply",
    name: "o gabinete de Candidaturas e Outreach",
    aliases: [
      "gabinete de candidaturas e outreach",
      "gabinete de candidaturas",
      "gabinete das candidaturas",
      "gabinete de outreach",
      "gabinete de job application",
      "sala de job application",
      "sala das candidaturas",
    ],
  },
  {
    id: "masters",
    name: "o gabinete do Mestrado",
    aliases: [
      "gabinete do mestrado",
      "gabinete de mestrado",
      "sala do mestrado",
      "sala do masters",
      "sala de estudos",
      "gabinete de estudos",
    ],
  },
  {
    id: "ceo-office",
    name: "o gabinete do Atlas",
    aliases: ["gabinete do atlas", "gabinete do ceo", "gabinete do chefe", "direcao"],
  },
  {
    // Id antigo da sala de Gestão inteira; desde a divisão é só a sala de reuniões (o gabinete do Atlas é "ceo-office").
    id: "gestao",
    name: "a sala de reuniões",
    aliases: [
      "sala de reunioes",
      "sala das reunioes",
      "sala de reunioes dos chefes",
      "sala dos chefes",
      "mesa de reunioes",
      "sala de gestao",
      "sala da gestao",
    ],
  },
  {
    id: "rest",
    name: "a sala de descanso",
    aliases: ["sala de descanso", "descanso", "copa", "cafe", "cafetaria", "sofa"],
  },
  { id: "wc", name: "a casa de banho", aliases: ["casa de banho", "wc", "quarto de banho", "lavabos"] },
  { id: "games", name: "a sala de jogos", aliases: ["sala de jogos", "ping pong", "pingue pongue", "tenis de mesa"] },
  { id: "gym", name: "o ginásio", aliases: ["ginasio", "gym", "passadeira"] },
  { id: "servers", name: "a sala dos servidores", aliases: ["servidores", "sala dos servidores", "sala de servidores", "bastidores"] },
  { id: "tray", name: "a bandeja de revisão", aliases: ["bandeja", "bandeja de revisao", "fim do corredor"] },
];

/** Em que sala trabalha cada agente ("vai à sala da Lena"; quem já trabalha nessa sala vai para a própria secretária). */
export const AGENT_ROOM: Readonly<Record<string, string>> = {
  ceo: "ceo-office",
  rhea: "pesquisa",
  mira: "pesquisa",
  vera: "search",
  scout: "search",
  nina: "apply",
  lena: "apply",
  theo: "apply",
  dean: "masters",
  ada: "masters",
  turing: "masters",
};

/** Lugar especial: a secretária de um agente (`desk:<id>`). */
export const deskPlace = (agentId: string): string => `desk:${agentId}`;
export const deskOwner = (placeId: string): string | null => (placeId.startsWith("desk:") ? placeId.slice(5) : null);

/** Texto comparável: sem acentos, minúsculas, sem pontuação e com espaços simples. */
export const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Sala por id (as secretárias e o gabinete do utilizador não estão aqui). */
export const roomPlace = (id: string): Place | undefined => ROOM_PLACES.find((p) => p.id === id);

/** "a sala" → "à sala", "o ginásio" → "ao ginásio" (depois de "chegou", "vai"). */
export const toPlace = (name: string): string => name.replace(/^a /, "à ").replace(/^o /, "ao ");
/** "a sala" → "da sala", "o ginásio" → "do ginásio" (depois de "a caminho"). */
export const ofPlace = (name: string): string => name.replace(/^a /, "da ").replace(/^o /, "do ");

/** Nome legível de um sítio, incluindo secretárias (`names` dá o nome de cada agente). */
export function placeName(id: string, names: (agentId: string) => string): string {
  const owner = deskOwner(id);
  if (owner) return `a secretária de ${names(owner)}`;
  return roomPlace(id)?.name ?? id;
}
