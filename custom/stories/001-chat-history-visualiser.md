# Story 001: Chat History Visualiser

> **Status:** IN PROGRESS
> **Priority:** High
> **Created:** 15 March 2026
> **Updated:** 15 March 2026

## Goal

Build a debug visualisation panel that shows the chat data flowing through the Copilot system, with two side-by-side columns:

1. **User View** — The chat history as the user sees it (all turns, requests, responses, tool call rounds)
2. **API View** — The exact `Raw.ChatMessage[]` as sent to the language model API (system prompts, user messages, assistant responses, tool calls/results)

Both views show all messages in order. Hovering a message shows full metadata. Clicking opens full content in a new editor tab.

## Context

Lifted from the backup branch's `nuumCompactionPanel.ts` concept (which had 3 columns for compaction). This is a simpler, Copilot-only version — no nuum dependency.

## Requirements

- [ ] Sidebar panel in the existing `copilot-chat` view container
- [ ] Button in sidebar section header to open in a full dedicated editor tab
- [ ] Command palette command: `Copilot: Show Chat Visualiser`
- [ ] Auto-updates when the active chat changes or a new request is built
- [ ] Two columns: User View and API View
- [ ] User View sources from `IConversationStore.lastConversation` → `Turn[]`
- [ ] API View sources from `ToolCallingLoop.onDidBuildPrompt` → `Raw.ChatMessage[]`
- [ ] Hover on any message block shows full metadata (role, type, id, token count, etc.)
- [ ] Click on any message block opens full content in a new editor tab
- [ ] Token counts should match the context window status hover (uses same `computePromptTokenDetails` pipeline)

## Design

### Data Sources

**User View (Column 1):**
```
IConversationStore.lastConversation
  → Conversation.turns: Turn[]
    → Each Turn has:
      - request: TurnMessage { type, name, message }
      - responseMessage: TurnMessage | undefined
      - rounds: IToolCallRound[] (tool calls + results)
      - references: PromptReference[]
      - responseStatus: TurnStatus
      - id: string
```

**API View (Column 2):**
```
ToolCallingLoop._onDidBuildPrompt event fires after each prompt build:
  → { result: IBuildPromptResult, tools, promptTokenLength, toolTokenCount }
  → result.messages: Raw.ChatMessage[]
    → Each Raw.ChatMessage has:
      - role: Raw.ChatRole (System | User | Assistant | Tool)
      - content: Raw.ChatCompletionContentPart[]
      - name?: string
      - toolCalls?: ChatMessageToolCall[]
      - toolCallId?: string
```

### Architecture

- **WebviewViewProvider** for sidebar panel (like existing `copilot-chat` debug view)
- **WebviewPanel** for dedicated editor tab (opened via command or header button)
- Both share the same HTML rendering logic
- Auto-refresh: listen to `IConversationStore` changes + `onDidBuildPrompt` events
- Data captured by a new lightweight service that subscribes to these events

### Key Files

| File | Role |
|------|------|
| `src/extension/log/vscode-node/chatVisualiserPanel.ts` | Main panel implementation (webview + data gathering) |
| `src/extension/extension/vscode-node/contributions.ts` | Register the contribution |
| `package.json` | View declaration, commands |
| `package.nls.json` | Localised strings |

### Token Count Alignment

The context window status hover uses `computePromptTokenDetails()` from `src/platform/tokenizer/node/promptTokenDetails.ts` which operates on `Raw.ChatMessage[]`. Our API View uses the exact same message array from `onDidBuildPrompt`, so counts will align naturally.

## Tasks

### Phase 1: Scaffold & User View

