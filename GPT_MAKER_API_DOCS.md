# GPT Maker API v2 Reference (Local Quick-Access)

## Base URL
`https://api.gptmaker.ai/v2`

## Agents
- **GET** `/agent/{agentId}`: Get agent details (metadata + behavior).
- **PUT** `/agent/{agentId}`: Update agent metadata and behavior.
  - *Note*: Payload must include full metadata (name, avatar, etc.) to avoid wiping settings.
  - *Limit*: `behavior` field should be <= 3000 characters.

### Verified Agent IDs
- **Marlon**: `3EFA08EA5593E0E17649C2E0D4FBCE5B`
- **Suporte Bot**: `3EFB9CBA2A607ACE30FACAF7F359BF2A`

## Trainings (Knowledge Base)
Types: `TEXT`, `WEBSITE`, `VIDEO`, `DOCUMENT`

- **GET** `/agent/{agentId}/trainings`: List all trainings for an agent.
- **POST** `/agent/{agentId}/trainings`: Create new training.
  - **TEXT Payload** (Limit: 1028 chars):
    ```json
    {
      "type": "TEXT",
      "text": "Content...",
      "image": "optional_image_url"
    }
    ```
  - **DOCUMENT Payload**:
    ```json
    {
      "type": "DOCUMENT",
      "documentUrl": "https://storage.com/file.txt",
      "documentName": "Rules",
      "documentMimetype": "text/plain"
    }
    ```

### Verified Training IDs (Marlon)
- `Marlon_RegrasSQL.txt`: `3EFBB86DF2E5D0F3A7645A268C7B7433`
- `Marlon_RegrasDeVendas.txt`: `3EFBB507E4D3F0210A2ABA49DC0D09A7`
- **PUT** `/training/{trainingId}`: Update training (only supported for `TEXT` type).
- **DELETE** `/training/{trainingId}`: Remove a training item.

## Workspace
- **GET** `/workspace/{workspaceId}/agents`: List all agents in a workspace.

## Authentication
- **Header**: `Authorization: Bearer <JWT_TOKEN>`
- **Content-Type**: `application/json`
