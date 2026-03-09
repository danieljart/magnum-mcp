import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { z } from "zod";
import pg from "pg";
import { syncCalendarToNeon } from "./sync-calendar.js";
import { enrichLeads } from "./enrich_leads.js";

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL (Neon)");
  process.exit(1);
}

// Create MCP server
const server = new McpServer({
  name: "Magnum Turismo MCP (Neon Native)",
  version: "2.0.0",
});

// Tool: Run SQL (Neon) - O motor principal agora
server.tool(
  "run_sql",
  "Executa consultas SQL no banco de dados Neon para buscar viagens, paradas e gerenciar reservas.",
  {
    sql: z.string().describe("O comando SQL para executar"),
  },
  async ({ sql }) => {
    try {
      const result = await pool.query(sql);
      return {
        content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Erro no SQL: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: Calculate Installment (Taxas fixas da Magnum)
const INSTALLMENT_RATES = {
  1: 6.38, 2: 12.86, 3: 14.30, 4: 15.08, 5: 16.00, 6: 17.00,
  7: 18.37, 8: 19.20, 9: 20.06, 10: 21.10, 11: 22.54, 12: 23.24,
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
  console.log(`[AUTH-DEBUG] Incoming ${req.method} ${req.path}`);

  if (req.method === 'OPTIONS') return next();
  if (req.path === '/' || req.path === '/favicon.ico' || req.path === '/debug') return next();

  const apiKey = process.env.MCP_API_KEY;
  if (!apiKey) return next();

  const xApiKey = req.headers["x-api-key"];
  const authHeader = req.headers["authorization"];
  let authHeaderKey = null;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    authHeaderKey = authHeader.substring(7);
  }

  const providedKey = xApiKey || authHeaderKey || req.query.apiKey;

  if (providedKey === apiKey) {
    console.log(`[AUTH-DEBUG] ✅ Authorized ${req.method} ${req.path}`);
    return next();
  }

  console.log(`[AUTH-DEBUG] ❌ Refused ${req.method} ${req.path}. Expected: ${apiKey.substring(0, 3)}... Provided: ${providedKey}`);
  res.status(401).json({
    error: "Unauthorized",
    message: "Invalid API Key",
    path: req.path,
    method: req.method
  });
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
const sessionTimeouts = new Map();

app.get("/sse", async (req, res) => {
  const sessionId = Math.random().toString(36).substring(7);
  console.log(`[SSE] [NEW] IP: ${req.ip} Session: ${sessionId}`);

  if (sessionTimeouts.has(sessionId)) {
    clearTimeout(sessionTimeouts.get(sessionId));
    sessionTimeouts.delete(sessionId);
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const transport = new SSEServerTransport(`/messages/${sessionId}`, res);
  transports.set(sessionId, transport);

  res.on('close', () => {
    console.log(`[SSE] [DISCONNECTED] Session: ${sessionId}. Grace period: 5min.`);
    // Increased to 5 minutes for absolute safety with slow bots
    const timeout = setTimeout(() => {
      console.log(`[SSE] [CLEANUP] Exposing session: ${sessionId}`);
      transports.delete(sessionId);
      sessionTimeouts.delete(sessionId);
    }, 300000);

    sessionTimeouts.set(sessionId, timeout);
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

// Dedicated Webhook Endpoint for GPT Maker Native Integration
app.post("/gptmaker-webhook", async (req, res) => {
  console.log(`\n[GPT-MAKER-WEBHOOK] Recebido de: ${req.ip}`);
  console.log(JSON.stringify(req.body, null, 2));
  return res.status(200).json({
    status: "success",
    message: "Webhook recebido com sucesso",
    receivedPayload: req.body
  });
});

// Manual sync endpoint — force Calendar → Neon sync immediately
app.post("/sync-now", async (req, res) => {
  console.log(`[SYNC-NOW] Sincronização manual solicitada por ${req.ip}`);
  try {
    const result = await syncCalendarToNeon();
    return res.status(200).json({ status: "success", ...result });
  } catch (err) {
    console.error('[SYNC-NOW] Erro:', err.message);
    return res.status(500).json({ status: "error", error: err.message });
  }
});

app.post("/messages/:sessionId", async (req, res) => {
  let { sessionId } = req.params;
  console.log(`[POST] Request for Session: ${sessionId}`);

  let transport = transports.get(sessionId);

  // SINGLETON FALLBACK: If ID not found but there's only one active session, use it.
  // This helps with stateless clients or race conditions.
  if (!transport && transports.size === 1) {
    const onlySessionId = Array.from(transports.keys())[0];
    console.log(`[POST] Session ${sessionId} not found, but only one session exists. Falling back to: ${onlySessionId}`);
    sessionId = onlySessionId;
    transport = transports.get(sessionId);
  }

  if (!transport) {
    console.error(`[POST] ERROR: Session ${sessionId} not found. Active: ${Array.from(transports.keys()).join(',')}`);
    res.status(400).json({
      error: "Session not found",
      requestedId: sessionId,
      activeSessions: transports.size,
      availableIds: Array.from(transports.keys())
    });
    return;
  }
  await transport.handlePostMessage(req, res);
});

const PORT = process.env.PORT || 3000;
const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutos

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Magnum Turismo MCP Server running on port ${PORT}`);
  console.log(`SSE endpoint: /sse`);
  console.log(`Messages endpoint: /messages`);
  console.log(`Sync manual endpoint: POST /sync-now`);

  // Sync imediato ao subir o servidor
  console.log(`[STARTUP] Iniciando sincronização de primeiro boot: ${new Date().toISOString()}`);
  syncCalendarToNeon().catch(err => console.error('[STARTUP-SYNC] Erro:', err.message));

  // Sync automático a cada 30 minutos
  setInterval(() => {
    syncCalendarToNeon().catch(err => console.error('[AUTO-SYNC] Erro:', err.message));
  }, SYNC_INTERVAL_MS);

  console.log(`[SYNC] Sincronização automática agendada a cada ${SYNC_INTERVAL_MS / 60000} minutos.`);

  // Leads enrichment: rodar às 12h, 20h e 00h (BRT = UTC-3)
  const LEADS_SYNC_HOURS_BRT = [12, 20, 0];
  let lastLeadsSync = null;
  setInterval(() => {
    const now = new Date();
    const hourBRT = (now.getUTCHours() - 3 + 24) % 24;
    const today = now.toISOString().slice(0, 10);
    const key = `${today}-${hourBRT}`;
    if (LEADS_SYNC_HOURS_BRT.includes(hourBRT) && lastLeadsSync !== key) {
      lastLeadsSync = key;
      console.log(`[LEADS-SYNC] Iniciando enriquecimento de leads (${hourBRT}h BRT)...`);
      enrichLeads().catch(err => console.error('[LEADS-SYNC] Erro:', err.message));
    }
  }, 5 * 60 * 1000); // verifica a cada 5 minutos
  console.log('[LEADS-SYNC] Agendado para 12h, 20h e 00h (BRT).');
});
