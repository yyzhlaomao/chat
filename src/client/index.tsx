import { createRoot } from "react-dom/client";
import { usePartySocket } from "partysocket/react";
import React, { useState, useRef, useEffect } from "react";
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

const NICKNAME_KEY = "chat-nickname";
const MAX_NICK_LEN = 20;
const CLEAR_INTERVAL_MS = 10 * 60 * 1000;

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

function deriveDefaultName(userId: string): string {
	const index = hashCode(userId) % names.length;
	return `${names[index]}#${userId.slice(0, 4)}`;
}

function getStoredNickname(): string | null {
	return localStorage.getItem(NICKNAME_KEY);
}

function saveNickname(nick: string | null) {
	if (nick) {
		localStorage.setItem(NICKNAME_KEY, nick);
	} else {
		localStorage.removeItem(NICKNAME_KEY);
	}
}

/** 将剩余毫秒格式化为 MM:SS */
function formatCountdown(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ── 昵称编辑组件 ──────────────────────────────────────────
interface NicknameEditorProps {
	name: string;
	defaultName: string;
	onChange: (newName: string) => void;
}

function NicknameEditor({ name, defaultName, onChange }: NicknameEditorProps) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft]     = useState(name);
	const [error, setError]     = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (editing) {
			inputRef.current?.focus();
			inputRef.current?.select();
		}
	}, [editing]);

	function startEdit() {
		setDraft(name);
		setError("");
		setEditing(true);
	}

	function confirm() {
		const trimmed = draft.trim();
		if (!trimmed) { setError("昵称不能为空"); return; }
		if (trimmed.length > MAX_NICK_LEN) { setError(`最多 ${MAX_NICK_LEN} 个字符`); return; }
		saveNickname(trimmed);
		onChange(trimmed);
		setEditing(false);
		setError("");
	}

	function cancel() { setEditing(false); setError(""); }

	function resetToDefault() {
		saveNickname(null);
		onChange(defaultName);
		setEditing(false);
		setError("");
	}

	if (editing) {
		return (
			<span className="nickname-editor">
				<input
					ref={inputRef}
					className="nickname-input"
					value={draft}
					maxLength={MAX_NICK_LEN}
					onChange={(e) => { setDraft(e.target.value); setError(""); }}
					onKeyDown={(e) => {
						if (e.key === "Enter") confirm();
						if (e.key === "Escape") cancel();
					}}
				/>
				<button className="nick-btn confirm" onClick={confirm} title="确认">✓</button>
				<button className="nick-btn cancel"  onClick={cancel}  title="取消">✗</button>
				{name !== defaultName && (
					<button className="nick-btn reset" onClick={resetToDefault} title="恢复默认">
						恢复默认
					</button>
				)}
				{error && <span className="nick-error">{error}</span>}
			</span>
		);
	}

	return (
		<span className="nickname-editor">
			<strong>{name}</strong>
			<button className="nick-edit-btn" onClick={startEdit} title="修改昵称">✏️</button>
		</span>
	);
}

// ── 右上角信息面板（在线人数 + 倒计时）────────────────────
function InfoPanel({ onlineCount, nextClearAt }: { onlineCount: number; nextClearAt: number }) {
	const [countdown, setCountdown] = useState(() =>
		formatCountdown(nextClearAt - Date.now()),
	);

	// 每秒更新倒计时
	useEffect(() => {
		setCountdown(formatCountdown(nextClearAt - Date.now()));
		const timer = setInterval(() => {
			setCountdown(formatCountdown(nextClearAt - Date.now()));
		}, 1000);
		return () => clearInterval(timer);
	}, [nextClearAt]);

	// 剩余时间不足 60 秒时变红提示
	const isUrgent = nextClearAt - Date.now() < 60_000;

	return (
		<div className="info-panel">
			<div className="info-row">
				<span className="online-dot" />
				{onlineCount} 人在线
			</div>
			<div className={`info-row timer-row${isUrgent ? " urgent" : ""}`}>
				<span className="timer-icon">⏱</span>
				{countdown} 后清除
			</div>
		</div>
	);
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

// ── 聊天区 ────────────────────────────────────────────────
function ChatRoom({ room }: { room: RoomKey }) {
	const userId      = getOrCreateUserId();
	const defaultName = deriveDefaultName(userId);

	const [name, setName]               = useState(getStoredNickname() ?? defaultName);
	const [messages, setMessages]       = useState<ChatMessage[]>([]);
	const [onlineCount, setOnlineCount] = useState<number>(0);
	// 默认：当前时间 + 10 分钟，连接后服务端会发来精确值
	const [nextClearAt, setNextClearAt] = useState<number>(Date.now() + CLEAR_INTERVAL_MS);

	const nameRef = useRef(name);
	useEffect(() => { nameRef.current = name; }, [name]);

	const socket = usePartySocket({
		party: "chat",
		room,
		onMessage: (evt) => {
			const message = JSON.parse(evt.data as string) as Message;

			if (message.type === "timer") {
				setNextClearAt(message.nextClearAt);
			} else if (message.type === "online") {
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
						{ id: message.id, content: message.content, user: message.user, role: message.role },
					]);
				} else {
					setMessages((prev) =>
						prev
							.slice(0, foundIndex)
							.concat({ id: message.id, content: message.content, user: message.user, role: message.role })
							.concat(prev.slice(foundIndex + 1)),
					);
				}
			} else if (message.type === "update") {
				setMessages((prev) =>
					prev.map((m) =>
						m.id === message.id
							? { id: message.id, content: message.content, user: message.user, role: message.role }
							: m,
					),
				);
			}
		},
	});

	return (
		<div className="chat container">
			{/* 右上角：在线人数 + 倒计时 */}
			<InfoPanel onlineCount={onlineCount} nextClearAt={nextClearAt} />

			{/* 状态栏：昵称（可编辑）*/}
			<div className="row status-bar">
				<div className="twelve columns">
					<span style={{ opacity: 0.6, marginRight: "6px" }}>你的名称：</span>
					<NicknameEditor name={name} defaultName={defaultName} onChange={setName} />
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
					const content = e.currentTarget.elements.namedItem("content") as HTMLInputElement;
					if (!content.value.trim()) return;
					const chatMessage: ChatMessage = {
						id: nanoid(8),
						content: content.value,
						user: nameRef.current,
						role: "user",
					};
					setMessages((prev) => [...prev, chatMessage]);
					socket.send(JSON.stringify({ type: "add", ...chatMessage } satisfies Message));
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

// ── 房间页 ────────────────────────────────────────────────
function RoomPage() {
	const { room } = useParams<{ room: string }>();
	if (!room || !VALID_KEYS.includes(room)) {
		return <Navigate to="/gaming" replace />;
	}
	return (
		<>
			<RoomTabs currentRoom={room} />
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
