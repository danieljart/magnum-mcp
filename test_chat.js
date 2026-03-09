import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GPTMAKER_API_KEY;
const AGENT_ID = process.argv[3] || "3EFB9CBA2A607ACE30FACAF7F359BF2A";

async function chat(prompt) {
    if (!apiKey) {
        console.error("Erro: GPTMAKER_API_KEY não encontrada no .env");
        return;
    }

    try {
        console.log(`\n[TESTE API] Enviando para Agente ${AGENT_ID}...`);
        console.log(`[USER]: ${prompt}`);

        const response = await axios.post(`https://api.gptmaker.ai/v2/agent/${AGENT_ID}/conversation`, {
            contextId: "manual_test_session_003", // Final clean session
            prompt: prompt,
            chatName: "Tester Daniel",
            phone: "5511999999999"
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        const data = response.data;
        console.log("\n[DEBUG] Full Response Data:", JSON.stringify(data, null, 2));
        console.log(`\n[AGENT]: ${data.message || "(Sem resposta de texto)"}`);

        if (data.images && data.images.length > 0) {
            console.log(`[IMAGES]: ${data.images.join(', ')}`);
        }
        if (data.audios && data.audios.length > 0) {
            console.log(`[AUDIOS]: ${data.audios.join(', ')}`);
        }
    } catch (error) {
        console.error("\n[ERRO NA API]:", error.response?.data || error.message);
    }
}

const userPrompt = process.argv[2] || "Olá, quem é você?";
chat(userPrompt);
