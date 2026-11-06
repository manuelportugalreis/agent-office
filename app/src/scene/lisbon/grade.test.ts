import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CITY_MAX_LIGHTNESS, CITY_SATURATION, recedeCity, recedeColor } from "./grade";

const hsl = (c: THREE.Color): { h: number; s: number; l: number } => {
  const o = { h: 0, s: 0, l: 0 };
  c.getHSL(o);
  return o;
};

describe("a cidade um passo atrás do escritório", () => {
  it("tira saturação ao amarelo pombalino sem mudar o tom, e não altera a cor original", () => {
    const yellow = new THREE.Color(0xe8b830);
    const before = hsl(yellow);
    const after = hsl(recedeColor(yellow));
    expect(after.h).toBeCloseTo(before.h, 2);
    expect(after.s).toBeCloseTo(before.s * CITY_SATURATION, 2);
    expect(hsl(yellow).s).toBeCloseTo(before.s, 5);
  });

  it("o reboco branco ao sol deixa de estar no máximo; as cores escuras mantêm a luminosidade", () => {
    expect(hsl(recedeColor(new THREE.Color(0xffffff))).l).toBeLessThanOrEqual(CITY_MAX_LIGHTNESS);
    const dark = new THREE.Color(0x2a3b2c);
    expect(hsl(recedeColor(dark)).l).toBeCloseTo(hsl(dark).l, 3);
  });

  it("um material partilhado só é recuado uma vez", () => {
    const m = new THREE.MeshStandardMaterial({ color: 0xe8b830 });
    const geo = new THREE.BoxGeometry();
    recedeCity([new THREE.Mesh(geo, m), new THREE.Mesh(geo, m)]);
    const once = hsl(m.color).s;
    recedeCity([new THREE.Mesh(geo, m)]);
    expect(hsl(m.color).s).toBeCloseTo(once, 5);
  });
});
