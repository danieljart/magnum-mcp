import { google } from 'googleapis';
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const { Pool } = pg;
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ────────────────────────────────────────────────
// Normalização de nomes de cidade
// Trata "Belém - PA", "Belém-PA", "belem" como "Belém"
// ────────────────────────────────────────────────
function normalizeCity(name) {
    if (!name) return null;
    return name
        .replace(/-\s*PA$/i, '')   // remove " - PA" ou "-PA" no final
        .trim()
        .replace(/\s+/g, ' ');
}

function formatToISO(dateStr) {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return dateStr;
}

function parseDescription(description) {
    if (!description) return null;
    const data = {};
    const lines = description.split('\n');
    lines.forEach(line => {
        const [key, ...valueParts] = line.split(':');
        if (key && valueParts.length > 0) {
            const cleanKey = key.trim().toUpperCase();
            const cleanValue = valueParts.join(':').trim();
            data[cleanKey] = cleanValue;
        }
    });

    const dataSaida = data['DATA_SAIDA'] ? formatToISO(data['DATA_SAIDA']) : null;
    if (!dataSaida) return null;

    let finalOrigem = data['ORIGEM'];
    let finalDestino = data['DESTINO'];

    if (finalOrigem && finalOrigem.toLowerCase() === 'origem') finalOrigem = null;
    if (finalDestino && finalDestino.toLowerCase() === 'destino') finalDestino = null;

    if (!finalOrigem || !finalDestino) {
        if (data['ROTA']) {
            if (/ x /i.test(data['ROTA'])) {
                finalOrigem = finalOrigem || data['ROTA'].split(/ x /i)[0].trim();
                finalDestino = finalDestino || data['ROTA'].split(/ x /i)[1].trim();
            } else if (data['ROTA'].toLowerCase().includes('x')) {
                finalOrigem = finalOrigem || data['ROTA'].toLowerCase().split('x')[0].trim();
                finalDestino = finalDestino || data['ROTA'].toLowerCase().split('x')[1].trim();
            }
        }
    }

    if (finalOrigem && finalOrigem.toLowerCase() === 'origem') finalOrigem = null;
    if (finalDestino && finalDestino.toLowerCase() === 'destino') finalDestino = null;

    // Normaliza nomes (remove "-PA")
    finalOrigem = normalizeCity(finalOrigem || 'Belém');
    finalDestino = normalizeCity(finalDestino || 'Santa Catarina');

    return {
        origem: finalOrigem,
        destino: finalDestino,
        data_saida: dataSaida,
    };
}

async function authorize() {
    let credentials;
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    } else if (fs.existsSync(CREDENTIALS_PATH)) {
        const content = fs.readFileSync(CREDENTIALS_PATH);
        credentials = JSON.parse(content);
    } else {
        throw new Error("Missing credentials.json or GOOGLE_CREDENTIALS_JSON env var");
    }

    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    if (process.env.GOOGLE_TOKEN_JSON) {
        oAuth2Client.setCredentials(JSON.parse(process.env.GOOGLE_TOKEN_JSON));
        return oAuth2Client;
    } else if (fs.existsSync(TOKEN_PATH)) {
        const token = fs.readFileSync(TOKEN_PATH);
        oAuth2Client.setCredentials(JSON.parse(token));
        return oAuth2Client;
    }
    throw new Error('Token não encontrado.');
}

// ────────────────────────────────────────────────
// Monta chave única: "data_saida|origem_normalizado|destino_normalizado"
// ────────────────────────────────────────────────
function tripKey(data_saida, origem, destino) {
    return `${data_saida}|${normalizeCity(origem)}|${normalizeCity(destino)}`;
}

