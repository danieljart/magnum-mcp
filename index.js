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
      .select("id, valor_base, vagas_disponiveis, status, horario_saida, tipo_onibus, local_embarque, tempo_viagem, distancia_km")
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
      const distInfo = p.distancia_origem_km !== null ? ` (Aprox. ${p.distancia_origem_km}km de Belém)` : "";
      if (p.eh_oficial) {
        return `✅ ${p.cidade} (${p.estado}) é uma parada oficial.${distInfo}`;
      } else {
        return `📍 Para ${p.cidade}, a parada oficial mais próxima é ${p.cidade_referencia} (${p.estado}).`;
      }
    }).join("\n");

    return {
      content: [{ type: "text", text: resposta }],
    };
  }
);

// Tool 7: Calculate Segment Distance
server.tool(
  "calcular_distancia_trecho",
  "Calcula a distância rodoviária aproximada entre duas cidades da rota.",
  {
    cidade_origem: z.string().describe("Cidade de embarque"),
    cidade_destino: z.string().describe("Cidade de desembarque"),
  },
  async ({ cidade_origem, cidade_destino }) => {
    const { data: paradas, error } = await supabase
      .from("paradas_rota")
      .select("cidade, distancia_origem_km")
      .or(`cidade.ilike.%${cidade_origem}%,cidade.ilike.%${cidade_destino}%`);

    if (error || !paradas || paradas.length < 2) {
      return {
        content: [{ type: "text", text: "Não foi possível localizar as duas cidades na rota para calcular a distância. Verifique se os nomes estão corretos." }],
        isError: true,
      };
    }

    const p1 = paradas.find(p => p.cidade.toLowerCase().includes(cidade_origem.toLowerCase()));
    const p2 = paradas.find(p => p.cidade.toLowerCase().includes(cidade_destino.toLowerCase()));

    if (!p1 || !p2 || p1.distancia_origem_km === null || p2.distancia_origem_km === null) {
      return {
        content: [{ type: "text", text: "Dados de quilometragem incompletos para um desses pontos." }],
        isError: true,
      };
    }

    const distancia = Math.abs(p1.distancia_origem_km - p2.distancia_origem_km);

    return {
      content: [{
        type: "text",
        text: `A distância aproximada entre ${p1.cidade} e ${p2.cidade} é de ${distancia} km.`
      }],
    };
  }
);

// Tool 5: Consult Reservation
server.tool(
  "consultar_reserva",
  "Consulta uma reserva pelo código ou telefone do cliente.",
  {
    codigo_ou_telefone: z.string().describe("Código da reserva ou telefone do cliente"),
  },
  async ({ codigo_ou_telefone }) => {
    const isCode = codigo_ou_telefone.length > 10 && !codigo_ou_telefone.includes("-"); // Simplified check

    let query = supabase
      .from("reservas")
      .select(`
        id, codigo_reserva, nome_cliente, telefone, quantidade, valor_total, status, created_at,
        viagens (origem, destino, data_saida, horario_saida, tipo_onibus)
      `);

    if (isCode) {
      query = query.eq("codigo_reserva", codigo_ou_telefone);
    } else {
      query = query.eq("telefone", codigo_ou_telefone);
    }

    const { data: reservas, error } = await query;

    if (error) {
      return {
        content: [{ type: "text", text: `Erro ao buscar reserva: ${error.message}` }],
        isError: true,
      };
    }

    if (!reservas || reservas.length === 0) {
      return {
        content: [{ type: "text", text: "Nenhuma reserva encontrada com esses dados." }],
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(reservas, null, 2) }],
    };
  }
);


// Setup Express with SSE
const app = express();

// Detailed CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'Mcp-Session-Id']
}));

app.use(express.json());

// Root route for health check
app.get("/", (req, res) => {
  res.send("Magnum Turismo MCP Server is running! Use /sse for MCP connection.");
});

app.use((req, res, next) => {
  // Allow OPTIONS requests for CORS preflight
  if (req.method === 'OPTIONS') {
    return next();
  }

  // Allow root health check, favicon and a new debug endpoint without auth
  if (req.path === '/' || req.path === '/favicon.ico' || req.path === '/debug') {
    return next();
  }

  const apiKey = process.env.MCP_API_KEY;
  if (!apiKey) {
    return next();
  }

  const xApiKey = req.headers["x-api-key"];
  const authHeader = req.headers["authorization"];
  let authHeaderKey = null;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    authHeaderKey = authHeader.substring(7);
  }

  const providedKey = xApiKey || authHeaderKey || req.query.apiKey;

  if (providedKey === apiKey) {
    return next();
  }

  console.log(`[AUTH] Refused ${req.method} ${req.path} - Provided Key: ${providedKey}`);
  res.status(401).json({ error: "Unauthorized", message: "Invalid API Key" });
});

// New Debug Endpoint
app.get("/debug", (req, res) => {
  res.json({
    status: "running",
    activeSessions: Array.from(transports.keys()),
    sessionCount: transports.size,
    env: {
      hasApiKey: !!process.env.MCP_API_KEY,
      port: process.env.PORT
    }
  });
});

const transports = new Map();

app.get("/sse", async (req, res) => {
  const sessionId = Math.random().toString(36).substring(7);
  console.log(`[SSE] [NEW] IP: ${req.ip} Session: ${sessionId}`);

  // Important headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // We tell the client to POST to /messages/<id>
  const transport = new SSEServerTransport(`/messages/${sessionId}`, res);
  transports.set(sessionId, transport);

  res.on('close', () => {
    console.log(`[SSE] [CLOSED] Session: ${sessionId}`);
    transports.delete(sessionId);
  });

  await server.connect(transport);
});

// Fallback for GPT Maker if it tries to POST to /sse directly
app.post("/sse", async (req, res) => {
  console.log(`[POST-SSE] Received POST on /sse from ${req.ip}. Redirecting to /messages...`);
  const sessionId = req.query.sessionId || Array.from(transports.keys())[0];
  if (sessionId) {
    const transport = transports.get(sessionId);
    if (transport) return await transport.handlePostMessage(req, res);
  }
  res.status(400).json({ error: "No active session", hint: "Connect via GET /sse first" });
});

app.post("/messages/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  console.log(`[POST] Session: ${sessionId}`);

  const transport = transports.get(sessionId);
  if (!transport) {
    console.error(`[POST] ERROR: Session ${sessionId} not found.`);
    res.status(400).json({ error: "Session not found", sessionId });
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
