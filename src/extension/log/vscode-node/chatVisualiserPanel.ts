/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
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

		this.webviewView.webview.html = renderConversation(conversation);
	}

	private async openContentTab(title: string, content: string): Promise<void> {
		const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
		await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
	}
}

// --- Rendering ---

function renderConversation(conversation: Conversation): string {
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

<!-- Column 2: API View (Phase 2) -->
<div class="column">
	<div class="column-header">
		<h3>API View</h3>
		<div class="token-badge">Coming in Phase 2</div>
	</div>
	<div class="items">
		<div class="empty">Subscribe to onDidBuildPrompt to capture API messages</div>
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

				html += `<div class="item msg-tool_call" title="${escapeHtml(toolMeta)}" onclick="openContent('Turn ${index + 1} Round ${ri + 1} — ${escapeHtml(toolName)}', ${escapeAttr(`# Tool Call: ${toolName}\n\n## Arguments\n${toolArgs}`)})">
	<div class="item-header">
		<span class="type-badge tool_call">tool</span>
		<span class="name">${escapeHtml(toolName)}</span>
		<span class="id">R${ri + 1}</span>
	</div>
	<div class="content">${escapeHtml(truncate(toolArgs, 120))}</div>
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
.empty {
	padding: 24px;
	text-align: center;
	opacity: 0.6;
}
</style>`;
}
