import { useState, useRef, useCallback, useEffect } from "react";
import { faqData, FAQItem } from "./data/faqData";
import { Mic, MicOff, Volume2, VolumeX, Send, MessageCircle, Bot, Settings, X } from "lucide-react";
import "./App.css";

// 音声の優先順位：より自然な音声を優先
const VOICE_PRIORITY_KEYWORDS = [
  "google",      // Google の音声は最も自然
  "microsoft",   // Microsoft の音声も高品質
  "natural",     // "Natural" を含む音声
  "premium",     // プレミアム音声
  "enhanced",    // 拡張音声
];

function scoreVoice(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase();
  let score = 0;
  // リモート音声（クラウドベース）はローカルより高品質
  if (!voice.localService) score += 10;
  // 優先キーワードによるスコアリング
  VOICE_PRIORITY_KEYWORDS.forEach((keyword, index) => {
    if (name.includes(keyword)) {
      score += (VOICE_PRIORITY_KEYWORDS.length - index) * 2;
    }
  });
  return score;
}

function getStoredValue(key: string, defaultValue: number): number {
  try {
    const stored = localStorage.getItem(key);
    if (stored !== null) return parseFloat(stored);
  } catch { /* ignore */ }
  return defaultValue;
}

function getStoredString(key: string, defaultValue: string): string {
  try {
    const stored = localStorage.getItem(key);
    if (stored !== null) return stored;
  } catch { /* ignore */ }
  return defaultValue;
}

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
}

