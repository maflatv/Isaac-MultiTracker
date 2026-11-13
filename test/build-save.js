// Guardados construidos a mano para las pruebas (no es un archivo de pruebas: node --test solo ejecuta *.test.js).
// Guardado mínimo: cabecera y los bloques que se leen (logros, contadores, objetos vistos y desafíos).
// Cada bloque: tipo, tamaño (sin usar), número de elementos y los datos. Contadores de 4 bytes, el resto de 1.
function buildSave({ achievements = 641, counters = 500, collectibles = 733, challenges = 46, set = {} } = {}) {
  const parts = [Buffer.alloc(0x14)];
  parts[0].write('ISAACNGSAVE', 0, 'latin1');
  const block = (type, count, size, values = {}) => {
    const head = Buffer.alloc(12);
    head.writeInt32LE(type, 0);
    head.writeInt32LE(count * size, 4);
    head.writeInt32LE(count, 8);
    const body = Buffer.alloc(count * size);
    for (const [i, v] of Object.entries(values)) size === 4 ? body.writeInt32LE(v, i * 4) : (body[i] = v);
    parts.push(head, body);
  };
  block(1, achievements, 1, set.achievements);
  block(2, counters, 4, set.counters);
  block(4, collectibles, 1, set.collectibles);
  block(7, challenges, 1, set.challenges);
  return Buffer.concat(parts);
}

module.exports = { buildSave };
