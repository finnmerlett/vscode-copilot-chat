/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import * as vscode from 'vscode';
import { getTextPart, roleToString } from '../../../platform/chat/common/globalStringUtils';
import { ILogService } from '../../../platform/log/common/logService';
import { IRequestLogger, LoggedInfoKind } from '../../../platform/requestLogger/node/requestLogger';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { IExtensionContribution } from '../../common/contributions';
import { IConversationStore } from '../../conversationStore/node/conversationStore';
import { Conversation, Turn, TurnStatus } from '../../prompt/common/conversation';

const viewId = 'copilot-chat-visualiser';
const showCommand = 'github.copilot.debug.showChatVisualiser';
const refreshCommand = 'github.copilot.debug.refreshChatVisualiser';

export class ChatVisualiserContribution extends Disposable implements IExtensionContribution {
	readonly id = 'chatVisualiserPanel';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@ILogService logService: ILogService,
	) {
		super();
		const provider = this._register(instantiationService.createInstance(ChatVisualiserViewProvider));
		this._register(vscode.window.registerWebviewViewProvider(viewId, provider, { webviewOptions: { retainContextWhenHidden: true } }));
		this._register(vscode.commands.registerCommand(refreshCommand, () => provider.refresh()));
		this._register(vscode.commands.registerCommand(showCommand, async () => {
			logService.info('[ChatVisualiser] show command invoked');
			await vscode.commands.executeCommand(`${viewId}.focus`);
		}));
	}
}

class ChatVisualiserViewProvider extends Disposable implements vscode.WebviewViewProvider {
	private webviewView: vscode.WebviewView | undefined;

	constructor(
		@IConversationStore private readonly conversationStore: IConversationStore,
		@IRequestLogger private readonly requestLogger: IRequestLogger,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.logService.info('[ChatVisualiser] resolveWebviewView called');
		this.webviewView = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = renderEmpty('No active chat session');

		this._register(webviewView.webview.onDidReceiveMessage(msg => {
			if (msg.command === 'openContent') {
				this.openContentTab(msg.title, msg.content);
			}
		}));

		this._register(webviewView.onDidChangeVisibility(() => {
			if (webviewView.visible) {
				this.refresh();
			}
		}));

		this.refresh();
	}

	refresh(): void {
		if (!this.webviewView) {
			return;
		}

		const conversation = this.conversationStore.lastConversation;
		if (!conversation) {
			this.webviewView.webview.html = renderEmpty('No active chat session');
			return;
		}

		// Gather the latest API messages from the request logger
		const apiMessages = this.getLatestApiMessages();

		this.webviewView.webview.html = renderConversation(conversation, apiMessages);
	}

	private getLatestApiMessages(): Raw.ChatMessage[] {
		const requests = this.requestLogger.getRequests();
		// Find the last request that has messages (skip MarkdownContentRequest entries)
		for (let i = requests.length - 1; i >= 0; i--) {
			const req = requests[i];
			if (req.kind === LoggedInfoKind.Request) {
				const entry = req.entry;
				if ('chatParams' in entry && entry.chatParams?.messages?.length) {
					return entry.chatParams.messages;
				}
			}
		}
		return [];
	}

	private async openContentTab(title: string, content: string): Promise<void> {
		const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
		await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
	}
}

// --- Rendering ---

function renderConversation(conversation: Conversation, apiMessages: Raw.ChatMessage[]): string {
	const turns = conversation.turns;
	const sessionIdShort = conversation.sessionId.slice(0, 12);

	return `<!DOCTYPE html>
<html><head>${baseStyles()}</head>
<body>

<div class="header">
	<h2>Chat Visualiser</h2>
	<div class="meta">Session: <code>${escapeHtml(sessionIdShort)}…</code> · ${turns.length} turn${turns.length !== 1 ? 's' : ''}</div>
</div>

<div class="columns">

<!-- Column 1: User View -->
<div class="column">
	<div class="column-header">
		<h3>User View</h3>
		<div class="token-badge">${turns.length} turns</div>
	</div>
	<div class="items">
	${turns.map((turn, i) => renderTurn(turn, i)).join('\n')}
	</div>
</div>

<!-- Column 2: API View -->
<div class="column">
	<div class="column-header">
		<h3>API View</h3>
		<div class="token-badge">${apiMessages.length} messages</div>
	</div>
	<div class="items">
	${apiMessages.length > 0
			? apiMessages.map((msg, i) => renderApiMessage(msg, i)).join('\n')
			: '<div class="empty">No API messages captured yet — send a message first</div>'}
	</div>
</div>

</div>

<script>
const vscode = acquireVsCodeApi();
function openContent(title, content) { vscode.postMessage({ command: 'openContent', title, content }); }
</script>
</body></html>`;
}