// FAQ検索：キーワードマッチングで最適な回答を見つける
function findBestMatch(input: string): FAQItem | null {
  const normalizedInput = input.toLowerCase().trim();
  if (!normalizedInput) return null;

  let bestMatch: FAQItem | null = null;
  let bestScore = 0;

  for (const faq of faqData) {
    let score = 0;

    // キーワードマッチング
    for (const keyword of faq.keywords) {
      if (normalizedInput.includes(keyword.toLowerCase())) {
        score += 3;
      }
    }

    // 質問文との部分一致
    const questionChars = faq.question.toLowerCase();
    for (const char of normalizedInput) {
      if (questionChars.includes(char) && char.trim()) {
        score += 0.5;
      }
    }

    // 質問文の単語マッチング
    const inputWords = normalizedInput.split(/[\s、。？！?!,.\s]+/).filter(Boolean);
    const questionWords = faq.question.split(/[\s、。？！?!,.\s]+/).filter(Boolean);
    for (const inputWord of inputWords) {
      for (const qWord of questionWords) {
        if (inputWord.length >= 2 && qWord.includes(inputWord)) {
          score += 2;
        }
        if (qWord.length >= 2 && inputWord.includes(qWord)) {
          score += 2;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = faq;
    }
  }

  // スコアが低すぎる場合はマッチなし
  if (bestScore < 3) return null;

  return bestMatch;
}

const GREETING_TEXT = "ここまでで、特に気になる点やご不明点はございますでしょうか。";
const APP_TITLE = "AIヘルプデスク 案内ロボット";
const APP_SUBTITLE = "AIヘルプデスクに関するご質問にお答えします";

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 0,
      role: "assistant",
      text: GREETING_TEXT,
    },
  ]);
  const [inputText, setInputText] = useState("");
  const [micEnabled, setMicEnabled] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [jaVoices, setJaVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState(() => getStoredString("faq-tts-voice", ""));
  const [speechRate, setSpeechRate] = useState(() => getStoredValue("faq-tts-rate", 0.9));
  const [speechPitch, setSpeechPitch] = useState(() => getStoredValue("faq-tts-pitch", 1.0));
  const [speechVolume, setSpeechVolume] = useState(() => getStoredValue("faq-tts-volume", 1.0));
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageIdRef = useRef(1);
  const micEnabledRef = useRef(micEnabled);
  const isSpeakingRef = useRef(isSpeaking);
  const greetingDoneRef = useRef(false);
  const greetingPlayedRef = useRef(false);
  const pendingSpeakRef = useRef(false);
  const finalTextRef = useRef("");
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ブラウザがWeb Speech APIに対応しているかチェック
  const speechRecognitionSupported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
  const speechSynthesisSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  // 音声リストを読み込み（voiceschanged イベント対応）
  useEffect(() => {
    if (!speechSynthesisSupported) return;
    synthRef.current = window.speechSynthesis;

    const loadVoices = () => {
      const allVoices = window.speechSynthesis.getVoices();
      const japanese = allVoices
        .filter((v) => v.lang === "ja-JP" || v.lang.startsWith("ja"))
        .sort((a, b) => scoreVoice(b) - scoreVoice(a));
      setJaVoices(japanese);

      // 保存された音声がない場合、最もスコアの高い音声を自動選択
      if (!selectedVoiceName && japanese.length > 0) {
        setSelectedVoiceName(japanese[0].name);
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [speechSynthesisSupported, selectedVoiceName]);

  // 設定をlocalStorageに保存
  useEffect(() => {
    try {
      localStorage.setItem("faq-tts-voice", selectedVoiceName);
      localStorage.setItem("faq-tts-rate", speechRate.toString());
      localStorage.setItem("faq-tts-pitch", speechPitch.toString());
      localStorage.setItem("faq-tts-volume", speechVolume.toString());
    } catch { /* ignore */ }
  }, [selectedVoiceName, speechRate, speechPitch, speechVolume]);

  // ref を最新の state に同期
  useEffect(() => {
    micEnabledRef.current = micEnabled;
  }, [micEnabled]);
  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  // メッセージ追加時に自動スクロール
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 選択中の音声オブジェクトを取得
  const getSelectedVoice = useCallback((): SpeechSynthesisVoice | null => {
    if (selectedVoiceName) {
      const found = jaVoices.find((v) => v.name === selectedVoiceName);
      if (found) return found;
    }
    // フォールバック：最もスコアの高い日本語音声
    return jaVoices.length > 0 ? jaVoices[0] : null;
  }, [jaVoices, selectedVoiceName]);

  // 音声合成で回答を読み上げる
  const speakText = useCallback(
    (text: string) => {
      if (!synthRef.current || !ttsEnabled) return;

      // 既に再生中の場合は停止
      synthRef.current.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "ja-JP";
      utterance.rate = speechRate;
      utterance.pitch = speechPitch;
      utterance.volume = speechVolume;

      // 選択された日本語音声を設定
      const voice = getSelectedVoice();
      if (voice) {
        utterance.voice = voice;
      }

      utterance.onstart = () => {
        setIsSpeaking(true);
        // TTS再生中はマイクを一時停止（ハウリング防止）
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch { /* ignore */ }
          recognitionRef.current = null;
        }
      };
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      synthRef.current.speak(utterance);
    },
    [ttsEnabled, speechRate, speechPitch, speechVolume, getSelectedVoice]
  );

  // 質問を処理して回答する
  const handleQuestion = useCallback(
    (question: string) => {
      if (!question.trim()) return;

      const userMsg: ChatMessage = {
        id: messageIdRef.current++,
        role: "user",
        text: question.trim(),
      };

      const match = findBestMatch(question);
      const answerText = match
        ? match.answer
        : "確認が必要なため、AICの担当者に引き継ぎます。";

      const assistantMsg: ChatMessage = {
        id: messageIdRef.current++,
        role: "assistant",
        text: answerText,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInputText("");

      // 回答を音声で読み上げる（即座にマイクを停止してから読み上げ）
      pendingSpeakRef.current = true;
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
        recognitionRef.current = null;
      }
      setIsListening(false);
      setInterimTranscript("");
      setTimeout(() => {
        pendingSpeakRef.current = false;
        speakText(answerText);
      }, 300);
    },
    [speakText]
  );

  // 音声認識を開始する（内部用）
  const startRecognition = useCallback(() => {
    if (!speechRecognitionSupported) return;
    // 既に動いていたら何もしない
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }

    const SpeechRecognitionAPI =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognitionAPI();
    recognition.lang = "ja-JP";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsListening(true);
      setInterimTranscript("");
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final_ = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final_ += transcript;
        } else {
          interim += transcript;
        }
      }

      if (final_) {
        // 確定テキストを蓄積し、1秒の沈黙後に質問を処理
        finalTextRef.current += final_;
        // 蓄積テキストを表示し続ける（消えないようにする）
        setInterimTranscript(finalTextRef.current);
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(() => {
          const text = finalTextRef.current;
          finalTextRef.current = "";
          debounceTimerRef.current = null;
          if (text) {
            handleQuestion(text);
          }
        }, 1000);
      } else {
        // 蓄積テキスト + 暫定テキストを表示
        setInterimTranscript(finalTextRef.current + interim);
      }
    };

    recognition.onerror = (e: Event) => {
      const err = e as Event & { error?: string };
      // "no-speech" や "aborted" は正常 — 自動再起動
      if (err.error === "no-speech" || err.error === "aborted") return;
      setIsListening(false);
      setInterimTranscript("");
    };

    recognition.onend = () => {
      // デバウンスタイマーが動いている場合、まだ話し中 → 認識を再起動して聞き続ける
      if (debounceTimerRef.current && micEnabledRef.current && !isSpeakingRef.current && !pendingSpeakRef.current) {
        startRecognition();
        return;
      }
      // タイマーなしで蓄積テキストがあれば処理（セッション終了時）
      if (finalTextRef.current && !debounceTimerRef.current) {
        const text = finalTextRef.current;
        finalTextRef.current = "";
        handleQuestion(text);
        return;
      }
      setInterimTranscript("");
      // マイクが有効 & TTS再生中でなく & 回答待ちでなければ自動再起動
      if (micEnabledRef.current && !isSpeakingRef.current && !pendingSpeakRef.current) {
        // isListening を false にしない（UIフリッカー防止）— そのまま再起動
        setTimeout(() => {
          if (micEnabledRef.current && !isSpeakingRef.current && !pendingSpeakRef.current) {
            startRecognition();
          } else {
            setIsListening(false);
          }
        }, 300);
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [speechRecognitionSupported, handleQuestion]);

  // TTS再生終了時にマイクを自動再開（初回挨拶完了後のみ）
  useEffect(() => {
    if (!isSpeaking && micEnabled && speechRecognitionSupported && !recognitionRef.current && greetingDoneRef.current) {
      const timer = setTimeout(() => startRecognition(), 500);
      return () => clearTimeout(timer);
    }
  }, [isSpeaking, micEnabled, speechRecognitionSupported, startRecognition]);

  // マイクON/OFFトグル
  const toggleMic = useCallback(() => {
    setMicEnabled((prev) => {
      const next = !prev;
      if (!next) {
        // マイクOFF: 認識を停止
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch { /* ignore */ }
          recognitionRef.current = null;
        }
        setIsListening(false);
        setInterimTranscript("");
      }
      return next;
    });
  }, []);

  // 音声ロード完了後に挨拶を再生（回答と同じvoiceを使用）
  useEffect(() => {
    // 既に挨拶再生済みなら何もしない
    if (greetingPlayedRef.current) return;
    if (!speechSynthesisSupported || !ttsEnabled) {
      // TTS非対応/無効の場合はマイクだけ開始
      if (!greetingDoneRef.current) {
        greetingDoneRef.current = true;
        greetingPlayedRef.current = true;
        if (micEnabled && speechRecognitionSupported) {
          setTimeout(() => startRecognition(), 500);
        }
      }
      return;
    }
    // 音声がまだロードされていない場合は待つ
    if (jaVoices.length === 0) return;

    greetingPlayedRef.current = true;

    const timer = setTimeout(() => {
      if (!synthRef.current) return;
      synthRef.current.cancel();
      const utterance = new SpeechSynthesisUtterance(GREETING_TEXT);
      utterance.lang = "ja-JP";
      utterance.rate = speechRate;
      utterance.pitch = speechPitch;
      utterance.volume = speechVolume;
      // 回答と同じvoiceを使用
      const voice = getSelectedVoice();
      if (voice) utterance.voice = voice;
      utterance.onstart = () => {
        setIsSpeaking(true);
        // TTS再生中はマイクを停止
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch { /* ignore */ }
          recognitionRef.current = null;
        }
      };
      utterance.onend = () => {
        setIsSpeaking(false);
        greetingDoneRef.current = true;
        // マイク開始は useEffect が isSpeaking 変化を検知して自動で行う
      };
      utterance.onerror = () => {
        setIsSpeaking(false);
        greetingDoneRef.current = true;
        // マイク開始は useEffect が isSpeaking 変化を検知して自動で行う
      };
      synthRef.current.speak(utterance);
    }, 300);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jaVoices, speechSynthesisSupported, ttsEnabled]);

  // 音声合成を停止
  const stopSpeaking = useCallback(() => {
    if (synthRef.current) {
      synthRef.current.cancel();
      setIsSpeaking(false);
    }
  }, []);

  // テキスト送信
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleQuestion(inputText);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* ヘッダー */}
      <header className="bg-[#0d1b4a] px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">{APP_TITLE}</h1>
              <p className="text-xs text-blue-200">{APP_SUBTITLE}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`p-2 rounded-lg transition-colors ${
                showSettings
                  ? "bg-white/20 text-white"
                  : "bg-white/10 text-blue-200 hover:bg-white/20"
              }`}
              title="音声設定"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button
              onClick={() => setTtsEnabled(!ttsEnabled)}
              className={`p-2 rounded-lg transition-colors ${
                ttsEnabled
                  ? "bg-white/20 text-white hover:bg-white/30"
                  : "bg-white/10 text-blue-200 hover:bg-white/20"
              }`}
              title={ttsEnabled ? "音声回答: ON" : "音声回答: OFF"}
            >
              {ttsEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>
      {/* ブルーアクセントライン */}
      <div className="h-1 bg-blue-500" />

      {/* 音声設定パネル */}
      {showSettings && (
        <div className="bg-white border-b border-gray-200 shadow-sm px-4 py-4">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-[#0d1b4a]">音声設定</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="p-1 text-gray-400 hover:text-gray-700 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 音声選択 */}
            <div className="mb-3">
              <label className="block text-xs text-gray-500 mb-1">音声を選択</label>
              {jaVoices.length > 0 ? (
                <select
                  value={selectedVoiceName}
                  onChange={(e) => setSelectedVoiceName(e.target.value)}
                  className="w-full bg-white text-gray-800 text-sm rounded-lg px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {jaVoices.map((voice) => (
                    <option key={voice.name} value={voice.name}>
                      {voice.name} {voice.localService ? "(ローカル)" : "(オンライン)"}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-amber-500">日本語音声が見つかりません。ブラウザの設定を確認してください。</p>
              )}
              {jaVoices.length > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  現在の音声: {getSelectedVoice()?.name ?? "未選択"}
                  {getSelectedVoice() && !getSelectedVoice()?.localService && " (クラウド - 高品質)"}
                </p>
              )}
            </div>

            {/* 速度 */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-500">速度</label>
                <span className="text-xs text-gray-600">{speechRate.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="1.5"
                step="0.1"
                value={speechRate}
                onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                <span>ゆっくり</span>
                <span>普通</span>
                <span>速い</span>
              </div>
            </div>

            {/* ピッチ */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-500">ピッチ（声の高さ）</label>
                <span className="text-xs text-gray-600">{speechPitch.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="1.5"
                step="0.1"
                value={speechPitch}
                onChange={(e) => setSpeechPitch(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                <span>低い</span>
                <span>普通</span>
                <span>高い</span>
              </div>
            </div>

            {/* 音量 */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-500">音量</label>
                <span className="text-xs text-gray-600">{Math.round(speechVolume * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={speechVolume}
                onChange={(e) => setSpeechVolume(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
            </div>

            {/* テスト再生ボタン */}
            <button
              onClick={() => speakText("こんにちは、音声のテストです。この速度とピッチで問題ないでしょうか。")}
              className="w-full bg-[#0d1b4a] hover:bg-[#162763] text-white text-sm rounded-lg px-4 py-2 transition-colors"
            >
              テスト再生
            </button>
          </div>
        </div>
      )}

      {/* チャットエリア */}
      <main className="flex-1 overflow-y-auto px-8 py-8">
        <div className="w-full max-w-none space-y-8 px-4">
          {messages.map((msg) => (
            <div key={msg.id}>
              {msg.role === "assistant" ? (
                <div className="flex items-start gap-4 w-full">
                  <div className="flex-shrink-0 w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center mt-1">
                    <MessageCircle className="w-5 h-5 text-gray-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base leading-relaxed text-gray-800 whitespace-pre-wrap" style={{ fontSize: '24px' }}>{msg.text}</p>
                    {msg.id !== 0 && (
                      <button
                        onClick={() => speakText(msg.text)}
                        className="mt-2 text-xs text-gray-400 hover:text-[#0d1b4a] flex items-center gap-1 transition-colors"
                      >
                        <Volume2 className="w-3 h-3" />
                        もう一度聞く
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex justify-end w-full">
                  <div className="bg-[#e8e6e1] text-gray-800 rounded-2xl rounded-br-sm px-5 py-3">
                    <p className="leading-relaxed whitespace-pre-wrap" style={{ fontSize: '24px' }}>{msg.text}</p>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* 音声認識中のリアルタイム表示 */}
          {interimTranscript && (
            <div className="flex justify-end">
              <div className="bg-[#e8e6e1]/60 text-gray-500 rounded-2xl rounded-br-sm px-5 py-3">
                <p className="italic" style={{ fontSize: '24px' }}>{interimTranscript}...</p>
              </div>
            </div>
          )}

          {/* 読み上げ中インジケーター */}
          {isSpeaking && (
            <div className="flex items-start gap-4 w-full">
              <div className="flex-shrink-0 w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center mt-1">
                <MessageCircle className="w-5 h-5 text-gray-500" />
              </div>
              <div className="flex items-center gap-2 py-1">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
                <span className="text-sm text-gray-500">読み上げ中...</span>
                <button
                  onClick={stopSpeaking}
                  className="text-sm text-red-500 hover:text-red-600 ml-2"
                >
                  停止
                </button>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* FAQ一覧（折りたたみ可能） */}
      <div className="w-full px-12 pb-2">
        <details className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <summary className="px-4 py-2 cursor-pointer text-sm text-gray-500 hover:text-[#0d1b4a] transition-colors">
            よくある質問一覧を見る
          </summary>
          <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {faqData.map((faq) => (
              <button
                key={faq.id}
                onClick={() => handleQuestion(faq.question)}
                className="text-left text-sm bg-gray-50 hover:bg-[#0d1b4a] text-gray-600 hover:text-white rounded-lg px-3 py-2 transition-colors border border-gray-200 hover:border-[#0d1b4a]"
              >
                {faq.question}
              </button>
            ))}
          </div>
        </details>
      </div>

      {/* 入力エリア */}
      <footer className="bg-white border-t border-gray-200 shadow-sm px-8 py-3">
        <div className="w-full max-w-none px-4">
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            {/* マイクON/OFFボタン */}
            <button
              type="button"
              onClick={toggleMic}
              disabled={!speechRecognitionSupported}
              className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                micEnabled && isListening
                  ? "bg-[#0d1b4a] text-white animate-pulse shadow-lg shadow-blue-900/30"
                  : micEnabled
                  ? "bg-[#0d1b4a]/70 text-white"
                  : speechRecognitionSupported
                  ? "bg-gray-200 text-gray-500 hover:bg-gray-300"
                  : "bg-gray-100 text-gray-300 cursor-not-allowed"
              }`}
              title={
                !speechRecognitionSupported
                  ? "お使いのブラウザは音声認識に対応していません"
                  : micEnabled
                  ? "マイクをOFFにする"
                  : "マイクをONにする"
              }
            >
              {micEnabled ? (
                <Mic className="w-5 h-5" />
              ) : (
                <MicOff className="w-5 h-5" />
              )}
            </button>

            {/* テキスト入力 */}
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={micEnabled && isListening ? "音声認識中...テキスト入力も可能です" : "質問を入力してください..."}
              className="flex-1 bg-gray-50 text-gray-800 placeholder-gray-400 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-300"
              style={{ fontSize: '24px' }}
            />

            {/* 送信ボタン */}
            <button
              type="submit"
              disabled={!inputText.trim()}
              className="flex-shrink-0 w-12 h-12 bg-[#0d1b4a] text-white rounded-xl flex items-center justify-center hover:bg-[#162763] disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>

          {/* 音声認識状態表示 */}
          {micEnabled && (
            <div className="mt-2 flex items-center justify-center gap-2">
              {isListening ? (
                <>
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-[#0d1b4a] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 bg-[#0d1b4a] rounded-full animate-bounce" style={{ animationDelay: "100ms" }} />
                    <span className="w-2 h-2 bg-[#0d1b4a] rounded-full animate-bounce" style={{ animationDelay: "200ms" }} />
                  </div>
                  <span className="text-xs text-[#0d1b4a] font-medium">マイクON — 話しかけてください</span>
                </>
              ) : isSpeaking ? (
                <span className="text-xs text-blue-600">回答中...終了後にマイクが再開します</span>
              ) : (
                <span className="text-xs text-amber-600">マイク起動中...</span>
              )}
            </div>
          )}

          {!speechRecognitionSupported && (
            <p className="mt-2 text-xs text-amber-500 text-center">
              お使いのブラウザは音声認識に対応していません。テキスト入力をご利用ください。
            </p>
          )}
        </div>
      </footer>
    </div>
  );
}

export default App
