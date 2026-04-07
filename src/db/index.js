// ============================================
// BotFlow.ai — Conexión a PostgreSQL
// ============================================

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  connectionString: process.env.DATABASE_URL,
  min: parseInt(process.env.DB_POOL_MIN || '2'),
  max: parseInt(process.env.DB_POOL_MAX || '10'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Log de conexión
pool.on('connect', () => {
  if (process.env.NODE_ENV === 'development') {
    console.log('📦 Nueva conexión al pool de PostgreSQL');
  }
});

pool.on('error', (err) => {
  console.error('❌ Error inesperado en el pool de PostgreSQL:', err);
});

// Helper para queries con logging en dev
export async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development' && duration > 100) {
      console.log(`🐢 Query lenta (${duration}ms):`, text.substring(0, 80));
    }
    return result;
  } catch (error) {
    console.error('❌ Error en query:', { text: text.substring(0, 80), error: error.message });
    throw error;
  }
}

// Helper para transacciones
export async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Test de conexión
export async function testConnection() {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ PostgreSQL conectado:', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('❌ No se pudo conectar a PostgreSQL:', error.message, error.code, JSON.stringify({host: error.address, port: error.port}));
    return false;
  }
}

export default pool;
