// Diálogo nativo de Windows para elegir un archivo: el navegador no puede dar rutas completas.
const { execFile } = require('child_process');

const SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Elegir archivo de guardado de Isaac'
$dialog.Filter = 'Guardados de Isaac (*.dat)|*.dat|Todos los archivos (*.*)|*.*'
$dialog.InitialDirectory = $env:PICKER_DIR
if ($env:PICKER_DRY_RUN) { exit 0 }
if ($dialog.ShowDialog($owner) -eq 'OK') { $dialog.FileName }
`;

// Devuelve la ruta elegida, o null si se cancela el diálogo.
function pickFile(initialDir, env = {}) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', SCRIPT], { env: { ...process.env, PICKER_DIR: initialDir, ...env } }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim() || null);
    });
  });
}

module.exports = { pickFile };
