# 💡 Idealização de Automações: GPT Maker + Magnum Turismo

Com base na documentação exaustiva da API v2 e no contexto do seu projeto (Agente de Viagens Marlon), aqui estão estratégias de automação divididas por objetivos de negócio. **Nada aqui foi executado ainda; são possibilidades técnicas para o futuro.**

---

## 1. 📂 Gestão Automática de Conhecimento (Trainings)
O Marlon precisa de dados frescos sobre viagens e paradas.
- **Sincronizador de Banco para IA**: Sempre que uma nova viagem for adicionada no seu banco de dados (Neon), um script pode usar o `POST /agent/{agentId}/trainings` para enviar essa nova regra ou itinerário como um treinamento de `TEXTO` ou `DOCUMENTO`.
- **Limpeza de Contexto**: Automação para deletar treinamentos antigos ou expirados (`DELETE /training/{trainingId}`) toda vez que uma viagem for concluída, mantendo o Marlon focado apenas no que está disponível.

## 2. 🤖 Orquestração de Comportamento Dinâmico
O Marlon pode mudar de personalidade ou foco dependendo do horário ou demanda.
- **Modo Plantão vs. Modo Vendas**: Usar o `PUT /agent/{agentId}` para alterar as instruções (`instructions`) do Marlon automaticamente. À noite, ele pode ser mais focado em suporte básico; durante o horário comercial, focado em fechar vendas agressivas.
- **Troca de Modelo em Tempo Real**: Se o tráfego aumentar muito, um script pode mudar o modelo de LLM para um mais barato/rápido (`PUT /agent/{agentId}`) e voltar para um modelo premium quando o volume baixar.

## 3. 🛠️ Integração Profunda com CRM Próprio (Contacts/Fields)
Manter os dados do cliente sincronizados entre o GPT Maker e o seu sistema de viagens.
- **Perfil Enriquecido**: Quando o Marlon descobre a cidade de origem de um cliente, um webhook dispara uma chamada para `PUT /custom-field/{fieldId}` no Maker, salvando essa info permanentemente para futuras viagens.
- **Identificação de "VVIP"**: Se um cliente antigo entra em contato, o sistema busca no seu banco, vê que ele é recorrente, e usa o `PUT /contact/{contactId}` para mudar o nome dele para "CLIENTE DIAMANTE: [Nome]", sinalizando para o Marlon (ou para o humano) que o atendimento é prioritário.

## 4. 🚑 Transbordo Inteligente e Monitoramento
Garantir que nenhum cliente fique sem resposta.
- **Alerta de Inatividade**: Usar `POST /agent/{agentId}/idle-actions` para que, se o cliente não responder em 10 minutos, o Marlon envie uma mensagem de "Ainda está aí? As vagas para [Destino] estão acabando!".
- **Bot de Notificação (Seu Pager)**: Sempre que o Marlon acionar o `POST /chat/{chatId}/start-human`, um script externo detecta isso e te envia um WhatsApp pessoal avisando: "Ei, assuma o atendimento do cliente [X], ele quer falar com humano agora!".

## 🌐 5. Automação de Canais (Escalabilidade)
- **Criação de Canais "On-Demand"**: Se você abrir uma nova filial ou agência parceira, o sistema pode criar automaticamente um novo canal de Widget ou WhatsApp (`POST /workspace/{workspaceId}/create-channel`) e já configurá-lo com as cores da marca.

---

### 🚀 Próximos Passos Sugeridos
1. **Priorização**: Qual dessas geraria mais valor hoje? (Ex: Sincronizar as viagens do banco com o treinamento do bot).
2. **Setup de Webhooks**: Configurar o Maker para avisar o seu servidor sempre que uma "Intenção" (ex: Reserva Iniciada) for detectada.
3. **Marlon Proativo**: Usar o Chat API para que o bot inicie conversas com clientes que não viajam há mais de 3 meses.

> [!NOTE]
> Todas estas ideias utilizam os endpoints mapeados no `GPT_MAKER_API_DOCS.md`. A tecnologia já permite tudo isso; o próximo passo seria apenas a implementação lógica.
