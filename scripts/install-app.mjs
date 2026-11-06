// Cria os atalhos "Agent Office" no ambiente de trabalho e no menu Iniciar (Windows). Cada atalho corre
// scripts/app.mjs sem janela de consola (através de wscript e de um pequeno .vbs) e usa o ícone do projeto.
// Uso: npm run app:install
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "win32") {
  console.log("Os atalhos só existem no Windows. Noutros sistemas corre: npm run app");
  process.exit(0);
}

const root = join(import.meta.dirname, "..");
const vbs = join(root, "scripts", "agent-office.vbs");
// O .vbs lança o node escondido (0 = sem janela) e não espera (False).
writeFileSync(
  vbs,
  [
    "' Gerado por scripts/install-app.mjs: abre o Agent Office sem janela de consola.",
    'Set shell = CreateObject("WScript.Shell")',
    `shell.CurrentDirectory = "${root}"`,
    `shell.Run """${process.execPath}"" ""${join(root, "scripts", "app.mjs")}""", 0, False`,
    "",
  ].join("\r\n"),
);

const ps = (v) => `'${v.replaceAll("'", "''")}'`;
const icon = join(root, "scripts", "agent-office.ico");
const script = `
$shell = New-Object -ComObject WScript.Shell
$places = @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('Programs')) ''))
foreach ($dir in $places) {
  $lnk = $shell.CreateShortcut((Join-Path $dir 'Agent Office.lnk'))
  $lnk.TargetPath = (Join-Path $env:WINDIR 'System32\\wscript.exe')
  $lnk.Arguments = '"' + ${ps(vbs)} + '"'
  $lnk.WorkingDirectory = ${ps(root)}
  $lnk.IconLocation = ${ps(icon)} + ',0'
  $lnk.Description = 'Agent Office: o escritório de agentes Claude Code'
  $lnk.Save()
  Write-Output ("Atalho criado: " + (Join-Path $dir 'Agent Office.lnk'))
}`;
const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" });
process.stdout.write(r.stdout);
if (r.status !== 0) {
  process.stderr.write(r.stderr);
  process.exit(1);
}
console.log("Pronto: abre o Agent Office pelo ícone no ambiente de trabalho ou no menu Iniciar.");
