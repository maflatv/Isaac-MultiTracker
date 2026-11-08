// Fuentes instaladas en Windows, para elegirlas en el panel. La vista las usa por su nombre: OBS y la ventana
// están en el mismo PC, así que no hace falta copiar ningún archivo de fuente.
const { execFile } = require('child_process');

const SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
(New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }
`;
const TIMEOUT_MS = 15000;

let cached = null;

// Devuelve los nombres de las familias, ordenados. Sin PowerShell (u otro sistema) devuelve una lista vacía.
function listFonts() {
  if (!cached) {
    cached = new Promise(resolve => {
      execFile('powershell.exe', ['-NoProfile', '-Command', SCRIPT], { timeout: TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
        if (err) { cached = null; return resolve([]); }
        const names = [...new Set(stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean))];
        resolve(names.sort((a, b) => a.localeCompare(b)));
      });
    });
  }
  return cached;
}

module.exports = { listFonts };