async function verifyAndFix() {
    console.log('\n🔍 ===== VERIFICAÇÃO: CALENDÁRIO vs BANCO =====\n');
    const DRY_RUN = process.argv.includes('--dry-run');
    if (DRY_RUN) console.log('⚠️  MODO DRY-RUN: nenhuma alteração será feita.\n');

    // ── 1. Busca eventos do calendário ──────────────────
    const auth = await authorize();
    const calendar = google.calendar({ version: 'v3', auth });
    const res = await calendar.events.list({
        calendarId: CALENDAR_ID,
        // Busca desde o início do mês atual para pegar viagens presentes e futuras
        timeMin: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
        maxResults: 200,
        singleEvents: true,
        orderBy: 'startTime',
    });
    const events = res.data.items || [];
    console.log(`📅 Calendário: ${events.length} evento(s) encontrado(s)\n`);

    // ── 2. Parseia e normaliza as viagens do calendário ──
    // Chave: tripKey → dados completos do evento
    const calendarTrips = new Map();
    const calendarSkipped = [];

    for (const event of events) {
        const trip = parseDescription(event.description);
        if (!trip) {
            calendarSkipped.push(event.summary || '(sem título)');
            continue;
        }
        const key = tripKey(trip.data_saida, trip.origem, trip.destino);
        if (calendarTrips.has(key)) {
            console.log(`⚠️  Duplicata no próprio calendário: "${event.summary}" (${key})`);
        }
        calendarTrips.set(key, { ...trip, title: event.summary });
    }

    console.log(`✅ Viagens válidas no calendário: ${calendarTrips.size}`);
    if (calendarSkipped.length)
        console.log(`⏭️  Eventos pulados (formato inválido): ${calendarSkipped.join(', ')}\n`);

    // Imprime lista do calendário para conferência
    console.log('\n📋 VIAGENS NO CALENDÁRIO (verdade absoluta):');
    for (const [key, t] of calendarTrips) {
        console.log(`  • ${t.data_saida}  ${t.origem} → ${t.destino}`);
    }

    // ── 3. Busca viagens no banco ────────────────────────
    const dbResult = await pool.query(
        `SELECT id, data_saida::text, origem, destino FROM viagens ORDER BY data_saida, origem`
    );
    const dbRows = dbResult.rows;
    console.log(`\n🗃️  Banco: ${dbRows.length} registro(s) encontrado(s)\n`);

    // ── 4. Mapeia banco por chave normalizada ───────────
    // Podem existir múltiplas rows com a mesma chave (duplicatas)
    const dbByKey = new Map(); // key → [rows]
    for (const row of dbRows) {
        const key = tripKey(row.data_saida, row.origem, row.destino);
        if (!dbByKey.has(key)) dbByKey.set(key, []);
        dbByKey.get(key).push(row);
    }

    // ── 5. Análise de diferenças ───────────────────────
    const toDelete = [];       // IDs que devem ser deletados do banco
    const missingInDb = [];    // Viagens que estão no calendário mas não no banco

    console.log('🔎 ANÁLISE:\n');

    // 5a. Encontra duplicatas internas no banco
    for (const [key, rows] of dbByKey) {
        if (rows.length > 1) {
            // Verifica se a chave existe no calendário
            if (calendarTrips.has(key)) {
                // Mantém APENAS o primeiro, deleta os demais
                const [keep, ...duplicates] = rows;
                console.log(`🔁 DUPLICATA (${key}):`);
                console.log(`   MANTER  → id=${keep.id} | ${keep.data_saida} ${keep.origem} → ${keep.destino}`);
                for (const dup of duplicates) {
                    console.log(`   DELETAR → id=${dup.id} | ${dup.data_saida} ${dup.origem} → ${dup.destino}`);
                    toDelete.push(dup.id);
                }
            } else {
                // Está duplicado E não existe no calendário — deleta todos
                console.log(`❌ DUPLICATA FANTASMA (não está no calendário) (${key}):`);
                for (const row of rows) {
                    console.log(`   DELETAR → id=${row.id} | ${row.data_saida} ${row.origem} → ${row.destino}`);
                    toDelete.push(row.id);
                }
            }
        }
    }

    // 5b. Encontra registros no banco que não existem no calendário (variações de nome, etc.)
    for (const [key, rows] of dbByKey) {
        if (!calendarTrips.has(key)) {
            for (const row of rows) {
                if (!toDelete.includes(row.id)) {
                    console.log(`👻 NO BANCO MAS NÃO NO CALENDÁRIO → id=${row.id} | ${row.data_saida} ${row.origem} → ${row.destino}`);
                    toDelete.push(row.id);
                }
            }
        }
    }

    // 5c. Encontra viagens no calendário que não estão no banco
    for (const [key, trip] of calendarTrips) {
        if (!dbByKey.has(key)) {
            missingInDb.push(trip);
            console.log(`➕ NO CALENDÁRIO MAS NÃO NO BANCO → ${trip.data_saida} ${trip.origem} → ${trip.destino}`);
        }
    }

    // ── 6. Resumo ──────────────────────────────────────
    console.log('\n📊 RESUMO:');
    console.log(`   Viagens no calendário:  ${calendarTrips.size}`);
    console.log(`   Registros no banco:     ${dbRows.length}`);
    console.log(`   A deletar do banco:     ${toDelete.length}`);
    console.log(`   Faltando no banco:      ${missingInDb.length}`);

    if (toDelete.length === 0 && missingInDb.length === 0) {
        console.log('\n✅ Banco está sincronizado com o calendário!\n');
        await pool.end();
        return;
    }

    if (DRY_RUN) {
        console.log('\n⚠️  DRY-RUN: nenhuma alteração foi feita. Rode sem --dry-run para aplicar.\n');
        await pool.end();
        return;
    }

    // ── 7. Aplica as correções ─────────────────────────
    if (toDelete.length > 0) {
        console.log(`\n🗑️  Deletando ${toDelete.length} registro(s) inválido(s)...`);
        await pool.query(`DELETE FROM viagens WHERE id = ANY($1::uuid[])`, [toDelete]);
        console.log('   ✅ Deletados.');
    }

    if (missingInDb.length > 0) {
        console.log(`\n⚠️  ${missingInDb.length} viagem(ns) estão no calendário mas faltam no banco.`);
        console.log('   Execute "node sync-calendar.js" para inserir as entradas faltantes.');
    }

    console.log('\n✅ Verificação concluída.\n');
    await pool.end();
}

verifyAndFix().catch(err => {
    console.error('❌ Erro fatal:', err);
    process.exit(1);
});
