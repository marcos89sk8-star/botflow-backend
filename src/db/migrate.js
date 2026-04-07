// ============================================
// BotFlow.ai — Runner de migraciones
// ============================================

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, testConnection } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function migrate() {
  console.log('🚀 Iniciando migraciones de BotFlow...\n');

  const connected = await testConnection();
  if (!connected) {
    console.error('No se puede ejecutar migraciones sin conexión a la DB');
    process.exit(1);
  }

  // Crear tabla de control de migraciones si no existe
  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Obtener migraciones ya ejecutadas
  const { rows: executed } = await query('SELECT filename FROM _migrations ORDER BY id');
  const executedSet = new Set(executed.map(r => r.filename));

  // Leer archivos de migración
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (executedSet.has(file)) {
      console.log(`  ⏭️  ${file} (ya ejecutada)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    console.log(`  ▶️  Ejecutando ${file}...`);

    try {
      await query(sql);
      await query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
      console.log(`  ✅ ${file} ejecutada correctamente`);
      count++;
    } catch (error) {
      console.error(`  ❌ Error en ${file}:`, error.message);
      process.exit(1);
    }
  }

  console.log(`\n✅ Migraciones completadas. ${count} nueva(s) ejecutada(s).`);
  process.exit(0);
}

migrate();
