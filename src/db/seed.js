// ============================================
// BotFlow.ai — Seed de datos de prueba
// Crea un usuario de demo con "Café Aroma"
// ============================================

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { query, transaction } from './index.js';

async function seed() {
  console.log('🌱 Sembrando datos de prueba...\n');

  await transaction(async (client) => {
    // 1. Usuario demo
    const passwordHash = await bcrypt.hash('demo1234', 12);
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, name, email_verified)
       VALUES ('demo@botflow.ai', $1, 'Juan Demo', TRUE)
       ON CONFLICT (email) DO UPDATE SET name = 'Juan Demo'
       RETURNING id`,
      [passwordHash]
    );
    const userId = userResult.rows[0].id;
    console.log('  ✅ Usuario demo creado:', userId);

    // 2. Organización: Café Aroma
    const orgResult = await client.query(
      `INSERT INTO organizations (owner_id, name, slug, industry, website_url)
       VALUES ($1, 'Café Aroma', 'cafe-aroma', 'Gastronomía', 'https://cafearoma.com.ar')
       ON CONFLICT (slug) DO UPDATE SET name = 'Café Aroma'
       RETURNING id`,
      [userId]
    );
    const orgId = orgResult.rows[0].id;
    console.log('  ✅ Organización creada:', orgId);

    // 3. Miembro
    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (organization_id, user_id) DO NOTHING`,
      [orgId, userId]
    );

    // 4. Suscripción Professional (trial)
    await client.query(
      `INSERT INTO subscriptions 
       (organization_id, plan, status, max_channels, max_conversations_per_month, max_knowledge_sources)
       VALUES ($1, 'professional', 'trialing', 3, 3000, 20)
       ON CONFLICT DO NOTHING`,
      [orgId]
    );
    console.log('  ✅ Suscripción Professional (trial) creada');

    // 5. Bot de Café Aroma
    const botResult = await client.query(
      `INSERT INTO bots 
       (organization_id, name, bot_id, tone, language, welcome_message, fallback_message, system_prompt, widget_primary_color)
       VALUES ($1, 'Aroma Bot', 'bf_aroma01', 'friendly', 'es',
         '¡Hola! ☕ Bienvenido a Café Aroma. ¿En qué puedo ayudarte?',
         'No tengo esa información, pero puedo pasarte con un miembro de nuestro equipo. ¿Querés que lo haga?',
         'Sos el asistente virtual de Café Aroma, una cafetería de especialidad en Buenos Aires. Respondé de forma amigable, concisa y con personalidad argentina. Usá voseo. Promocioná los productos pero sin ser insistente.',
         '#4ade80')
       ON CONFLICT (bot_id) DO UPDATE SET name = 'Aroma Bot'
       RETURNING id`,
      [orgId]
    );
    const botId = botResult.rows[0].id;
    console.log('  ✅ Bot creado:', botId);

    // 6. Canales
    await client.query(
      `INSERT INTO channels (bot_id, type, status, config) VALUES
       ($1, 'web_widget', 'connected', '{"allowedOrigins": ["https://cafearoma.com.ar"]}'),
       ($1, 'whatsapp', 'connected', '{"phone": "+5491155551234"}'),
       ($1, 'instagram', 'disconnected', '{}')
       ON CONFLICT (bot_id, type) DO NOTHING`,
      [botId]
    );
    console.log('  ✅ Canales creados (web + whatsapp + instagram)');

    // 7. Knowledge sources
    await client.query(
      `INSERT INTO knowledge_sources (bot_id, type, title, content, is_processed) VALUES
       ($1, 'text', 'Menú de Café Aroma', 
        'MENÚ - Café Aroma\n\nCafés:\n- Espresso: $1.200\n- Cappuccino: $1.800\n- Latte: $1.900\n- Cold Brew: $2.100\n- Flat White: $2.000\n\nComidas:\n- Medialunas (3): $1.500\n- Tostado J&Q: $2.800\n- Budín de limón: $1.600\n- Ensalada Caesar: $3.200\n\nPostres:\n- Brownie: $2.000\n- Cheesecake: $2.400\n- Alfajor artesanal: $1.200',
        TRUE),
       ($1, 'text', 'Información del local', 
        'Café Aroma - Información General\n\nDirección: Av. Córdoba 1234, Palermo, CABA\nHorarios: Lunes a Viernes 8:00-20:00, Sábados 9:00-21:00, Domingos 9:00-18:00\nTeléfono: +54 11 5555-1234\nInstagram: @cafearoma.ba\nWiFi: Sí, gratis para clientes (password: aroma2024)\n\nAceptamos: Efectivo, Débito, Crédito, Mercado Pago, QR\nReservas: Sí, por WhatsApp o Instagram\nDelivery: Sí, por Rappi y PedidosYa\nCapacidad: 45 personas interior, 20 exterior',
        TRUE),
       ($1, 'faq', 'Preguntas frecuentes',
        'P: ¿Tienen opciones veganas?\nR: ¡Sí! Tenemos leche de almendras y avena sin cargo extra, y varias opciones de comida vegana.\n\nP: ¿Aceptan mascotas?\nR: ¡Por supuesto! Tenemos espacio pet-friendly en nuestra terraza.\n\nP: ¿Hacen eventos privados?\nR: Sí, podés reservar nuestro salón privado para hasta 15 personas.\n\nP: ¿Tienen estacionamiento?\nR: No tenemos estacionamiento propio, pero hay un parking público a 50 metros.',
        TRUE)
       ON CONFLICT DO NOTHING`,
      [botId]
    );
    console.log('  ✅ Knowledge base creada (menú, info, FAQs)');

    // 8. Quick replies
    await client.query(
      `INSERT INTO quick_replies (bot_id, trigger_text, response_text, is_exact_match, priority) VALUES
       ($1, 'horarios', 'Nuestros horarios son:\n🕐 Lun-Vie: 8:00 a 20:00\n🕐 Sábados: 9:00 a 21:00\n🕐 Domingos: 9:00 a 18:00', FALSE, 10),
       ($1, 'dirección', '📍 Estamos en Av. Córdoba 1234, Palermo, CABA. ¡Te esperamos!', FALSE, 10),
       ($1, 'wifi', '📶 WiFi gratis para clientes. Password: aroma2024', FALSE, 10),
       ($1, 'delivery', '🛵 Hacemos delivery por Rappi y PedidosYa. ¡Buscanos ahí!', FALSE, 10),
       ($1, 'reserva', '📅 Para reservas, escribinos por WhatsApp al +54 11 5555-1234 o por Instagram @cafearoma.ba', FALSE, 10)
       ON CONFLICT DO NOTHING`,
      [botId]
    );
    console.log('  ✅ Quick replies creadas');
  });

  console.log('\n✅ Seed completado. Credenciales demo:');
  console.log('   Email: demo@botflow.ai');
  console.log('   Password: demo1234\n');
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Error en seed:', err);
  process.exit(1);
});
