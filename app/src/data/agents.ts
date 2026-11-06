export type AgentState = "idle" | "work" | "think" | "appr" | "err";
export type ScreenKind = "doc" | "web" | "code" | "mail" | "cal" | "list" | "dash";
export type Deadline = readonly [title: string, due: string, note: string];
export type HairStyle = "short" | "sidepart" | "long" | "ponytail" | "bun" | "curly" | "bald";

export interface AgentDef {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly emoji: string;
  /** Cor da roupa (matiz HSL). */
  readonly hue: number;
  readonly hair: string;
  readonly hairStyle: HairStyle;
  readonly skin: string;
  readonly glasses?: boolean;
  readonly headset?: boolean;
  readonly chief?: boolean;
  /** Posição da cadeira (onde a personagem se senta). */
  readonly x: number;
  readonly z: number;
  /** Secretária: [x, z, largura]. Se omitido, usa a posição por defeito das salas de cima. */
  readonly desk?: readonly [number, number, number];
  /** Secretárias das salas de baixo saem pela porta da divisória. */
  readonly bottom?: boolean;
  readonly exitX?: number;
  readonly boss: string;
  readonly screen: ScreenKind;
  /** Agente de uma disciplina do Canvas: o servidor diz qual (configuração) e as entregas aparecem no painel dele. */
  readonly hasCourse?: boolean;
  readonly canvas?: boolean;
  readonly startsResting?: boolean;
}

const topX = (roomX: number, slot: number): number => roomX + 1.2 + slot * 1.8;
const TOP_SEAT_Z = 2.35;

export const AGENTS: readonly AgentDef[] = [
  {
    id: "ceo",
    name: "Atlas",
    role: "CEO",
    emoji: "🧭",
    hue: 48,
    hair: "#3b2a20",
    hairStyle: "sidepart",
    skin: "#e8b98f",
    chief: true,
    x: 7.4,
    z: 10.55,
    desk: [7.4, 9.6, 1.8],
    bottom: true,
    // Entra pelo lado do gabinete dele (a divisória com a sala de reuniões está em x = 9).
    exitX: 8.5,
    boss: "Tu",
    screen: "dash",
  },
  {
    id: "rhea",
    name: "Rhea",
    role: "Chefe de Projetos",
    emoji: "🧪",
    hue: 210,
    hair: "#1f2937",
    hairStyle: "long",
    skin: "#c68e66",
    glasses: true,
    chief: true,
    x: topX(0, 0),
    z: TOP_SEAT_Z,
    boss: "Atlas (CEO)",
    screen: "doc",
  },
  {
    id: "mira",
    name: "Mira",
    role: "Analista · verifica evidência",
    emoji: "🔎",
    hue: 210,
    hair: "#7c4a1d",
    hairStyle: "ponytail",
    skin: "#f1c9a5",
    x: topX(0, 1),
    z: TOP_SEAT_Z,
    boss: "Rhea",
    screen: "web",
  },
  {
    id: "vera",
    name: "Vera",
    role: "Chefe de Job Search",
    emoji: "🧭",
    hue: 145,
    hair: "#2b2b2b",
    hairStyle: "bun",
    skin: "#e0ac84",
    chief: true,
    x: topX(6, 0),
    z: TOP_SEAT_Z,
    boss: "Atlas (CEO)",
    screen: "dash",
  },
  {
    id: "scout",
    name: "Scout",
    role: "Recolha e filtro de vagas",
    emoji: "🛰️",
    hue: 145,
    hair: "#5b3a29",
    hairStyle: "short",
    skin: "#d9a679",
    headset: true,
    x: topX(6, 1),
    z: TOP_SEAT_Z,
    boss: "Vera",
    screen: "list",
  },
  {
    id: "nina",
    name: "Nina",
    role: "Chefe de Candidaturas e Outreach",
    emoji: "🗂️",
    hue: 25,
    hair: "#111827",
    hairStyle: "long",
    skin: "#f0c3a0",
    glasses: true,
    chief: true,
    x: topX(12, 0),
    z: TOP_SEAT_Z,
    boss: "Atlas (CEO)",
    screen: "doc",
  },
  {
    id: "lena",
    name: "Lena",
    role: "CV, carta e outreach",
    emoji: "✍️",
    hue: 25,
    hair: "#c0392b",
    hairStyle: "curly",
    skin: "#f3cfb1",
    x: topX(12, 1),
    z: TOP_SEAT_Z,
    boss: "Nina",
    screen: "doc",
  },
  {
    id: "theo",
    name: "Theo",
    role: "Candidaturas e formulários",
    emoji: "📨",
    hue: 25,
    hair: "#4a3b2a",
    hairStyle: "short",
    skin: "#e8b98f",
    glasses: true,
    x: topX(12, 2),
    z: TOP_SEAT_Z,
    boss: "Nina",
    screen: "mail",
  },
  {
    id: "dean",
    name: "Dean",
    role: "Chefe de estudos · sincroniza o Canvas",
    emoji: "🎓",
    hue: 270,
    hair: "#111827",
    hairStyle: "bald",
    skin: "#c68e66",
    chief: true,
    x: 1.0,
    z: 10.55,
    desk: [1.0, 9.6, 1.4],
    bottom: true,
    exitX: 2.0,
    boss: "Atlas (CEO)",
    screen: "cal",
    canvas: true,
    startsResting: true,
  },
  {
    id: "ada",
    name: "Ada",
    role: "Entregas · primeira disciplina",
    emoji: "📈",
    hue: 270,
    hair: "#5b3a29",
    hairStyle: "bun",
    skin: "#f0c3a0",
    x: 3.0,
    z: 10.55,
    desk: [3.0, 9.6, 1.4],
    bottom: true,
    exitX: 4.0,
    boss: "Dean",
    screen: "cal",
    hasCourse: true,
  },
  {
    id: "turing",
    name: "Turing",
    role: "Entregas · segunda disciplina",
    emoji: "🤖",
    hue: 270,
    hair: "#2b2b2b",
    hairStyle: "curly",
    skin: "#e0ac84",
    glasses: true,
    headset: true,
    x: 5.0,
    z: 10.55,
    desk: [5.0, 9.6, 1.4],
    bottom: true,
    exitX: 4.0,
    boss: "Dean",
    screen: "cal",
    hasCourse: true,
  },
];

export const MEETING_IDS = ["ceo", "rhea", "vera", "nina"] as const;
