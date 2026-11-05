import type * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

/**
 * Só para desenvolvimento (?export): exporta o edifício e a mobília (o que não se mexe) para um .glb,
 * que depois é cozinhado (luz global) no Blender. Quem recebe o ficheiro é o servidor de testes local.
 */
const WAIT_MS = 9000; // espera os modelos reais (carregam em segundo plano)

export async function exportStatic(roots: readonly THREE.Object3D[]): Promise<void> {
  await new Promise((r) => setTimeout(r, WAIT_MS));
  const exporter = new GLTFExporter();
  const glb = await new Promise<ArrayBuffer>((resolve, reject) =>
    exporter.parse(
      [...roots],
      (result) => resolve(result as ArrayBuffer),
      (e) => reject(e),
      { binary: true, onlyVisible: true, maxTextureSize: 1024 },
    ),
  );
  const res = await fetch("/save?name=office_static.glb", { method: "POST", body: glb });
  document.title = res.ok ? `export ok ${(glb.byteLength / 1e6).toFixed(1)} MB` : "export falhou";
}
