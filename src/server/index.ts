import {
	type Connection,
	Server,
	type WSMessage,
	routePartykitRequest,
} from "partyserver";

import type { ChatMessage, Message } from "../shared";

const CLEAR_INTERVAL_MS = 10 * 60 * 1000; // 10 分钟

export class Chat extends Server<Env> {
	static options = { hibernate: true };

	messages = [] as ChatMessage[];

	broadcastMessage(message: Message, exclude?: string[]) {
		this.broadcast(JSON.stringify(message), exclude);
	}

	onStart() {
		this.ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, user TEXT, role TEXT, content TEXT)`,
		);

		this.messages = this.ctx.storage.sql
			.exec(`SELECT * FROM messages`)
			.toArray() as ChatMessage[];

		// 若没有定时任务则设置 10 分钟后清空
		this.ctx.storage.getAlarm().then((alarm) => {
			if (alarm === null) {
				this.ctx.storage.setAlarm(Date.now() + CLEAR_INTERVAL_MS);
			}
		});
	}

	async alarm() {
		// 清空所有消息
		this.messages = [];
		this.ctx.storage.sql.exec(`DELETE FROM messages`);

		// 通知所有在线客户端
		this.broadcast(JSON.stringify({ type: "clear" } satisfies Message));

		// 重新设置下一次清空
		this.ctx.storage.setAlarm(Date.now() + CLEAR_INTERVAL_MS);
	}

	getOnlineCount(): number {
		return [...this.getConnections()].length;
	}

	broadcastOnlineCount() {
		this.broadcast(
			JSON.stringify({
				type: "online",
				count: this.getOnlineCount(),
			} satisfies Message),
		);
	}

	onConnect(connection: Connection) {
		// 发送历史消息给新连接
		connection.send(
			JSON.stringify({
				type: "all",
				messages: this.messages,
			} satisfies Message),
		);
		// 向所有人广播最新在线人数
		this.broadcastOnlineCount();
	}

	onClose(_connection: Connection) {
		// 有人离开时更新在线人数
		this.broadcastOnlineCount();
	}

	saveMessage(message: ChatMessage) {
		const existingMessage = this.messages.find((m) => m.id === message.id);
		if (existingMessage) {
			this.messages = this.messages.map((m) =>
				m.id === message.id ? message : m,
			);
		} else {
			this.messages.push(message);
		}

		this.ctx.storage.sql.exec(
			`INSERT INTO messages (id, user, role, content) VALUES (?, ?, ?, ?)
			 ON CONFLICT (id) DO UPDATE SET content = ?`,
			message.id,
			message.user,
			message.role,
			message.content,
			message.content,
		);
	}

	onMessage(connection: Connection, message: WSMessage) {
		this.broadcast(message);

		const parsed = JSON.parse(message as string) as Message;
		if (parsed.type === "add" || parsed.type === "update") {
			this.saveMessage(parsed);
		}
	}
}

export default {
	async fetch(request, env) {
		return (
			(await routePartykitRequest(request, { ...env })) ||
			env.ASSETS.fetch(request)
		);
	},
} satisfies ExportedHandler<Env>;
