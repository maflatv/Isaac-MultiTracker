// Diálogo nativo para elegir un archivo: el navegador no puede dar rutas completas.
// La aplicación de escritorio usa el diálogo de Electron; esto sirve al ejecutar con Node y dentro de Isaac Suite.
// En Windows lo abre PowerShell; en Linux, zenity (GNOME y la mayoría) o kdialog (KDE).
const path = require('path');
const { execFile } = require('child_process');

// Los textos llegan por variables de entorno: así no hay que escaparlos dentro del script.
const SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = $env:PICKER_TITLE
$dialog.Filter = $env:PICKER_FILTER
$dialog.InitialDirectory = $env:PICKER_DIR
if ($env:PICKER_DRY_RUN) { exit 0 }
if ($dialog.ShowDialog($owner) -eq 'OK') { $dialog.FileName }
`;

// Linux: el primero de los dos que esté instalado. Los dos salen con código 1 al cancelar.
const LINUX_PICKERS = [
  (dir, text) => ['zenity', ['--file-selection', `--title=${text.title}`, `--filename=${dir}${path.sep}`, `--file-filter=${text.filter} | *.dat`, `--file-filter=${text.all} | *`]],
  (dir, text) => ['kdialog', ['--title', text.title, '--getopenfilename', dir, `*.dat|${text.filter}\n*|${text.all}`]],
];

function pickLinux(initialDir, text, i = 0) {
  if (i >= LINUX_PICKERS.length) return Promise.reject(new Error('Instala zenity o kdialog para elegir archivos.'));
  const [cmd, args] = LINUX_PICKERS[i](initialDir, text);
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout) => {
      if (err && err.code === 'ENOENT') return resolve(pickLinux(initialDir, text, i + 1));
      if (err && err.code === 1) return resolve(null);
      if (err) return reject(err);
      resolve(stdout.trim() || null);
    });
  });
}

// Devuelve la ruta elegida, o null si se cancela el diálogo. text: { title, filter, all }.
function pickFile(initialDir, text, env = {}) {
  if (process.platform !== 'win32') return pickLinux(initialDir, text);
  const filter = `${text.filter} (*.dat)|*.dat|${text.all} (*.*)|*.*`;
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', SCRIPT], { env: { ...process.env, PICKER_DIR: initialDir, PICKER_TITLE: text.title, PICKER_FILTER: filter, ...env } }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim() || null);
    });
  });
}

module.exports = { pickFile };
