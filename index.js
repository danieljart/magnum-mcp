import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { z } from "zod";

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Create MCP server
const server = new McpServer({
  name: "Magnum Turismo MCP",
  version: "1.0.0",
});

// Tool 1: Get Viagem
server.tool(
  "get_viagem",
  "Busca viagem por data e retorna detalhes de disponibilidade e valor.",
  {
    data: z.string().describe("Data da viagem no formato YYYY-MM-DD"),
  },
  async ({ data }) => {
    const { data: viagens, error } = await supabase
      .from("viagens")
      .select("id, valor_base, vagas_disponiveis, status, horario_saida, tipo_onibus, local_embarque, tempo_viagem")
      .eq("data_saida", data);

    if (error) {
      return {
        content: [{ type: "text", text: `Erro ao buscar viagem: ${error.message}` }],
        isError: true,
      };
    }

    if (!viagens || viagens.length === 0) {
      return {
        content: [{ type: "text", text: "Nenhuma viagem encontrada para esta data." }],
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(viagens, null, 2) }],
    };
  }
);

// Tool 2: Calculate Installment
const INSTALLMENT_RATES = {
  1: 6.38,
  2: 12.86,
  3: 14.30,
  4: 15.08,
  5: 16.00,
  6: 17.00,
  7: 18.37,
  8: 19.20,
  9: 20.06,
  10: 21.10,
  11: 22.54,
  12: 23.24,
};

server.tool(
  "calcular_parcela",
  "Calcula o valor total e o valor das parcelas com base em taxas fixas.",
  {
    valor_base: z.number().describe("Valor base da viagem"),
    numero_parcelas: z.number().min(1).max(12).describe("Número de parcelas (1-12)"),
  },
  async ({ valor_base, numero_parcelas }) => {
    const taxa = INSTALLMENT_RATES[numero_parcelas];
    if (taxa === undefined) {
      return {
        content: [{ type: "text", text: "Número de parcelas inválido. Use de 1 a 12." }],
        isError: true,
      };
    }

    const valor_total = valor_base * (1 + taxa / 100);
    const valor_parcela = valor_total / numero_parcelas;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              valor_total: Number(valor_total.toFixed(2)),
              valor_parcela: Number(valor_parcela.toFixed(2)),
              taxa_aplicada: `${taxa}%`,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool 3: Create Reservation
server.tool(
  "criar_reserva",
  "Cria uma reserva de viagem chamando a RPC do Supabase.",
  {
    viagem_id: z.string().uuid().describe("UUID da viagem"),
    nome_cliente: z.string().describe("Nome do cliente"),
    telefone: z.string().describe("Telefone de contato"),
    quantidade: z.number().min(1).describe("Quantidade de vagas"),
  },
  async ({ viagem_id, nome_cliente, telefone, quantidade }) => {
    const { data, error } = await supabase.rpc("criar_reserva", {
      p_viagem_id: viagem_id,
      p_nome_cliente: nome_cliente,
      p_telefone: telefone,
      p_quantidade: quantidade,
    });

    if (error) {
      return {
        content: [{ type: "text", text: `Erro na RPC: ${error.message}` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// Tool 4: Check Route Stop
server.tool(
  "verificar_parada",
  "Verifica se uma cidade faz parte da rota oficial ou sugere uma alternativa próxima.",
  {
    cidade: z.string().describe("Nome da cidade para verificar na rota"),
  },
  async ({ cidade }) => {
    // Busca exata ou por similaridade simples
    const { data: paradas, error } = await supabase
      .from("paradas_rota")
      .select("*")
      .ilike("cidade", `%${cidade}%`);

    if (error) {
      return {
        content: [{ type: "text", text: `Erro ao verificar rota: ${error.message}` }],
        isError: true,
      };
    }

    if (!paradas || paradas.length === 0) {
      return {
        content: [{ type: "text", text: "Essa cidade não consta na nossa rota e não temos paradas próximas cadastradas para ela." }],
      };
    }

    const resposta = paradas.map(p => {
      if (p.eh_oficial) {
        return `✅ ${p.cidade} (${p.estado}) é uma parada oficial.`;
      } else {
        return `📍 Para ${p.cidade}, a parada oficial mais próxima é ${p.cidade_referencia} (${p.estado}).`;
      }
    }).join("\n");

    return {
      content: [{ type: "text", text: resposta }],
    };
  }
);

// Setup Express with SSE
const app = express();

// Detailed CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));

app.use(express.json());

// Root route for health check
app.get("/", (req, res) => {
  res.send("Magnum Turismo MCP Server is running! Use /sse for MCP connection.");
});

// Basic Security Middleware
app.use((req, res, next) => {
  const apiKey = process.env.MCP_API_KEY;
  if (!apiKey) {
    console.log("No MCP_API_KEY set, allowing request.");
    return next();
  }

  // Check X-API-Key header
  const xApiKey = req.headers["x-api-key"];

  // Check Authorization: Bearer <key> header
  let authHeaderKey = null;
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    authHeaderKey = authHeader.substring(7);
  }

  const providedKey = xApiKey || authHeaderKey || req.query.apiKey;

  if (providedKey === apiKey) {
    console.log("Valid API Key provided.");
    return next();
  }

  console.log(`Unauthorized attempt with key: ${providedKey}`);
  res.status(401).send("Unauthorized: Invalid API Key");
});

const transports = new Map();

app.get("/sse", async (req, res) => {
  console.log("New SSE connection attempt...");

  // Use the full URL if possible, otherwise relative
  const transport = new SSEServerTransport("/messages", res);
  const sessionId = Math.random().toString(36).substring(7);
  transports.set(sessionId, transport);

  console.log(`Session established: ${sessionId}`);

  res.on('close', () => {
    console.log(`Session closed: ${sessionId}`);
    transports.delete(sessionId);
    // Don't close the whole server, just clean up
  });

  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId || Array.from(transports.keys())[0];
  console.log(`Message received for session: ${sessionId}`);

  const transport = transports.get(sessionId);
  if (!transport) {
    console.error(`No transport found for session: ${sessionId}`);
    res.status(400).send("No active SSE transport");
    return;
  }
  await transport.handlePostMessage(req, res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Magnum Turismo MCP Server running on port ${PORT}`);
  console.log(`SSE endpoint: /sse`);
  console.log(`Messages endpoint: /messages`);
});
