import type { AgentDef } from "../data/agents";
import { createAgent, type Agent } from "./agent";
import type { Loc } from "./locations";

/** O segurança da porta: está sempre em pé à entrada (ponta este do corredor), a olhar para dentro. Não faz parte da equipa. */
export const GUARD_DEF: AgentDef = {
  id: "guard",
  name: "Segurança",
  role: "Porta",
  emoji: "💂",
  hue: 222,
  hair: "#1f1b18",
  hairStyle: "short",
  skin: "#c58f68",
  chief: true,
  x: 23.25,
  z: 6.35,
  boss: "",
  screen: "doc",
};

const FACE_WEST = -Math.PI / 2;
export const GUARD_SPOT = { x: 23.25, z: 6.35 } as const;

export function createGuard(): Agent {
  const spot: Loc = { key: "guard-post", pts: [GUARD_SPOT], yaw: FACE_WEST, sit: 0, owner: null };
  const guard = createAgent(GUARD_DEF, spot);
  guard.task = "";
  guard.x = GUARD_SPOT.x;
  guard.z = GUARD_SPOT.z;
  guard.yaw = guard.yawTarget = FACE_WEST;
  return guard;
}
