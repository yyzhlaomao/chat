import { createRoot } from "react-dom/client";
import { usePartySocket } from "partysocket/react";
import React, { useState } from "react";
import {
	BrowserRouter,
	Routes,
	Route,
	Navigate,
} from "react-router";
import { nanoid } from "nanoid";

import { names, type ChatMessage, type Message } from "../shared";

const PUBLIC_ROOM = "public";

// 将字符串哈希为非负整数
function hashCode(str: string): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = (hash << 5) - hash + str.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash);
}

// 首次访问生成 ID 并存入 localStorage，之后复用
function getOrCreateUserId(): string {
	const stored = localStorage.getItem("chat-user-id");
	if (stored) return stored;
	const id = nanoid(16);
	localStorage.setItem("chat-user-id", id);
	return id;
}

// 根据用户 ID 派生固定名称，格式：Alice#a3f2
function deriveUserName(userId: string): string {
	const index = hashCode(userId) % names.length;
	return `${names[index]}#${userId.slice(0, 4)}`;
}

function App() {
	const userId = getOrCreateUserId();
	const name = deriveUserName(userId);
	const [messages, setMessages] = useState<ChatMessage[]>([]);

	const socket = usePartySocket({
		party: "chat",
		room: PUBLIC_ROOM,
		onMessage: (evt) => {
			const message = JSON.parse(evt.data as string) as Message;

			if (message.type === "clear") {
				setMessages([]);
			} else if (message.type === "all") {
				setMessages(message.messages);
			} else if (message.type === "add") {
				const foundIndex = messages.findIndex((m) => m.id === message.id);
				if (foundIndex === -1) {
					setMessages((messages) => [
						...messages,
						{
							id: message.id,
							content: message.content,
							user: message.user,
							role: message.role,
						},
					]);
				} else {
					setMessages((messages) =>
						messages
							.slice(0, foundIndex)
							.concat({
								id: message.id,
								content: message.content,
								user: message.user,
								role: message.role,
							})
							.concat(messages.slice(foundIndex + 1)),
					);
				}
			} else if (message.type === "update") {
				setMessages((messages) =>
					messages.map((m) =>
						m.id === message.id
							? {
									id: message.id,
									content: message.content,
									user: message.user,
									role: message.role,
								}
							: m,
					),
				);
			}
		},
	});

	return (
		<div className="chat container">
			<div className="row" style={{ marginBottom: "0.5rem", opacity: 0.6 }}>
				<div className="twelve columns">
					你的名称：<strong>{name}</strong>
					<span style={{ marginLeft: "1rem", fontSize: "0.85em" }}>
						（聊天记录每 10 分钟自动清除）
					</span>
				</div>
			</div>
			{messages.map((message) => (
				<div key={message.id} className="row message">
					<div className="three columns user">{message.user}</div>
					<div className="nine columns">{message.content}</div>
				</div>
			))}
			<form
				className="row"
				onSubmit={(e) => {
					e.preventDefault();
					const content = e.currentTarget.elements.namedItem(
						"content",
					) as HTMLInputElement;
					if (!content.value.trim()) return;
					const chatMessage: ChatMessage = {
						id: nanoid(8),
						content: content.value,
						user: name,
						role: "user",
					};
					setMessages((messages) => [...messages, chatMessage]);

					socket.send(
						JSON.stringify({
							type: "add",
							...chatMessage,
						} satisfies Message),
					);

					content.value = "";
				}}
			>
				<input
					type="text"
					name="content"
					className="ten columns my-input-text"
					placeholder={`${name}，说点什么...`}
					autoComplete="off"
				/>
				<button type="submit" className="send-message two columns">
					发送
				</button>
			</form>
		</div>
	);
}

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
createRoot(document.getElementById("root")!).render(
	<BrowserRouter>
		<Routes>
			<Route path="/" element={<Navigate to={`/${PUBLIC_ROOM}`} />} />
			<Route path="/:room" element={<App />} />
			<Route path="*" element={<Navigate to="/" />} />
		</Routes>
	</BrowserRouter>,
);
