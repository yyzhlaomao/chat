import { createRoot } from "react-dom/client";
import { usePartySocket } from "partysocket/react";
import React, { useState } from "react";
import {
	BrowserRouter,
	Routes,
	Route,
	Navigate,
	useParams,
	useNavigate,
} from "react-router";
import { nanoid } from "nanoid";

import { names, type ChatMessage, type Message } from "../shared";

// ── 房间定义 ──────────────────────────────────────────────
const ROOMS = [
	{ key: "gaming", label: "🎮 游戏" },
	{ key: "anime",  label: "🎌 动漫" },
	{ key: "movies", label: "🎬 影视" },
	{ key: "daily",  label: "💬 日常" },
] as const;

type RoomKey = typeof ROOMS[number]["key"];

const VALID_KEYS = ROOMS.map((r) => r.key) as string[];

// ── 工具函数 ──────────────────────────────────────────────
function hashCode(str: string): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = (hash << 5) - hash + str.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash);
}

function getOrCreateUserId(): string {
	const stored = localStorage.getItem("chat-user-id");
	if (stored) return stored;
	const id = nanoid(16);
	localStorage.setItem("chat-user-id", id);
	return id;
}

function deriveUserName(userId: string): string {
	const index = hashCode(userId) % names.length;
	return `${names[index]}#${userId.slice(0, 4)}`;
}

// ── 顶部房间切换栏 ─────────────────────────────────────────
function RoomTabs({ currentRoom }: { currentRoom: string }) {
	const navigate = useNavigate();
	return (
		<div className="room-tabs">
			{ROOMS.map((r) => (
				<button
					key={r.key}
					className={`room-tab${currentRoom === r.key ? " active" : ""}`}
					onClick={() => navigate(`/${r.key}`)}
				>
					{r.label}
				</button>
			))}
		</div>
	);
}

// ── 聊天区（key=room 确保切换房间时完整重置状态）────────────
function ChatRoom({ room }: { room: RoomKey }) {
	const userId = getOrCreateUserId();
	const name = deriveUserName(userId);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [onlineCount, setOnlineCount] = useState<number>(0);

	const socket = usePartySocket({
		party: "chat",
		room,
		onMessage: (evt) => {
			const message = JSON.parse(evt.data as string) as Message;

			if (message.type === "online") {
				setOnlineCount(message.count);
			} else if (message.type === "clear") {
				setMessages([]);
			} else if (message.type === "all") {
				setMessages(message.messages);
			} else if (message.type === "add") {
				const foundIndex = messages.findIndex((m) => m.id === message.id);
				if (foundIndex === -1) {
					setMessages((prev) => [
						...prev,
						{
							id: message.id,
							content: message.content,
							user: message.user,
							role: message.role,
						},
					]);
				} else {
					setMessages((prev) =>
						prev
							.slice(0, foundIndex)
							.concat({
								id: message.id,
								content: message.content,
								user: message.user,
								role: message.role,
							})
							.concat(prev.slice(foundIndex + 1)),
					);
				}
			} else if (message.type === "update") {
				setMessages((prev) =>
					prev.map((m) =>
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
			{/* 右上角在线人数 */}
			<div className="online-badge">
				<span className="online-dot" />
				{onlineCount} 人在线
			</div>

			{/* 当前用户名提示 */}
			<div className="row" style={{ marginBottom: "0.5rem", opacity: 0.6 }}>
				<div className="twelve columns">
					你的名称：<strong>{name}</strong>
					<span style={{ marginLeft: "1rem", fontSize: "0.85em" }}>
						（聊天记录每 10 分钟自动清除）
					</span>
				</div>
			</div>

			{/* 消息列表 */}
			{messages.map((message) => (
				<div key={message.id} className="row message">
					<div className="three columns user">{message.user}</div>
					<div className="nine columns">{message.content}</div>
				</div>
			))}

			{/* 输入框 */}
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
					setMessages((prev) => [...prev, chatMessage]);
					socket.send(
						JSON.stringify({ type: "add", ...chatMessage } satisfies Message),
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

// ── 房间页（路由验证 + 组合渲染）────────────────────────────
function RoomPage() {
	const { room } = useParams<{ room: string }>();
	if (!room || !VALID_KEYS.includes(room)) {
		return <Navigate to="/gaming" replace />;
	}
	return (
		<>
			<RoomTabs currentRoom={room} />
			{/* key 变化时 ChatRoom 完整重建，消息/人数状态自动清空 */}
			<ChatRoom key={room} room={room as RoomKey} />
		</>
	);
}

// ── 入口 ─────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
createRoot(document.getElementById("root")!).render(
	<BrowserRouter>
		<Routes>
			<Route path="/" element={<Navigate to="/gaming" replace />} />
			<Route path="/:room" element={<RoomPage />} />
			<Route path="*" element={<Navigate to="/gaming" replace />} />
		</Routes>
	</BrowserRouter>,
);
