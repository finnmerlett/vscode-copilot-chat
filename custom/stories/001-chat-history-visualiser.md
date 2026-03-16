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

- [x] Add view + command declarations to `package.json` and `package.nls.json`
- [x] Create `chatVisualiserPanel.ts` with WebviewViewProvider
- [x] Register contribution in `contributions.ts`
- [x] Render User View column from `IConversationStore.lastConversation`
- [x] Style with VS Code theme variables (using backup branch's CSS as reference)
- [ ] Auto-refresh on conversation change (see Bug #1)

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

- [x] Capture API messages via `IRequestLogger.getRequests()` (uses `Raw.ChatMessage[]` from logged requests)
- [ ] Auto-refresh via `IRequestLogger.onDidChangeRequests` event (see Bug #1 — deferred)
- [x] Render API View column alongside User View
- [x] Show role, content preview, tool calls for each message
- [x] Styled YAML key-value previews and XML tag highlighting
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

### E2E Testing (runs headed after each phase)

Each phase should have a headed Playwright e2e test that launches VS Code Insiders, verifies the panel works via text assertions (no screenshots), and checks expected content appears. Run after each phase to validate.

**Setup (from backup branch pattern):**
- Uses Playwright's Electron support (`_electron.launch`)
- Launches VS Code Insiders with `--extensionDevelopmentPath` pointing to our extension
- Copies auth state from real user data dir to temp dir
- Disables settings sync, updates, telemetry, startup editor
- Test user data dir is ephemeral (`/tmp/visualiser-e2e-{timestamp}`)
- Workspace folder: `/Users/finnmerlett/Repos/mortgage-calculator-app`

**Test scenario:**
1. Start a new chat (ensure fresh conversation)
2. Select model provider **4o**
3. Send message: `"Read the full contents of src/utils, and give me a summary of what each file does"`
4. Wait for response to complete
5. Open the Chat Visualiser sidebar
6. Verify expected text appears in the panel (textual assertions, not screenshots)

**Key settings for test launch:**
```json
{
  "workbench.startupEditor": "none",
  "update.mode": "none",
  "extensions.autoUpdate": false,
  "telemetry.telemetryLevel": "off",
  "settingsSync.enabled": false
}
```

**Launch args:**
```
--extensionDevelopmentPath=<repo root>
--user-data-dir=<temp dir>
--log=debug
--disable-gpu-sandbox
--no-sandbox
--disable-updates
--skip-release-notes
--disable-workspace-trust
--sync=off
```

- [ ] Create `test/e2e/chat-visualiser-e2e.ts` with Playwright Electron setup
- [ ] Phase 1 test: panel appears in sidebar, shows "no active conversation" state
- [ ] Phase 2 test: send a message, verify both columns populate with expected text
- [ ] Phase 3 test: click a message block, verify editor tab opens with content

#### Key Files

| File | Why / How |
|------|-----------|
| **NEW** `test/e2e/chat-visualiser-e2e.ts` | Headed Playwright test — launches VS Code, verifies panel rendering. Adapted from backup branch's `test/e2e/nuum-compaction-panel-e2e.ts`. |

### Utility: Model Selector Command

Lifted from backup branch — a command palette command `Chat: Select Model` (`github.copilot.chat.selectModel`) that shows a quick pick of available Copilot models and switches to the selected one via `workbench.action.chat.changeModel`. Useful for e2e tests and general development.

- [x] Add command to `package.json`
- [x] Add implementation to `conversationFeature.ts`

## Devlog

### 2026-03-15 — Setup

- Created project brief in `AGENTS.md`, story template, and initial story plan.
- Lifted `selectModel` command from backup branch — allows programmatic model selection for e2e tests and general use.

### 2026-03-16 — Phase 1 scaffold

- Added `copilot-chat-visualiser` webview view to the `copilot-chat` view container, gated on `github.copilot.chat.showLogView`.
- Created `chatVisualiserPanel.ts` with `ChatVisualiserContribution` + `ChatVisualiserViewProvider`.
- Renders User View column from `IConversationStore.lastConversation` → `Turn[]`, showing request messages, tool call rounds, and responses.
- Each message block has hover metadata and click-to-open-in-editor-tab.
- CSS uses VS Code theme variables for consistent styling.
- API View column is placeholder ("Coming in Phase 2").
- **Discovery:** `IToolCall` has `name`, `arguments`, `id` — not `input`/`result` as assumed. Tool results are in `round.response`.
- **Note:** `IConversationStore` has no change event — currently using manual refresh + visibility change. Will need a better auto-refresh mechanism.

### 2026-03-16 — Phase 2 API View

- **Design decision:** Instead of subscribing directly to `ToolCallingLoop.onDidBuildPrompt` (which requires access to per-request loop instances), we use `IRequestLogger` which already captures `Raw.ChatMessage[]` for every API request. Same data, simpler wiring.
- `IRequestLogger.getRequests()` returns all logged info; we find the latest `ILoggedRequestInfo` with `chatParams.messages`.
- `IRequestLogger.onDidChangeRequests` fires whenever a new request is logged — we auto-refresh the panel when visible.
- Used `roleToString()` and `getTextPart()` from `globalStringUtils.ts` instead of reimplementing.
- **Discovery:** `LoggedRequest` is a union type — `IMarkdownContentRequest` doesn't have `chatParams`. Used `'chatParams' in entry` narrowing.

### 2026-03-16 — Phase 2 refinements

- Added `jsonToYamlPreviewHtml()` — returns pre-escaped HTML with styled `<span class="kv-key">` for keys and `<span class="kv-sep">` for colons. YAML-like previews are now visually distinct from plain text.
- Added `highlightXmlTags()` — wraps `<tag>` patterns in `<span class="xml-tag">` with green/dimmed styling. Applied to API View content text.
- Attempted auto-refresh via `onDidChangeRequests` and `onDidChangeActiveChatPanelSessionResource` — neither worked as expected. Removed both; logged as Bug #1 for post-Phase-2 fix.

## Checklist

- [ ] Compiles without errors
- [ ] E2E test passes for each phase
- [ ] Tested manually — sidebar shows data
- [ ] Tested manually — dedicated tab opens
- [ ] Token counts match context window hover
- [ ] No regressions in existing functionality

## Bugs & Issues

| # | Description | Status | Resolution |
|---|-------------|--------|------------|
| 1 | Auto-refresh not working. Tried `IRequestLogger.onDidChangeRequests` and `vscode.window.onDidChangeActiveChatPanelSessionResource` (proposed API) — neither fires as expected. Panel only updates via manual refresh button or visibility change. | Open — scheduled post-Phase 2 | Investigate: may need to hook into `ToolCallingLoop.onDidBuildPrompt` per-request, or use `IConversationStore` polling. The proposed API may require `chatParticipantPrivate` to actually be enabled at runtime. |

## Devlog

### 15 March 2026

- Story created based on backup branch analysis
- Identified data sources: `IConversationStore` for user view, `onDidBuildPrompt` for API view
- Confirmed `onDidBuildPrompt` event already exists on `ToolCallingLoop` (line 181)
- Existing view container `copilot-chat` in package.json — will add our view there
- Token detail computation uses `computePromptTokenDetails()` on same `Raw.ChatMessage[]`
- Added e2e testing plan — headed Playwright tests using Electron support, adapted from backup branch pattern
