import axios from 'axios';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();
const apiKey = process.env.GPTMAKER_API_KEY;

const AGENTS = {
    MARLON: {
        id: "3EFA08EA5593E0E17649C2E0D4FBCE5B",
        name: "Marlon",
        behaviorFile: "Marlon_Comportamento.txt",
        trainingFiles: ["Marlon_RegrasDeVendas.txt", "Marlon_RegrasSQL.txt"]
    },
    SUPORTE: {
        id: "3EFB9CBA2A607ACE30FACAF7F359BF2A",
        name: "Suporte Bot",
        behaviorFile: "Suporte_Comportamento.txt",
        trainingFiles: ["Suporte_RegrasDeSuporte.txt", "Suporte_RegrasSQL.txt"]
    },
    NOTIFICADOR: {
        id: "3EFB185EA020C0FA07F6C2E3C035BD57",
        name: "Magnum Turismo - Notificações",
        behaviorFile: "Notificador_Comportamento.txt",
        trainingFiles: ["Notificador_Regras.txt"]
    }
};

async function getAgentFullData(agentId) {
    const response = await axios.get(`https://api.gptmaker.ai/v2/agent/${agentId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    return response.data;
}

async function updateAgent(agentId, behavior) {
    try {
        console.log(`Updating agent ${agentId} behavior...`);
        const fullData = await getAgentFullData(agentId);
        const payload = { ...fullData, behavior: behavior };

        await axios.put(`https://api.gptmaker.ai/v2/agent/${agentId}`, payload, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
        });
        console.log(`Success updating behavior for ${fullData.name}.`);
    } catch (error) {
        console.error(`Error updating agent ${agentId}:`, error.response?.data || error.message);
    }
}

function chunkText(text, size = 950) {
    const chunks = [];
    for (let i = 0; i < text.length; i += size) {
        chunks.push(text.substring(i, i + size));
    }
    return chunks;
}

async function syncTrainings(agentId, fileNames) {
    try {
        console.log(`\nSyncing trainings for agent ${agentId} via FIXED chunks...`);

        // 1. List existing trainings
        const listResponse = await axios.get(`https://api.gptmaker.ai/v2/agent/${agentId}/trainings`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        const currentTrainings = (listResponse.data.data || listResponse.data) || [];

        // 2. Delete ALL existing TEXT and DOCUMENT trainings related to our managed files
        for (const t of currentTrainings) {
            const isManagedDoc = t.type === 'DOCUMENT' && fileNames.includes(t.documentName);
            const isManagedText = t.type === 'TEXT' && fileNames.some(name =>
                t.text && (t.text.includes(`[FILE: ${name}]`) || t.text.includes(`[ARQUIVO: ${name}]`))
            );

            if (isManagedDoc || isManagedText) {
                console.log(`Deleting old training: ${t.type} - ID: ${t.id}`);
                try {
                    await axios.delete(`https://api.gptmaker.ai/v2/training/${t.id}`, {
                        headers: { 'Authorization': `Bearer ${apiKey}` }
                    });
                } catch (delError) {
                    console.error(`Failed to delete training ${t.id}:`, delError.message);
                }
            }
        }

        // 3. Split files into chunks and upload as TEXT
        for (const fileName of fileNames) {
            console.log(`Processing file: ${fileName}`);
            const content = fs.readFileSync(fileName, 'utf8');
            const chunks = chunkText(content);

            for (let i = 0; i < chunks.length; i++) {
                const textPayload = `[FILE: ${fileName}] [PARTE: ${i + 1}/${chunks.length}]\n\n${chunks[i]}`;

                console.log(`Uploading chunk ${i + 1}/${chunks.length} for ${fileName}...`);
                await axios.post(`https://api.gptmaker.ai/v2/agent/${agentId}/trainings`, {
                    type: "TEXT",
                    text: textPayload
                }, {
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
                });
            }
            console.log(`Finished uploading all chunks for ${fileName}.`);
        }
    } catch (error) {
        console.error(`Error syncing trainings for ${agentId}:`, error.response?.data || error.message);
    }
}

async function main() {
    const target = process.argv[2];
    if (!target) {
        console.log("Usage: node sync_to_gptmaker.js [marlon|suporte|notificador|all]");
        return;
    }

    const agentsToSync = target === 'all' ? Object.keys(AGENTS) : (AGENTS[target.toUpperCase()] ? [target.toUpperCase()] : []);

    if (agentsToSync.length === 0) {
        console.log(`Agent '${target}' not found.`);
        return;
    }

    for (const key of agentsToSync) {
        const agent = AGENTS[key];
        console.log(`\n=== Starting Sync: ${agent.name} ===`);

        try {
            const behavior = fs.readFileSync(agent.behaviorFile, 'utf8');
            await updateAgent(agent.id, behavior);
            await syncTrainings(agent.id, agent.trainingFiles);
            console.log(`=== Finished Sync: ${agent.name} ===\n`);
        } catch (err) {
            console.error(`Fatal error syncing ${agent.name}:`, err.message);
        }
    }
}

main();