function renderTurn(turn: Turn, index: number): string {
	const request = turn.request;
	const response = turn.responseMessage;
	const status = turn.responseStatus;
	const rounds = turn.rounds;
	const refs = turn.references;

	const statusIcon = statusToIcon(status);
	const turnId = turn.id.slice(-8);

	// Build metadata for hover tooltip
	const metadata = [
		`Turn ${index + 1}`,
		`ID: ${turn.id}`,
		`Type: ${request.type}`,
		`Status: ${status}`,
		`Rounds: ${rounds.length}`,
		`References: ${refs.length}`,
	].join('\n');

	let html = '';

	// Request message
	const requestContent = request.message || '(empty)';
	html += `<div class="item msg-${escapeHtml(request.type)}" title="${escapeHtml(metadata)}" onclick="openContent('Turn ${index + 1} — Request', ${escapeAttr(requestContent)})">
	<div class="item-header">
		<span class="type-badge ${escapeHtml(request.type)}">${escapeHtml(request.type)}</span>
		${request.name ? `<span class="name">${escapeHtml(request.name)}</span>` : ''}
		<span class="id">${escapeHtml(turnId)}</span>
		<span class="status">${statusIcon}</span>
	</div>
	<div class="content">${escapeHtml(truncate(requestContent, 200))}</div>
</div>`;

	// Tool call rounds
	for (const [ri, round] of rounds.entries()) {
		if (round.toolCalls && round.toolCalls.length > 0) {
			for (const tc of round.toolCalls) {
				const toolName = tc.name ?? 'unknown';
				const toolArgs = tc.arguments ?? '';
				const toolMeta = `Round ${ri + 1}\nTool: ${toolName}\nID: ${tc.id}\nArguments: ${truncate(toolArgs, 100)}`;

				html += `<div class="item msg-tool_call" title="${escapeHtml(toolMeta)}" onclick="openContent('Turn ${index + 1} Round ${ri + 1} — ${escapeHtml(toolName)}', ${escapeAttr(`# Tool Call: ${toolName}\n\n## Arguments\n\`\`\`json\n${toolArgs}\n\`\`\``)})">
	<div class="item-header">
		<span class="type-badge tool_call">tool</span>
		<span class="name">${escapeHtml(toolName)}</span>
		<span class="id">R${ri + 1}</span>
	</div>
	<div class="content">${jsonToYamlPreviewHtml(toolArgs)}</div>
</div>`;
			}
		}

		// Round response (assistant message after tool calls)
		if (round.response) {
			const roundMeta = `Round ${ri + 1} response\nLength: ${round.response.length} chars`;
			html += `<div class="item msg-assistant" title="${escapeHtml(roundMeta)}" onclick="openContent('Turn ${index + 1} Round ${ri + 1} — Response', ${escapeAttr(round.response)})">
	<div class="item-header">
		<span class="type-badge assistant">assistant</span>
		<span class="id">R${ri + 1}</span>
	</div>
	<div class="content">${escapeHtml(truncate(round.response, 200))}</div>
</div>`;
		}
	}

	// Final response (if different from last round)
	if (response && response.message) {
		const lastRoundResponse = rounds.length > 0 ? rounds[rounds.length - 1].response : undefined;
		if (response.message !== lastRoundResponse) {
			const respMeta = `Response\nType: ${response.type}\nLength: ${response.message.length} chars`;
			html += `<div class="item msg-model" title="${escapeHtml(respMeta)}" onclick="openContent('Turn ${index + 1} — Response', ${escapeAttr(response.message)})">
	<div class="item-header">
		<span class="type-badge model">${escapeHtml(response.type)}</span>
		<span class="id">${escapeHtml(turnId)}</span>
	</div>
	<div class="content">${escapeHtml(truncate(response.message, 200))}</div>
</div>`;
		}
	}

	return html;
}

function renderApiMessage(msg: Raw.ChatMessage, index: number): string {
	const role = roleToString(msg.role);
	const text = getTextPart(msg.content);
	const name = msg.name ? ` (${msg.name})` : '';

	// Build full content for click-to-open
	let fullContent = `# Message ${index + 1}: ${role}${name}\n\n`;
	fullContent += `## Content\n${text}\n`;

	// Check for tool calls (assistant messages)
	const toolCalls = 'toolCalls' in msg ? (msg as Raw.AssistantChatMessage).toolCalls : undefined;
	if (toolCalls && toolCalls.length > 0) {
		fullContent += `\n## Tool Calls\n`;
		for (const tc of toolCalls) {
			fullContent += `\n### ${tc.function.name}\n\`\`\`json\n${tc.function.arguments}\n\`\`\`\n`;
		}
	}

	// Check for tool call ID (tool response messages)
	const toolCallId = 'toolCallId' in msg ? (msg as Raw.ToolChatMessage).toolCallId : undefined;
	if (toolCallId) {
		fullContent += `\n## Tool Call ID\n${toolCallId}\n`;
	}

	// Build hover metadata
	const metadata = [
		`Message ${index + 1}`,
		`Role: ${role}`,
		name ? `Name: ${msg.name}` : '',
		`Content parts: ${msg.content.length}`,
		`Text length: ${text.length} chars`,
		toolCalls ? `Tool calls: ${toolCalls.length}` : '',
		toolCallId ? `Tool call ID: ${toolCallId}` : '',
	].filter(Boolean).join('\n');

	// Tool calls sub-items
	let toolCallHtml = '';
	if (toolCalls && toolCalls.length > 0) {
		for (const tc of toolCalls) {
			const tcMeta = `Tool: ${tc.function.name}\nID: ${tc.id}\nArgs length: ${tc.function.arguments.length}`;
			toolCallHtml += `<div class="item msg-tool_call" title="${escapeHtml(tcMeta)}" onclick="openContent('${escapeHtml(tc.function.name)}', ${escapeAttr(`# Tool Call: ${tc.function.name}\n\nID: ${tc.id}\n\n## Arguments\n\`\`\`json\n${tc.function.arguments}\n\`\`\``)})">
	<div class="item-header">
		<span class="type-badge tool_call">call</span>
		<span class="name">${escapeHtml(tc.function.name)}</span>
	</div>
	<div class="content">${jsonToYamlPreviewHtml(tc.function.arguments)}</div>
</div>`;
		}
	}

	return `<div class="item msg-${escapeHtml(role)}" title="${escapeHtml(metadata)}" onclick="openContent('Message ${index + 1} — ${escapeHtml(role)}', ${escapeAttr(fullContent)})">
	<div class="item-header">
		<span class="type-badge ${escapeHtml(role)}">${escapeHtml(role)}</span>
		${msg.name ? `<span class="name">${escapeHtml(msg.name)}</span>` : ''}
		<span class="id">#${index + 1}</span>
		<span class="tokens">${text.length}c</span>
	</div>
	<div class="content">${highlightXmlTags(escapeHtml(truncate(text, 200)))}</div>
</div>
${toolCallHtml}`;
}

function statusToIcon(status: TurnStatus): string {
	switch (status) {
		case TurnStatus.InProgress: return '⏳';
		case TurnStatus.Success: return '✓';
		case TurnStatus.Cancelled: return '✗';
		case TurnStatus.OffTopic: return '⊘';
		case TurnStatus.Filtered: return '⊘';
		case TurnStatus.PromptFiltered: return '⊘';
		case TurnStatus.Error: return '✗';
		default: return '?';
	}
}

function renderEmpty(message: string): string {
	return `<!DOCTYPE html>
<html><head>${baseStyles()}</head>
<body>
<div class="empty">${escapeHtml(message)}</div>
</body></html>`;
}

function truncate(s: string, maxLen: number): string {
	if (s.length <= maxLen) {
		return s;
	}
	return s.slice(0, maxLen) + '…';
}

/** Returns already-escaped HTML with styled key/value spans for YAML-like preview. */
function jsonToYamlPreviewHtml(jsonStr: string): string {
	try {
		const obj = JSON.parse(jsonStr);
		if (typeof obj !== 'object' || obj === null) {
			return escapeHtml(truncate(jsonStr, 120));
		}
		return Object.entries(obj).map(([k, v]) => {
			const val = typeof v === 'string'
				? (v.length > 80 ? v.slice(0, 80) + '…' : v)
				: JSON.stringify(v);
			return `<span class="kv-key">${escapeHtml(k)}</span><span class="kv-sep">:</span> ${escapeHtml(val)}`;
		}).join('\n');
	} catch {
		return escapeHtml(truncate(jsonStr, 120));
	}
}

/** After escapeHtml, highlights XML-like tags (&lt;tag&gt;) with a styled span. */
function highlightXmlTags(escapedHtml: string): string {
	return escapedHtml.replace(/&lt;(\/?[\w-]+)&gt;/g, '<span class="xml-tag">&lt;$1&gt;</span>');
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
	return JSON.stringify(s).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

function baseStyles(): string {
	return `<style>
:root {
	--bg: var(--vscode-editor-background, #1e1e1e);
	--fg: var(--vscode-editor-foreground, #ccc);
	--border: var(--vscode-panel-border, #333);
	--badge-bg: var(--vscode-badge-background, #4d4d4d);
	--badge-fg: var(--vscode-badge-foreground, #fff);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
	font-family: var(--vscode-font-family, system-ui);
	font-size: var(--vscode-font-size, 13px);
	color: var(--fg);
	background: var(--bg);
	padding: 8px;
}
.header {
	display: flex;
	align-items: center;
	gap: 12px;
	margin-bottom: 12px;
	flex-wrap: wrap;
}
.header h2 { font-size: 14px; font-weight: 600; }
.meta { opacity: 0.7; font-size: 11px; }
.columns {
	display: flex;
	gap: 8px;
	min-height: 200px;
}
.column {
	flex: 1;
	min-width: 0;
	border: 1px solid var(--border);
	border-radius: 4px;
	display: flex;
	flex-direction: column;
}
.column-header {
	padding: 6px 8px;
	border-bottom: 1px solid var(--border);
	position: sticky;
	top: 0;
	background: var(--bg);
	z-index: 1;
}
.column-header h3 { font-size: 12px; font-weight: 600; }
.token-badge {
	font-size: 10px;
	opacity: 0.7;
	margin-top: 2px;
}
.items {
	flex: 1;
	overflow-y: auto;
	padding: 4px;
}
.item {
	padding: 4px 6px;
	margin-bottom: 3px;
	border-radius: 3px;
	border-left: 3px solid transparent;
	background: rgba(255,255,255,0.03);
	cursor: pointer;
}
.item:hover {
	background: rgba(255,255,255,0.07);
}
.item-header {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-bottom: 2px;
}
.type-badge {
	font-size: 10px;
	padding: 1px 5px;
	border-radius: 3px;
	background: var(--badge-bg);
	color: var(--badge-fg);
	font-weight: 500;
}
.type-badge.user { background: #264f78; }
.type-badge.assistant { background: #4e3a22; }
.type-badge.model { background: #4e3a22; }
.type-badge.system { background: #444; }
.type-badge.tool { background: #22404a; }
.type-badge.tool_call { background: #2d4a22; }
.type-badge.tool_result { background: #22404a; }
.type-badge.follow-up { background: #4a2244; }
.type-badge.template { background: #3a2244; }
.type-badge.meta { background: #22404a; }
.type-badge.server { background: #4a3622; }
.name { font-size: 10px; opacity: 0.8; font-family: monospace; }
.id { font-size: 10px; opacity: 0.5; font-family: monospace; }
.status { font-size: 10px; margin-left: auto; }
.tokens { font-size: 10px; opacity: 0.5; margin-left: auto; }
.content {
	font-size: 11px;
	white-space: pre-wrap;
	word-break: break-word;
	opacity: 0.85;
	max-height: 80px;
	overflow: hidden;
}
.content .kv-key {
	opacity: 0.5;
}
.content .kv-sep {
	opacity: 0.5;
}
.content .xml-tag {
	opacity: 0.5;

}
.empty {
	padding: 24px;
	text-align: center;
	opacity: 0.6;
}
</style>`;
}
