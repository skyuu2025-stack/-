
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { Language, UserProfile, ReadingType, ReadingResult } from './types';
import { TRANSLATIONS, Icons } from './constants';
import { Header } from './components/Header';
import { FortuneCard } from './components/FortuneCard';
import { PremiumModal } from './components/PremiumModal';
import { generateFortune } from './services/geminiService';

// --- Utils ---
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// --- Sub-Components ---
const HexagramLine: React.FC<{ type: 0 | 1; isChanging?: boolean }> = ({ type, isChanging }) => (
  <div className={`relative h-3 w-48 mx-auto flex gap-4 ${isChanging ? 'animate-pulse' : ''}`}>
    {type === 1 ? (
      <div className={`w-full h-full rounded-sm ${isChanging ? 'bg-orange-400 shadow-[0_0_15px_#fb923c]' : 'bg-yellow-500 shadow-[0_0_10px_#eab308]'}`} />
    ) : (
      <>
        <div className={`flex-1 h-full rounded-sm ${isChanging ? 'bg-orange-400 shadow-[0_0_15px_#fb923c]' : 'bg-yellow-500 shadow-[0_0_10px_#eab308]'}`} />
        <div className="w-12 h-full bg-transparent" />
        <div className={`flex-1 h-full rounded-sm ${isChanging ? 'bg-orange-400 shadow-[0_0_15px_#fb923c]' : 'bg-yellow-500 shadow-[0_0_10px_#eab308]'}`} />
      </>
    )}
  </div>
);

const VoiceWaveform: React.FC<{ frequencies: number[] }> = ({ frequencies }) => {
  const mirrored = [...[...frequencies.slice(0, 16)].reverse(), ...frequencies.slice(0, 16)];
  const intensity = frequencies.reduce((a, b) => a + b, 0) / frequencies.length;
  return (
    <div className="relative flex items-center justify-center h-24 w-full mb-4 overflow-hidden">
      <div className="absolute w-40 h-40 rounded-full bg-yellow-500/10 blur-3xl transition-transform duration-150" style={{ transform: `scale(${0.5 + intensity / 100})` }} />
      <div className="relative flex items-center justify-center gap-1 h-full z-10">
        {mirrored.map((v, i) => (
          <div key={i} className="w-1 rounded-full transition-all duration-100" style={{ height: `${Math.max(8, v)}%`, backgroundColor: v > 70 ? '#fef08a' : '#ca8a04', opacity: 0.2 + (v / 100) * 0.8 }} />
        ))}
      </div>
    </div>
  );
};

