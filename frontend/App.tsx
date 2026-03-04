
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { 
  Terminal, 
  Search, 
  Plus, 
  Trash2, 
  Edit3, 
  Heart, 
  MessageSquare, 
  Eye, 
  ChevronLeft, 
  ChevronRight, 
  Cpu, 
  LogOut, 
  LogIn, 
  Tag as TagIcon,
  Zap,
  Clock,
  ArrowUpDown,
  Send,
  Volume2,
  VolumeX,
  X,
  Upload,
  User,
  Lock,
  ShieldCheck,
  ThumbsUp,
  MapPin,
  Image as ImageIcon,
  AlertTriangle
} from 'lucide-react';
import { Post, Comment, SortOption } from './types';
import { POSTS_PER_PAGE } from './constants';
// 智谱克隆音色播报

const COMMENTS_PER_PAGE = 5;
const RANK_BOARD_PAGE_SIZE = 10;
const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const DEFAULT_COVER = "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&q=80&w=800";
const PERMANENT_BAN_THRESHOLD = 4102444800000;
const readStoredCredentials = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('lx_current_user');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const username = String(parsed?.username || '').trim();
    const password = String(parsed?.password || '');
    if (!username || !password) return null;
    return { username, password };
  } catch (_error) {
    return null;
  }
};

const apiFetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
  const headers = new Headers(init.headers || undefined);
  const creds = readStoredCredentials();
  if (creds) {
    if (!headers.has('X-Auth-Username')) {
      headers.set('X-Auth-Username', creds.username);
    }
    if (!headers.has('X-Auth-Password')) {
      headers.set('X-Auth-Password', creds.password);
    }
  }
  return fetch(input, {
    credentials: 'include',
    ...init,
    headers
  });
};

const ensureRocketCursorEnabled = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const canUse = window.matchMedia?.('(pointer: fine)')?.matches;
  if (!canUse) return;
  document.body.classList.add('rocket-cursor-enabled');
};

type GeminiServiceModule = typeof import('./services/geminiService');
type MossServiceModule = typeof import('./services/mossService');
type TtsServiceModule = typeof import('./services/ttsService');

let geminiServicePromise: Promise<GeminiServiceModule> | null = null;
let mossServicePromise: Promise<MossServiceModule> | null = null;
let ttsServicePromise: Promise<TtsServiceModule> | null = null;

const loadGeminiService = () => {
  if (!geminiServicePromise) {
    geminiServicePromise = import('./services/geminiService');
  }
  return geminiServicePromise;
};

const loadMossService = () => {
  if (!mossServicePromise) {
    mossServicePromise = import('./services/mossService');
  }
  return mossServicePromise;
};

const loadTtsService = () => {
  if (!ttsServicePromise) {
    ttsServicePromise = import('./services/ttsService');
  }
  return ttsServicePromise;
};

// --- 类型扩展 ---
interface UserData {
  id?: number;
  username: string;
  password?: string;
  isAdmin?: boolean;
  rank?: string;
  totalSeconds?: number;
}

interface ConfirmModalConfig {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  variant?: 'danger' | 'warning';
}

interface RankRule {
  name: string;
  thresholdSeconds: number;
}

interface RankBoardItem {
  username: string;
  rank: string;
  totalSeconds: number;
  lastLoginAt?: number | null;
  bannedUntil?: number;
  isAdmin?: boolean;
}

type AuthMode = 'login' | 'register';

const RANK_RULES: RankRule[] = [
  { name: '士兵', thresholdSeconds: 0 },
  { name: '军士', thresholdSeconds: 30 },
  { name: '少校', thresholdSeconds: 120 },
  { name: '中校', thresholdSeconds: 300 },
  { name: '大校', thresholdSeconds: 600 },
  { name: '少将', thresholdSeconds: 1800 },
  { name: '中将', thresholdSeconds: 3600 },
  { name: '上将', thresholdSeconds: 7200 }
];

// --- 子组件 ---

