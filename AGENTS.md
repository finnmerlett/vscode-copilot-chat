# Copilot X Nuum — Project Brief

## Overview

This project adds **chat history visualisation** to GitHub Copilot Chat in VS Code. The goal is to make the internal workings of the chat system transparent — showing what the user sees alongside what the API actually receives.

Originally this was an attempt to integrate [nuum](https://github.com/sanity-labs/nuum) (a recursive memory platform) into Copilot for automatic conversation history consolidation. That approach ran into issues: too many changes were made without clear understanding. We are now restarting with a step-by-step interactive approach, building on the latest github copilot `main` branch.

### Current Focus

**Forget nuum for now.** Focus on the Copilot side only: build a debug visualiser panel that shows the chat data flowing through the system. Start with two columns:

1. **User View** — The chat history as the user sees it (all turns in order, including system/setup)
2. **API View** — The exact message list as sent to the language model API

Both views show all messages in order. Hovering shows full message metadata. Clicking opens the full content in a new editor tab.

## Conventions

### Story Format

- **Location:** `/custom/stories/`
- **Naming:** `NNN-description-here.md` (zero-padded 3-digit prefix)
- **Template:** `000-template.md`
- **Active story:** `001-chat-history-visualiser.md`

### Branch

- **Working branch:** `copilot-x-nuum`
- **Backup of old work:** `copilot-x-nuum--backup-1`
- **Base:** latest `origin/main`

## Key Copilot Data Sources

### User-Facing History

- `IConversationStore` — stores `Conversation` objects keyed by responseId
- `Conversation` has a `sessionId` and an ordered list of `Turn` objects
- Each `Turn` has a `request: TurnMessage` (user/model/meta/etc), `responseMessage`, `rounds` (tool call rounds), `references`, etc.
- Located in `src/extension/conversationStore/` and `src/extension/prompt/common/conversation.ts`

### API Messages

- `Raw.ChatMessage` — the internal representation with `Raw.ChatRole` (System/User/Assistant/Tool)
- Converted to provider-specific formats in `src/platform/endpoint/node/messagesApi.ts` (Anthropic) and `responsesApi.ts` (OpenAI)
- The prompt-tsx rendering pipeline produces `Raw.ChatMessage[]` which is what actually goes to the API
- `src/platform/chat/common/globalStringUtils.ts` has helpers like `roleToString`, `getTextPart`

## Workflow Rules

### Interaction

- **Always iterate with the user** using the user input MCP tool. Ask questions, check understanding, confirm decisions.
- **Never stop chat generation** until the user explicitly confirms the task is completed.
- **Never assume** — if something is unclear, ask.

### Stories & Tracking

- **Keep the active story updated** as you work:
  - Tick off task checkboxes as each item is completed.
  - Add new information (bugs, discoveries, design changes) as it comes up.
  - Add devlog entries for significant decisions or changes.
- **Commit ticked items with the work** — when code changes are committed, the story file should be updated in the same commit to reflect the completed tasks.
- **Commit message format:** `[NNN] Story Name — description of change` (e.g. `[001] Chat History Visualiser — scaffold sidebar panel`)

### Code

- Check compilation output (watch tasks) before declaring anything done.
- Proceed step by step. Get feedback before moving to the next phase.

## Architecture Notes

- The extension uses **WebviewViewProvider** for sidebar panels (see backup branch's `nuumCompactionPanel.ts` for reference)
- Panels are registered via the contribution system and gated on context keys
- VS Code theming variables are used for consistent styling
- The extension uses dependency injection via `IInstantiationService`
