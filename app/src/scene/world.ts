import * as THREE from "three";

/** Cena única partilhada pelos módulos de construção. */
export const scene = new THREE.Scene();

/** Luzes interiores (uma por sala), ajustadas pela hora do dia. */
export const lamps: THREE.PointLight[] = [];