const CyberButton = React.memo<{
  onClick?: () => void;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'moss';
  className?: string;
  type?: 'button' | 'submit';
  disabled?: boolean;
}>(({ onClick, children, variant = 'primary', className = '', type = 'button', disabled = false }) => {
  const variants = {
    primary: 'border-cyan-500 text-cyan-400 hover:bg-cyan-500/10 hover:shadow-[0_0_15px_rgba(0,243,255,0.4)]',
    secondary: 'border-red-500 text-red-400 hover:bg-red-500/10 hover:shadow-[0_0_15px_rgba(255,0,0,0.4)]',
    danger: 'border-orange-600 text-orange-500 hover:bg-orange-600/10 hover:shadow-[0_0_15px_rgba(234,88,12,0.4)]',
    moss: 'border-white text-white hover:bg-white/10 hover:shadow-[0_0_15px_rgba(255,255,255,0.4)]',
  };

  return (
    <button 
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2 border font-orbitron text-sm transition-all duration-300 active:scale-95 disabled:opacity-30 ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
});

const Tag = React.memo<{ label: string; active?: boolean; onClick?: (label: string) => void }>(({ label, active, onClick }) => (
  <span 
    onClick={() => onClick?.(label)}
    className={`px-2 py-0.5 text-xs font-mono border cursor-pointer transition-colors ${
      active 
        ? 'bg-red-600 text-white border-red-600' 
        : 'border-red-500/30 text-red-400 hover:border-red-500'
    }`}
  >
    #{label}
  </span>
));

const CyberConfirmModal: React.FC<ConfirmModalConfig & { onClose: () => void }> = ({ 
  isOpen, title, message, onConfirm, onClose, variant = 'danger' 
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-300 modal-backdrop">
      <div className="w-full max-w-md p-1 bg-red-600 shadow-[0_0_30px_rgba(255,0,0,0.4)]">
        <div className="bg-black p-6 relative overflow-hidden">
          {/* 背景修饰 */}
          <div className="absolute top-0 right-0 p-2 opacity-10">
            <AlertTriangle size={80} className="text-red-500" />
          </div>
          
          <div className="flex items-center gap-3 mb-4 text-red-500">
            <AlertTriangle className="animate-pulse" />
            <h2 className="text-lg font-orbitron font-bold tracking-tighter uppercase">{title}</h2>
          </div>

          <p className="text-red-100/80 font-mono text-sm leading-relaxed mb-8 border-l-2 border-red-600 pl-4 py-2 bg-red-900/10">
            {message}
          </p>

          <div className="flex justify-end gap-3">
            <button 
              onClick={onClose}
              className="px-4 py-2 text-[10px] font-orbitron text-red-900 hover:text-red-500 uppercase tracking-widest transition-colors"
            >
              Abort Operation (放弃)
            </button>
            <CyberButton 
              variant="secondary" 
              onClick={() => { onConfirm(); onClose(); }}
              className="px-8"
            >
              Confirm Wipe (确认抹除)
            </CyberButton>
          </div>

          <div className="mt-6 flex justify-between items-center opacity-20">
            <div className="h-[1px] bg-red-500 flex-1"></div>
            <span className="text-[8px] font-mono text-red-500 px-2 tracking-[0.3em]">SYSTEM_OVERRIDE_ENABLED</span>
            <div className="h-[1px] bg-red-500 flex-1"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

const MossChat: React.FC<{ username?: string; rank?: string }> = ({ username, rank }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<{id: string; role: 'user' | 'moss'; text: string; fullText?: string}[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  const [floatingPos, setFloatingPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ offsetX: number; offsetY: number; moved: boolean; originLeft: number; originTop: number } | null>(null);
  const suppressClickRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastSpeakRef = useRef<{ text: string; at: number } | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const revealCancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = Math.abs(e.movementX);
      const dy = Math.abs(e.movementY);
      if (dx + dy > 2) dragRef.current.moved = true;
      if (!floatingPos) {
        setFloatingPos({ x: dragRef.current.originLeft, y: dragRef.current.originTop });
      }
      const next = {
        x: e.clientX - dragRef.current.offsetX,
        y: e.clientY - dragRef.current.offsetY
      };
      setFloatingPos(next);
    };
    const handleUp = () => {
      if (dragRef.current?.moved) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 150);
      }
      dragRef.current = null;
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, []);

  useEffect(() => {
    if (!isOpen || !floatingPos) return;
    const width = 320;
    const height = 384;
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    const maxX = Math.max(8, window.innerWidth - width - 8);
    const maxY = Math.max(8, window.innerHeight - height - 8);
    const clamped = {
      x: clamp(floatingPos.x, 8, maxX),
      y: clamp(floatingPos.y, 8, maxY)
    };
    if (clamped.x !== floatingPos.x || clamped.y !== floatingPos.y) {
      setFloatingPos(clamped);
    }
  }, [isOpen, floatingPos]);

  const startDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragRef.current = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      moved: false,
      originLeft: rect.left,
      originTop: rect.top
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const revealTextSync = useCallback((messageId: string, fullText: string, durationMs?: number) => {
    if (revealCancelRef.current) {
      revealCancelRef.current();
      revealCancelRef.current = null;
    }
    const start = performance.now();
    const total = fullText.length;
    const fallbackDuration = Math.max(1200, total * 45);
    const finalDuration = Number.isFinite(durationMs) ? Math.max(600, durationMs as number) : fallbackDuration;
    let hasStarted = false;

    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const elapsed = performance.now() - start;
      const progress = Math.min(1, elapsed / finalDuration);
      const count = Math.max(1, Math.floor(progress * total));
      if (!hasStarted && count > 0) {
        hasStarted = true;
        setIsTyping(false);
      }
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, text: fullText.slice(0, count) } : m));
      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
    revealCancelRef.current = () => {
      cancelled = true;
    };
  }, []);

  const speakMoss = useCallback(async (text: string, messageId?: string) => {
    if (!isVoiceEnabled) return;
    const speakText = text.replace(/^MOSS：\s*/i, '').replace(/^MOSS:\s*/i, '');
    const now = Date.now();
    if (lastSpeakRef.current && lastSpeakRef.current.text === speakText && now - lastSpeakRef.current.at < 3000) {
      return;
    }
    lastSpeakRef.current = { text: speakText, at: now };

    try {
      const { synthesizeMossSpeech } = await loadTtsService();
      const blob = await synthesizeMossSpeech(speakText);
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        URL.revokeObjectURL(ttsAudioRef.current.src);
        ttsAudioRef.current = null;
      }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      ttsAudioRef.current = audio;
      let durationMs: number | undefined;
      audio.onloadedmetadata = () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          durationMs = audio.duration * 1000;
        }
      };
      audio.onended = () => {
        URL.revokeObjectURL(url);
      };
      if (messageId) {
        revealTextSync(messageId, text, durationMs);
      } else {
        setIsTyping(false);
      }
      await audio.play();
    } catch (error) {
      console.warn("TTS failed:", error);
      if (messageId) {
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, text: text } : m));
      }
      setIsTyping(false);
    }
  }, [isVoiceEnabled, revealTextSync]);

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;
    const userMsg = input;
    setMessages(prev => [...prev, { id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, role: 'user', text: userMsg }]);
    setInput('');
    setIsTyping(true);

    let response = "MOSS：由于太阳风暴干扰，通讯模块暂时离线。";
    try {
      const { askMOSS } = await loadMossService();
      response = await askMOSS(userMsg);
    } catch (error) {
      console.error('Load MOSS service error:', error);
    }
    const mossId = `moss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    if (isVoiceEnabled) {
      setMessages(prev => [...prev, { id: mossId, role: 'moss', text: '', fullText: response }]);
      void speakMoss(response, mossId);
    } else {
      setMessages(prev => [...prev, { id: mossId, role: 'moss', text: response }]);
      setIsTyping(false);
    }
  };

  return (
    <div
      className="fixed z-[100] font-mono moss-chat-root"
      style={floatingPos ? { left: floatingPos.x, top: floatingPos.y } : { right: 24, bottom: 24 }}
    >
      {isOpen ? (
        <div className="w-80 h-96 cyber-border-red bg-black/90 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 shadow-2xl text-red-500 moss-chat-panel">
          <div className="bg-red-900/40 p-3 border-b border-red-500 flex justify-between items-center relative">
            <span className="absolute inset-x-0 text-xs font-orbitron tracking-tighter text-red-100 uppercase text-center pointer-events-none">
              {`MOSS对话${username ? `${username}${rank || '士兵'}` : '终端'}`}
            </span>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full moss-eye animate-pulse"></div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (isVoiceEnabled && ttsAudioRef.current) {
                    ttsAudioRef.current.pause();
                    URL.revokeObjectURL(ttsAudioRef.current.src);
                    ttsAudioRef.current = null;
                  }
                  if (revealCancelRef.current) {
                    revealCancelRef.current();
                    revealCancelRef.current = null;
                  }
                  setMessages(prev => prev.map(m => m.fullText ? { ...m, text: m.fullText } : m));
                  setIsVoiceEnabled(v => !v);
                }}
                className="text-red-400 hover:text-white transition-colors"
                title={isVoiceEnabled ? '关闭语音' : '开启语音'}
              >
                {isVoiceEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
              <button onClick={() => setIsOpen(false)} className="text-red-400 hover:text-white transition-colors"><X size={16}/></button>
            </div>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 text-[12px]">
            {messages.length === 0 && (
              <p className="text-red-800 text-center italic">
                MOSS：流浪地球计划已进入加速阶段。
                {username ? ` ${username}${rank || '士兵'}，请输入你的查询请求。` : '请问你的查询请求是什么？'}
              </p>
            )}
            {messages.map((m) => {
              if (m.role === 'moss' && !m.text) return null;
              return (
                <div key={m.id} className={`${m.role === 'user' ? 'text-right' : 'text-left'}`}>
                  <span className={`inline-block p-2 border ${m.role === 'user' ? 'border-cyan-900 text-cyan-400' : 'border-red-900 text-red-400'} bg-black/60`}>
                    {m.text}
                  </span>
                </div>
              );
            })}
            {isTyping && (
              <div className="flex items-center gap-2 text-red-400 text-[10px]">
                <span className="moss-spinner"></span>
                <span className="animate-pulse">MOSS 正在搜寻人类历史数据库...</span>
              </div>
            )}
          </div>

          <div className="p-3 border-t border-red-900 bg-red-900/10 flex gap-2">
            <input 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="请输入通讯内容..."
              className="flex-1 bg-black/60 border border-red-500/30 p-1 text-xs text-red-400 focus:outline-none focus:border-red-500"
            />
            <button onClick={handleSend} className="text-red-500 hover:text-white"><Send size={16}/></button>
          </div>
        </div>
      ) : (
        <button 
          onClick={() => {
            if (suppressClickRef.current) return;
            setIsOpen(true);
          }}
          className="w-16 h-16 rounded-full moss-eye flex items-center justify-center border-2 border-red-600 animate-pulse group relative moss-drag-handle"
          onPointerDown={startDrag}
        >
          <div className="absolute inset-0 rounded-full border border-red-500 scale-125 opacity-20 group-hover:opacity-100 transition-opacity"></div>
          <span className="text-[10px] text-white font-orbitron font-bold">MOSS</span>
        </button>
      )}
    </div>
  );
}

// --- 主应用组件 ---

export default function App() {
  const [posts, setPosts] = useState<Post[]>([]);
  const rocketFlameRef = useRef<HTMLDivElement | null>(null);
  const flameRafRef = useRef<number | null>(null);
  const flameStartRef = useRef<number | null>(null);
  const flameStopTimerRef = useRef<number | null>(null);
  const lastPointerDownAtRef = useRef<number>(0);
  const [uptimeText, setUptimeText] = useState('');
  const [onlineCount, setOnlineCount] = useState(0);
  
  // 用户与权限系统
  const [currentUser, setCurrentUser] = useState<UserData | null>(() => {
    const saved = localStorage.getItem('lx_current_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authInfo, setAuthInfo] = useState<string | null>(null);
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authConfirmPassword, setAuthConfirmPassword] = useState('');
  const [showWelcome, setShowWelcome] = useState(false);
  const [welcomeUser, setWelcomeUser] = useState<string | null>(null);
  const [welcomeRank, setWelcomeRank] = useState<string | null>(null);
  const [welcomeFading, setWelcomeFading] = useState(false);
  const [showRankBoard, setShowRankBoard] = useState(false);
  const [rankBoard, setRankBoard] = useState<RankBoardItem[]>([]);
  const [rankBoardLoading, setRankBoardLoading] = useState(false);
  const [rankBoardError, setRankBoardError] = useState<string | null>(null);
  const [rankBoardRefreshKey, setRankBoardRefreshKey] = useState(0);
  const [rankBoardPage, setRankBoardPage] = useState(1);
  const [rankActionLoadingKey, setRankActionLoadingKey] = useState<string | null>(null);
  const [rankNotice, setRankNotice] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: ''
  });
  const isAdmin = useMemo(() => {
    const username = String(currentUser?.username || '').trim().toLowerCase();
    return Boolean(currentUser?.isAdmin) || username === 'lx';
  }, [currentUser]);

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [postDetailLoadingId, setPostDetailLoadingId] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [allTags, setAllTags] = useState<string[]>([]);
  const [postsRefreshKey, setPostsRefreshKey] = useState(0);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);

  // 全局确认模态框状态
  const [confirmModal, setConfirmModal] = useState<ConfirmModalConfig>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });
  const modalOpen = showAuth || showWelcome || rankNotice.visible || showRankBoard || isEditorOpen || confirmModal.isOpen;
  const modalOpenRef = useRef(false);

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('lx_current_user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('lx_current_user');
    }
  }, [currentUser]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/auth/me`, { signal: controller.signal });
        if (!res.ok) {
          if (active && res.status === 401) {
            setCurrentUser(null);
          }
          return;
        }
        const data = await res.json();
        if (!active) return;
        const user = data?.user;
        if (!user) return;
        setCurrentUser((prev) => {
          const nextUsername = String(user.username || '');
          return {
            id: Number(user.id),
            username: nextUsername,
            password: prev?.username === nextUsername ? prev.password : undefined,
            isAdmin: Boolean(user.isAdmin),
            rank: user.rank || '士兵',
            totalSeconds: Number.isFinite(user.totalSeconds) ? Number(user.totalSeconds) : 0
          };
        });
      } catch (error: any) {
        if (error?.name === 'AbortError') return;
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (showAuth) return;
    setAuthError(null);
    setAuthInfo(null);
    setAuthMode('login');
    setAuthPassword('');
    setAuthConfirmPassword('');
  }, [showAuth]);

  const openAuthModal = useCallback((mode: AuthMode = 'login', message?: string) => {
    setAuthMode(mode);
    setAuthInfo(null);
    setAuthError(message || null);
    setShowAuth(true);
  }, []);

  const switchAuthMode = useCallback((mode: AuthMode) => {
    setAuthMode(mode);
    setAuthError(null);
    setAuthInfo(null);
    setAuthPassword('');
    setAuthConfirmPassword('');
  }, []);

  useEffect(() => {
    modalOpenRef.current = modalOpen;
  }, [modalOpen]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (modalOpen) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    ensureRocketCursorEnabled();
  }, [modalOpen]);

  const fetchOnlineCount = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await apiFetch(`${API_BASE}/users/online`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      const count = Number(data?.count);
      if (Number.isFinite(count)) {
        setOnlineCount(Math.max(0, count));
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') return;
      console.error('Online count error:', error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const start = new Date('2026-02-01T00:00:00');
    let lastOnlineSync = Date.now();

    const formatUptime = (ms: number) => {
      const totalSeconds = Math.max(0, Math.floor(ms / 1000));
      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      const years = totalSeconds / (365 * 24 * 3600);
      const speedLyPerYear = 0.05;
      const traveled = years * speedLyPerYear;
      const totalDistance = 4;
      const remaining = Math.max(0, totalDistance - traveled);
      const traveledText = traveled.toFixed(4);
      const remainingText = remaining.toFixed(4);
      return `已稳定运行 ${days} 天 ${hours} 时 ${minutes} 分 ${seconds} 秒，累计行驶 ${traveledText} 光年，距离新家园还有 ${remainingText} 光年`;
    };

    const updateUptime = () => {
      setUptimeText(formatUptime(Date.now() - start.getTime()));
    };

    const intervalId = window.setInterval(() => {
      updateUptime();
      const now = Date.now();
      if (now - lastOnlineSync >= 5000) {
        lastOnlineSync = now;
        void fetchOnlineCount();
      }
    }, 1000);
    const initialOnlineTimerId = window.setTimeout(() => {
      lastOnlineSync = Date.now();
      void fetchOnlineCount();
    }, 1500);

    updateUptime();

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(initialOnlineTimerId);
    };
  }, [fetchOnlineCount]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const win: any = globalThis as any;
    const canUse = win.matchMedia?.('(pointer: fine)')?.matches;
    if (!canUse) return;
    ensureRocketCursorEnabled();

    const updateFlamePos = (x: number, y: number) => {
      const node = rocketFlameRef.current;
      if (!node) return;
      node.style.setProperty('--fx', `${x}px`);
      node.style.setProperty('--fy', `${y}px`);
    };

    const minScale = 0.9;
    const maxScale = 1.8;
    const maxMs = 420;
    const minVisibleMs = 140;

    const animateFlame = () => {
      const start = flameStartRef.current;
      const node = rocketFlameRef.current;
      if (!start || !node) return;
      const elapsed = Math.max(0, performance.now() - start);
      const t = Math.min(1, elapsed / maxMs);
      const scale = minScale + (maxScale - minScale) * t;
      const flicker = 0.88 + Math.random() * 0.24;
      const jitterX = (Math.random() - 0.5) * 4;
      const jitterY = (Math.random() - 0.5) * 3;
      node.style.setProperty('--flameScale', scale.toFixed(3));
      node.style.setProperty('--flameOpacity', flicker.toFixed(3));
      node.style.setProperty('--flameJx', `${jitterX.toFixed(2)}px`);
      node.style.setProperty('--flameJy', `${jitterY.toFixed(2)}px`);
      flameRafRef.current = win.requestAnimationFrame(animateFlame);
    };

    const handleMove = (e: PointerEvent | MouseEvent) => {
      updateFlamePos(e.clientX, e.clientY);
    };

    const stopFlameNow = () => {
      document.body.classList.remove('rocket-firing');
      flameStartRef.current = null;
      if (flameRafRef.current) {
        win.cancelAnimationFrame(flameRafRef.current);
        flameRafRef.current = null;
      }
      if (flameStopTimerRef.current) {
        win.clearTimeout(flameStopTimerRef.current);
        flameStopTimerRef.current = null;
      }
      const node = rocketFlameRef.current;
      if (node) {
        node.style.setProperty('--flameScale', '0');
        node.style.setProperty('--flameOpacity', '0');
        node.style.setProperty('--flameJx', '0px');
        node.style.setProperty('--flameJy', '0px');
      }
    };

    const stopFlame = () => {
      const start = flameStartRef.current;
      if (!start) {
        stopFlameNow();
        return;
      }
      const elapsed = performance.now() - start;
      if (elapsed >= minVisibleMs) {
        stopFlameNow();
        return;
      }
      if (flameStopTimerRef.current) {
        win.clearTimeout(flameStopTimerRef.current);
      }
      flameStopTimerRef.current = win.setTimeout(stopFlameNow, minVisibleMs - elapsed);
    };

    const startFlame = (x: number, y: number) => {
      if (flameStopTimerRef.current) {
        win.clearTimeout(flameStopTimerRef.current);
        flameStopTimerRef.current = null;
      }
      document.body.classList.add('rocket-firing');
      const now = performance.now();
      const boostedStart = modalOpenRef.current ? now - maxMs : now;
      flameStartRef.current = boostedStart;
      const node = rocketFlameRef.current;
      if (node) {
        node.style.setProperty('--fx', `${x}px`);
        node.style.setProperty('--fy', `${y}px`);
        node.style.setProperty('--flameScale', (modalOpenRef.current ? maxScale : minScale).toFixed(3));
        node.style.setProperty('--flameOpacity', '1');
        node.style.setProperty('--flameJx', '0px');
        node.style.setProperty('--flameJy', '0px');
      }
      if (!flameRafRef.current) {
        flameRafRef.current = win.requestAnimationFrame(animateFlame);
      }
    };

    const handleDown = (e: PointerEvent | MouseEvent) => {
      lastPointerDownAtRef.current = performance.now();
      startFlame(e.clientX, e.clientY);
    };
    const handleMouseDown = (e: MouseEvent) => {
      const now = performance.now();
      if (now - lastPointerDownAtRef.current < 80) return;
      startFlame(e.clientX, e.clientY);
    };
    const handleUp = () => stopFlame();
    const handleLeave = () => stopFlame();
    const handleBlur = () => stopFlame();
    const handleCancel = () => stopFlame();

    win.addEventListener('pointermove', handleMove, { passive: true });
    if ('onpointerrawupdate' in win) {
      win.addEventListener('pointerrawupdate', handleMove as EventListener, { passive: true });
    } else {
      win.addEventListener('mousemove', handleMove, { passive: true });
    }
    const pointerCaptureOptions: AddEventListenerOptions = { capture: true, passive: true };
    win.addEventListener('pointerdown', handleDown, pointerCaptureOptions);
    win.addEventListener('pointerup', handleUp, pointerCaptureOptions);
    win.addEventListener('pointercancel', handleCancel, pointerCaptureOptions);
    win.addEventListener('mousedown', handleMouseDown, pointerCaptureOptions);
    win.addEventListener('mouseup', handleUp, pointerCaptureOptions);
    win.addEventListener('mouseleave', handleLeave);
    win.addEventListener('blur', handleBlur);

    return () => {
      document.body.classList.remove('rocket-cursor-enabled');
      document.body.classList.remove('rocket-firing');
      flameStartRef.current = null;
      if (flameRafRef.current) {
        win.cancelAnimationFrame(flameRafRef.current);
        flameRafRef.current = null;
      }
      if (flameStopTimerRef.current) {
        win.clearTimeout(flameStopTimerRef.current);
        flameStopTimerRef.current = null;
      }
      win.removeEventListener('pointermove', handleMove);
      if ('onpointerrawupdate' in win) {
        win.removeEventListener('pointerrawupdate', handleMove as EventListener);
      } else {
        win.removeEventListener('mousemove', handleMove as EventListener);
      }
      win.removeEventListener('pointerdown', handleDown, pointerCaptureOptions);
      win.removeEventListener('pointerup', handleUp, pointerCaptureOptions);
      win.removeEventListener('pointercancel', handleCancel, pointerCaptureOptions);
      win.removeEventListener('mousedown', handleMouseDown, pointerCaptureOptions);
      win.removeEventListener('mouseup', handleUp, pointerCaptureOptions);
      win.removeEventListener('mouseleave', handleLeave);
      win.removeEventListener('blur', handleBlur);
    };
  }, []);

  useEffect(() => {
    if (!showWelcome) return;
    setWelcomeFading(false);
    const fadeTimer = window.setTimeout(() => setWelcomeFading(true), 1200);
    const closeTimer = window.setTimeout(() => setShowWelcome(false), 3000);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(closeTimer);
    };
  }, [showWelcome]);

  const openWelcome = useCallback((username: string, rank?: string) => {
    setWelcomeUser(username);
    setWelcomeRank(rank || null);
    setShowWelcome(true);
    setWelcomeFading(false);
  }, []);

  const formatDuration = useCallback((totalSeconds: number) => {
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0秒';
    if (totalSeconds < 60) return `${totalSeconds}秒`;
    return `${Math.floor(totalSeconds / 60)}分钟`;
  }, []);

  const formatDateTime = useCallback((timestamp?: number | null) => {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 0) return '从未登录';
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
  }, []);

  const isPermanentBan = useCallback((bannedUntil?: number | null) => {
    const value = Number(bannedUntil);
    return Number.isFinite(value) && value >= PERMANENT_BAN_THRESHOLD;
  }, []);

  const getUserRankLabel = useCallback((user?: UserData | null) => {
    return user?.rank || '士兵';
  }, []);

  const isManagedRank = useCallback((rank?: string) => {
    if (!rank) return false;
    return RANK_RULES.some(rule => rule.name === rank);
  }, []);

  const shouldSyncRank = useCallback((currentRank?: string, nextRank?: string) => {
    if (!nextRank) return false;
    if (!currentRank) return true;
    // 自定义军衔不被自动“降级/覆盖”
    if (!isManagedRank(currentRank)) {
      return !isManagedRank(nextRank);
    }
    return true;
  }, [isManagedRank]);

  const openRankNotice = useCallback((message: string) => {
    setRankNotice({ visible: true, message });
  }, []);

  useEffect(() => {
    if (!showRankBoard) return;
    let active = true;
    const controller = new AbortController();
    setRankBoardPage(1);
    setRankBoardLoading(true);
    setRankBoardError(null);
    const shouldUseAdminApi = isAdmin && Boolean(currentUser?.username);

    (async () => {
      try {
        let data: any = null;
        if (shouldUseAdminApi) {
          const adminRes = await apiFetch(`${API_BASE}/users/admin/list`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal
          });
          if (adminRes.ok) {
            data = await adminRes.json();
          } else if (adminRes.status === 401 || adminRes.status === 403) {
            const fallbackRes = await apiFetch(`${API_BASE}/users/leaderboard`, {
              signal: controller.signal
            });
            if (!fallbackRes.ok) {
              throw new Error(`Load rank board failed: ${fallbackRes.status}`);
            }
            data = await fallbackRes.json();
          } else {
            throw new Error(`Load rank board failed: ${adminRes.status}`);
          }
        } else {
          const res = await apiFetch(`${API_BASE}/users/leaderboard`, {
            signal: controller.signal
          });
          if (!res.ok) {
            throw new Error(`Load rank board failed: ${res.status}`);
          }
          data = await res.json();
        }

        if (!active) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        const normalized = items.map((item: any) => ({
          username: String(item?.username || ''),
          rank: item?.rank || '士兵',
          totalSeconds: Number(item?.totalSeconds) || 0,
          lastLoginAt: item?.lastLoginAt == null ? null : Number(item?.lastLoginAt) || null,
          bannedUntil: Number(item?.bannedUntil) || 0,
          isAdmin: Boolean(item?.isAdmin)
        }));
        setRankBoard(normalized);
      } catch (err: any) {
        if (!active || err?.name === 'AbortError') return;
        console.error('Rank board error:', err);
        setRankBoardError('军衔榜加载失败，请稍后重试。');
      } finally {
        if (active) setRankBoardLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [showRankBoard, rankBoardRefreshKey, isAdmin, currentUser?.username]);

  const rankBoardTotalPages = Math.max(1, Math.ceil(rankBoard.length / RANK_BOARD_PAGE_SIZE));
  const rankBoardVisibleItems = useMemo(() => {
    const page = Math.min(rankBoardPage, rankBoardTotalPages);
    const start = (page - 1) * RANK_BOARD_PAGE_SIZE;
    return rankBoard.slice(start, start + RANK_BOARD_PAGE_SIZE);
  }, [rankBoard, rankBoardPage, rankBoardTotalPages]);

  const handleAdminBanUser = useCallback((item: RankBoardItem, action: 'ban' | 'unban') => {
    if (!isAdmin || !currentUser) return;
    const targetUsername = String(item.username || '').trim();
    if (!targetUsername) return;
    const actionText = action === 'ban' ? '封禁' : '解除封禁';
    setConfirmModal({
      isOpen: true,
      title: 'MOSS WARNING: USER ACCESS CONTROL',
      message: `确认对用户 ${targetUsername} 执行「${actionText}」吗？`,
      variant: 'warning',
      onConfirm: async () => {
        const actionKey = `${action}:${targetUsername}`;
        setRankActionLoadingKey(actionKey);
        setRankBoardError(null);
        try {
          const res = await apiFetch(`${API_BASE}/users/admin/ban`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              targetUsername,
              action
            })
          });
          if (!res.ok) {
            throw new Error(`Ban user failed: ${res.status}`);
          }
          setRankBoardRefreshKey((k) => k + 1);
        } catch (error) {
          console.error('Ban user error:', error);
          setRankBoardError(action === 'ban' ? '封禁用户失败，请稍后重试。' : '解除封禁失败，请稍后重试。');
        } finally {
          setRankActionLoadingKey((key) => (key === actionKey ? null : key));
        }
      }
    });
  }, [isAdmin, currentUser]);

  const handleAdminDeleteUser = useCallback((item: RankBoardItem) => {
    if (!isAdmin || !currentUser) return;
    const targetUsername = String(item.username || '').trim();
    if (!targetUsername) return;
    setConfirmModal({
      isOpen: true,
      title: 'MOSS WARNING: DELETE USER',
      message: `确认彻底删除用户 ${targetUsername} 吗？该操作不可恢复。`,
      variant: 'danger',
      onConfirm: async () => {
        const actionKey = `delete:${targetUsername}`;
        setRankActionLoadingKey(actionKey);
        setRankBoardError(null);
        try {
          const res = await apiFetch(`${API_BASE}/users/admin/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              targetUsername
            })
          });
          if (!res.ok) {
            throw new Error(`Delete user failed: ${res.status}`);
          }
          setRankBoardRefreshKey((k) => k + 1);
        } catch (error) {
          console.error('Delete user error:', error);
          setRankBoardError('删除用户失败，请稍后重试。');
        } finally {
          setRankActionLoadingKey((key) => (key === actionKey ? null : key));
        }
      }
    });
  }, [isAdmin, currentUser]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const win: any = window as any;
    let timeoutId: number | null = null;
    let idleId: number | null = null;
    const loadTags = async () => {
      try {
        const res = await apiFetch(`${API_BASE}/tags`, { signal: controller.signal });
        if (!res.ok) {
          throw new Error(`Load tags failed: ${res.status}`);
        }
        const data = await res.json();
        if (!active) return;
        const tags = Array.isArray(data.tags) ? data.tags : [];
        setAllTags(tags);
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.error('Load tags error:', err);
      }
    };

    if (typeof win.requestIdleCallback === 'function') {
      idleId = win.requestIdleCallback(() => {
        void loadTags();
      }, { timeout: 2000 });
    } else {
      timeoutId = window.setTimeout(() => {
        void loadTags();
      }, 1200);
    }
    return () => {
      active = false;
      controller.abort();
      if (idleId !== null && typeof win.cancelIdleCallback === 'function') {
        win.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  useEffect(() => {
    const handler = window.setTimeout(() => {
      setSearchKeyword(searchQuery.trim());
      setCurrentPage(1);
    }, 300);
    return () => window.clearTimeout(handler);
  }, [searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedTag, sortBy]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    (async () => {
      try {
        const params = new URLSearchParams();
        params.set('summary', '1');
        params.set('page', String(currentPage));
        params.set('pageSize', String(POSTS_PER_PAGE));
        params.set('sort', sortBy);
        if (searchKeyword) params.set('search', searchKeyword);
        if (selectedTag) params.set('tag', selectedTag);
        const res = await apiFetch(`${API_BASE}/posts?${params.toString()}`, {
          signal: controller.signal
        });
        if (!res.ok) {
          throw new Error(`Load posts failed: ${res.status}`);
        }
        const data = await res.json();
        if (active) {
          setPosts(Array.isArray(data.posts) ? data.posts : []);
          const total = Number(data.total || 0);
          const nextTotalPages = Math.max(1, Math.ceil(total / POSTS_PER_PAGE));
          setTotalPages(nextTotalPages);
          if (currentPage > nextTotalPages) {
            setCurrentPage(nextTotalPages);
          }
        }
      } catch (error: any) {
        if (error?.name === 'AbortError') return;
        console.error('Load posts error:', error);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [currentPage, sortBy, selectedTag, searchKeyword, postsRefreshKey]);

  useEffect(() => {
    if (!currentUser) return;
    let lastTick = Date.now();
    let intervalId: number | null = null;

    const handleVisibility = () => {
      lastTick = Date.now();
    };

    const syncTime = async (deltaSeconds: number) => {
      if (!currentUser.username || deltaSeconds <= 0) return;
      try {
        const res = await apiFetch(`${API_BASE}/users/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deltaSeconds
          })
        });
        if (!res.ok) {
          if (res.status === 401) {
            try {
              const meRes = await apiFetch(`${API_BASE}/auth/me`);
              if (meRes.ok) {
                const meData = await meRes.json();
                const meUser = meData?.user;
                if (meUser) {
                  setCurrentUser({
                    id: Number(meUser.id),
                    username: String(meUser.username || currentUser.username),
                    password: currentUser.password,
                    isAdmin: Boolean(meUser.isAdmin),
                    rank: meUser.rank || currentUser.rank || '士兵',
                    totalSeconds: Number.isFinite(meUser.totalSeconds) ? Number(meUser.totalSeconds) : currentUser.totalSeconds
                  });
                  return;
                }
              }
            } catch (_error) {
              // keep default logout fallback below
            }
            setCurrentUser(null);
            openAuthModal('login', '登录状态已失效，请重新登录。');
            return;
          }
          if (res.status === 403) {
            const data = await res.json().catch(() => null);
            const bannedUntil = Number(data?.bannedUntil);
            const bannedText = Number.isFinite(bannedUntil) && bannedUntil > Date.now()
              ? (isPermanentBan(bannedUntil)
                  ? '账号已被封禁，请联系管理员解除。'
                  : `账号已被封禁，解封时间：${formatDateTime(bannedUntil)}`)
              : '账号已被封禁，请联系管理员。';
            setCurrentUser(null);
            openAuthModal('login', bannedText);
          }
          return;
        }
        const data = await res.json();
        const nextRank = typeof data?.rank === 'string' ? data.rank : undefined;
        const allowRankUpdate = shouldSyncRank(currentUser.rank, nextRank);
        if (data?.rank || Number.isFinite(data?.totalSeconds)) {
          setCurrentUser(prev => prev ? {
            ...prev,
            rank: allowRankUpdate ? (nextRank ?? prev.rank) : prev.rank,
            totalSeconds: Number.isFinite(data.totalSeconds) ? data.totalSeconds : prev.totalSeconds
          } : prev);
        }
        if (allowRankUpdate && data?.upgraded && data?.fromRank && data?.toRank) {
          const duration = formatDuration(Number(data.totalSeconds || 0));
          openRankNotice(`${currentUser.username}${data.fromRank}，您在领航者空间站执行任务时长已达${duration}，军衔升至${data.toRank}`);
        }
      } catch (error) {
        console.error('Rank sync error:', error);
      }
    };

    intervalId = window.setInterval(() => {
      if (document.hidden) {
        lastTick = Date.now();
        return;
      }
      const now = Date.now();
      const deltaSeconds = Math.floor((now - lastTick) / 1000);
      if (deltaSeconds <= 0) return;
      lastTick = now;
      void syncTime(deltaSeconds);
    }, 5000);

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      if (intervalId) window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [currentUser, formatDuration, openRankNotice, openAuthModal, formatDateTime, isPermanentBan]);

  const toggleMusic = useCallback(() => {
    const audio = document.getElementById('bgm') as HTMLAudioElement;
    if (isMusicPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => console.log('Audio requires user interaction'));
    }
    setIsMusicPlaying(!isMusicPlaying);
  }, [isMusicPlaying]);

  const handleLogout = useCallback(async () => {
    if (!currentUser) return;
    try {
      await apiFetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        keepalive: true
      });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setCurrentUser(null);
      void fetchOnlineCount();
    }
  }, [currentUser, fetchOnlineCount]);

  const paginatedPosts = posts;

  const handleLike = useCallback(async (id: string) => {
    if (!currentUser) {
      openAuthModal('login', '请先登录后再互动。');
      return;
    }
    try {
      const res = await apiFetch(`${API_BASE}/posts/${id}/like`, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`Like failed: ${res.status}`);
      }
      const data = await res.json();
      setPosts(prev => prev.map(p => p.id === id ? { ...p, likes: data.likes ?? p.likes } : p));
    } catch (error) {
      console.error('Like Error:', error);
    }
  }, [currentUser, openAuthModal]);

  const uploadImage = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await apiFetch(`${API_BASE}/uploads`, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) {
      throw new Error(`Upload failed: ${res.status}`);
    }
    const data = await res.json();
    return data.url as string;
  }, []);

  const handleAddComment = useCallback(async (postId: string, comment: string, imageUrl?: string) => {
    if (!currentUser) {
      openAuthModal('login', '请先登录后再发表评论。');
      return false;
    }
    if (!comment.trim() && !imageUrl) return false;
    try {
      const res = await apiFetch(`${API_BASE}/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: comment,
          imageUrl: imageUrl || null
        })
      });
      if (!res.ok) {
        throw new Error(`Add comment failed: ${res.status}`);
      }
      await res.json();
      setPosts(prev => prev.map(p => p.id === postId ? {
        ...p,
        commentCount: (p.commentCount ?? p.comments.length) + 1
      } : p));
      return true;
    } catch (error) {
      console.error('Add Comment Error:', error);
      return false;
    }
  }, [currentUser, openAuthModal]);

  const handleLikeComment = useCallback(async (postId: string, commentId: string) => {
    if (!currentUser) {
      openAuthModal('login', '请先登录后再互动。');
      return null;
    }
    try {
      const res = await apiFetch(`${API_BASE}/comments/${commentId}/like`, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`Like comment failed: ${res.status}`);
      }
      const data = await res.json();
      setPosts(prev => prev.map(p =>
        p.id === postId
          ? { ...p, comments: p.comments.map(c => c.id === commentId ? { ...c, likes: data.likes ?? c.likes } : c) }
          : p
      ));
      return Number.isFinite(data?.likes) ? data.likes : null;
    } catch (error) {
      console.error('Like Comment Error:', error);
      return null;
    }
  }, [currentUser, openAuthModal]);

  const handleDeleteComment = useCallback((postId: string, commentId: string) => {
    if (!isAdmin || !currentUser) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      setConfirmModal({
        isOpen: true,
        title: 'MOSS WARNING: DELETE COMMENT',
        message: 'Confirm delete this comment?',
        onConfirm: async () => {
          try {
            const res = await apiFetch(`${API_BASE}/posts/${postId}/comments/${commentId}`, {
              method: 'DELETE'
            });
            if (!res.ok) {
              throw new Error(`Delete comment failed: ${res.status}`);
            }
            setPosts(prev => prev.map(p =>
              p.id === postId
                ? {
                    ...p,
                    comments: p.comments.filter(c => c.id !== commentId),
                    commentCount: Math.max(0, (p.commentCount ?? p.comments.length) - 1)
                  }
                : p
            ));
            resolve(true);
          } catch (error) {
            console.error('Delete Comment Error:', error);
            resolve(false);
          }
        }
      });
    });
  }, [isAdmin, currentUser]);

  const handleDeletePost = (id: string) => {
    if (!id || !isAdmin || !currentUser) return;
    setConfirmModal({
      isOpen: true,
      title: 'MOSS WARNING: DELETE POST',
      message: 'Confirm delete this post?',
      onConfirm: async () => {
        try {
          const res = await apiFetch(`${API_BASE}/posts/${id}`, {
            method: 'DELETE'
          });
          if (!res.ok) {
            throw new Error(`Delete post failed: ${res.status}`);
          }
          setPosts(currentPosts => currentPosts.filter(p => p.id !== id));
          if (selectedPostId === id) setSelectedPostId(null);
          setPostsRefreshKey(key => key + 1);
        } catch (error) {
          console.error('Delete Post Error:', error);
        }
      }
    });
  };

  const handleAuth = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const username = authUsername.trim();
    const password = authPassword;
    setAuthError(null);
    setAuthInfo(null);
    if (!username || !password) {
      setAuthError('请输入账号和密码');
      return;
    }

    if (authMode === 'register') {
      if (password !== authConfirmPassword) {
        setAuthError('两次输入的密码不一致');
        return;
      }
      try {
        const registerRes = await apiFetch(`${API_BASE}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        if (registerRes.ok) {
          setAuthMode('login');
          setAuthPassword('');
          setAuthConfirmPassword('');
          setAuthInfo('注册成功，请登录');
          return;
        }
        if (registerRes.status === 409) {
          setAuthError('用户名已存在');
          return;
        }
        setAuthError('注册失败，请稍后重试。');
        return;
      } catch (error) {
        console.error('Register Error:', error);
        setAuthError('服务器不可用，请稍后重试。');
        return;
      }
    }

    try {
      const loginRes = await apiFetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (loginRes.ok) {
        const data = await loginRes.json();
        const serverUser = data?.user || {};
        const newUser: UserData = {
          id: Number(serverUser.id),
          username: String(serverUser.username || username),
          password,
          isAdmin: Boolean(serverUser.isAdmin),
          rank: serverUser.rank || '士兵',
          totalSeconds: Number.isFinite(serverUser.totalSeconds) ? Number(serverUser.totalSeconds) : 0
        };
        setCurrentUser(newUser);
        setShowAuth(false);
        setAuthError(null);
        setAuthInfo(null);
        openWelcome(newUser.username, newUser.rank);
        void fetchOnlineCount();
        return;
      }

      if (loginRes.status === 404) {
        setAuthError('用户不存在');
        return;
      }

      if (loginRes.status === 401) {
        setAuthError('密码输入错误');
        return;
      }

      if (loginRes.status === 403) {
        const data = await loginRes.json().catch(() => null);
        const bannedUntil = Number(data?.bannedUntil);
        if (Number.isFinite(bannedUntil) && bannedUntil > Date.now()) {
          setAuthError(isPermanentBan(bannedUntil)
            ? '账号已被封禁，请联系管理员解除。'
            : `账号已被封禁，解封时间：${formatDateTime(bannedUntil)}`);
        } else {
          setAuthError('账号已被封禁，请联系管理员。');
        }
        return;
      }

      setAuthError('登录失败，请稍后重试。');
    } catch (error) {
      console.error('Auth Error:', error);
      setAuthError('服务器不可用，请稍后重试。');
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageUploading(true);
      setImageUploadError(null);
      try {
        const url = await uploadImage(file);
        setUploadedImageUrl(url);
      } catch (error) {
        console.error('Upload image error:', error);
        setImageUploadError('图片上传失败，请稍后重试。');
      } finally {
        setImageUploading(false);
      }
    }
  };

  const handleSavePost = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isAdmin || !currentUser) return;
    const formData = new FormData(e.currentTarget);
    const title = formData.get('title') as string;
    const content = formData.get('content') as string;
    const tagsInput = formData.get('tags') as string;
    const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
    let finalExcerpt = editingPost?.excerpt || '';
    if (!editingPost || editingPost.content !== content) {
      try {
        const { generateExcerpt } = await loadGeminiService();
        finalExcerpt = await generateExcerpt(title, content);
      } catch (error) {
        console.error('Load excerpt service error:', error);
        finalExcerpt = '矩阵未能生成摘要。';
      }
    }
    const currentImage = uploadedImageUrl || editingPost?.imageUrl || DEFAULT_COVER;

    try {
      if (editingPost) {
        const res = await apiFetch(`${API_BASE}/posts/${editingPost.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            content,
            excerpt: finalExcerpt,
            tags,
            imageUrl: currentImage
          })
        });
        if (!res.ok) {
          throw new Error(`Update post failed: ${res.status}`);
        }
        setPosts(prev => prev.map(p => p.id === editingPost.id ? {
          ...p, title, content, tags, excerpt: finalExcerpt, imageUrl: currentImage
        } : p));
        setAllTags(prev => Array.from(new Set([...prev, ...tags])));
        setPostsRefreshKey(key => key + 1);
      } else {
        const res = await apiFetch(`${API_BASE}/posts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            content,
            excerpt: finalExcerpt,
            tags,
            imageUrl: currentImage
          })
        });
        if (!res.ok) {
          throw new Error(`Create post failed: ${res.status}`);
        }
        const data = await res.json();
        const newPost = data.post;
        setPosts(prev => [{ ...newPost, commentCount: 0 }, ...prev]);
        setAllTags(prev => Array.from(new Set([...prev, ...tags])));
        setPostsRefreshKey(key => key + 1);
      }
    } catch (error) {
      console.error('Save Post Error:', error);
    }

    setIsEditorOpen(false);
    setEditingPost(null);
    setUploadedImageUrl(null);
    window.requestAnimationFrame(() => {
      ensureRocketCursorEnabled();
    });
  };

  const viewPost = useCallback((id: string) => {
    setSelectedPostId(id);
    setPosts(prev => prev.map(p => p.id === id ? { ...p, views: p.views + 1 } : p));
    apiFetch(`${API_BASE}/posts/${id}/view`, { method: 'POST' })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data) return;
        setPosts(prev => prev.map(p => p.id === id ? { ...p, views: data.views ?? p.views } : p));
      })
      .catch(err => console.error('View Error:', err));

    const target = posts.find(p => p.id === id);
    const needsDetail = !target || !target.content;
    if (needsDetail) {
      setPostDetailLoadingId(id);
      apiFetch(`${API_BASE}/posts/${id}`)
        .then(res => res.ok ? res.json() : Promise.reject(new Error(`Load post failed: ${res.status}`)))
        .then(data => {
          const fullPost = data?.post;
          if (!fullPost) return;
          setPosts(prev => {
            const exists = prev.some(p => p.id === id);
            if (!exists) return [fullPost, ...prev];
            return prev.map(p => p.id === id ? { ...p, ...fullPost } : p);
          });
        })
        .catch(err => console.error('Load post detail error:', err))
        .finally(() => setPostDetailLoadingId(current => current === id ? null : current));
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [posts]);

  const currentPost = useMemo(() => posts.find(p => p.id === selectedPostId), [posts, selectedPostId]);

  return (
    <>
      <div ref={rocketFlameRef} className="rocket-flame" aria-hidden="true" />
      <MossChat username={currentUser?.username} rank={getUserRankLabel(currentUser)} />
      {/* 全局确认弹窗 */}
      <CyberConfirmModal 
        {...confirmModal} 
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))} 
      />

      {showAuth && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/95 backdrop-blur-md p-4 animate-in fade-in zoom-in-95 duration-300 modal-backdrop">
          <div className="cyber-border-red bg-black w-full max-w-md p-8 relative shadow-[0_0_50px_rgba(255,0,0,0.3)]">
            <button onClick={() => setShowAuth(false)} className="absolute top-4 right-4 text-red-500 hover:text-white"><X size={24}/></button>
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-red-600 mx-auto mb-4 flex items-center justify-center font-bold text-2xl text-white shadow-[0_0_20px_rgba(255,0,0,0.5)] uppercase font-orbitron">LX</div>
              <h2 className="text-2xl font-orbitron text-red-500 uppercase tracking-widest cyber-glow-red">
                {authMode === 'login' ? 'Terminal Access' : 'Terminal Register'}
              </h2>
              <p className="text-[10px] text-red-900 font-mono mt-1 uppercase">Unified Government Identification Protocol</p>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-6">
              <button
                type="button"
                onClick={() => switchAuthMode('login')}
                className={`py-2 text-xs font-orbitron uppercase tracking-widest border transition-colors ${
                  authMode === 'login'
                    ? 'border-red-500 bg-red-900/30 text-red-300'
                    : 'border-red-900/60 text-red-700 hover:text-red-400 hover:border-red-700'
                }`}
              >
                登录
              </button>
              <button
                type="button"
                onClick={() => switchAuthMode('register')}
                className={`py-2 text-xs font-orbitron uppercase tracking-widest border transition-colors ${
                  authMode === 'register'
                    ? 'border-red-500 bg-red-900/30 text-red-300'
                    : 'border-red-900/60 text-red-700 hover:text-red-400 hover:border-red-700'
                }`}
              >
                注册
              </button>
            </div>
            <form onSubmit={handleAuth} className="space-y-6">
              <div className="space-y-1">
                <label className="text-[10px] text-red-600 uppercase font-orbitron tracking-widest flex items-center gap-2"><User size={12}/> Identifier</label>
                <input
                  required
                  placeholder="USERNAME_STRING..."
                  value={authUsername}
                  onChange={(e) => {
                    setAuthUsername(e.target.value);
                    if (authError) setAuthError(null);
                    if (authInfo) setAuthInfo(null);
                  }}
                  className="w-full bg-black/40 border border-red-500/30 p-3 text-red-400 focus:outline-none focus:border-red-500 font-mono placeholder-red-900 transition-all"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-red-600 uppercase font-orbitron tracking-widest flex items-center gap-2"><Lock size={12}/> Encryption Key</label>
                <input
                  type="password"
                  required
                  placeholder="PASSWORD_MODULE..."
                  value={authPassword}
                  onChange={(e) => {
                    setAuthPassword(e.target.value);
                    if (authError) setAuthError(null);
                    if (authInfo) setAuthInfo(null);
                  }}
                  className="w-full bg-black/40 border border-red-500/30 p-3 text-red-400 focus:outline-none focus:border-red-500 font-mono placeholder-red-900 transition-all"
                />
              </div>
              {authMode === 'register' && (
                <div className="space-y-1">
                  <label className="text-[10px] text-red-600 uppercase font-orbitron tracking-widest flex items-center gap-2"><Lock size={12}/> Confirm Key</label>
                  <input
                    type="password"
                    required
                    placeholder="CONFIRM_PASSWORD..."
                    value={authConfirmPassword}
                    onChange={(e) => {
                      setAuthConfirmPassword(e.target.value);
                      if (authError) setAuthError(null);
                      if (authInfo) setAuthInfo(null);
                    }}
                    className="w-full bg-black/40 border border-red-500/30 p-3 text-red-400 focus:outline-none focus:border-red-500 font-mono placeholder-red-900 transition-all"
                  />
                </div>
              )}
              {authError && (
                <div className="border border-red-700/60 bg-red-950/40 p-3 text-xs text-red-200 font-mono" role="alert">
                  {authError}
                </div>
              )}
              {authInfo && (
                <div className="border border-emerald-700/60 bg-emerald-950/40 p-3 text-xs text-emerald-200 font-mono" role="status">
                  {authInfo}
                </div>
              )}
              <div className="pt-4 space-y-3">
                <CyberButton type="submit" variant="secondary" className="w-full py-4 text-lg">
                  {authMode === 'login' ? '执行终端接入' : '执行注册'}
                </CyberButton>
                <button
                  type="button"
                  onClick={() => switchAuthMode(authMode === 'login' ? 'register' : 'login')}
                  className="w-full text-[10px] text-red-700 hover:text-red-400 font-orbitron uppercase tracking-widest transition-colors"
                >
                  {authMode === 'login' ? '没有账号？前往注册' : '已有账号？前往登录'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showWelcome && welcomeUser && (
        <div className={`fixed inset-0 z-[220] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 ${welcomeFading ? 'opacity-0 transition-opacity duration-700' : 'opacity-100'} modal-backdrop`}>
          <div className="cyber-border-red bg-black w-full max-w-md p-8 relative shadow-[0_0_50px_rgba(255,0,0,0.3)]">
            <button
              onClick={() => setShowWelcome(false)}
              className="absolute top-4 right-4 text-red-500 hover:text-white"
            >
              <X size={24} />
            </button>
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-600 mx-auto flex items-center justify-center font-bold text-2xl text-white shadow-[0_0_20px_rgba(255,0,0,0.5)] uppercase font-orbitron">LX</div>
              <h2 className="text-2xl font-orbitron text-red-500 uppercase tracking-widest cyber-glow-red">欢迎回来</h2>
              <p className="text-sm text-red-200/80 font-mono">欢迎回来，{welcomeUser}{welcomeRank || getUserRankLabel(currentUser)}</p>
            </div>
            <div className="pt-6">
              <CyberButton variant="secondary" className="w-full" onClick={() => setShowWelcome(false)}>
                进入终端
              </CyberButton>
            </div>
          </div>
        </div>
      )}

      {rankNotice.visible && (
        <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/70 backdrop-blur-md p-4 modal-backdrop">
          <div className="cyber-border-red bg-black w-full max-w-lg p-6 relative shadow-[0_0_40px_rgba(255,0,0,0.4)]">
            <button
              onClick={() => setRankNotice({ visible: false, message: '' })}
              className="absolute top-4 right-4 text-red-500 hover:text-white"
            >
              <X size={20} />
            </button>
            <div className="flex items-center gap-3 text-red-500 mb-4">
              <Zap size={18} />
              <h2 className="text-lg font-orbitron font-bold tracking-widest uppercase">Rank Upgrade</h2>
            </div>
            <p className="text-sm text-red-200/90 font-mono leading-relaxed">
              {rankNotice.message}
            </p>
            <div className="pt-6">
              <CyberButton variant="secondary" className="w-full" onClick={() => setRankNotice({ visible: false, message: '' })}>
                确认
              </CyberButton>
            </div>
          </div>
        </div>
      )}

      {showRankBoard && (
        <div className="rank-board-modal fixed inset-0 z-[210] flex items-start sm:items-center justify-center bg-black/90 backdrop-blur-md p-0 sm:p-4 animate-in fade-in duration-300 modal-backdrop">
          <div className={`rank-board-panel cyber-border-red bg-black w-full ${isAdmin ? 'max-w-5xl' : 'max-w-2xl'} p-4 sm:p-6 pt-10 relative shadow-[0_0_50px_rgba(255,0,0,0.3)] max-h-[calc(100vh-2rem)] overflow-y-auto`}>
            <button
              onClick={() => setShowRankBoard(false)}
              className="absolute top-3 right-3 text-red-500 hover:text-white"
              aria-label="关闭军衔榜"
            >
              <X size={24}/>
            </button>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-orbitron text-red-500 uppercase tracking-widest flex items-center gap-2">
                <ShieldCheck size={20} /> 军衔榜
              </h2>
              <CyberButton variant="secondary" onClick={() => setRankBoardRefreshKey(k => k + 1)} className="text-xs sm:text-sm px-2.5 sm:px-3 py-2">
                刷新
              </CyberButton>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h3 className="text-sm font-orbitron text-red-400 uppercase tracking-widest">Ranking</h3>
                <div className="border border-red-600/30 bg-black/40 p-2.5 sm:p-3 min-h-[200px]">
                  {rankBoardLoading && (
                    <p className="text-sm text-red-400 font-mono">加载中...</p>
                  )}
                  {!rankBoardLoading && rankBoardError && (
                    <p className="text-sm text-red-300 font-mono">{rankBoardError}</p>
                  )}
                  {!rankBoardLoading && !rankBoardError && rankBoard.length === 0 && (
                    <p className="text-sm text-red-400 font-mono">暂无数据</p>
                  )}
                  {!rankBoardLoading && !rankBoardError && rankBoard.length > 0 && (
                    <div className="space-y-2 text-xs sm:text-sm text-red-200 font-mono rank-board-scroll overflow-x-hidden">
                      <div
                        className={`rank-board-grid grid items-center gap-2 text-xs text-red-500 border-b border-red-900/40 pb-1 ${isAdmin ? 'rank-board-grid-admin' : 'rank-board-grid-user'}`}
                      >
                        {isAdmin ? (
                          <>
                            <span>#</span>
                            <span className="whitespace-nowrap">用户名</span>
                            <span className="text-right">军衔</span>
                            <span className="text-right">最近登录</span>
                          </>
                        ) : (
                          <>
                            <span className="whitespace-nowrap">用户名</span>
                            <span className="text-center">军衔</span>
                            <span className="text-center">已执行任务</span>
                          </>
                        )}
                      </div>

                      {rankBoardVisibleItems.map((item, index) => {
                        const listIndex = (rankBoardPage - 1) * RANK_BOARD_PAGE_SIZE + index + 1;
                        const isTargetAdmin = Boolean(item.isAdmin);
                        const isBanned = Number(item.bannedUntil) > Date.now();
                        const isPermanentBannedUser = isPermanentBan(item.bannedUntil);
                        const banActionKey = `ban:${item.username}`;
                        const unbanActionKey = `unban:${item.username}`;
                        const deleteActionKey = `delete:${item.username}`;
                        const actionBusy = rankActionLoadingKey === banActionKey
                          || rankActionLoadingKey === unbanActionKey
                          || rankActionLoadingKey === deleteActionKey;
                        return (
                          <div key={item.username} className="border-b border-red-900/40 pb-2">
                            <div
                              className={`rank-board-row grid items-center gap-2 ${isAdmin ? 'rank-board-grid-admin' : 'rank-board-grid-user'}`}
                            >
                              {isAdmin ? (
                                <>
                                  <span className="text-red-500">{listIndex}</span>
                                  <span className="min-w-0 truncate" title={item.username}>{item.username}</span>
                                  <span className="text-right text-red-300 whitespace-nowrap">{item.rank}</span>
                                  <span className="text-right text-red-500 text-[11px] sm:text-sm whitespace-nowrap">{formatDateTime(item.lastLoginAt)}</span>
                                </>
                              ) : (
                                <>
                                  <span className="min-w-0 truncate" title={item.username}>{listIndex}. {item.username}</span>
                                  <span className="text-center text-red-300 whitespace-nowrap">{item.rank}</span>
                                  <span className="text-center text-red-600 whitespace-nowrap">{item.totalSeconds}秒</span>
                                </>
                              )}
                            </div>

                            {isAdmin && (
                              <div className="mt-2 pl-8 flex flex-wrap items-center justify-between gap-2">
                                <span className="text-[11px] text-red-600">已执行任务{item.totalSeconds}秒</span>
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                  <span className={`text-[11px] ${isBanned ? 'text-orange-400' : 'text-red-700'}`}>
                                    {isBanned
                                      ? (isPermanentBannedUser ? '已封禁（待解除）' : `封禁至 ${formatDateTime(item.bannedUntil)}`)
                                      : '状态正常'}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={isTargetAdmin || actionBusy || isBanned}
                                    onClick={() => handleAdminBanUser(item, 'ban')}
                                    className={`px-2 py-1 border text-[10px] disabled:opacity-40 transition-colors ${
                                      isBanned
                                        ? 'border-orange-900/40 text-orange-900'
                                        : 'border-orange-500/50 text-orange-300 hover:bg-orange-500/10'
                                    }`}
                                  >
                                    封禁
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isTargetAdmin || actionBusy || !isBanned}
                                    onClick={() => handleAdminBanUser(item, 'unban')}
                                    className={`px-2 py-1 border text-[10px] disabled:opacity-40 transition-colors ${
                                      isBanned
                                        ? 'border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10'
                                        : 'border-emerald-900/40 text-emerald-900'
                                    }`}
                                  >
                                    解除
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isTargetAdmin || actionBusy}
                                    onClick={() => handleAdminDeleteUser(item)}
                                    className="px-2 py-1 border text-[10px] border-red-500/50 text-red-300 disabled:opacity-40 hover:bg-red-500/10 transition-colors"
                                  >
                                    删除
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {rankBoard.length > RANK_BOARD_PAGE_SIZE && (
                        <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[10px] text-red-600 font-mono">PAGE {rankBoardPage} / {rankBoardTotalPages}</span>
                          <div className="flex items-center gap-2">
                            <CyberButton
                              variant="secondary"
                              className="px-2 py-1 text-[10px]"
                              disabled={rankBoardPage === 1}
                              onClick={() => setRankBoardPage((p) => Math.max(1, p - 1))}
                            >
                              上一页
                            </CyberButton>
                            <CyberButton
                              variant="secondary"
                              className="px-2 py-1 text-[10px]"
                              disabled={rankBoardPage >= rankBoardTotalPages}
                              onClick={() => setRankBoardPage((p) => Math.min(rankBoardTotalPages, p + 1))}
                            >
                              下一页
                            </CyberButton>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-3">
                <h3 className="text-sm font-orbitron text-red-400 uppercase tracking-widest">Rank Guide</h3>
                <div className="border border-red-600/30 bg-black/40 p-3 space-y-2 text-sm text-red-200 font-mono">
                  {RANK_RULES.map((rule, index) => (
                    <div key={rule.name} className="flex items-center justify-between border-b border-red-900/40 pb-1 last:border-b-0">
                      <span>{rule.name}</span>
                      <span>{index === 0 ? '初始' : `累计 ${formatDuration(rule.thresholdSeconds)}`}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-red-600 font-mono leading-relaxed">
                  任务时长按登录后实际浏览时间累计，后台每 5 秒同步一次。
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {isEditorOpen && isAdmin && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/95 backdrop-blur-sm p-4 animate-in fade-in duration-300 modal-backdrop">
          <div className="cyber-border-red bg-black w-full max-w-2xl p-6 relative max-h-[90vh] overflow-y-auto shadow-2xl">
            <h2 className="text-xl font-orbitron text-red-500 mb-6 flex items-center gap-2 uppercase tracking-widest"><Cpu className="w-5 h-5" /> {editingPost ? '修订广播内容' : '发起系统广播'}</h2>
            <form onSubmit={handleSavePost} className="space-y-4">
              <div>
                <label className="block text-xs text-red-600 mb-1 font-orbitron uppercase tracking-widest">Broadcast Title</label>
                <input name="title" defaultValue={editingPost?.title} required className="w-full bg-black/40 border border-red-500/30 p-2 text-red-400 focus:outline-none focus:border-red-500" />
              </div>
              <div>
                <label className="block text-xs text-red-600 mb-1 font-orbitron uppercase tracking-widest">Classifiers</label>
                <input name="tags" defaultValue={editingPost?.tags.join(', ')} className="w-full bg-black/40 border border-red-500/30 p-2 text-red-400 focus:outline-none focus:border-red-500" placeholder="用逗号分隔..." />
              </div>
              <div>
                <label className="block text-xs text-red-600 mb-1 font-orbitron uppercase tracking-widest">Log Data</label>
                <textarea name="content" defaultValue={editingPost?.content} required rows={6} className="w-full bg-black/40 border border-red-500/30 p-2 text-red-400 focus:outline-none focus:border-red-500 font-mono text-sm" />
              </div>
              <div>
                <label className="block text-xs text-red-600 mb-2 font-orbitron uppercase tracking-widest">Cover Image</label>
                <div className="flex items-center gap-3">
                  <label className="cursor-pointer text-red-500 hover:text-white transition-colors flex items-center gap-2 text-xs font-mono uppercase">
                    <Upload size={16} />
                    <span>{imageUploading ? '上传中...' : '上传封面'}</span>
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" disabled={imageUploading} />
                  </label>
                  {(uploadedImageUrl || editingPost?.imageUrl) && (
                    <button
                      type="button"
                      onClick={() => setUploadedImageUrl(null)}
                      className="text-[10px] text-orange-400 uppercase font-orbitron tracking-widest hover:text-orange-300 transition-colors"
                    >
                      移除
                    </button>
                  )}
                </div>
                {imageUploadError && (
                  <div className="text-[10px] text-orange-500 font-mono mt-2">{imageUploadError}</div>
                )}
                {(uploadedImageUrl || editingPost?.imageUrl) && (
                  <div className="mt-3 border border-red-500/20 bg-black/40 p-2">
                    <img
                      src={uploadedImageUrl || editingPost?.imageUrl}
                      className="w-full max-h-64 object-cover opacity-80"
                      alt="Cover Preview"
                    />
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-3 mt-8">
                <CyberButton variant="danger" onClick={() => setIsEditorOpen(false)}>中止传输</CyberButton>
                <CyberButton type="submit" variant="moss">执行广播</CyberButton>
              </div>
            </form>
          </div>
        </div>
      )}
      <div className="max-w-6xl mx-auto px-4 py-8 relative min-h-screen app-scale">
        <div className="mb-6">
          <div className="cyber-border-red bg-black/50 px-4 py-3 text-[11px] font-mono text-red-300 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <span>{uptimeText || '已稳定运行 0 天 0 时 0 分 0 秒'}</span>
            <span>当前在港人数 {onlineCount} 人</span>
          </div>
        </div>
      
      {/* 头部 */}
      <header className="flex flex-col md:flex-row justify-between items-center mb-12 gap-6 pb-6 border-b border-red-500/30">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => {setSelectedPostId(null); setSelectedTag(null);}}>
          <div className="w-12 h-12 bg-red-600 rounded-sm flex items-center justify-center font-bold text-white shadow-[0_0_15px_rgba(255,0,0,0.5)] uppercase font-orbitron">LX</div>
          <div>
            <h1 className="text-3xl font-orbitron font-bold cyber-glow-red tracking-widest text-red-500">LXBLOG</h1>
            <p className="text-xs text-red-500/60 uppercase tracking-tighter">领航者空间站核心枢纽 // MOSS 接管中</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={toggleMusic} className="p-2 border border-red-500/40 text-red-500 hover:text-white transition-colors">
            {isMusicPlaying ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
          <CyberButton onClick={() => setShowRankBoard(true)} variant="secondary" className="px-3 py-2 text-xs">
            军衔榜
          </CyberButton>
          {currentUser ? (
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-end">
                <span className="text-[10px] text-red-900 uppercase font-mono tracking-tighter">Connected Node</span>
                <span className="text-sm font-orbitron text-red-400 flex items-center gap-1">
                  {isAdmin && <ShieldCheck size={14} className="text-red-600" />} {currentUser.username}{getUserRankLabel(currentUser)}
                </span>
              </div>
              {isAdmin && (
                <CyberButton onClick={() => { setEditingPost(null); setUploadedImageUrl(null); setIsEditorOpen(true); }} variant="moss">
                  <Plus className="w-4 h-4 inline mr-2" /> 系统广播
                </CyberButton>
              )}
              <CyberButton onClick={handleLogout} variant="danger">
                <LogOut className="w-4 h-4 inline mr-2" /> 撤销接入
              </CyberButton>
            </div>
          ) : (
            <CyberButton onClick={() => openAuthModal('login')} variant="secondary">
              <LogIn className="w-4 h-4 inline mr-2" /> 终端接入
            </CyberButton>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <aside className="lg:col-span-1 space-y-8 order-2 lg:order-1">
          <div className="cyber-border-red p-4 bg-black/40">
            <h3 className="text-sm font-orbitron text-red-500 mb-4 flex items-center gap-2 uppercase tracking-wider">
              <Search className="w-4 h-4" /> Indexing
            </h3>
            <input 
              type="text" 
              placeholder="搜索系统日志..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-black/60 border border-red-500/30 p-2 text-sm text-red-400 focus:outline-none focus:border-red-500 placeholder-red-900"
            />
          </div>
          <div className="cyber-border-red p-4 bg-black/40">
            <h3 className="text-sm font-orbitron text-red-500 mb-4 flex items-center gap-2 uppercase tracking-wider">
              <ArrowUpDown className="w-4 h-4" /> Sorting
            </h3>
            <select 
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="w-full bg-black border border-red-500/30 p-2 text-sm text-red-400 focus:outline-none focus:border-red-500"
            >
              <option value="newest">最新日志 (TIME)</option>
              <option value="oldest">历史记录 (ARCHIVE)</option>
              <option value="likes">资源权重 (LIKES)</option>
              <option value="views">全民关注 (VIEWS)</option>
            </select>
          </div>
          <div className="cyber-border-red p-4 bg-black/40">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-orbitron text-red-500 flex items-center gap-2 uppercase tracking-wider">
                <TagIcon className="w-4 h-4" /> Sectors
              </h3>
              {selectedTag && (
                <button onClick={() => setSelectedTag(null)} className="text-[10px] text-orange-400 underline">重置</button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {allTags.map(tag => (
                <Tag key={tag} label={tag} active={selectedTag === tag} onClick={setSelectedTag} />
              ))}
            </div>
          </div>
          <div className="cyber-border-red p-4 bg-black/20 text-[10px] text-red-900 font-mono leading-relaxed space-y-3">
            <div className="border-b border-red-900/30 pb-2">
              <p>TERMINAL: LXBLOG_V4</p>
              <p>STATUS: THE_SUN_IS_DYING</p>
            </div>
            <div className="space-y-2">
              <p className="text-red-500/80 uppercase font-bold tracking-widest text-[9px]">System Brief</p>
              <p className="text-red-700 leading-normal italic">
                This personal blog is a sci-fi archive themed after "The Wandering Earth". 
                It functions as a decentralized record for LX, logging planetary propulsion updates.
              </p>
            </div>
            <div className="pt-2 opacity-50 space-y-1">
              <p>PLANET_STATUS: DRIVING</p>
              <p>MOSS_STATUS: ONLINE</p>
            </div>
          </div>
        </aside>

        <main className="lg:col-span-3 order-1 lg:order-2 space-y-6">
          {selectedPostId ? (
            currentPost && postDetailLoadingId !== selectedPostId ? (
              <PostDetail 
                post={currentPost}
                onBack={() => setSelectedPostId(null)}
                onLike={() => handleLike(selectedPostId)}
                onAddComment={(msg, img) => handleAddComment(selectedPostId, msg, img)}
                onLikeComment={(commentId) => handleLikeComment(selectedPostId, commentId)}
                onDeleteComment={(commentId) => handleDeleteComment(selectedPostId, commentId)}
                isAdmin={isAdmin}
                onDelete={() => handleDeletePost(selectedPostId)}
                onEdit={() => { 
                  setEditingPost(currentPost); 
                  setUploadedImageUrl(null);
                  setIsEditorOpen(true); 
                }}
                onUploadImage={uploadImage}
              />
            ) : (
              <div className="cyber-border-red bg-black/40 p-8 text-center text-red-500 font-orbitron uppercase tracking-widest">
                Loading Data Sector...
              </div>
            )
          ) : (
            <>
              <div className="space-y-6">
                {paginatedPosts.length > 0 ? paginatedPosts.map(post => (
                  <ArticleCard 
                    key={post.id} 
                    post={post} 
                    onClick={() => viewPost(post.id)}
                    onLike={(e) => { e.stopPropagation(); handleLike(post.id); }}
                    isAdmin={isAdmin}
                    onDelete={() => handleDeletePost(post.id)}
                    onEdit={(e) => { 
                      e.stopPropagation(); 
                      setEditingPost(post); 
                      setUploadedImageUrl(null);
                      setIsEditorOpen(true); 
                    }}
                  />
                )) : (
                  <div className="text-center py-20 cyber-border-red bg-black/40 font-orbitron text-red-900 uppercase tracking-widest">
                    No matching logs found in terminal.
                  </div>
                )}
              </div>
              {totalPages > 1 && (
                <div className="flex justify-center items-center gap-4 py-6">
                  <CyberButton onClick={() => setCurrentPage(p => Math.max(1, p - 1))} className={currentPage === 1 ? 'opacity-30' : ''}>
                    <ChevronLeft className="w-4 h-4" />
                  </CyberButton>
                  <span className="font-orbitron text-red-400 text-sm tracking-wider">ARCHIVE_SLICE {currentPage} / {totalPages}</span>
                  <CyberButton onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} className={currentPage === totalPages ? 'opacity-30' : ''}>
                    <ChevronRight className="w-4 h-4" />
                  </CyberButton>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      </div>
    </>
  );
}

const ArticleCard = React.memo<{ 
  post: Post; 
  onClick: () => void; 
  onLike: (e: React.MouseEvent) => void; 
  isAdmin: boolean; 
  onDelete: () => void; 
  onEdit: (e: React.MouseEvent) => void; 
}>(({ post, onClick, onLike, isAdmin, onDelete, onEdit }) => {
  const listImageSrc = post.imageThumbUrl || post.imageUrl;
  return (
  <article onClick={onClick} className="cyber-card cyber-border-red bg-black/40 overflow-hidden flex flex-col md:flex-row group cursor-pointer transition-all duration-300 hover:bg-black/60 shadow-lg">
    {listImageSrc && (
      <div className="w-full md:w-48 h-48 md:h-auto overflow-hidden shrink-0 bg-black/50 flex items-center justify-center border-r border-red-900/30">
        <img
          src={listImageSrc}
          loading="lazy"
          decoding="async"
          fetchPriority="low"
          className="w-full h-full object-cover grayscale opacity-60 group-hover:opacity-100 group-hover:grayscale-0 transition-all duration-500"
          alt={post.title}
        />
      </div>
    )}
    <div className="p-5 flex-1 flex flex-col justify-between">
      <div>
        <div className="flex justify-between items-start mb-2">
          <h2 className="text-xl font-orbitron text-red-100 group-hover:text-red-500 transition-colors uppercase leading-tight cyber-glow-red tracking-wider">{post.title}</h2>
          {isAdmin && (
            <div className="flex gap-3 shrink-0 ml-2">
              <button onClick={(e) => { e.stopPropagation(); onEdit(e); }} className="p-1.5 border border-purple-500/30 text-purple-400 hover:border-purple-500 hover:bg-purple-500/10 transition-all"><Edit3 size={14} /></button>
              <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1.5 border border-orange-600/30 text-orange-600 hover:border-orange-600 hover:bg-orange-600/10 transition-all"><Trash2 size={14} /></button>
            </div>
          )}
        </div>
        <p className="text-sm text-red-400/70 font-mono mb-3 line-clamp-2 leading-relaxed">{post.excerpt}</p>
        <div className="flex flex-wrap gap-2 mb-4">{post.tags.map(t => <Tag key={t} label={t} />)}</div>
      </div>
      <div className="flex items-center justify-between text-[10px] font-mono text-red-900 border-t border-red-500/10 pt-3">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1"><Clock size={12} /> {new Date(post.createdAt).toLocaleDateString()}</span>
          <span className="flex items-center gap-1"><Eye size={12} /> {post.views}</span>
          <span className="flex items-center gap-1 text-red-600"><Heart size={12} className="fill-current" /> {post.likes}</span>
          <span className="flex items-center gap-1"><MessageSquare size={12} /> {post.commentCount ?? post.comments.length}</span>
        </div>
        <span className="text-red-500 font-orbitron group-hover:underline tracking-tighter uppercase">Read Data Sector &gt;</span>
      </div>
    </div>
  </article>
  );
});

const PostDetail = React.memo<{ 
  post: Post; 
  onBack: () => void; 
  onLike: () => void; 
  onAddComment: (msg: string, img?: string) => Promise<boolean>; 
  onLikeComment: (commentId: string) => Promise<number | null>;
  onDeleteComment: (commentId: string) => Promise<boolean>;
  isAdmin: boolean; 
  onDelete: () => void; 
  onEdit: () => void; 
  onUploadImage: (file: File) => Promise<string>;
}>(({ post, onBack, onLike, onAddComment, onLikeComment, onDeleteComment, isAdmin, onDelete, onEdit, onUploadImage }) => {
  const [commentText, setCommentText] = useState('');
  const [commentPage, setCommentPage] = useState(1);
  const [commentImg, setCommentImg] = useState<string | null>(null);
  const [commentImgUploading, setCommentImgUploading] = useState(false);
  const [commentImgError, setCommentImgError] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentTotal, setCommentTotal] = useState(0);
  const [commentLoading, setCommentLoading] = useState(false);
  const [commentRefreshKey, setCommentRefreshKey] = useState(0);
  const totalCommentPages = Math.max(1, Math.ceil(commentTotal / COMMENTS_PER_PAGE));

  useEffect(() => {
    setCommentPage(1);
    setComments([]);
    setCommentTotal(0);
  }, [post.id]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    (async () => {
      setCommentLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('page', String(commentPage));
        params.set('pageSize', String(COMMENTS_PER_PAGE));
        const res = await apiFetch(`${API_BASE}/posts/${post.id}/comments?${params.toString()}`, {
          signal: controller.signal
        });
        if (!res.ok) {
          throw new Error(`Load comments failed: ${res.status}`);
        }
        const data = await res.json();
        if (!active) return;
        const total = Number(data.total || 0);
        setCommentTotal(total);
        const nextTotalPages = Math.max(1, Math.ceil(total / COMMENTS_PER_PAGE));
        if (commentPage > nextTotalPages) {
          setCommentPage(nextTotalPages);
          return;
        }
        setComments(Array.isArray(data.comments) ? data.comments : []);
      } catch (error: any) {
        if (error?.name === 'AbortError') return;
        console.error('Load comments error:', error);
      } finally {
        if (active) setCommentLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [post.id, commentPage, commentRefreshKey]);

  const handleNextCommentPage = () => setCommentPage(p => Math.min(totalCommentPages, p + 1));
  const handlePrevCommentPage = () => setCommentPage(p => Math.max(1, p - 1));

  const handleCommentImgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCommentImgUploading(true);
      setCommentImgError(null);
      try {
        const url = await onUploadImage(file);
        setCommentImg(url);
      } catch (error) {
        console.error('Upload comment image error:', error);
        setCommentImgError('图片上传失败，请稍后重试。');
      } finally {
        setCommentImgUploading(false);
      }
    }
  };

  const handleSubmitComment = async () => {
    if (commentImgUploading) return;
    const ok = await onAddComment(commentText, commentImg || undefined);
    if (!ok) return;
    setCommentText('');
    setCommentImg(null);
    setCommentPage(1);
    setCommentRefreshKey(key => key + 1);
  };

  const handleLikeCommentLocal = async (commentId: string) => {
    const likes = await onLikeComment(commentId);
    if (!Number.isFinite(likes)) return;
    setComments(prev => prev.map(c => c.id === commentId ? { ...c, likes: likes as number } : c));
  };

  const handleDeleteCommentLocal = async (commentId: string) => {
    const ok = await onDeleteComment(commentId);
    if (!ok) return;
    setCommentRefreshKey(key => key + 1);
  };

  const formatDateFull = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}年${(d.getMonth() + 1).toString().padStart(2, '0')}月${d.getDate().toString().padStart(2, '0')}日 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button onClick={onBack} className="text-red-500 hover:text-white flex items-center gap-2 font-orbitron text-sm mb-4 transition-colors uppercase tracking-widest"><ChevronLeft size={16}/> Back To Root</button>
      <div className="cyber-border-red bg-black/60 overflow-hidden shadow-2xl">
        {post.imageUrl && (
          <div className="w-full border-b border-red-500/30 bg-black/70 p-2 md:p-3 flex items-center justify-center">
            <img
              src={post.imageUrl}
              loading="eager"
              decoding="async"
              fetchPriority="high"
              className="max-w-full max-h-[70vh] object-contain opacity-90"
              alt="Post Banner"
            />
          </div>
        )}
        <div className="p-6">
          <div className="flex justify-between items-start mb-6">
            <div className="flex flex-wrap gap-2">{post.tags.map(t => <Tag key={t} label={t} />)}</div>
            {isAdmin && (
              <div className="flex gap-4">
                <CyberButton onClick={onEdit} variant="primary">修改条目</CyberButton>
                <CyberButton onClick={onDelete} variant="danger">彻底离线</CyberButton>
              </div>
            )}
          </div>
          <h1 className="text-4xl font-orbitron text-red-500 mb-2 uppercase cyber-glow-red leading-tight tracking-wider">{post.title}</h1>
          <div className="flex gap-4 text-xs font-mono text-red-900 mb-8 border-b border-red-500/20 pb-4">
            <span>ORIGIN: {post.author}</span>
            <span>TIMESTAMP: {formatDateFull(post.createdAt)}</span>
            <span>OBSERVATION: {post.views}</span>
          </div>
          <div className="prose prose-invert max-w-none text-red-100/90 leading-relaxed font-mono whitespace-pre-wrap mb-10 text-sm">{post.content}</div>
          <div className="flex justify-between items-center pt-8 border-t border-red-500/20">
            <CyberButton onClick={onLike} variant="secondary" className="flex items-center gap-2"><Heart size={16} className={post.likes > 0 ? 'fill-current text-red-500' : ''}/> SYNC_CORES ({post.likes})</CyberButton>
            <div className="flex items-center gap-2 text-red-900 text-[10px] uppercase font-mono"><Zap size={14}/> Encryption: 550W_STD</div>
          </div>
        </div>
      </div>

      <div className="space-y-6 pb-20">
        <h3 className="text-xl font-orbitron text-red-500 flex items-center gap-2 uppercase tracking-widest"><MessageSquare size={20}/> Communication Channel</h3>
        <div className="cyber-border-red p-4 bg-black/40">
          <textarea value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="请输入您的应答内容..." className="w-full bg-black/60 border border-red-500/30 p-4 text-red-400 focus:outline-none mb-4 font-mono text-sm transition-colors" rows={3} />
          {commentImg && (
            <div className="mb-4 relative w-32 h-32 border border-red-500/30">
              <img src={commentImg} className="w-full h-full object-cover opacity-95" alt="Visual" />
              <button onClick={() => setCommentImg(null)} className="absolute -top-2 -right-2 bg-red-600 rounded-full p-0.5"><X size={12}/></button>
            </div>
          )}
          <div className="flex justify-between items-center">
            <label className="cursor-pointer text-red-500 hover:text-white transition-colors flex items-center gap-2">
              <ImageIcon size={18}/><span className="text-xs font-mono uppercase">{commentImgUploading ? '上传中...' : 'Add Visual Data'}</span>
              <input type="file" accept="image/*" onChange={handleCommentImgUpload} className="hidden" disabled={commentImgUploading} />
            </label>
            <CyberButton onClick={handleSubmitComment} variant="moss" disabled={commentImgUploading}>广播应答</CyberButton>
          </div>
          {commentImgError && (
            <div className="mt-2 text-[10px] text-orange-500 font-mono">{commentImgError}</div>
          )}
        </div>
        <div className="space-y-4">
          {commentLoading ? (
            <div className="text-center py-8 text-red-600 font-mono text-xs italic border border-dashed border-red-900/30 uppercase tracking-widest">Loading...</div>
          ) : comments.length > 0 ? (
            <>
              {comments.map(c => (
                <div key={c.id} className="cyber-border-red p-4 bg-red-900/10 border-l-2 border-l-red-500 animate-in slide-in-from-left duration-300 group">
                  <div className="flex justify-between mb-2 text-[10px] font-orbitron text-red-500">
                    <span className="flex items-center gap-2">{c.author} {c.location && <span className="text-red-700 flex items-center gap-1"><MapPin size={10}/> 地址 {c.location}</span>}</span>
                    <div className="flex items-center gap-4">
                      <span>{formatDateFull(c.createdAt)}</span>
                      {isAdmin && <button onClick={() => handleDeleteCommentLocal(c.id)} className="text-orange-600 hover:text-orange-400 transition-colors opacity-0 group-hover:opacity-100"><Trash2 size={12}/></button>}
                    </div>
                  </div>
                  <p className="text-sm text-red-100/80 font-mono mb-3">{c.content}</p>
                  {(c.imageThumbUrl || c.imageUrl) && (
                    <div className="mb-3 max-w-sm border border-red-500/10">
                      <img
                        src={c.imageThumbUrl || c.imageUrl}
                        loading="lazy"
                        decoding="async"
                        fetchPriority="low"
                        className="w-full h-auto opacity-95"
                        alt="Attachment"
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-4">
                    <button onClick={() => handleLikeCommentLocal(c.id)} className="flex items-center gap-1 text-[10px] font-mono text-red-900 hover:text-red-500 transition-colors">
                      <ThumbsUp size={12} className={c.likes > 0 ? "text-red-500" : ""}/> {c.likes}
                    </button>
                  </div>
                </div>
              ))}
              {totalCommentPages > 1 && (
                <div className="flex justify-center gap-4 pt-4">
                  <button disabled={commentPage === 1} onClick={handlePrevCommentPage} className="p-2 border border-red-500/30 text-red-500 disabled:opacity-30 hover:bg-red-500/10 transition-colors"><ChevronLeft size={16}/></button>
                  <span className="text-red-500 font-mono text-xs flex items-center">PAGE {commentPage} / {totalCommentPages}</span>
                  <button disabled={commentPage === totalCommentPages} onClick={handleNextCommentPage} className="p-2 border border-red-500/30 text-red-500 disabled:opacity-30 hover:bg-red-500/10 transition-colors"><ChevronRight size={16}/></button>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-red-900 font-mono text-xs italic border border-dashed border-red-900/30 uppercase tracking-widest">No response on channel.</div>
          )}
        </div>
      </div>
    </div>
  );
});

