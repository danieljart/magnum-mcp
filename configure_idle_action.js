import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GPTMAKER_API_KEY;
const agentId = "3EFA08EA5593E0E17649C2E0D4FBCE5B"; // Marlon's ID

// dayWeek: 0 = Domingo, 1 = Segunda, ..., 6 = Sábado
// A janela de 9h às 10h é o horário de disparo.
// Se a inatividade for atingida fora dessa janela, a mensagem aguarda até a próxima janela das 9h.
const payload = {
    actions: [
        {
            instructions: "O cliente consultou uma viagem mas parou de responder. Envie uma mensagem cordial perguntando se ainda tem interesse na viagem, mencionando que as vagas costumam acabar rápido. Use a rota da conversa (Origem e Destino) se já souber. Apenas 1 tentativa.",
            seconds: 86400, // 24 horas de inatividade antes de disparar
            allowAllHours: false,
            workingHours: [
                { dayWeek: 1, active: true, hours: [{ start: "09:00", end: "12:00" }] }, // Segunda
                { dayWeek: 2, active: true, hours: [{ start: "09:00", end: "12:00" }] }, // Terça
                { dayWeek: 3, active: true, hours: [{ start: "09:00", end: "12:00" }] }, // Quarta
                { dayWeek: 4, active: true, hours: [{ start: "09:00", end: "12:00" }] }, // Quinta
                { dayWeek: 5, active: true, hours: [{ start: "09:00", end: "12:00" }] }, // Sexta
                { dayWeek: 6, active: false, hours: [] }, // Sábado (desativado)
                { dayWeek: 0, active: false, hours: [] }  // Domingo (desativado)
            ]
        }
    ],
    finishOn: {
        seconds: 172800 // Encerra o chat após 48h de inatividade total sem resposta
    }
};

async function configureIdleAction() {
    try {
        console.log("Configuring idle action (follow-up) for Marlon...");
        const response = await axios.post(
            `https://api.gptmaker.ai/v2/agent/${agentId}/idle-actions`,
            payload,
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log("Success! Idle action configured.");
        console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error("Error:", error.response?.data || error.message);
    }
}

configureIdleAction();
