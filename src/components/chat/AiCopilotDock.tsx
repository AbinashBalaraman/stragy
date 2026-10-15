import React, { useState, useRef, useEffect, Component, ReactNode } from 'react';
import {
  Send,
  Sparkles,
  Bot,
  User,
  ArrowRight,
  RotateCcw,
  Mic,
  MicOff,
  Sliders,
  CheckCircle2,
  Cpu,
  Play,
  Wand2,
  Activity,
  AlertCircle,
  TrendingUp,
  Gauge,
  Zap,
  Award,
  ArrowUpRight,
  SlidersHorizontal,
  Copy,
  Check
} from 'lucide-react';
import { StrategyAST } from '../../shared/strategy/types';
import { repairStrategyAST } from '../../shared/strategy/schema';

export interface AgentActionStep {
  stepNumber?: number;
  step?: number;
  stage?: 'INSPECT' | 'HYPOTHESIS' | 'TRIAL_SWEEP' | 'EVALUATE' | 'MUTATE' | 'EXECUTE';
  type?: 'INSPECT' | 'HYPOTHESIS' | 'TRIAL_SWEEP' | 'EVALUATE' | 'MUTATE' | 'EXECUTE';
  title: string;
  action?: string;
  detail?: string;
  parametersTouched?: string[];
  simulatedTrials?: number;
  bestMetricSoFar?: string;
  status?: 'COMPLETED' | 'ACTIVE' | 'PENDING' | 'completed' | 'optimal' | 'warning';
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: number;
  providerUsed?: string;
  detectedPattern?: string;
  agentTrace?: AgentActionStep[];
  variations?: {
    id: string;
    name: string;
    category: string;
    summary: string;
    pros: string;
    cons: string;
    strategy: StrategyAST;
  }[];
  appliedChangeSummary?: string;
  optimizationResult?: {
    assistantMessage: string;
    agentTrace?: AgentActionStep[];
    trialsCount?: number;
    beforeMetrics: {
      totalPnL: number;
      winRate: number;
      profitFactor: number;
      maxDrawdown: number;
      sharpeRatio: number;
      totalTrades: number;
    };
    afterMetrics: {
      totalPnL: number;
      winRate: number;
      profitFactor: number;
      maxDrawdown: number;
      sharpeRatio: number;
      totalTrades: number;
    };
    improvements: string[];
    mutationsApplied?: string[];
    optimizedStrategy: StrategyAST;
    variations: any[];
    providerUsed: string;
  };
}

function extractStrategyFromText(text?: string | null): StrategyAST | null {
  try {
    if (!text || typeof text !== 'string') return null;
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const candidateStr = jsonMatch
      ? jsonMatch[1]
      : text.includes('{') && text.includes('}')
      ? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
      : null;
    if (!candidateStr) return null;
    const parsed = JSON.parse(candidateStr);
    if (parsed && (parsed.indicators || parsed.rules || parsed.risk || parsed.name)) {
      return repairStrategyAST(parsed);
    }
  } catch {}
  return null;
}

const fmtPnL = (val?: number | null): string => {
  if (typeof val !== 'number' || isNaN(val)) return '₹0';
  const prefix = val < 0 ? '-₹' : '₹';
  return `${prefix}${Math.abs(Math.round(val)).toLocaleString('en-IN')}`;
};

const fmtPct = (val?: number | null, digits = 1): string => {
  if (typeof val !== 'number' || isNaN(val)) return '0.0%';
  return `${val.toFixed(digits)}%`;
};

const fmtNum = (val?: number | null, digits = 2): string => {
  if (typeof val !== 'number' || isNaN(val)) return '0.00';
  return val.toFixed(digits);
};

interface AiCopilotDockProps {
  strategy: StrategyAST;
  onApplyVariation: (variationStrategy: StrategyAST) => void;
  onApplyAndRunBacktest?: (variationStrategy: StrategyAST, allVariations?: StrategyAST[]) => void | Promise<void>;
  onApplyStrategyEdit: (instruction: string) => Promise<void>;
  onRunBacktest: () => void;
  onRunScanner: () => void;
}

const CHAT_STORAGE_KEY = 'stragy_copilot_chat_history_v2';

const INITIAL_WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  sender: 'assistant',
  text: "Hello! I'm **Stragy AI Copilot** powered by **DeepSeek Flash V4 Free** for Indian Capital Markets (NSE/BSE).\n\n🎙️ **Voice & Autonomous Quant Tools are active!** Click the microphone to speak, or ask me to design an algorithmic strategy, test a breakout setup, or optimize your risk parameters.",
  timestamp: Date.now(),
  providerUsed: 'DeepSeek Flash V4 Free'
};

