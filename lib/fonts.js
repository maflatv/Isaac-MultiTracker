// Fuentes instaladas en el sistema, para elegirlas en el panel. La vista las usa por su nombre: OBS y la ventana
// están en el mismo PC, así que no hace falta copiar ningún archivo de fuente.
const { execFile } = require('child_process');

const SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
(New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }
`;
const TIMEOUT_MS = 15000;

// Windows: PowerShell da un nombre por línea. Linux: fc-list da por línea las familias de un archivo separadas por comas
// (la primera es el nombre principal) y escapa algunos signos con "\".
const COMMANDS = {
  win32: ['powershell.exe', ['-NoProfile', '-Command', SCRIPT], line => line],
  other: ['fc-list', [':', 'family'], line => line.split(',')[0].replace(/\\(.)/g, '$1')],
};

let cached = null;

// Devuelve los nombres de las familias, ordenados. Si no se pueden leer, devuelve una lista vacía.
function listFonts() {
  if (!cached) {
    cached = new Promise(resolve => {
      const [cmd, args, name] = COMMANDS[process.platform === 'win32' ? 'win32' : 'other'];
      execFile(cmd, args, { timeout: TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
        if (err) { cached = null; return resolve([]); }
        const names = [...new Set(stdout.split(/\r?\n/).map(s => name(s).trim()).filter(Boolean))];
        resolve(names.sort((a, b) => a.localeCompare(b)));
      });
    });
  }
  return cached;
}

module.exports = { listFonts };
