import axios from 'axios';
import fs from 'fs';

const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJncHRtYWtlciIsImlkIjoiM0VGQTA4NDlCMzcyNDE0MDc3NzE3NjFDQ0JGQjA3RjMiLCJ0ZW5hbnQiOiIzRUZBMDg0OUIzNzI0MTQwNzc3MTc2MUNDQkZCMDdGMyIsInV1aWQiOiJiMjU4ZDU0YS05MDBhLTRhZmMtOTUyZi0yYjJlOGRlZTY4NTEifQ.EgKlt_pA61Ix-6_9vkqC7Aefg3KCS2YYPgniHV9MXMw';

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

const GITHUB_REPO = "danieljart/magnum-mcp";
const GITHUB_BRANCH = "main";

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

async function syncTrainings(agentId, fileNames) {
    try {
        console.log(`Syncing trainings for agent ${agentId}...`);

        // 1. List existing trainings
        const listResponse = await axios.get(`https://api.gptmaker.ai/v2/agent/${agentId}/trainings`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        const currentTrainings = listResponse.data.data;

        // 2. Delete existing document trainings that we are about to upload
        for (const t of currentTrainings) {
            if (t.type === 'DOCUMENT' && fileNames.includes(t.documentName)) {
                console.log(`Deleting old training: ${t.documentName} (${t.id})`);
                await axios.delete(`https://api.gptmaker.ai/v2/training/${t.id}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });
            }
        }

        // 3. Add new trainings as DOCUMENT
        for (const fileName of fileNames) {
            console.log(`Adding document training: ${fileName}`);
            const rawUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/${fileName}`;
            const payload = {
                type: "DOCUMENT",
                documentUrl: rawUrl,
                documentName: fileName,
                documentMimetype: "text/plain"
            };

            await axios.post(`https://api.gptmaker.ai/v2/agent/${agentId}/trainings`, payload, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
            });
            console.log(`Uploaded ${fileName} training.`);
        }
    } catch (error) {
        console.error(`Error syncing trainings for ${agentId}:`, error.response?.data || error.message);
    }
}

async function main() {
    const target = process.argv[2];
    const agentsToSync = target === 'all' ? Object.keys(AGENTS) : (AGENTS[target.toUpperCase()] ? [target.toUpperCase()] : []);

    if (agentsToSync.length === 0) {
        console.log("Usage: node sync_to_gptmaker.js [marlon|suporte|notificador|all]");
        return;
    }

    for (const key of agentsToSync) {
        const agent = AGENTS[key];
        console.log(`\n=== Syncing ${agent.name} ===`);

        const behavior = fs.readFileSync(agent.behaviorFile, 'utf8');
        await updateAgent(agent.id, behavior);
        await syncTrainings(agent.id, agent.trainingFiles);
    }
}

main();
