require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { Pool } = require('pg');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// We need pg package
const neonPool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_OCZcNY5fT7jW@ep-floral-dust-aigqa6h8-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require'
});

async function migrate() {
    console.log("Migrando paradas_rota...");
    const { data: paradas } = await supabase.from('paradas_rota').select('*');
    for (const p of paradas || []) {
        await neonPool.query(`
      INSERT INTO paradas_rota (id, estado, cidade, ordem, eh_oficial, cidade_referencia, created_at, distancia_origem_km)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO NOTHING
    `, [p.id, p.estado, p.cidade, p.ordem, p.eh_oficial, p.cidade_referencia, p.created_at, p.distancia_origem_km]);
    }

    console.log("Migrando viagens...");
    const { data: viagens } = await supabase.from('viagens').select('*');
    for (const v of viagens || []) {
        await neonPool.query(`
      INSERT INTO viagens (id, data_saida, origem, destino, valor_base, vagas_total, vagas_disponiveis, status, created_at, horario_saida, tipo_onibus, local_embarque, tempo_viagem, distancia_km)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (id) DO NOTHING
    `, [v.id, v.data_saida, v.origem, v.destino, v.valor_base, v.vagas_total, v.vagas_disponiveis, v.status, v.created_at, v.horario_saida, v.tipo_onibus, v.local_embarque, v.tempo_viagem, v.distancia_km]);
    }

    console.log("Migrando reservas...");
    const { data: reservas } = await supabase.from('reservas').select('*');
    for (const r of reservas || []) {
        await neonPool.query(`
      INSERT INTO reservas (id, codigo_reserva, viagem_id, nome_cliente, telefone, quantidade, valor_total, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO NOTHING
    `, [r.id, r.codigo_reserva, r.viagem_id, r.nome_cliente, r.telefone, r.quantidade, r.valor_total, r.status, r.created_at]);
    }

    console.log("Migration complete!");
    process.exit(0);
}

migrate().catch(console.error);
