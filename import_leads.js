import axios from 'axios';
import dotenv from 'dotenv';
import pkg from 'pg';

dotenv.config();

const { Pool } = pkg;
const apiKey = process.env.GPTMAKER_API_KEY;
const workspaceId = '3EFA0849B85440AA27C7761CCBFB07F3';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function fetchAllContacts() {
    const contacts = [];
    const seenIds = new Set();
    let page = 0;
    const limit = 50;

    console.log('Fetching contacts from GPT Maker...');
    while (true) {
        const response = await axios.get(`https://api.gptmaker.ai/v2/workspace/${workspaceId}/search`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            params: { limit, page }
        });

        const data = response.data?.data || response.data || [];
        const batch = Array.isArray(data) ? data : [];

        if (batch.length === 0) break;

        // Stop if we see an ID we've already added (API is looping)
        const firstId = batch[0]?.id;
        if (firstId && seenIds.has(firstId)) {
            console.log(`Detected repeat at page ${page} — stopping pagination.`);
            break;
        }

        for (const c of batch) {
            if (!seenIds.has(c.id)) {
                seenIds.add(c.id);
                contacts.push(c);
            }
        }

        console.log(`  Page ${page}: +${batch.length} contacts (total unique: ${contacts.length})`);
        if (batch.length < limit) break;
        page++;
    }

    return contacts;
}

async function importContacts() {
    const client = await pool.connect();
    try {
        const contacts = await fetchAllContacts();
        console.log(`\nTotal contacts found: ${contacts.length}`);

        // Filter out invalid entries (numbers only as name, @lid recipients, etc.)
        const valid = contacts.filter(c => {
            const isRealPhone = c.phone && /^\d{10,15}$/.test(c.phone);
            const isRealName = c.name && !/^\d+$/.test(c.name); // not a pure number name
            return isRealPhone && isRealName;
        });

        console.log(`Valid contacts to import: ${valid.length}`);

        let inserted = 0;
        let skipped = 0;

        for (const contact of valid) {
            const phone = contact.phone;
            const name = contact.name?.trim() || null;

            // Check if already exists
            const existing = await client.query(
                'SELECT id FROM leads WHERE telefone = $1', [phone]
            );

            if (existing.rows.length > 0) {
                skipped++;
                continue;
            }

            await client.query(
                `INSERT INTO leads (nome, telefone, status, primeiro_contato, criado_em, atualizado_em)
                 VALUES ($1, $2, 'novo', NOW(), NOW(), NOW())`,
                [name, phone]
            );
            inserted++;
        }

        console.log(`\n✅ Done! Inserted: ${inserted} | Skipped (already existed): ${skipped}`);
    } finally {
        client.release();
        await pool.end();
    }
}

importContacts().catch(console.error);
