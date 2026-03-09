import axios from 'axios';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GPTMAKER_API_KEY;
const agentId = "3EFA08EA5593E0E17649C2E0D4FBCE5B"; // Marlon's ID
const trainingFile = "Marlon_FollowUp.txt";
const CHUNK_SIZE = 900; // characters per chunk, safely under the 1028 limit

function chunkText(text, size = CHUNK_SIZE) {
    const chunks = [];
    let start = 0;
    while (start < text.length) {
        let end = start + size;
        if (end < text.length) {
            const lastNewline = text.lastIndexOf('\n', end);
            if (lastNewline > start) {
                end = lastNewline;
            }
        }
        const chunk = text.substring(start, end).trim();
        if (chunk) chunks.push(chunk);
        start = end;
    }
    return chunks;
}

async function deleteExistingFollowUpTrainings() {
    console.log('Checking for existing follow-up trainings to delete...');
    const listResponse = await axios.get(`https://api.gptmaker.ai/v2/agent/${agentId}/trainings`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const currentTrainings = (listResponse.data.data || listResponse.data) || [];

    for (const t of currentTrainings) {
        if (t.type === 'TEXT' && t.text && t.text.includes(`[FILE: ${trainingFile}]`)) {
            console.log(`Deleting old follow-up training: ID ${t.id}`);
            try {
                await axios.delete(`https://api.gptmaker.ai/v2/training/${t.id}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });
            } catch (delError) {
                console.error(`Failed to delete training ${t.id}:`, delError.message);
            }
        }
    }
}

async function uploadTraining() {
    try {
        if (!fs.existsSync(trainingFile)) {
            console.error(`File ${trainingFile} not found.`);
            return;
        }

        // Delete old versions first
        await deleteExistingFollowUpTrainings();

        const content = fs.readFileSync(trainingFile, 'utf8');
        const chunks = chunkText(content);

        console.log(`\nUploading ${chunks.length} chunk(s) from ${trainingFile} to Marlon...`);

        for (let i = 0; i < chunks.length; i++) {
            const textPayload = `[FILE: ${trainingFile}] [PARTE: ${i + 1}/${chunks.length}]\n\n${chunks[i]}`;
            console.log(`Uploading chunk ${i + 1}/${chunks.length}...`);

            const response = await axios.post(`https://api.gptmaker.ai/v2/agent/${agentId}/trainings`, {
                type: "TEXT",
                text: textPayload
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            console.log(`Chunk ${i + 1} uploaded. Training ID: ${response.data.id || response.data.data?.id}`);
        }

        console.log('\nSuccess! All follow-up training chunks added to Marlon.');
    } catch (error) {
        console.error('Error uploading training:', error.response?.data || error.message);
    }
}

uploadTraining();
