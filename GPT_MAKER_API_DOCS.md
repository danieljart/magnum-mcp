# GPT Maker API v2 - Manual de Referência Exaustivo

## 🔗 Informações Base
- **URL Base**: `https://api.gptmaker.ai/v2`
- **Autenticação**: Header `Authorization: Bearer <TOKEN>`
- **Token**: Obtenha em [Developers Dashboard](https://app.gptmaker.ai/browse/developers)

---

## 🏗️ Workspace
Gerenciamento de alto nível e créditos.
- `GET /workspaces`: Lista todos os workspaces da conta.
- `GET /workspace/{workspaceId}/agents`: Lista agentes no workspace.
- `GET /workspace/{workspaceId}/credits`: Consulta saldo de créditos.
- `POST /workspace/{workspaceId}/agent`: Cria um novo agente via workspace.

## 🤖 Agentes (Agents)
Configurações, comportamento e status.
- `GET /agent/{agentId}`: Obtém detalhes completos do agente.
- `PUT /agent/{agentId}`: Atualiza metadados e comportamento.
- `PUT /agent/{agentId}/active`: Ativa o agente.
- `PUT /agent/{agentId}/inactive`: Inativa o agente.
- `GET /agent/{agentId}/settings`: Recupera as configurações atuais.
- `PUT /agent/{agentId}/settings`: Atualiza configurações específicas.
- `GET /agent/{agentId}/webhooks`: Lista webhooks configurados.
- `PUT /agent/{agentId}/webhooks`: Atualiza links de webhooks.
- `POST /agent/{agentId}/add-context`: Adiciona contexto manual (ex: logs externos).
- `GET /agent/{agentId}/credits-spent`: Histórico de consumo de créditos.
- `GET /agent/{agentId}/list-behavior-history`: Log de alterações no comportamento.
- `DELETE /agent/{agentId}`: Remove o agente.

## 💬 Conversas e Chats
Interação direta com clientes e controle de fluxo.
- `POST /agent/{agentId}/conversation`: Inicia/Continua chat via API.
- `GET /chats`: Lista todos os chats ativos/históricos do workspace.
- `GET /chat/{chatId}/messages`: Lista mensagens de um chat específico.
- `POST /chat/{chatId}/send-message`: Envia mensagem (Texto, Imagem, Áudio, etc).
- `PUT /chat/{chatId}/edit-message`: Edita mensagem (Telegram, Z-API, Widget).
- `DELETE /chat/{chatId}/message/{messageId}`: Remove uma mensagem.
- `DELETE /chat/{chatId}/messages`: Remove todas as mensagens de um chat.
- `POST /chat/{chatId}/start-human`: Transfere para atendimento humano (IA pausada).
- `POST /chat/{chatId}/stop-human`: Finaliza atendimento humano (IA retoma).
- `DELETE /chat/{chatId}`: Remove o chat completamente.

## 📚 Treinamentos (Trainings)
Base de conhecimento do agente.
- `GET /agent/{agentId}/trainings`: Lista todos os treinamentos de um agente.
- `POST /agent/{agentId}/trainings`: Adiciona treinamento (`TEXT`, `WEBSITE`, `VIDEO`, `DOCUMENT`).
- `PUT /training/{trainingId}`: Atualiza conteúdo (apenas para tipo `TEXT`).
- `DELETE /training/{trainingId}`: Remove item de treinamento.

## 🏷️ Campos Customizados (Custom Fields)
Metadados e variáveis de contato.
- `GET /custom-field/workspace/{workspaceId}`: Lista todos os campos.
- `POST /custom-field`: Cria um novo campo personalizado.
- `PUT /custom-field/{fieldId}`: Atualiza definição do campo.
- `PUT /custom-field/{fieldId}/archive`: Arquiva/Desarquiva um campo.

## 👥 Contatos (Contacts)
Gestão de clientes e identificadores.
- `GET /workspace/{workspaceId}/search`: Busca contatos por filtros.
- `GET /contact/{contactId}`: Detalhes de um contato específico.
- `PUT /contact/{contactId}`: Atualiza dados (nome, email, telefone, etc).

## 🧭 Intenções (Intentions)
Ações proativas disparadas pela IA.
- `GET /agent/{agentId}/intentions`: Lista intenções configuradas.
- `POST /agent/{agentId}/intentions`: Cria uma nova intenção (Webhook).
- `PUT /intention/{intentionId}`: Atualiza lógica/instruções da intenção.
- `DELETE /intention/{intentionId}`: Remove a intenção.

## ⚙️ Regras de Transferência (Transfer Rules)
Lógica de transbordo para humanos ou outros bots.
- `GET /agent/{agentId}/transfer-rules`: Lista regras de transferência.
- `POST /agent/{agentId}/transfer-rules`: Cria nova regra.
- `PUT /transfer-rule/{ruleId}`: Atualiza critérios de transferência.
- `DELETE /transfer-rule/{ruleId}`: Remove a regra.

## ⏳ Ações de Inatividade (Idle Actions)
Comportamento quando o chat fica parado.
- `GET /agent/{agentId}/idle-actions`: Lista ações de inatividade.
- `POST /agent/{agentId}/idle-actions`: Cria nova ação (ex: encerrar, avisar).
- `PUT /idle-action/{actionId}`: Atualiza tempo ou mensagem de inatividade.
- `DELETE /idle-action/{actionId}`: Remove a ação.

## 🛠️ MCP (Model Context Protocol)
Ferramentas e integrações customizadas.
- `POST /mcp/connect`: Conecta um novo servidor MCP.
- `GET /mcp/{mcpId}/tools`: Lista ferramentas disponíveis no MCP.
- `PUT /mcp/{mcpId}/active`: Ativa uma ferramenta específica.
- `PUT /mcp/{mcpId}/inactive`: Desativa uma ferramenta.
- `POST /mcp/{mcpId}/sync`: Sincroniza ferramentas com o servidor remoto.
- `DELETE /mcp/{mcpId}`: Remove a conexão MCP.

## 📊 Atendimentos (Interactions)
Métricas e logs de sessões de conversa.
- `GET /workspace/{workspaceId}/interactions`: Lista sessões, status e tempos.
- `GET /interaction/{interactionId}/messages`: Mensagens específicas de uma sessão.
- `DELETE /interaction/{interactionId}`: Remove log de atendimento.

## 📺 Canais & Widget (Channels) - NOVA ESTRUTURA
Gerenciamento de canais desmembrado dos agentes (mais atualizado).
- `GET /workspace/{workspaceId}/channels`: Lista todos os canais do workspace (paginado).
- `POST /workspace/{workspaceId}/create-channel`: Cria canal independente (Types: `Z_API`, `WHATSAPP`, `INSTAGRAM`, `CLOUD_API`, `TELEGRAM`, `WIDGET`, `MESSENGER`, `MERCADO_LIVRE`, `TWILIO_SMS`).
- `GET /channel/{channelId}/config`: Detalhes de configuração técnica do canal.
- `PUT /channel/{channelId}/config`: Atualização avançada de comportamento:
    - `audioAction`: `DISABLED`, `ENABLED`.
    - `startTrigger`: `ONLY_WHEN_CALLING_BY_NAME`, `ALWAYS`.
    - `endTrigger`: `WHEN_SAY_GOODBYE`, `NEVER`.
    - `enabledTyping`: Exibe "digitando...".
    - `takeOutsideService`: Transbordo para sistemas externos.
- `GET /channel/{channelId}/qr-code`: Obtém QR Code para conexões tipo Z-API.
- `GET /channel/{channelId}/widget/links`: Scripts para incorporação.
- `PUT /channel/{channelId}/widget/settings`: Cores, ícones e CSS do Widget.
- `DELETE /channel/{channelId}`: Remove o canal.

---

## 🔌 Integrações Nativas (Pelo Painel)
Embora configuradas majoritariamente via Dashboard, impactam a lógica da API:
- **Eleven Labs**: Conversão de texto-para-venda (Voice).
- **Google Agenda**: Agendamentos automáticos via IA.
- **Plug Chat**: Integração de atendimento.
- **E-Vendi**: Vendas nativas.

---

## 🚫 O que NÃO é possível via API (Manual Only)
- **Faturamento**: Ver/Pagar faturas e mudar planos de assinatura.
- **Equipe**: Convidar membros ou gerenciar permissões de usuários do painel.
- **Segurança**: Alterar senha da conta mestre ou habilitar 2FA.
- **WhatsApp API Local**: Conexões diretas de WhatsApp que exigem leitura física de QR Code inicial no celular (o endpoint de QR Code via API existe, mas o ato de escanear é manual).

---

> [!TIP]
> Use este guia para verificar se uma automação é possível. Se o endpoint estiver aqui, podemos automatizar! Se não estiver, provavelmente exige ação manual no dashboard.
