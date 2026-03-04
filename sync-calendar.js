import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
    return {
        status: data['STATUS'] || 'ATIVO',
        origem: (data['ROTA'] && data['ROTA'].includes('x') ? data['ROTA'].split('x')[0].trim() : 'Belém').replace(/-PA$/i, ''),
        destino: (data['ROTA'] && data['ROTA'].includes('x') ? data['ROTA'].split('x')[1].trim() : (data['ROTA'] || 'Destino')).replace(/-PA$/i, ''),
        data_saida: data['DATA_SAIDA'] ? formatToISO(data['DATA_SAIDA']) : null,
        tipo_onibus: data['ONIBUS'],
        vagas_total: parseInt(data['LUGARES_TOTAIS']) || 0,
        vagas_disponiveis: parseInt(data['LUGARES_DISPONIVEIS']) || 0,
        valor_base: parseFloat(data['VALOR_PASSAGEM']) || 0,
        tempo_viagem: data['TEMPO_VIAGEM'],
        horario_saida: data['HORARIO_SAIDA'],
        local_embarque: data['LOCAL_EMBARQUE']
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
    return getAccessToken(oAuth2Client);
}

function getAccessToken(oAuth2Client) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/calendar.readonly'],
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => {
        rl.question('Enter the code from that page here: ', (code) => {
            rl.close();
            oAuth2Client.getToken(code, (err, token) => {
                if (err) return console.error('Error retrieving access token', err);
                oAuth2Client.setCredentials(token);
                fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
                resolve(oAuth2Client);
            });
        });
    });
}

async function listEvents(auth) {
    const calendar = google.calendar({ version: 'v3', auth });
    const res = await calendar.events.list({
        calendarId: CALENDAR_ID,
        timeMin: new Date().toISOString(),
        maxResults: 50,
        singleEvents: true,
        orderBy: 'startTime',
    });
    const events = res.data.items;
    if (!events || events.length === 0) {
        console.log('No upcoming events found.');
        return;
    }
    console.log(`Found ${events.length} events. Syncing to Supabase...`);
    for (const event of events) {
        const tripData = parseDescription(event.description);
        if (!tripData || !tripData.data_saida) {
            console.log(`Skipping event "${event.summary}" - invalid description format.`);
            continue;
        }
        const { error } = await supabase
            .from('viagens')
            .upsert(tripData, { onConflict: 'data_saida,origem,destino' });
        if (error) console.error(`Error syncing trip "${event.summary}":`, error.message);
        else console.log(`Synced trip: ${event.summary}`);
    }
}

authorize().then(listEvents).catch(console.error);
