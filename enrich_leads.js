import axios from 'axios';
import dotenv from 'dotenv';
import pkg from 'pg';

dotenv.config();

const { Pool } = pkg;
const apiKey = process.env.GPTMAKER_API_KEY;
const workspaceId = '3EFA0849B85440AA27C7761CCBFB07F3';
const marlonAgentId = '3EFA08EA5593E0E17649C2E0D4FBCE5B';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Fetch all Marlon interactions (paginated, with dedup)
async function fetchMarlonInteractions() {
    const interactions = [];
    const seenIds = new Set();
    let page = 1;

    console.log('Fetching Marlon interactions...');
    while (true) {
        const res = await axios.get(`https://api.gptmaker.ai/v2/workspace/${workspaceId}/interactions`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            params: { page, pageSize: 50, agentId: marlonAgentId }
        });

        const batch = res.data?.data || res.data || [];
        const items = Array.isArray(batch) ? batch : [];

        if (items.length === 0) break;

        // Dedup
        const firstId = items[0]?.id;
        if (firstId && seenIds.has(firstId)) {
            console.log(`Detected repeat at page ${page} — stopping.`);
            break;
        }

        for (const item of items) {
            if (!seenIds.has(item.id)) {
                seenIds.add(item.id);
                if (item.agentId === marlonAgentId) interactions.push(item);
            }
        }

        const total = res.data?.count || 0;
        console.log(`  Page ${page}: ${interactions.length}/${total} Marlon interactions`);

        if (interactions.length >= total || items.length < 50) break;
        page++;
    }
    return interactions;
}

// Fetch messages for a specific interaction
async function fetchMessages(interactionId) {
    try {
        const res = await axios.get(`https://api.gptmaker.ai/v2/interaction/${interactionId}/messages`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        return res.data?.data || res.data || [];
    } catch {
        return [];
    }
}

// Extract origin/destination cities from text using the paradas_rota table
async function extractCities(client, text) {
    const { rows: cities } = await client.query(
        `SELECT cidade FROM paradas_rota ORDER BY LENGTH(cidade) DESC`
    );

    const found = [];
    const lower = text.toLowerCase();
    for (const { cidade } of cities) {
        if (lower.includes(cidade.toLowerCase()) && !found.includes(cidade)) {
            found.push(cidade);
        }
    }
    return found; // first mention = likely origin, second = destination
}

export async function enrichLeads() {
    const client = await pool.connect();
    try {
        // Get existing leads
        const { rows: leads } = await client.query('SELECT id, telefone, status FROM leads');
        const leadsByPhone = {};
        for (const lead of leads) {
            // Normalize phone: keep only digits
            const normalized = lead.telefone.replace(/\D/g, '');
            leadsByPhone[normalized] = lead;
        }

        console.log(`Found ${leads.length} leads to enrich.`);

        const interactions = await fetchMarlonInteractions();
        console.log(`\nTotal Marlon interactions: ${interactions.length}\n`);

        let updated = 0;

        // Group interactions by contact phone (most recent first)
        const byPhone = {};
        for (const interaction of interactions) {
            const phone = (interaction.contactPhone || '').replace(/\D/g, '');
            if (!byPhone[phone]) byPhone[phone] = [];
            byPhone[phone].push(interaction);
        }

        for (const [phone, contactInteractions] of Object.entries(byPhone)) {
            const lead = leadsByPhone[phone];
            if (!lead) continue; // not in leads table

            // Use most recent interaction's messages
            const latest = contactInteractions[0];
            const messages = await fetchMessages(latest.id);

            // Combine all message text
            const fullText = messages
                .filter(m => m.content || m.text || m.message)
                .map(m => m.content || m.text || m.message)
                .join(' ');

            const cities = await extractCities(client, fullText);

            // Determine status from interaction status
            let newStatus = 'contato';
            if (fullText.length > 200) newStatus = 'conversando'; // had a real conversation
            if (latest.status === 'RESOLVED') newStatus = 'conversando';

            const updates = [];
            const values = [];
            let paramIdx = 1;

            if (cities[0]) { updates.push(`cidade_origem = $${paramIdx++}`); values.push(cities[0]); }
            if (cities[1]) { updates.push(`cidade_destino_intencao = $${paramIdx++}`); values.push(cities[1]); }
            if (newStatus !== lead.status) { updates.push(`status = $${paramIdx++}`); values.push(newStatus); }
            updates.push(`primeiro_contato = $${paramIdx++}`);
            values.push(new Date(latest.startAt));
            updates.push(`atualizado_em = NOW()`);

            if (updates.length > 0) {
                values.push(lead.id);
                await client.query(
                    `UPDATE leads SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
                    values
                );
                console.log(`Updated lead ${phone}: origem=${cities[0] || '?'}, destino=${cities[1] || '?'}, status=${newStatus}`);
                updated++;
            }
        }

        console.log(`\n✅ Done! Enriched ${updated} leads out of ${leads.length}.`);
    } finally {
        client.release();
        await pool.end();
    }
}

// Allow direct execution for manual runs
if (process.argv[1] && process.argv[1].endsWith('enrich_leads.js')) {
    enrichLeads().catch(console.error);
}
