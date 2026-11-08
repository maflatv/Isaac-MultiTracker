// Diálogo nativo de Windows para elegir un archivo: el navegador no puede dar rutas completas.
// La aplicación de escritorio usa el diálogo de Electron; esto sirve al ejecutar con Node y dentro de Isaac Suite.
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

// Devuelve la ruta elegida, o null si se cancela el diálogo. text: { title, filter, all }.
function pickFile(initialDir, text, env = {}) {
  const filter = `${text.filter} (*.dat)|*.dat|${text.all} (*.*)|*.*`;
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', SCRIPT], { env: { ...process.env, PICKER_DIR: initialDir, PICKER_TITLE: text.title, PICKER_FILTER: filter, ...env } }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim() || null);
    });
  });
}

module.exports = { pickFile };