- [ ] Add view + command declarations to `package.json` and `package.nls.json`
- [ ] Create `chatVisualiserPanel.ts` with WebviewViewProvider
- [ ] Register contribution in `contributions.ts`
- [ ] Render User View column from `IConversationStore.lastConversation`
- [ ] Style with VS Code theme variables (using backup branch's CSS as reference)
- [ ] Auto-refresh on conversation change

#### Key Files for Phase 1

| File | Why / How |
|------|-----------|
| [`package.json`](../../package.json) (lines ~5605-5640) | Add new view `copilot-chat-visualiser` to the existing `"copilot-chat"` views array, and add a new command `github.copilot.chat.showVisualiser`. Existing views: `copilot-chat` (Chat Debug), `context-inspector`. |
| [`package.nls.json`](../../package.nls.json) | Add localised strings for the new view name and command title. |
| [`src/extension/extension/vscode-node/contributions.ts`](../../src/extension/extension/vscode-node/contributions.ts) | Import and register `ChatVisualiserContribution` in `vscodeNodeChatContributions` array (line ~116+). Pattern: `asContributionFactory(ChatVisualiserContribution)`. |
| **NEW** `src/extension/log/vscode-node/chatVisualiserPanel.ts` | Create the `ChatVisualiserContribution` class (extends `Disposable`, implements `IExtensionContribution`) and `ChatVisualiserViewProvider` (implements `vscode.WebviewViewProvider`). Pattern matches `RequestLogTree` in the same directory. |
| [`src/extension/conversationStore/node/conversationStore.ts`](../../src/extension/conversationStore/node/conversationStore.ts) | Read-only dependency. `IConversationStore.lastConversation` gives us the active `Conversation` with its `Turn[]`. |
| [`src/extension/prompt/common/conversation.ts`](../../src/extension/prompt/common/conversation.ts) | Read-only dependency. Defines `Conversation`, `Turn`, `TurnMessage`, `TurnStatus`, `IToolCallRound` — the types we render in the User View. |

### Phase 2: API View

- [ ] Subscribe to `onDidBuildPrompt` events to capture `Raw.ChatMessage[]`
- [ ] Render API View column alongside User View
- [ ] Show role, content preview, tool calls for each message
- [ ] Show token counts per message and total

#### Key Files for Phase 2

| File | Why / How |
|------|-----------|
| [`src/extension/intents/node/toolCallingLoop.ts`](../../src/extension/intents/node/toolCallingLoop.ts) (line 181) | Read-only dependency. `ToolCallingLoop.onDidBuildPrompt` event fires `{ result: IBuildPromptResult, tools, promptTokenLength, toolTokenCount }` after each prompt render. We need to subscribe to this. |
| [`src/extension/prompt/node/intents.ts`](../../src/extension/prompt/node/intents.ts) (line 158) | Read-only dependency. `IBuildPromptResult` extends `RenderPromptResult` which contains `.messages: Raw.ChatMessage[]`. |
| [`src/platform/chat/common/globalStringUtils.ts`](../../src/platform/chat/common/globalStringUtils.ts) | Read-only utility. `roleToString()`, `getTextPart()` helpers for displaying `Raw.ChatMessage` data. |
| [`src/platform/tokenizer/node/promptTokenDetails.ts`](../../src/platform/tokenizer/node/promptTokenDetails.ts) | Read-only dependency. `computePromptTokenDetails()` — same function the context window hover uses. We may call this to show matching token breakdowns. |
| [`src/extension/prompt/node/defaultIntentRequestHandler.ts`](../../src/extension/prompt/node/defaultIntentRequestHandler.ts) (line 341, 615) | Reference for how to subscribe to `onDidBuildPrompt`. This file already subscribes to the event — we follow the same pattern. |

### Phase 3: Interactions

- [ ] Hover tooltip with full metadata
- [ ] Click to open full content in new editor tab
- [ ] Command palette command to open dedicated tab
- [ ] Header button to pop out to editor tab

#### Key Files for Phase 3

| File | Why / How |
|------|-----------|
| `src/extension/log/vscode-node/chatVisualiserPanel.ts` | Extend with webview message handling: `postMessage` for hover/click, `vscode.window.createWebviewPanel` for dedicated tab. |
| [`src/extension/log/vscode-node/requestLogTree.ts`](../../src/extension/log/vscode-node/requestLogTree.ts) | Reference for how existing debug views open content in editor tabs (uses `showHtmlCommand`). |

## Checklist

- [ ] Compiles without errors
- [ ] Tested manually — sidebar shows data
- [ ] Tested manually — dedicated tab opens
- [ ] Token counts match context window hover
- [ ] No regressions in existing functionality

## Bugs & Issues

| # | Description | Status | Resolution |
|---|-------------|--------|------------|

## Devlog

### 15 March 2026

- Story created based on backup branch analysis
- Identified data sources: `IConversationStore` for user view, `onDidBuildPrompt` for API view
- Confirmed `onDidBuildPrompt` event already exists on `ToolCallingLoop` (line 181)
- Existing view container `copilot-chat` in package.json — will add our view there
- Token detail computation uses `computePromptTokenDetails()` on same `Raw.ChatMessage[]`