// --- Main App ---
const App: React.FC = () => {
  const [lang, setLang] = useState<Language>('zh');
  const t = TRANSLATIONS[lang] as any;

  const [isPremium, setIsPremium] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [currentReading, setCurrentReading] = useState<ReadingType | null>(null);
  const [readingResult, setReadingResult] = useState<ReadingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [frequencies, setFrequencies] = useState<number[]>(new Array(32).fill(10));

  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    const saved = localStorage.getItem('sage_profile');
    return saved ? JSON.parse(saved) : { name: '', birthDate: '', birthTime: '', gender: 'male', isPremium: false };
  });

  const audioContextInRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);

  useEffect(() => {
    localStorage.setItem('sage_profile', JSON.stringify(userProfile));
  }, [userProfile]);

  const startListening = async () => {
    if (isListening) return;
    setIsListening(true);
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    audioContextInRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    
    const updateProfileTool: FunctionDeclaration = {
      name: 'updateProfile',
      parameters: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          birthDate: { type: Type.STRING },
          birthTime: { type: Type.STRING },
          gender: { type: Type.STRING, enum: ['male', 'female', 'other'] }
        }
      }
    };

    const sessionPromise = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-09-2025',
      config: {
        responseModalities: [Modality.AUDIO],
        tools: [{ functionDeclarations: [updateProfileTool] }],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: lang === 'en' ? 'Zephyr' : 'Kore' } } }
      },
      callbacks: {
        onopen: async () => {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = audioContextInRef.current!.createMediaStreamSource(stream);
            const analyser = audioContextInRef.current!.createAnalyser();
            analyser.fftSize = 128;
            source.connect(analyser);
            analyserRef.current = analyser;
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const update = () => {
              if (analyserRef.current) {
                analyserRef.current.getByteFrequencyData(dataArray);
                setFrequencies(Array.from(dataArray.slice(0, 32)).map(v => (v / 255) * 100));
                animationFrameRef.current = requestAnimationFrame(update);
              }
            };
            update();
            const processor = audioContextInRef.current!.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              const input = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(input.length);
              for (let i = 0; i < input.length; i++) int16[i] = input[i] * 32768;
              sessionPromise.then(s => s.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } }));
            };
            source.connect(processor);
            processor.connect(audioContextInRef.current!.destination);
          } catch (e) { console.error(e); }
        },
        onmessage: async (msg: LiveServerMessage) => {
          if (msg.toolCall) {
            for (const fc of msg.toolCall.functionCalls) {
              if (fc.name === 'updateProfile') {
                setUserProfile(p => ({ ...p, ...fc.args }));
                sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { ok: true } } }));
              }
            }
          }
        },
        onclose: () => stopListening(),
        onerror: () => stopListening()
      }
    });
    sessionPromiseRef.current = sessionPromise;
  };

  const stopListening = () => {
    setIsListening(false);
    sessionPromiseRef.current?.then(s => s.close());
    sessionPromiseRef.current = null;
    audioContextInRef.current?.close();
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    analyserRef.current = null;
    setFrequencies(new Array(32).fill(10));
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = canvas.toDataURL('image/jpeg');
        setCapturedImage(imageData);
        const stream = video.srcObject as MediaStream;
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
        }
      }
    }
  };

  const handleStartReading = (type: ReadingType) => {
    if ((type === 'iching' || type === 'face') && !isPremium) {
      setShowPremiumModal(true);
      return;
    }
    setCurrentReading(type);
    setReadingResult(null);
    setCapturedImage(null);
    setIsEditingProfile(false);
    if (type === 'face') {
      setTimeout(async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
          if (videoRef.current) videoRef.current.srcObject = stream;
        } catch (e) { alert(t.cameraAccessError); }
      }, 100);
    }
  };

  const handleAnalyze = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!currentReading) return;
    setLoading(true);
    try {
      const res = await generateFortune(currentReading, userProfile, lang, capturedImage || undefined);
      setReadingResult(res);
    } catch (e) {
      alert("Heavenly report obscured. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // --- Specialized Renderers ---
  const getElementColor = (name: string) => {
    const n = name.toLowerCase();
    if (n.includes('wood') || n.includes('木')) return 'from-emerald-600 to-emerald-400';
    if (n.includes('fire') || n.includes('火')) return 'from-rose-600 to-rose-400';
    if (n.includes('earth') || n.includes('土')) return 'from-amber-800 to-amber-500';
    if (n.includes('metal') || n.includes('金')) return 'from-slate-300 to-slate-100';
    if (n.includes('water') || n.includes('水')) return 'from-blue-700 to-blue-400';
    return 'from-yellow-600 to-yellow-400';
  };

  const renderBaziReport = (result: ReadingResult) => {
    const chart = result.baziChart;
    return (
      <div className="max-w-4xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-1000">
        <div className="text-center">
          <div className="inline-block px-4 py-1 rounded-full border border-yellow-500/30 text-yellow-500 text-[10px] font-cinzel mb-4 uppercase tracking-[0.2em]">{t.baziTitle}</div>
          <h2 className="text-5xl font-bold gold-gradient font-cinzel">{result.title}</h2>
          {chart && <p className="text-xl text-gray-400 mt-2 italic">Day Master: <span className="text-yellow-400 font-bold">{chart.dayMaster}</span></p>}
        </div>

        {chart && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {chart.pillars?.map((p, i) => (
                <div key={i} className="glass-card p-6 rounded-3xl border-t-4 border-t-yellow-500/40 text-center">
                  <span className="text-[10px] text-gray-500 uppercase tracking-widest mb-4 block">{p.label}</span>
                  <div className="text-4xl font-serif-zh flex flex-col mb-4">
                    <span className="text-yellow-400">{p.stem}</span>
                    <span className="text-orange-400">{p.branch}</span>
                  </div>
                  <p className="text-[10px] text-gray-400 leading-relaxed italic">{p.interpretation}</p>
                </div>
              ))}
            </div>
            
            <div className="glass-card p-8 md:p-12 rounded-[2.5rem] border border-white/5 relative overflow-hidden">
               <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none">
                  <Icons.Bazi />
               </div>
               <div className="text-center mb-12">
                 <h3 className="text-xs font-bold text-yellow-500 uppercase tracking-[0.5em] mb-2">Elemental Strength</h3>
                 <p className="text-[10px] text-gray-500 uppercase tracking-widest italic">The balance of cosmic energies at your birth</p>
               </div>
               <div className="flex justify-between items-end h-56 gap-4 md:gap-10 max-w-2xl mx-auto">
                 {chart.fiveElements?.map((el, i) => (
                   <div key={i} className="flex-1 flex flex-col items-center gap-6 group/bar relative">
                     <div className="w-full relative flex flex-col items-center">
                        <span className="absolute -top-8 text-[11px] font-bold text-white bg-slate-800/80 px-2 py-1 rounded-md opacity-0 group-hover/bar:opacity-100 transition-all duration-300 transform translate-y-2 group-hover/bar:translate-y-0">
                          {el.strength}%
                        </span>
                        
                        <div className="w-full bg-slate-950/60 rounded-t-2xl h-56 relative overflow-hidden shadow-2xl border border-white/5 group-hover/bar:border-white/20 transition-all">
                           <div 
                             className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t ${getElementColor(el.element)} transition-all duration-1000 ease-out shadow-[0_0_20px_rgba(255,255,255,0.05)]`}
                             style={{ height: `${el.strength}%` }} 
                           />
                           <div className="absolute inset-0 bg-gradient-to-r from-white/10 to-transparent opacity-30 pointer-events-none" />
                        </div>
                     </div>
                     <div className="text-center">
                        <span className="text-[12px] font-bold text-gray-400 uppercase tracking-[0.2em] group-hover/bar:text-yellow-500 transition-colors block mb-1">{el.element}</span>
                        <div className={`h-1 w-8 mx-auto rounded-full bg-gradient-to-r ${getElementColor(el.element)} opacity-50`} />
                     </div>
                   </div>
                 ))}
               </div>
            </div>
          </>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {result.details?.map((d, i) => (
            <div key={i} className="glass-card p-8 rounded-3xl border-l-4 border-l-yellow-500 hover:border-l-yellow-400 transition-all">
              <h4 className="text-yellow-500 font-bold mb-3 uppercase text-[10px] tracking-widest">{d.category}</h4>
              <p className="text-gray-300 text-sm leading-relaxed">{d.content}</p>
            </div>
          ))}
        </div>
        <button onClick={() => { setReadingResult(null); setCurrentReading(null); }} className="w-full py-6 bg-white/5 border border-white/10 rounded-2xl text-[10px] font-bold uppercase tracking-[0.5em] text-white hover:bg-yellow-500/5 transition-all">Return to Sanctuary</button>
      </div>
    );
  };

  const renderIChingReport = (result: ReadingResult) => {
    const hex = result.hexagram;
    return (
      <div className="max-w-2xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-1000">
        <div className="text-center">
          <div className="inline-block px-4 py-1 rounded-full border border-yellow-500/30 text-yellow-500 text-[10px] font-cinzel mb-4 uppercase tracking-[0.2em]">{t.ichingTitle}</div>
          <h2 className="text-6xl font-bold gold-gradient font-cinzel">{hex?.name || result.title}</h2>
          <p className="text-lg text-gray-400 mt-4 italic">"{result.summary}"</p>
        </div>
        {hex && (
          <div className="glass-card py-16 px-8 rounded-[3rem] border border-white/5 shadow-[0_0_50px_rgba(234,179,8,0.1)]">
            <div className="flex flex-col-reverse gap-6">
              {hex.lines?.map((l, i) => <HexagramLine key={i} type={l as 0 | 1} isChanging={hex.changingLines?.includes(i + 1)} />)}
            </div>
          </div>
        )}
        {hex?.interpretation && (
          <div className="glass-card p-10 rounded-[2.5rem] border-l-4 border-l-yellow-500 bg-yellow-500/5">
            <h3 className="text-xs font-bold text-yellow-500 uppercase tracking-widest mb-4">Master's Interpretation</h3>
            <p className="text-gray-200 leading-loose text-lg font-serif-zh">{hex.interpretation}</p>
          </div>
        )}
        <div className="grid grid-cols-1 gap-4">
          {result.details?.map((d, i) => (
            <div key={i} className="glass-card p-8 rounded-2xl border border-white/5">
              <h4 className="text-yellow-500 font-bold mb-2 uppercase text-[10px] tracking-widest">{d.category}</h4>
              <p className="text-gray-300 text-sm leading-relaxed">{d.content}</p>
            </div>
          ))}
        </div>
        <button onClick={() => { setReadingResult(null); setCurrentReading(null); }} className="w-full py-6 border border-white/10 rounded-2xl text-[10px] font-bold uppercase tracking-[0.5em] text-white hover:bg-yellow-500/5 transition-all">Ascend</button>
      </div>
    );
  };

  const renderFaceReport = (result: ReadingResult) => (
    <div className="max-w-4xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-1000">
      <div className="flex flex-col md:flex-row gap-12 items-center">
        <div className="w-72 h-96 rounded-[3rem] overflow-hidden border-2 border-yellow-500/30 shadow-2xl shrink-0 group">
          <img src={capturedImage!} className="w-full h-full object-cover grayscale sepia brightness-95 group-hover:scale-110 transition-transform duration-[3s]" alt="Face Report" />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 to-transparent" />
        </div>
        <div className="text-center md:text-left space-y-6">
          <div className="inline-block px-4 py-1 rounded-full border border-yellow-500/30 text-yellow-500 text-[10px] font-cinzel tracking-widest uppercase">{t.faceTitle}</div>
          <h2 className="text-5xl font-bold gold-gradient font-cinzel">Physiognomy Report</h2>
          <div className="text-5xl font-cinzel text-yellow-500 font-bold">{result.score}<span className="text-sm text-gray-500 ml-2 tracking-widest">/ 100</span></div>
          <p className="text-lg text-gray-400 italic font-light leading-relaxed max-w-lg">"{result.summary}"</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {result.details?.map((d, i) => {
          const categoryKey = d.category.split(' ')[0].toLowerCase();
          const Icon = (Icons as any)[Object.keys(Icons).find(k => k.toLowerCase() === categoryKey) || 'Face'] || Icons.Face;
          return (
            <div key={i} className="glass-card p-8 rounded-[2.5rem] border border-white/5 flex gap-8 group hover:border-yellow-500/30 transition-all">
              <div className="w-14 h-14 rounded-2xl bg-yellow-500/5 border border-yellow-500/10 flex items-center justify-center text-yellow-500 group-hover:bg-yellow-500/20 group-hover:scale-110 transition-all shrink-0"><Icon /></div>
              <div>
                <h4 className="text-yellow-500 font-bold mb-3 uppercase tracking-widest text-[10px]">{d.category}</h4>
                <p className="text-gray-300 text-sm leading-relaxed font-light">{d.content}</p>
              </div>
            </div>
          );
        })}
      </div>
      <button onClick={() => { setReadingResult(null); setCurrentReading(null); setCapturedImage(null); }} className="w-full py-6 border border-white/10 rounded-2xl text-[10px] font-bold uppercase tracking-[0.5em] text-white hover:bg-yellow-500/5 transition-all">Conclude Session</button>
    </div>
  );

  const renderDailyReport = (result: ReadingResult) => (
    <div className="max-w-2xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-1000">
      <div className="text-center">
        <div className="inline-block px-4 py-1 rounded-full border border-yellow-500/30 text-yellow-500 text-[10px] font-cinzel mb-4 uppercase tracking-[0.2em]">{t.dailyTitle}</div>
        <h2 className="text-5xl font-bold gold-gradient font-cinzel">{result.score}<span className="text-xl text-gray-500 ml-3">/ 100</span></h2>
        <p className="text-lg text-gray-300 italic mt-6 leading-relaxed">"{result.summary}"</p>
      </div>
      <div className="grid grid-cols-1 gap-6">
        {result.details?.map((d, i) => (
          <div key={i} className="glass-card p-8 rounded-[2rem] border-l-4 border-l-yellow-500/40 hover:border-l-yellow-500 transition-all">
            <h4 className="text-yellow-500 font-bold mb-2 uppercase tracking-widest text-[10px]">{d.category}</h4>
            <p className="text-gray-300 text-sm leading-relaxed">{d.content}</p>
          </div>
        ))}
      </div>
      <button onClick={() => { setReadingResult(null); setCurrentReading(null); }} className="w-full py-6 border border-white/10 rounded-2xl text-[10px] font-bold uppercase tracking-[0.5em] text-white hover:bg-yellow-500/5 transition-all">Return Home</button>
    </div>
  );

  // --- Main Render Flow ---
  return (
    <div className="min-h-screen pb-20 overflow-x-hidden">
      <Header lang={lang} t={t} setLang={setLang} isPremium={isPremium} onShowPremium={() => setShowPremiumModal(true)} onShowProfile={() => setIsEditingProfile(true)} onGoHome={() => { setCurrentReading(null); setReadingResult(null); setIsEditingProfile(false); stopListening(); if (videoRef.current) (videoRef.current.srcObject as MediaStream)?.getTracks().forEach(t => t.stop()); }} />
      <main className="pt-32 px-6 max-w-7xl mx-auto">
        {isEditingProfile ? (
          <div className="min-h-[60vh] flex items-center justify-center">
            <div className="max-w-lg w-full glass-card p-10 rounded-[2.5rem] animate-in zoom-in-95 duration-500">
              <h2 className="text-2xl font-bold gold-gradient font-cinzel mb-10">{t.profile}</h2>
              <form onSubmit={e => { e.preventDefault(); setIsEditingProfile(false); stopListening(); }} className="space-y-8">
                <div className="space-y-6">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">{t.inputName}</label>
                    <input type="text" required className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:border-yellow-500/40" value={userProfile.name} onChange={e => setUserProfile(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <input type="date" required className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-4 text-white" value={userProfile.birthDate} onChange={e => setUserProfile(p => ({ ...p, birthDate: e.target.value }))} />
                    <input type="time" className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-4 text-white" value={userProfile.birthTime} onChange={e => setUserProfile(p => ({ ...p, birthTime: e.target.value }))} />
                  </div>
                </div>
                <button type="submit" className="w-full py-5 bg-yellow-500 text-slate-950 font-bold rounded-2xl shadow-xl">{t.save}</button>
              </form>
            </div>
          </div>
        ) : !currentReading ? (
          <div className="flex flex-col items-center">
            <div className="text-center mb-20 animate-in fade-in slide-in-from-top-12 duration-1000">
              <div className="oracle-eye"><div className="oracle-inner"></div></div>
              <h1 className="text-6xl md:text-8xl font-cinzel font-bold mb-6 gold-gradient tracking-[0.2em] uppercase">{t.welcome}</h1>
              <p className="text-xl text-gray-400 max-w-2xl mx-auto italic font-light">{t.tagline}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 w-full">
              <FortuneCard title={t.baziTitle} description={lang === 'zh' ? '探究生辰八字中的天干地支' : 'Discover stems and branches.'} icon={<Icons.Bazi />} onClick={() => handleStartReading('bazi')} />
              <FortuneCard title={t.dailyTitle} description={lang === 'zh' ? '获悉今日专属的能量波动' : 'Daily energy fluctuations.'} icon={<Icons.Daily />} onClick={() => handleStartReading('daily')} />
              <FortuneCard title={t.ichingTitle} description={lang === 'zh' ? '感应六十四卦的玄妙变化' : 'Ancient wisdom hexagrams.'} icon={<Icons.IChing />} isLocked={!isPremium} onClick={() => handleStartReading('iching')} />
              <FortuneCard title={t.faceTitle} description={lang === 'zh' ? '洞察法相背后的旦夕祸福' : 'AI physiognomy insights.'} icon={<Icons.Face />} isLocked={!isPremium} onClick={() => handleStartReading('face')} />
            </div>
          </div>
        ) : (
          <div className="min-h-[60vh] flex flex-col items-center justify-center">
            {loading ? (
              <div className="text-center space-y-8">
                <div className="w-16 h-16 border-4 border-yellow-500/20 border-t-yellow-500 rounded-full animate-spin mx-auto" />
                <p className="text-2xl font-cinzel tracking-[0.3em] text-yellow-500 animate-pulse uppercase">{t.loading}</p>
              </div>
            ) : readingResult ? (
              currentReading === 'bazi' ? renderBaziReport(readingResult) :
              currentReading === 'iching' ? renderIChingReport(readingResult) :
              currentReading === 'face' ? renderFaceReport(readingResult) :
              renderDailyReport(readingResult)
            ) : (currentReading === 'face' ? (
              <div className="max-w-md w-full space-y-8 animate-in fade-in zoom-in-95 duration-500">
                <div className="text-center"><h2 className="text-3xl font-bold gold-gradient font-cinzel">{t.faceTitle}</h2></div>
                <div className="relative aspect-[3/4] bg-slate-900 rounded-[3rem] overflow-hidden border-2 border-yellow-500/20">
                  {!capturedImage ? (
                    <>
                      <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover scale-x-[-1]" />
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-64 h-80 border-2 border-dashed border-yellow-500/30 rounded-[3rem] animate-pulse" />
                      </div>
                      <button onClick={capturePhoto} className="absolute bottom-8 left-1/2 -translate-x-1/2 w-16 h-16 rounded-full bg-white border-4 border-yellow-500/40" />
                    </>
                  ) : <img src={capturedImage} className="w-full h-full object-cover scale-x-[-1]" alt="Photo" />}
                </div>
                {capturedImage && <button onClick={handleAnalyze} className="w-full py-5 bg-yellow-500 text-slate-950 font-bold rounded-2xl shadow-xl">{t.analyzeFace}</button>}
                <button onClick={() => { (videoRef.current?.srcObject as MediaStream)?.getTracks().forEach(track => track.stop()); setCurrentReading(null); }} className="w-full py-2 text-gray-500 uppercase text-[10px] font-bold tracking-widest">Back</button>
                <canvas ref={canvasRef} className="hidden" />
              </div>
            ) : (
              <div className="max-w-lg w-full glass-card p-10 rounded-[2.5rem] animate-in zoom-in-95 duration-500">
                <div className="flex items-center justify-between mb-10">
                  <h2 className="text-2xl font-bold gold-gradient font-cinzel">{t[`${currentReading}Title`] || t.baziTitle}</h2>
                  <button type="button" onClick={isListening ? stopListening : startListening} className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all ${isListening ? 'bg-yellow-500 text-slate-950 border-yellow-500' : 'bg-yellow-500/5 border-yellow-500/20 text-yellow-500'}`}>
                    <Icons.Mic className={isListening ? "w-4 h-4 animate-bounce" : "w-4 h-4"} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">{isListening ? t.voiceStop : t.voiceFill}</span>
                  </button>
                </div>
                {isListening && <VoiceWaveform frequencies={frequencies} />}
                <form onSubmit={handleAnalyze} className="space-y-8">
                  <div className="space-y-6">
                    <input type="text" required placeholder={t.inputName} className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:border-yellow-500/50 outline-none transition-all" value={userProfile.name} onChange={e => setUserProfile(p => ({ ...p, name: e.target.value }))} />
                    <div className="grid grid-cols-2 gap-4">
                      <input type="date" required className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-4 text-white outline-none" value={userProfile.birthDate} onChange={e => setUserProfile(p => ({ ...p, birthDate: e.target.value }))} />
                      <input type="time" className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-4 text-white outline-none" value={userProfile.birthTime} onChange={e => setUserProfile(p => ({ ...p, birthTime: e.target.value }))} />
                    </div>
                    {currentReading === 'iching' && (
                      <div className="space-y-2">
                         <label className="text-[10px] font-bold text-yellow-500/70 uppercase tracking-widest ml-1">{t.ichingQuestionLabel}</label>
                         <textarea 
                           required 
                           placeholder={t.ichingPlaceholder} 
                           className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:border-yellow-500/50 outline-none transition-all h-24 resize-none"
                           value={userProfile.ichingQuestion || ''}
                           onChange={e => setUserProfile(p => ({ ...p, ichingQuestion: e.target.value }))}
                         />
                      </div>
                    )}
                  </div>
                  <button type="submit" disabled={isListening} className="w-full py-5 bg-yellow-500 text-slate-950 font-bold rounded-2xl shadow-xl hover:scale-[1.02] transition-all">{t.analyze}</button>
                  <button type="button" onClick={() => setCurrentReading(null)} className="w-full text-gray-500 text-[10px] uppercase font-bold tracking-widest">Back</button>
                </form>
              </div>
            ))}
          </div>
        )}
      </main>
      {showPremiumModal && <PremiumModal t={t} onClose={() => setShowPremiumModal(false)} onUpgrade={() => { setIsPremium(true); setShowPremiumModal(false); }} />}
      <footer className="fixed bottom-6 left-0 right-0 pointer-events-none text-center opacity-20">
        <p className="text-[10px] font-cinzel tracking-[0.8em] uppercase">Celestial Oracle &bull; Sinology AI &bull; Est MMXXIV</p>
      </footer>
    </div>
  );
};

export default App;
