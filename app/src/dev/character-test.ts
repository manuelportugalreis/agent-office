import * as THREE from "three";
import { buildCharacter, preloadCharacters, type Drivers } from "../scene/character";

/** Página de teste (só em desenvolvimento): personagens reais em poses simples para validar o retarget. */
const params = new URLSearchParams(location.search);
const pose = params.get("pose") ?? "stand";
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd8d2c6);
scene.add(new THREE.HemisphereLight(0xfff4e6, 0x9a8f80, 2));
const sun = new THREE.DirectionalLight(0xffe9cc, 3);
sun.position.set(3, 6, 5);
sun.castShadow = true;
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ color: 0xcfc8ba }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 50);
cam.position.set(0, 1.1, 5.2);
cam.lookAt(0, 0.9, 0);

function makeDrivers(): Drivers {
  const g = () => new THREE.Group();
  const d = { torso: g(), head: g(), shL: g(), shR: g(), elL: g(), elR: g(), hpL: g(), hpR: g(), knL: g(), knR: g(), hips: g() };
  d.hips.position.y = 0.93;
  if (pose === "sit") {
    d.hips.position.y = 0.48;
    d.hpL.rotation.x = d.hpR.rotation.x = -1.57;
    d.knL.rotation.x = d.knR.rotation.x = 1.5;
    d.shL.rotation.x = d.shR.rotation.x = -0.8;
    d.elL.rotation.x = d.elR.rotation.x = -0.9;
  } else if (pose === "arms") {
    d.shL.rotation.x = d.shR.rotation.x = -1.5;
    d.elL.rotation.x = d.elR.rotation.x = -0.4;
    d.hpL.rotation.x = 0.4;
    d.hpR.rotation.x = -0.4;
  } else if (pose === "side") {
    d.shL.rotation.z = 0.8;
    d.shR.rotation.z = -0.8;
  }
  return d as Drivers;
}

void preloadCharacters(["Hair_Long", "Hair_SimpleParted", "Hair_Buns", "Hair_Buzzed"]).then(() => {
  const looks = [
    {
      female: false,
      skin: "#e8b98f",
      hair: "#3b2a20",
      hairModel: "Hair_SimpleParted",
      shirt: "#4a7ab0",
      trousers: "#2b3447",
      shoes: "#17181c",
      longSleeves: false,
    },
    {
      female: true,
      skin: "#8d5a3b",
      hair: "#2a1d16",
      hairModel: "Hair_Long",
      shirt: "#b04a6a",
      trousers: "#3a3f4a",
      shoes: "#17181c",
      longSleeves: true,
    },
  ];
  const chars = looks.map((look, i) => {
    const drivers = makeDrivers();
    const c = buildCharacter(look, drivers);
    if (!c) throw new Error("personagem não carregou");
    c.root.position.x = (i - 0.5) * 1.4;
    scene.add(c.root);
    c.update();
    (window as unknown as { dbg: THREE.Object3D[] }).dbg = [...((window as unknown as { dbg?: THREE.Object3D[] }).dbg ?? []), c.root];
    return c;
  });
  const loop = (): void => {
    chars.forEach((c) => c.update());
    renderer.render(scene, cam);
    requestAnimationFrame(loop);
  };
  loop();
});