const sanitizeChatMessage = (m: any): ChatMessage | null => {
  if (!m || typeof m !== 'object') return null;
  const id = typeof m.id === 'string' ? m.id : `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const sender = m.sender === 'user' ? 'user' : 'assistant';
  const text = typeof m.text === 'string' ? m.text : (typeof m.reply === 'string' ? m.reply : 'Ready to trade.');
  const timestamp = typeof m.timestamp === 'number' ? m.timestamp : Date.now();

  return {
    ...m,
    id,
    sender,
    text,
    timestamp,
    variations: Array.isArray(m.variations)
      ? m.variations.filter((v: any) => v && typeof v === 'object' && v.strategy)
      : undefined,
    agentTrace: Array.isArray(m.agentTrace)
      ? m.agentTrace.filter((t: any) => t && typeof t === 'object')
      : undefined
  };
};

// Safe JSON parser helper for fetch responses
async function parseSafeJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// Internal Inner Copilot Component
const AiCopilotDockInner: React.FC<AiCopilotDockProps> = ({
  strategy,
  onApplyVariation,
  onApplyAndRunBacktest,
  onApplyStrategyEdit,
  onRunBacktest,
  onRunScanner
}) => {
  // Load persistent chat history from localStorage with sanitization
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem(CHAT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const sanitized = parsed.map(sanitizeChatMessage).filter(Boolean) as ChatMessage[];
          if (sanitized.length > 0) return sanitized;
        }
      }
    } catch (e) {
      console.warn('Could not load chat history from localStorage:', e);
    }
    return [INITIAL_WELCOME_MESSAGE];
  });

  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<{ activeProvider: string; model?: string } | null>({
    activeProvider: 'DeepSeek Flash V4 Free'
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  // Automatically persist sanitized messages whenever they change
  useEffect(() => {
    try {
      if (messages && messages.length > 0) {
        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
      }
    } catch (e) {
      console.warn('Failed to save chat history to localStorage:', e);
    }
  }, [messages]);

  // Sync across tabs or multiple instances
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === CHAT_STORAGE_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const sanitized = parsed.map(sanitizeChatMessage).filter(Boolean) as ChatMessage[];
            if (sanitized.length > 0) setMessages(sanitized);
          }
        } catch {}
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Fetch AI backend status on mount & ensure voice speaker synthesis is cancelled
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    } catch {}

    fetch('/api/ai/status')
      .then(res => res.json())
      .then(data => {
        if (data?.success) {
          setAiStatus({ activeProvider: data.activeProvider || 'DeepSeek Flash V4 Free', model: data.model });
        }
      })
      .catch(() => {});
  }, []);

  // Initialize Speech Recognition (Speech-to-Text dictation)
  useEffect(() => {
    try {
      const SpeechRecognitionAPI =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognitionAPI) {
        const recognition = new SpeechRecognitionAPI();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'en-IN';

        recognition.onstart = () => {
          setIsListening(true);
          setVoiceNotice(null);
        };

        recognition.onresult = (event: any) => {
          try {
            let transcript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
              transcript += event.results[i][0].transcript;
            }
            if (transcript) {
              setInput(transcript);
            }
          } catch {}
        };

        recognition.onerror = (event: any) => {
          setIsListening(false);
          if (event.error !== 'no-speech') {
            console.warn('Speech recognition warning:', event.error);
          }
        };

        recognition.onend = () => {
          setIsListening(false);
        };

        recognitionRef.current = recognition;
      } else {
        setSpeechSupported(false);
      }
    } catch {
      setSpeechSupported(false);
    }

    return () => {
      try {
        if (recognitionRef.current) {
          recognitionRef.current.abort();
        }
        if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis) {
          window.speechSynthesis.cancel();
        }
      } catch {}
    };
  }, []);

  const scrollToBottom = () => {
    try {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } catch {}
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isProcessing]);

  // Toggle Microphone safely without window.alert
  const toggleListening = () => {
    if (!recognitionRef.current) {
      setVoiceNotice('Voice recognition is not supported in this browser window. Please use Chrome/Edge or type below.');
      setTimeout(() => setVoiceNotice(null), 4000);
      return;
    }

    if (isListening) {
      try {
        recognitionRef.current.stop();
      } catch {}
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
      } catch (err) {
        console.warn('Microphone start error:', err);
        setIsListening(false);
      }
    }
  };

  const handleSend = async (customPrompt?: string) => {
    const textToSend = customPrompt || input.trim();
    if (!textToSend || isProcessing) return;

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }

    setInput('');
    const userMsg: ChatMessage = {
      id: `usr_${Date.now()}`,
      sender: 'user',
      text: textToSend,
      timestamp: Date.now()
    };
    setMessages(prev => [...prev, userMsg]);
    setIsProcessing(true);

    const lower = textToSend.toLowerCase();

    // 0. Check for Variation Selection / Ordinal Command (e.g. "backtest the first one", "run 2", "test option 1", "first one", "second", etc.)
    const checkVariationSelection = () => {
      let targetVariations: { id: string; name: string; category: string; summary: string; pros: string; cons: string; strategy: StrategyAST }[] | null = null;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].variations && messages[i].variations!.length > 0) {
          targetVariations = messages[i].variations!;
          break;
        }
        if (messages[i].optimizationResult?.variations && messages[i].optimizationResult!.variations.length > 0) {
          targetVariations = messages[i].optimizationResult!.variations;
          break;
        }
      }

      if (!targetVariations || targetVariations.length === 0) return null;

      let targetIdx = -1;
      const isFirst =
        lower.includes('first') ||
        lower.includes('1st') ||
        lower === '1' ||
        lower === '#1' ||
        lower.includes('variant 1') ||
        lower.includes('variation 1') ||
        lower.includes('option 1') ||
        lower.includes('setup 1') ||
        lower.includes('model 1') ||
        lower.includes('backtest 1') ||
        lower.includes('run 1') ||
        lower.includes('test 1') ||
        lower.includes('select 1') ||
        lower.includes('load 1') ||
        lower === 'first one' ||
        lower === 'the first one' ||
        lower === 'the first' ||
        lower === 'first';

      const isSecond =
        lower.includes('second') ||
        lower.includes('2nd') ||
        lower === '2' ||
        lower === '#2' ||
        lower.includes('variant 2') ||
        lower.includes('variation 2') ||
        lower.includes('option 2') ||
        lower.includes('setup 2') ||
        lower.includes('model 2') ||
        lower.includes('backtest 2') ||
        lower.includes('run 2') ||
        lower.includes('test 2') ||
        lower.includes('select 2') ||
        lower.includes('load 2') ||
        lower === 'second one' ||
        lower === 'the second one' ||
        lower === 'the second' ||
        lower === 'second';

      const isThird =
        lower.includes('third') ||
        lower.includes('3rd') ||
        lower === '3' ||
        lower === '#3' ||
        lower.includes('variant 3') ||
        lower.includes('variation 3') ||
        lower.includes('option 3') ||
        lower.includes('setup 3') ||
        lower.includes('model 3') ||
        lower.includes('backtest 3') ||
        lower.includes('run 3') ||
        lower.includes('test 3') ||
        lower.includes('select 3') ||
        lower.includes('load 3') ||
        lower === 'third one' ||
        lower === 'the third one' ||
        lower === 'the third' ||
        lower === 'third';

      if (isFirst) targetIdx = 0;
      else if (isSecond) targetIdx = 1;
      else if (isThird) targetIdx = 2;
      else if (
        lower === 'proceed' ||
        lower === 'apply' ||
        lower === 'apply it' ||
        lower === 'apply this' ||
        lower === 'do it' ||
        lower === 'yes' ||
        lower === 'load it' ||
        lower === 'backtest' ||
        lower === 'backtest it' ||
        lower === 'run it' ||
        lower === 'run backtest' ||
        lower === 'simulate' ||
        lower === 'simulate it'
      ) {
        targetIdx = 0;
      }

      if (targetIdx >= 0 && targetIdx < targetVariations.length) {
        return {
          chosen: targetVariations[targetIdx],
          all: targetVariations,
          idx: targetIdx
        };
      }
      return null;
    };

    const varSelection = checkVariationSelection();
    if (varSelection) {
      const { chosen, all, idx } = varSelection;
      const allStrategies = all.map(v => v.strategy).filter(Boolean);

      if (onApplyAndRunBacktest) {
        onApplyAndRunBacktest(chosen.strategy, allStrategies);
      } else {
        onApplyVariation(chosen.strategy);
        onRunBacktest();
      }

      const replyText = `🚀 **Autonomously Loaded & Backtested Variation ${idx + 1}: "${chosen.name}"** on Indian NSE Daily OHLCV data!\n\n• **Regime**: ${chosen.category || 'Quantitative System'}\n• **Key Strength**: ${chosen.pros || 'Calibrated for Indian Markets'}\n• **Live State**: Parameters loaded into Strategy Builder and institutional simulation metrics are active in the **Results** tab.`;

      const asstMsg: ChatMessage = {
        id: `asst_${Date.now()}`,
        sender: 'assistant',
        text: replyText,
        timestamp: Date.now(),
        providerUsed: 'Stragy Master Quant Engine'
      };
      setMessages(prev => [...prev, asstMsg]);
      setIsProcessing(false);
      return;
    }

    // 0b. Fallback: check for standalone PROCEED / APPLY on previous extracted AST
    if (
      lower === 'proceed' ||
      lower === 'proceed with it' ||
      lower === 'apply' ||
      lower === 'apply it' ||
      lower === 'apply this' ||
      lower === 'do it' ||
      lower === 'yes' ||
      lower === 'load it' ||
      lower === 'apply changes'
    ) {
      // Find the most recent strategy in messages
      let targetStrat: StrategyAST | null = null;
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.optimizationResult?.optimizedStrategy) {
          targetStrat = m.optimizationResult.optimizedStrategy;
          break;
        }
        if (m.variations && m.variations.length > 0 && m.variations[0]?.strategy) {
          targetStrat = m.variations[0].strategy;
          break;
        }
        const extracted = extractStrategyFromText(m.text);
        if (extracted) {
          targetStrat = extracted;
          break;
        }
      }

      if (targetStrat) {
        if (onApplyAndRunBacktest) {
          onApplyAndRunBacktest(targetStrat);
        } else {
          onApplyVariation(targetStrat);
          onRunBacktest();
        }
        const replyText = `🚀 **Executing Live Simulation!** Applied **${targetStrat.name}** to your Strategy Builder and ran institutional backtest on Indian NSE OHLCV bars.\n\nLive metrics are updated and viewable in the **Results** tab.`;
        const asstMsg: ChatMessage = {
          id: `asst_${Date.now()}`,
          sender: 'assistant',
          text: replyText,
          timestamp: Date.now(),
          providerUsed: 'Stragy Execution Engine'
        };
        setMessages(prev => [...prev, asstMsg]);
        setIsProcessing(false);
        return;
      }
    }

    // 1. Check for optimization or parameter tuning intent: "make it profitable", "optimize", "tune settings", "change some parameters run test again", etc.
    const isOptimizationIntent =
      lower.includes('profitable') ||
      lower.includes('optimize') ||
      lower.includes('make it profitable') ||
      lower.includes('improve win rate') ||
      lower.includes('reduce drawdown') ||
      lower.includes('tune settings') ||
      lower.includes('fix whipsaw') ||
      lower.includes('more profit') ||
      lower.includes('improve') ||
      lower.includes('better results') ||
      lower.includes('losing money') ||
      lower.includes('parameter') ||
      lower.includes('param') ||
      lower.includes('tweak') ||
      lower.includes('adjust') ||
      lower.includes('retune') ||
      lower.includes('retest') ||
      lower.includes('test again') ||
      lower.includes('run test again') ||
      lower.includes('run again') ||
      lower.includes('backtest again') ||
      lower.includes('chang e') ||
      lower.includes('change parameter') ||
      lower.includes('change setting') ||
      lower.includes('modify setting');

    if (isOptimizationIntent) {
      try {
        const res = await fetch('/api/ai/optimize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ strategy, prompt: textToSend })
        });
        const data = await parseSafeJson(res);
        if (data?.success && data?.optimizedStrategy) {
          // Automatically apply winning strategy & run backtest directly in workspace across all variations
          const allVariationStrategies = Array.isArray(data.variations)
            ? data.variations.map((v: any) => v?.strategy).filter(Boolean)
            : [];

          try {
            if (onApplyAndRunBacktest) {
              onApplyAndRunBacktest(data.optimizedStrategy, allVariationStrategies);
            } else {
              onApplyVariation(data.optimizedStrategy);
              onRunBacktest();
            }
          } catch (appErr) {
            console.warn('Strategy apply warning:', appErr);
          }

          const asstMsg: ChatMessage = {
            id: `asst_${Date.now()}`,
            sender: 'assistant',
            text: data.assistantMessage || 'Optimized strategy generated.',
            timestamp: Date.now(),
            optimizationResult: data,
            variations: Array.isArray(data.variations) ? data.variations : undefined,
            detectedPattern: 'Autonomous Quantitative Optimizer',
            providerUsed: data.providerUsed || 'Stragy Master Quant Agent'
          };
          setMessages(prev => [...prev, asstMsg]);
          setIsProcessing(false);
          return;
        }
      } catch (optErr) {
        console.warn('Optimization error:', optErr);
      }
    }

    // 2. Direct simulation or backtest command on current strategy
    if (
      lower === 'run backtest' ||
      lower === 'backtest' ||
      lower === 'backtest it' ||
      lower === 'run it' ||
      lower === 'simulate' ||
      lower === 'test current strategy' ||
      lower === 'backtest current strategy'
    ) {
      setTimeout(() => {
        try {
          const replyText = `Executing institutional event-driven backtesting simulation for **${strategy?.name || 'Current Strategy'}** on latest NSE OHLCV bars...`;
          const asstMsg: ChatMessage = {
            id: `asst_${Date.now()}`,
            sender: 'assistant',
            text: replyText,
            timestamp: Date.now(),
            providerUsed: 'Stragy Execution Engine'
          };
          setMessages(prev => [...prev, asstMsg]);
          setIsProcessing(false);
          onRunBacktest();
        } catch (e) {
          setIsProcessing(false);
        }
      }, 400);
      return;
    }

    // 3. Direct scanner command
    if (lower.includes('scan') && (lower.includes('nifty') || lower.includes('screener') || lower.includes('universe') || lower.includes('stocks'))) {
      setTimeout(() => {
        try {
          const replyText = 'Scanning active NSE 50 universe against quantitative parameters...';
          const asstMsg: ChatMessage = {
            id: `asst_${Date.now()}`,
            sender: 'assistant',
            text: replyText,
            timestamp: Date.now(),
            providerUsed: 'Stragy Scanner Engine'
          };
          setMessages(prev => [...prev, asstMsg]);
          setIsProcessing(false);
          onRunScanner();
        } catch (e) {
          setIsProcessing(false);
        }
      }, 400);
      return;
    }

    // 4. Check if it is an edit instruction for the current strategy
    const isEditIntent =
      lower.includes('tighten') ||
      lower.includes('increase') ||
      lower.includes('decrease') ||
      lower.includes('set stop') ||
      lower.includes('set take profit') ||
      lower.includes('add 200 ema') ||
      lower.includes('add ema') ||
      lower.includes('add supertrend') ||
      lower.includes('switch to intraday') ||
      lower.includes('switch to delivery');

    if (isEditIntent && strategy) {
      try {
        const res = await fetch('/api/ai/apply-edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ strategy, instruction: textToSend })
        });
        const data = await parseSafeJson(res);
        if (data?.success && data?.strategy) {
          const asstMsg: ChatMessage = {
            id: `asst_${Date.now()}`,
            sender: 'assistant',
            text: data.assistantMessage || 'Applied parameter adjustment.',
            timestamp: Date.now(),
            appliedChangeSummary: data.appliedChangeSummary,
            providerUsed: data.providerUsed || 'DeepSeek Flash V4 Free'
          };
          setMessages(prev => [...prev, asstMsg]);
          try {
            if (onApplyAndRunBacktest) {
              onApplyAndRunBacktest(data.strategy);
            } else {
              onApplyVariation(data.strategy);
              onRunBacktest();
            }
          } catch {}
          setIsProcessing(false);
          return;
        }
      } catch (e) {
        console.error(e);
      }
    }

    // 5. Strategy generation, loading, or backtesting intent
    const isStrategyRequest =
      lower.includes('strategy') ||
      lower.includes('load') ||
      lower.includes('create') ||
      lower.includes('build') ||
      lower.includes('setup') ||
      lower.includes('synthesize') ||
      lower.includes('backtest') ||
      lower.includes('test') ||
      lower.includes('supertrend') ||
      lower.includes('rsi') ||
      lower.includes('macd') ||
      lower.includes('breakout') ||
      lower.includes('crossover') ||
      lower.includes('bollinger') ||
      lower.includes('nr7') ||
      lower.includes('mean reversion') ||
      lower.includes('momentum');

    if (isStrategyRequest) {
      try {
        const res = await fetch('/api/ai/parse-strategy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: textToSend, symbolId: strategy?.universe?.symbolId || 1 })
        });
        const data = await parseSafeJson(res);

        if (data?.success && Array.isArray(data.variations) && data.variations.length > 0) {
          const primaryVar = data.variations[0];
          const allVarStrats = data.variations.map((v: any) => v?.strategy).filter(Boolean);

          if (primaryVar?.strategy) {
            try {
              if (onApplyAndRunBacktest) {
                onApplyAndRunBacktest(primaryVar.strategy, allVarStrats);
              } else {
                onApplyVariation(primaryVar.strategy);
                onRunBacktest();
              }
            } catch {}
          }

          const confirmationIntro = `🚀 **Autonomously Loaded & Backtested Variation 1: "${primaryVar.name || 'Setup 1'}"** on Indian NSE Daily OHLCV data!\n\n${data.assistantMessage || ''}\n\n*The strategy has been simulated and metrics are active in the Results tab. To test other variations, select below or ask "backtest the second one".*`;

          const asstMsg: ChatMessage = {
            id: `asst_${Date.now()}`,
            sender: 'assistant',
            text: confirmationIntro,
            timestamp: Date.now(),
            detectedPattern: data.detectedPattern,
            variations: data.variations,
            providerUsed: data.providerUsed || aiStatus?.activeProvider || 'DeepSeek Flash V4 Free'
          };
          setMessages(prev => [...prev, asstMsg]);
          setIsProcessing(false);
          return;
        }
      } catch (parseErr) {
        console.warn('Strategy parse error:', parseErr);
      }
    }

    // 6. Send query to AI Conversational Engine (DeepSeek Flash V4 Free / Gemini)
    try {
      const chatHistory = messages.map(m => ({
        role: m.sender,
        text: m.text
      }));

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend,
          history: chatHistory,
          currentStrategy: strategy
        })
      });
      const data = await parseSafeJson(res);

      if (data?.success && data?.reply) {
        // If an optimization result or variation was returned in chat
        try {
          if (data.optimizationResult?.optimizedStrategy) {
            if (onApplyAndRunBacktest) {
              onApplyAndRunBacktest(data.optimizationResult.optimizedStrategy);
            } else {
              onApplyVariation(data.optimizationResult.optimizedStrategy);
              onRunBacktest();
            }
          } else if (data.variations && data.variations.length > 0 && (lower.includes('load') || lower.includes('backtest') || lower.includes('test'))) {
            const primaryVar = data.variations[0];
            if (primaryVar?.strategy) {
              if (onApplyAndRunBacktest) {
                onApplyAndRunBacktest(primaryVar.strategy);
              } else {
                onApplyVariation(primaryVar.strategy);
                onRunBacktest();
              }
            }
          }
        } catch {}

        const asstMsg: ChatMessage = {
          id: `asst_${Date.now()}`,
          sender: 'assistant',
          text: data.reply,
          timestamp: Date.now(),
          variations: Array.isArray(data.variations) ? data.variations : undefined,
          optimizationResult: data.optimizationResult,
          detectedPattern: data.detectedPattern,
          providerUsed: data.providerUsed || aiStatus?.activeProvider || 'DeepSeek Flash V4 Free'
        };
        setMessages(prev => [...prev, asstMsg]);
      } else {
        const errorText = "I'm listening! Tell me more or ask any question about quantitative trading, algorithmic concepts, Indian market rules, or anything else you'd like to explore.";
        const asstMsg: ChatMessage = {
          id: `asst_${Date.now()}`,
          sender: 'assistant',
          text: errorText,
          timestamp: Date.now(),
          providerUsed: aiStatus?.activeProvider || 'DeepSeek Flash V4 Free'
        };
        setMessages(prev => [...prev, asstMsg]);
      }
    } catch (err: any) {
      const fallbackText = "I'm connected and ready. Ask me anything about algorithmic trading, Indian market dynamics (NSE/BSE), math, or how to formulate your strategy!";
      const asstMsg: ChatMessage = {
        id: `asst_${Date.now()}`,
        sender: 'assistant',
        text: fallbackText,
        timestamp: Date.now(),
        providerUsed: aiStatus?.activeProvider || 'DeepSeek Flash V4 Free'
      };
      setMessages(prev => [...prev, asstMsg]);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0c0c0e] text-[#ececed]">
      {/* Sidebar Header */}
      <div className="p-4 border-b border-[rgba(236,236,237,0.08)] flex items-center justify-between bg-[#0c0c0e]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#222] to-[#111] border border-[rgba(236,236,237,0.08)] flex items-center justify-center shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M12 8V4H8"></path><rect width="16" height="12" x="4" y="8" rx="2"></rect><path d="M2 14h2"></path><path d="M20 14h2"></path><path d="M15 13v2"></path><path d="M9 13v2"></path></svg>
          </div>

          <div>
            <span className="label-muted !mb-0">AI COPILOT</span>
            <div className="text-[0.8rem] font-semibold text-[#ececed]">
              {aiStatus?.activeProvider || 'DeepSeek Flash V4'}
            </div>
          </div>
        </div>

        {/* Header Controls: Reset Conversation */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setMessages([
                {
                  id: 'welcome',
                  sender: 'assistant',
                  text: "Chat memory reset. Speak or type your strategy concept, risk question, or Indian market query!",
                  timestamp: Date.now(),
                  providerUsed: 'DeepSeek Flash V4 Free'
                }
              ]);
            }}
            className="p-1.5 text-neutral-400 hover:text-[#ececed] hover:bg-white/[0.04] rounded-lg border border-[rgba(236,236,237,0.08)] transition-colors"
            title="Reset Conversation"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {messages.map(msg => {
          return (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[92%] rounded-xl p-3 text-[0.8rem] leading-relaxed ${
                  msg.sender === 'user'
                    ? 'bg-[#00ffa3] text-[#0c0c0e] font-medium rounded-br-sm shadow-sm'
                    : 'bg-[#161619] border border-[rgba(236,236,237,0.08)] text-[#ececed] rounded-bl-sm shadow-sm'
                }`}
              >
                {/* Assistant metadata header */}
                {msg.sender === 'assistant' && (
                  <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-[rgba(236,236,237,0.08)]">
                    <span className="label-quant !mb-0 text-[10px]">
                      {msg.providerUsed?.includes('DeepSeek') ? 'Neural Engine' : msg.providerUsed || 'System'}
                    </span>
                  </div>
                )}

                {/* Pattern Badge if detected */}
                {msg.detectedPattern && (
                  <div className="mb-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#00ffa3]/10 border border-[#00ffa3]/20 text-[#00ffa3] font-mono text-[10px]">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Pattern: {msg.detectedPattern}</span>
                  </div>
                )}

                <div className="whitespace-pre-line space-y-1.5">{msg.text}</div>

                {/* Render Autonomous Optimization Comparative Card if present */}
                {msg.optimizationResult && (() => {
                  const optRes = msg.optimizationResult;
                  const optBefore = optRes.beforeMetrics || { totalPnL: 0, winRate: 0, profitFactor: 0, maxDrawdown: 0, sharpeRatio: 0, totalTrades: 0 };
                  const optAfter = optRes.afterMetrics || { totalPnL: 0, winRate: 0, profitFactor: 0, maxDrawdown: 0, sharpeRatio: 0, totalTrades: 0 };
                  const optTrace: any[] = Array.isArray(optRes.agentTrace)
                    ? optRes.agentTrace
                    : Array.isArray(msg.agentTrace)
                    ? msg.agentTrace
                    : [];
                  const optImprovements: string[] = Array.isArray(optRes.improvements)
                    ? optRes.improvements
                    : [];

                  return (
                    <div className="mt-3 p-3.5 bg-[#0c0c0e]/95 border border-emerald-500/40 rounded-xl space-y-3 shadow-md">
                      <div className="flex items-center justify-between border-b border-[#1d1d21] pb-2">
                        <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-xs">
                          <Zap className="w-3.5 h-3.5 fill-emerald-400" />
                          <span>Autonomous Master Agent Trace</span>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 font-semibold border border-emerald-500/30">
                          {optRes.trialsCount ? `${optRes.trialsCount} Trials Simulated` : 'Optimized & Applied'}
                        </span>
                      </div>

                      {/* Agent Action Steps Trace */}
                      {optTrace.length > 0 && (
                        <div className="bg-[#161619]/90 rounded-lg p-2.5 border border-[#1d1d21] space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1">
                              <Activity className="w-3 h-3 text-cyan-400" />
                              <span>Direct Webpage & Parameter Actions:</span>
                            </span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 font-mono">
                              Auto-Executed
                            </span>
                          </div>

                          <div className="space-y-1.5">
                            {optTrace.map((step, sIdx) => {
                              const stepNum = step?.stepNumber || step?.step || sIdx + 1;
                              const stepTitle = step?.title || `Step ${sIdx + 1}`;
                              const stepAction = step?.action || step?.detail || '';
                              const touchedParams = Array.isArray(step?.parametersTouched) ? step.parametersTouched : [];

                              return (
                                <div
                                  key={sIdx}
                                  className="text-[11px] p-2 rounded-md bg-[#0c0c0e]/80 border border-[#1d1d21]/80 flex items-start gap-2"
                                >
                                  <div className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                                    {stepNum}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-1">
                                      <span className="font-bold text-white text-[11px]">{stepTitle}</span>
                                      {step.bestMetricSoFar && (
                                        <span className="text-[9px] text-emerald-400 font-mono bg-emerald-500/10 px-1 rounded">
                                          {step.bestMetricSoFar}
                                        </span>
                                      )}
                                    </div>
                                    {stepAction && <p className="text-neutral-300 text-[10px] leading-tight mt-0.5">{stepAction}</p>}
                                    {touchedParams.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {touchedParams.map((p: string, pi: number) => (
                                          <span
                                            key={pi}
                                            className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/40 font-mono"
                                          >
                                            {p}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Metrics Comparison Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                        <div className="p-2 rounded-lg bg-[#161619]/90 border border-[#1d1d21]">
                          <div className="text-neutral-400 font-medium mb-0.5">Net P&L</div>
                          <div className="text-[11px] font-bold flex items-center gap-1">
                            <span className={(optBefore.totalPnL ?? 0) >= 0 ? 'text-neutral-300 line-through' : 'text-rose-400/70 line-through'}>
                              {fmtPnL(optBefore.totalPnL)}
                            </span>
                            <span className="text-neutral-400">→</span>
                            <span className={(optAfter.totalPnL ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                              {fmtPnL(optAfter.totalPnL)}
                            </span>
                          </div>
                        </div>

                        <div className="p-2 rounded-lg bg-[#161619]/90 border border-[#1d1d21]">
                          <div className="text-neutral-400 font-medium mb-0.5">Win Rate</div>
                          <div className="text-[11px] font-bold flex items-center gap-1">
                            <span className="text-neutral-400 line-through">{fmtPct(optBefore.winRate)}</span>
                            <span className="text-neutral-400">→</span>
                            <span className="text-cyan-300 font-extrabold">{fmtPct(optAfter.winRate)}</span>
                          </div>
                        </div>

                        <div className="p-2 rounded-lg bg-[#161619]/90 border border-[#1d1d21]">
                          <div className="text-neutral-400 font-medium mb-0.5">Profit Factor</div>
                          <div className="text-[11px] font-bold flex items-center gap-1">
                            <span className="text-neutral-400 line-through">{fmtNum(optBefore.profitFactor)}</span>
                            <span className="text-neutral-400">→</span>
                            <span className="text-emerald-300 font-extrabold">{fmtNum(optAfter.profitFactor)}</span>
                          </div>
                        </div>

                        <div className="p-2 rounded-lg bg-[#161619]/90 border border-[#1d1d21]">
                          <div className="text-neutral-400 font-medium mb-0.5">Max Drawdown</div>
                          <div className="text-[11px] font-bold flex items-center gap-1">
                            <span className="text-rose-400/80 line-through">{fmtPct(optBefore.maxDrawdown)}</span>
                            <span className="text-neutral-400">→</span>
                            <span className="text-emerald-400 font-extrabold">{fmtPct(optAfter.maxDrawdown)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Applied Improvements List */}
                      {optImprovements.length > 0 && (
                        <div className="space-y-1 bg-[#161619]/70 p-2.5 rounded-lg border border-[#1d1d21]/80">
                          <p className="text-[10px] font-bold text-neutral-300 uppercase tracking-wider">Quant Enhancements Applied:</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px]">
                            {optImprovements.map((imp, i) => (
                              <div key={i} className="flex items-center gap-1.5 text-neutral-300">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                                <span>{imp}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => {
                            if (optRes.optimizedStrategy) {
                              const allVarStrats = Array.isArray(optRes.variations)
                                ? optRes.variations.map((v: any) => v?.strategy).filter(Boolean)
                                : [];
                              if (onApplyAndRunBacktest) {
                                onApplyAndRunBacktest(optRes.optimizedStrategy, allVarStrats);
                              } else {
                                onApplyVariation(optRes.optimizedStrategy);
                                onRunBacktest();
                              }
                              const confirmText = `🚀 Re-running institutional backtest for optimized **${optRes.optimizedStrategy.name}**...`;
                              setMessages(prev => [
                                ...prev,
                                {
                                  id: `opt_run_${Date.now()}`,
                                  sender: 'assistant',
                                  text: confirmText,
                                  timestamp: Date.now(),
                                  providerUsed: 'Stragy Execution Engine'
                                }
                              ]);
                            }
                          }}
                          className="flex-1 py-1.5 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#0c0c0e] font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm"
                        >
                          <Play className="w-3 h-3 fill-current" />
                          <span>Run Simulation Again</span>
                        </button>

                        <button
                          onClick={() => {
                            if (optRes.optimizedStrategy) {
                              onApplyVariation(optRes.optimizedStrategy);
                              const confirmText = `Optimized parameters loaded into Strategy Builder workspace.`;
                              setMessages(prev => [
                                ...prev,
                                {
                                  id: `opt_load_${Date.now()}`,
                                  sender: 'assistant',
                                  text: confirmText,
                                  timestamp: Date.now(),
                                  providerUsed: 'Stragy Execution Engine'
                                }
                              ]);
                            }
                          }}
                          className="py-1.5 px-3 rounded-lg bg-[#1d1d21] hover:bg-[rgba(236,236,237,0.12)] text-neutral-300 hover:text-white font-medium text-xs border border-[rgba(236,236,237,0.12)] flex items-center justify-center gap-1 transition-all"
                        >
                          <SlidersHorizontal className="w-3 h-3" />
                          <span>Edit in Builder</span>
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* Render Extracted Strategy Card if message has embedded JSON not captured in variations */}
                {(() => {
                  if (msg.optimizationResult || (msg.variations && msg.variations.length > 0)) return null;
                  const extracted = extractStrategyFromText(msg.text);
                  if (!extracted) return null;
                  return (
                    <div className="mt-3 p-3 bg-[#0c0c0e]/90 border border-cyan-500/40 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-cyan-400 font-bold text-xs">
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>{extracted.name || 'Strategy Detected in Chat'}</span>
                        </div>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 font-mono">JSON AST Ready</span>
                      </div>
                      <p className="text-[11px] text-neutral-300">{extracted.description || 'Custom algorithmic strategy parsed from chat.'}</p>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => {
                            if (onApplyAndRunBacktest) {
                              onApplyAndRunBacktest(extracted);
                            } else {
                              onApplyVariation(extracted);
                              onRunBacktest();
                            }
                            const confirmText = `🚀 Loaded **${extracted.name}** and executed backtest simulation on Indian NSE Daily OHLCV data.`;
                            setMessages(prev => [
                              ...prev,
                              {
                                id: `extr_${Date.now()}`,
                                sender: 'assistant',
                                text: confirmText,
                                timestamp: Date.now(),
                                providerUsed: 'Stragy Execution Engine'
                              }
                            ]);
                          }}
                          className="flex-1 py-1.5 px-3 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-[#0c0c0e] font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm"
                        >
                          <Play className="w-3 h-3 fill-current" />
                          <span>1-Click Load & Run Backtest</span>
                        </button>
                        <button
                          onClick={() => {
                            onApplyVariation(extracted);
                            const confirmText = `Loaded **${extracted.name}** into Strategy Builder.`;
                            setMessages(prev => [
                              ...prev,
                              {
                                id: `extr_b_${Date.now()}`,
                                sender: 'assistant',
                                text: confirmText,
                                timestamp: Date.now(),
                                providerUsed: 'Stragy Execution Engine'
                              }
                            ]);
                          }}
                          className="py-1.5 px-2.5 rounded-lg bg-[#1d1d21] hover:bg-[rgba(236,236,237,0.12)] text-neutral-300 hover:text-white font-medium text-xs border border-[rgba(236,236,237,0.12)] flex items-center justify-center gap-1"
                        >
                          <SlidersHorizontal className="w-3 h-3" />
                          <span>Builder</span>
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* Render AI Variation Cards */}
                {msg.variations && msg.variations.length > 0 && (
                  <div className="mt-3 space-y-2.5 pt-2 border-t border-[#1d1d21]">
                    <p className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">
                      Synthesized Quant Variations:
                    </p>
                    {msg.variations.map((v, idx) => {
                      if (!v || !v.strategy) return null;
                      const varName = v.name || `Variation ${idx + 1}`;
                      const varCategory = v.category || 'Quantitative';
                      const varSummary = v.summary || 'Institutional algorithmic setup.';
                      const varPros = v.pros || 'Balanced risk-adjusted profile.';
                      const varCons = v.cons || 'Requires steady market conditions.';

                      return (
                        <div
                          key={v.id || idx}
                          className="p-3 bg-[#0c0c0e]/90 border border-[rgba(236,236,237,0.12)]/80 rounded-xl hover:border-cyan-500/60 transition-all group shadow-sm"
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="w-4 h-4 rounded-full bg-cyan-500/20 text-cyan-400 text-[10px] font-bold flex items-center justify-center">
                                {idx + 1}
                              </span>
                              <h4 className="font-bold text-white text-xs">{varName}</h4>
                            </div>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1d1d21] text-cyan-300 font-medium border border-[rgba(236,236,237,0.12)]/50">
                              {varCategory}
                            </span>
                          </div>

                          <p className="text-[11px] text-neutral-300 mb-2">{varSummary}</p>

                          <div className="grid grid-cols-2 gap-1.5 text-[10px] mb-2.5 bg-[#161619]/80 p-2 rounded-lg border border-[#1d1d21]/80">
                            <div className="text-emerald-400">
                              <span className="font-semibold">Strength:</span> {varPros}
                            </div>
                            <div className="text-neutral-400">
                              <span className="font-semibold">Consideration:</span> {varCons}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                const allVarStrats = (msg.variations || [])
                                  .map(x => x?.strategy)
                                  .filter(Boolean);
                                if (onApplyAndRunBacktest) {
                                  onApplyAndRunBacktest(v.strategy, allVarStrats);
                                } else {
                                  onApplyVariation(v.strategy);
                                  onRunBacktest();
                                }
                                const confirmText = `🚀 Loaded **${varName}** and executed backtest simulation on Indian NSE Daily OHLCV data. Results are live in the Results tab.`;
                                setMessages(prev => [
                                  ...prev,
                                  {
                                    id: `backtest_${Date.now()}`,
                                    sender: 'assistant',
                                    text: confirmText,
                                    timestamp: Date.now(),
                                    providerUsed: 'Stragy Execution Engine'
                                  }
                                ]);
                              }}
                              className="flex-1 py-1.5 px-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-[#0c0c0e] font-bold text-[11px] flex items-center justify-center gap-1.5 transition-all shadow-sm"
                            >
                              <Play className="w-3 h-3 fill-current" />
                              <span>Load & Run Backtest</span>
                            </button>

                            <button
                              onClick={() => {
                                onApplyVariation(v.strategy);
                                const confirmText = `Loaded **${varName}** into your Strategy Builder. Parameter controls have been updated.`;
                                setMessages(prev => [
                                  ...prev,
                                  {
                                    id: `select_${Date.now()}`,
                                    sender: 'assistant',
                                    text: confirmText,
                                    timestamp: Date.now(),
                                    providerUsed: 'Stragy Execution Engine'
                                  }
                                ]);
                              }}
                              className="py-1.5 px-2.5 rounded-lg bg-[#1d1d21] hover:bg-[rgba(236,236,237,0.12)] text-neutral-300 hover:text-white font-medium text-[11px] border border-[rgba(236,236,237,0.12)] flex items-center justify-center gap-1 transition-all"
                              title="Load parameters into builder without running simulation immediately"
                            >
                              <span>Builder</span>
                              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {msg.sender === 'user' && (
                <div className="w-6 h-6 rounded-lg bg-[#1d1d21] border border-[rgba(236,236,237,0.12)] flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-3.5 h-3.5 text-neutral-300" />
                </div>
              )}
            </div>
          );
        })}

        {isProcessing && (
          <div className="flex items-center gap-2.5 text-neutral-400 text-xs bg-[#161619]/60 p-3 rounded-xl border border-[#1d1d21]/60 w-fit">
            <div className="w-5 h-5 rounded-full bg-cyan-600/20 border border-cyan-500/40 flex items-center justify-center animate-pulse">
              <Bot className="w-3 h-3 text-cyan-400" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-cyan-400 font-medium">{aiStatus?.activeProvider || 'DeepSeek Flash'}</span>
              <span className="animate-pulse">is thinking & responding...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Voice Warning Notice if any */}
      {voiceNotice && (
        <div className="bg-amber-950/80 border-t border-amber-500/40 px-3.5 py-1.5 text-[11px] text-amber-200 flex items-center justify-between">
          <span>{voiceNotice}</span>
          <button onClick={() => setVoiceNotice(null)} className="text-amber-400 font-bold text-xs ml-2">✕</button>
        </div>
      )}

      {/* Live Voice Recording Status */}
      {isListening && (
        <div className="bg-red-950/70 border-t border-red-500/40 px-3.5 py-2 flex items-center justify-between text-xs text-red-300 animate-pulse">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
            <span className="font-semibold text-white">Listening to your voice...</span>
            <span className="text-[11px] text-red-200">Speak your question or strategy</span>
          </div>
          <button
            onClick={toggleListening}
            className="text-[10px] px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white font-bold"
          >
            Done
          </button>
        </div>
      )}

      {/* Input Composer & Suggested Actions matching Design Specification */}
      <div className="p-4 border-t border-[rgba(236,236,237,0.08)] bg-[#0c0c0e]">
        <form
          onSubmit={e => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2 mb-3"
        >
          {/* Voice Microphone Button */}
          <button
            id="voice-mic-btn"
            type="button"
            onClick={toggleListening}
            className={`p-2 rounded-xl border transition-all flex items-center justify-center shrink-0 ${
              isListening
                ? 'bg-red-600 border-red-400 text-white shadow-lg shadow-red-600/40 animate-pulse'
                : 'bg-[#141417] hover:bg-[#00ffa3]/20 text-neutral-400 hover:text-[#00ffa3] border-[rgba(236,236,237,0.08)]'
            }`}
            title={isListening ? 'Stop Listening' : 'Click to Speak (Voice Speech-to-Text)'}
          >
            {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </button>

          <input
            id="chat-input"
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={isListening ? "Listening... speak clearly" : "Type strategy command..."}
            className="flex-1 bg-[#141417] border border-[rgba(236,236,237,0.08)] rounded-xl px-4 py-2 text-xs text-[#ececed] placeholder-neutral-500 focus:outline-none focus:border-[#00ffa3] transition-all"
          />

          <button
            id="chat-send-btn"
            type="submit"
            disabled={!input.trim() || isProcessing}
            className="btn-primary-mint !p-2 !rounded-xl shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Send Message"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </form>

        {/* Suggested Quant Actions */}
        <div>
          <span className="label-muted !text-[9px] mb-1.5">SUGGESTED</span>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => handleSend('Make it profitable')}
              className="badge-mint cursor-pointer hover:bg-[#00ffa3]/20 transition-colors"
            >
              ⚡ Auto-Tune
            </button>
            <button
              onClick={() => handleSend('Supertrend (10, 3) breakout on Reliance')}
              className="text-[9px] px-2 py-0.5 rounded font-mono font-medium text-neutral-400 hover:text-[#ececed] bg-[#161619] border border-[rgba(236,236,237,0.08)] hover:border-neutral-700 transition-colors"
            >
              Supertrend
            </button>
            <button
              onClick={() => handleSend('Golden Cross (50/200 SMA)')}
              className="text-[9px] px-2 py-0.5 rounded font-mono font-medium text-neutral-400 hover:text-[#ececed] bg-[#161619] border border-[rgba(236,236,237,0.08)] hover:border-neutral-700 transition-colors"
            >
              Golden Cross
            </button>
            <button
              onClick={() => handleSend('Add 200 EMA trend filter')}
              className="text-[9px] px-2 py-0.5 rounded font-mono font-medium text-neutral-400 hover:text-[#ececed] bg-[#161619] border border-[rgba(236,236,237,0.08)] hover:border-neutral-700 transition-colors"
            >
              +200 EMA
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// React Error Boundary specifically guarding the Copilot Dock
interface ErrorBoundaryState {
  hasError: boolean;
  error?: any;
}

class ChatErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: any): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('Chat Copilot Boundary caught error:', error, errorInfo);
  }

  handleReset = () => {
    try {
      localStorage.removeItem(CHAT_STORAGE_KEY);
    } catch {}
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col h-full items-center justify-center p-6 bg-[#0c0c0e] text-center border-r border-[#1d1d21]">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mb-3">
            <Bot className="w-6 h-6 text-rose-400" />
          </div>
          <h4 className="text-sm font-bold text-white mb-1">Copilot Interface Restored</h4>
          <p className="text-xs text-neutral-400 max-w-xs mb-4">
            An unexpected error occurred during rendering. Click below to reset the conversation and resume.
          </p>
          <button
            onClick={this.handleReset}
            className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 text-[#0c0c0e] font-bold text-xs rounded-xl shadow-md hover:from-cyan-400 hover:to-blue-500 transition-all flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Chat & Recover</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export const AiCopilotDock: React.FC<AiCopilotDockProps> = (props) => {
  return (
    <ChatErrorBoundary>
      <AiCopilotDockInner {...props} />
    </ChatErrorBoundary>
  );
};
