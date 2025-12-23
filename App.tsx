
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { Language, UserProfile, ReadingType, ReadingResult } from './types';
import { TRANSLATIONS, Icons } from './constants';
import { Header } from './components/Header';
import { FortuneCard } from './components/FortuneCard';
import { PremiumModal } from './components/PremiumModal';
import { generateFortune } from './services/geminiService';

// Audio Utils
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
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

const HexagramLine: React.FC<{ type: 0 | 1; isChanging?: boolean }> = ({ type, isChanging }) => {
  return (
    <div className={`relative h-3 w-48 mx-auto flex gap-4 ${isChanging ? 'animate-pulse' : ''}`}>
      {type === 1 ? (
        <div className={`w-full h-full rounded-sm shadow-[0_0_10px_rgba(234,179,8,0.4)] ${isChanging ? 'bg-orange-400 shadow-[0_0_15px_rgba(251,146,60,0.6)]' : 'bg-yellow-500'}`} />
      ) : (
        <>
          <div className={`flex-1 h-full rounded-sm shadow-[0_0_10px_rgba(234,179,8,0.4)] ${isChanging ? 'bg-orange-400 shadow-[0_0_15px_rgba(251,146,60,0.6)]' : 'bg-yellow-500'}`} />
          <div className="w-12 h-full bg-transparent" />
          <div className={`flex-1 h-full rounded-sm shadow-[0_0_10px_rgba(234,179,8,0.4)] ${isChanging ? 'bg-orange-400 shadow-[0_0_15px_rgba(251,146,60,0.6)]' : 'bg-yellow-500'}`} />
        </>
      )}
      {isChanging && (
        <div className="absolute -right-8 top-1/2 -translate-y-1/2 text-orange-400 font-bold text-lg animate-bounce">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
          </svg>
        </div>
      )}
    </div>
  );
};

const VoiceWaveform: React.FC = () => {
  return (
    <div className="flex items-end justify-center gap-[3px] h-12 w-full mb-2">
      {[...Array(20)].map((_, i) => (
        <div
          key={i}
          className="w-[3px] bg-yellow-500 rounded-full"
          style={{
            height: `${20 + Math.random() * 80}%`,
            transition: 'height 0.1s ease-in-out'
          }}
        />
      ))}
    </div>
  );
};

const App: React.FC = () => {
  const [lang, setLang] = useState<Language>('zh');
  const [isPremium, setIsPremium] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [currentReading, setCurrentReading] = useState<ReadingType | null>(null);
  const [readingResult, setReadingResult] = useState<ReadingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    try {
      const saved = localStorage.getItem('celestial_sage_profile');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error("Failed to load profile", e);
    }
    return {
      name: '',
      birthDate: '',
      birthTime: '',
      gender: 'male',
      isPremium: false
    };
  });

  const audioContextInRef = useRef<AudioContext | null>(null);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    localStorage.setItem('celestial_sage_profile', JSON.stringify(userProfile));
  }, [userProfile]);

  const t = TRANSLATIONS[lang] as any;

  const startListening = async () => {
    if (isListening) return;
    setIsListening(true);

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    audioContextInRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    audioContextOutRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

    const updateProfileTool: FunctionDeclaration = {
      name: 'updateProfile',
      description: 'Update user profile details based on voice input',
      parameters: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: 'Full name' },
          birthDate: { type: Type.STRING, description: 'Birth date in YYYY-MM-DD format' },
          birthTime: { type: Type.STRING, description: 'Birth time in HH:mm 24h format' },
          gender: { type: Type.STRING, enum: ['male', 'female', 'other'], description: 'User gender' }
        }
      }
    };

    const sessionPromise = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-09-2025',
      config: {
        responseModalities: [Modality.AUDIO],
        tools: [{ functionDeclarations: [updateProfileTool] }],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: lang === 'en' ? 'Zephyr' : 'Kore' } }
        },
        systemInstruction: `You are the Celestial Sage Voice Assistant. Help the user fill their destiny profile. 
        If they speak, extract their name, birth date, time, and gender.
        ALWAYS use the updateProfile tool to save any information found. 
        Current language: ${lang}. Confirm the details in a mystical, reassuring tone.`
      },
      callbacks: {
        onopen: async () => {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = audioContextInRef.current!.createMediaStreamSource(stream);
            const processor = audioContextInRef.current!.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } });
              });
            };
            source.connect(processor);
            processor.connect(audioContextInRef.current!.destination);
          } catch (err) {
            console.error("Audio access error", err);
          }
        },
        onmessage: async (msg: LiveServerMessage) => {
          if (msg.toolCall) {
            for (const fc of msg.toolCall.functionCalls) {
              if (fc.name === 'updateProfile') {
                setUserProfile(prev => ({ ...prev, ...fc.args }));
                sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { status: 'success' } } }));
              }
            }
          }
          const audioData = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
          if (audioData && audioContextOutRef.current) {
            const buffer = await decodeAudioData(decode(audioData), audioContextOutRef.current, 24000, 1);
            const source = audioContextOutRef.current.createBufferSource();
            source.buffer = buffer;
            source.connect(audioContextOutRef.current.destination);
            const startTime = Math.max(nextStartTimeRef.current, audioContextOutRef.current.currentTime);
            source.start(startTime);
            nextStartTimeRef.current = startTime + buffer.duration;
            activeSourcesRef.current.add(source);
            source.onended = () => activeSourcesRef.current.delete(source);
          }
        },
        onclose: () => stopListening(),
        onerror: (e) => { console.error("Live Error", e); stopListening(); }
      }
    });
    sessionPromiseRef.current = sessionPromise;
  };

  const stopListening = () => {
    setIsListening(false);
    sessionPromiseRef.current?.then(s => s.close());
    sessionPromiseRef.current = null;
    audioContextInRef.current?.close();
    audioContextOutRef.current?.close();
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      alert(t.cameraAccessError);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        ctx.drawImage(videoRef.current, 0, 0);
        const dataUrl = canvasRef.current.toDataURL('image/jpeg');
        setCapturedImage(dataUrl);
        stopCamera();
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
      setTimeout(startCamera, 100);
    }
  };

  const handleAnalyze = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!currentReading) return;
    setLoading(true);
    try {
      const result = await generateFortune(currentReading, userProfile, lang, capturedImage || undefined);
      setReadingResult(result);
    } catch (error) {
      console.error(error);
      alert("Error calculating destiny. Try again later.");
    } finally {
      setLoading(false);
    }
  };

  const renderFaceCapture = () => (
    <div className="max-w-lg mx-auto glass-card p-8 rounded-3xl animate-in zoom-in-95 duration-500 shadow-2xl relative overflow-hidden text-center">
      <h2 className="text-2xl font-bold gold-gradient font-cinzel mb-6">{t.faceTitle}</h2>
      {!capturedImage ? (
        <div className="relative aspect-[3/4] bg-slate-900 rounded-2xl border-2 border-yellow-500/20 overflow-hidden mb-8 group">
          <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover scale-x-[-1]" />
          <div className="absolute inset-0 pointer-events-none border-[20px] border-slate-950/40">
            <div className="w-full h-full border-2 border-dashed border-yellow-500/40 rounded-[100px] absolute inset-[10%]" />
          </div>
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute bottom-6 left-0 right-0 flex justify-center">
            <button onClick={capturePhoto} className="w-16 h-16 rounded-full bg-white flex items-center justify-center border-4 border-yellow-500 shadow-[0_0_20px_rgba(255,255,255,0.4)] hover:scale-110 active:scale-95 transition-all">
              <div className="w-12 h-12 rounded-full border-2 border-slate-950" />
            </button>
          </div>
        </div>
      ) : (
        <div className="relative aspect-[3/4] rounded-2xl border-2 border-yellow-500/50 overflow-hidden mb-8">
          <img src={capturedImage} className="w-full h-full object-cover scale-x-[-1]" />
          <div className="absolute top-0 left-0 right-0 h-1 bg-yellow-500 animate-scan-line shadow-[0_0_15px_#eab308]" />
        </div>
      )}
      <div className="flex gap-4">
        {capturedImage ? (
          <button onClick={() => { setCapturedImage(null); handleAnalyze(); }} className="flex-1 py-4 bg-yellow-500 text-slate-950 font-bold rounded-2xl hover:scale-[1.02] transition-all">{t.analyzeFace}</button>
        ) : (
          <button onClick={() => { setCurrentReading(null); stopCamera(); }} className="w-full py-2 text-gray-500">{lang === 'en' ? 'Back' : '返回'}</button>
        )}
      </div>
    </div>
  );

  const renderBaziResult = (result: ReadingResult) => {
    if (!result.baziChart) return null;
    const { pillars, dayMaster, fiveElements } = result.baziChart;

    const pillarMetadata: Record<string, { influence: string, stage: string, relationship: string }> = {
      Year: {
        influence: lang === 'en' ? 'Ancestry & Roots' : '祖荫与根基',
        stage: lang === 'en' ? 'Age 0 - 18' : '0 - 18 岁 (幼年)',
        relationship: lang === 'en' ? 'Grandparents & Heritage' : '祖辈与家族传承'
      },
      Month: {
        influence: lang === 'en' ? 'Parents & Career' : '父母与事业',
        stage: lang === 'en' ? 'Age 19 - 35' : '19 - 35 岁 (青年)',
        relationship: lang === 'en' ? 'Parents & Siblings' : '父母与同辈'
      },
      Day: {
        influence: lang === 'en' ? 'Self & Spouse' : '自身与配偶',
        stage: lang === 'en' ? 'Age 36 - 55' : '36 - 55 岁 (中年)',
        relationship: lang === 'en' ? 'Your Essence & Partner' : '自身元神与配偶'
      },
      Hour: {
        influence: lang === 'en' ? 'Children & Legacy' : '子女与晚年',
        stage: lang === 'en' ? 'Age 56+' : '56 岁以后 (晚年)',
        relationship: lang === 'en' ? 'Children & Followers' : '子女与后辈'
      }
    };

    return (
      <div className="max-w-4xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-1000">
        <div className="text-center space-y-4">
          <div className="inline-block px-4 py-1 rounded-full border border-yellow-500/30 text-yellow-500 text-sm font-cinzel tracking-widest uppercase">{t.baziTitle}</div>
          <h2 className="text-5xl font-bold gold-gradient font-cinzel">{userProfile.name || 'Seeker'}'s Oracle</h2>
          <p className="text-lg text-gray-400 italic leading-relaxed">"{result.summary}"</p>
        </div>
        
        {/* Four Pillars Visual Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {pillars.map((pillar, idx) => (
            <div key={idx} className={`glass-card p-6 rounded-3xl text-center border-t-4 transition-transform hover:scale-105 ${pillar.stem === dayMaster ? 'border-t-yellow-500 bg-yellow-500/10 shadow-[0_0_30px_rgba(234,179,8,0.1)]' : 'border-t-white/10'}`}>
              <div className="text-[10px] font-cinzel text-gray-500 uppercase tracking-widest mb-1">{pillar.label}</div>
              <div className="text-[8px] text-yellow-500/60 font-bold uppercase tracking-widest mb-4">{pillarMetadata[pillar.label].influence}</div>
              <div className="space-y-2">
                <div className="text-4xl font-serif-zh font-bold text-white">{pillar.stem}</div>
                <div className="text-4xl font-serif-zh font-bold text-white">{pillar.branch}</div>
              </div>
              <div className="mt-4 text-[10px] font-bold text-yellow-500/60 uppercase tracking-widest">{pillar.element}</div>
              {pillar.stem === dayMaster && <div className="mt-2 text-[8px] bg-yellow-500 text-slate-950 px-2 py-0.5 rounded-full inline-block font-bold">DAY MASTER</div>}
            </div>
          ))}
        </div>

        {/* Detailed Individual Pillar Interpretations Section */}
        <div className="space-y-10">
          <div className="text-center space-y-2">
            <h3 className="text-2xl font-bold text-yellow-400 font-cinzel tracking-[0.2em] uppercase">The Pillars of Destiny</h3>
            <div className="h-[2px] w-24 bg-yellow-500/30 mx-auto"></div>
            <p className="text-gray-500 text-xs max-w-xl mx-auto leading-relaxed">
              Your existence is built upon four sacred temporal pillars. Each governs a unique stage of your journey, a specific set of relationships, and a core aspect of your soul's influence on the physical plane.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {pillars.map((pillar, idx) => {
              const meta = pillarMetadata[pillar.label];
              return (
                <div key={idx} className="glass-card p-8 rounded-[2.5rem] border border-white/5 hover:border-yellow-500/30 transition-all shadow-2xl relative overflow-hidden group">
                  {/* Decorative Background Icon */}
                  <div className="absolute -right-4 -bottom-4 opacity-5 text-yellow-500 transform scale-150 rotate-12 group-hover:scale-[1.8] transition-transform duration-700 pointer-events-none">
                    <Icons.Bazi />
                  </div>

                  <div className="flex flex-col h-full relative z-10">
                    <div className="flex items-start justify-between mb-6">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-yellow-500/10 flex items-center justify-center text-yellow-500 font-bold text-lg shadow-inner border border-yellow-500/20">
                          {idx + 1}
                        </div>
                        <div>
                          <h4 className="text-yellow-400 font-bold uppercase tracking-widest text-base font-cinzel">{pillar.label} Pillar</h4>
                          <p className="text-[10px] text-gray-500 font-bold tracking-[0.1em] uppercase">{meta.influence}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-serif-zh font-bold text-white/90">{pillar.stem}{pillar.branch}</div>
                        <div className="text-[9px] text-yellow-500/40 font-bold uppercase tracking-tighter">{pillar.element}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-6">
                      <div className="bg-white/5 p-3 rounded-2xl border border-white/5">
                        <span className="block text-[8px] text-gray-500 font-bold uppercase tracking-widest mb-1">Life Stage</span>
                        <span className="text-[10px] text-white font-medium">{meta.stage}</span>
                      </div>
                      <div className="bg-white/5 p-3 rounded-2xl border border-white/5">
                        <span className="block text-[8px] text-gray-500 font-bold uppercase tracking-widest mb-1">Key Connection</span>
                        <span className="text-[10px] text-white font-medium">{meta.relationship}</span>
                      </div>
                    </div>

                    <div className="flex-1">
                      <p className="text-gray-300 text-sm leading-relaxed italic font-light relative">
                        <span className="text-3xl text-yellow-500/20 font-serif absolute -left-4 -top-2">"</span>
                        {pillar.interpretation}
                        <span className="text-3xl text-yellow-500/20 font-serif absolute -right-4 bottom-0">"</span>
                      </p>
                    </div>

                    <div className="mt-8 pt-4 border-t border-white/5 flex items-center justify-between">
                      <div className="flex gap-2">
                        <div className="w-2 h-2 rounded-full bg-yellow-500/40"></div>
                        <div className="w-2 h-2 rounded-full bg-yellow-500/20"></div>
                        <div className="w-2 h-2 rounded-full bg-yellow-500/10"></div>
                      </div>
                      <span className="text-[8px] text-gray-600 font-bold uppercase tracking-[0.4em]">Oracle Verified</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Elemental Balance */}
        <div className="glass-card p-10 rounded-[3rem] border border-white/5">
          <div className="text-center mb-10">
            <h3 className="text-xl font-bold text-yellow-400 font-cinzel uppercase tracking-[0.3em]">Elemental Equilibrium</h3>
            <p className="text-[10px] text-gray-500 mt-2 uppercase tracking-widest font-bold">The cosmic balance of the five phases</p>
          </div>
          <div className="grid grid-cols-5 gap-6 max-w-2xl mx-auto">
            {fiveElements.map((el, idx) => (
              <div key={idx} className="space-y-4">
                <div className="relative h-48 bg-slate-950/40 rounded-full border border-white/5 overflow-hidden flex flex-col justify-end p-1">
                  <div 
                    className="w-full bg-gradient-to-t from-yellow-600 to-yellow-300 transition-all duration-1000 delay-500 rounded-full shadow-[0_0_20px_rgba(234,179,8,0.3)]" 
                    style={{ height: `${el.strength}%` }} 
                  />
                </div>
                <div className="text-center">
                  <div className="text-[10px] font-bold text-white uppercase tracking-wider">{el.element}</div>
                  <div className="text-[11px] text-yellow-500/60 font-cinzel font-bold">{el.strength}%</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Overall Detailed Analysis */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {result.details.map((item, idx) => (
            <div key={idx} className="glass-card p-8 rounded-3xl border-l-2 border-yellow-500/30 hover:border-yellow-500 transition-all">
              <h4 className="text-yellow-400 font-bold mb-4 uppercase tracking-widest text-sm font-cinzel">{item.category}</h4>
              <p className="text-gray-300 leading-relaxed font-light">{item.content}</p>
            </div>
          ))}
        </div>
        
        <button onClick={() => { setReadingResult(null); setCurrentReading(null); }} className="w-full py-8 border border-white/10 rounded-2xl hover:border-yellow-500/50 transition-all text-xs font-bold uppercase tracking-[0.4em] text-white bg-white/5 hover:bg-yellow-500/5 shadow-inner">Ascend from the Altar</button>
      </div>
    );
  };

  const renderFaceResult = (result: ReadingResult) => {
    return (
      <div className="max-w-4xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-1000">
        <div className="text-center space-y-4">
          <div className="inline-block px-4 py-1 rounded-full border border-yellow-500/30 text-yellow-500 text-sm font-cinzel tracking-widest uppercase">{t.faceTitle}</div>
          <h2 className="text-5xl font-bold gold-gradient font-cinzel">Physiognomy Oracle</h2>
          <div className="flex items-center justify-center gap-4">
            <span className="text-gray-500 uppercase text-[10px] tracking-[0.3em]">Fortune Score</span>
            <span className="text-3xl font-cinzel font-bold text-yellow-500">{result.score}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Central Portrait Display */}
          <div className="lg:col-span-5 flex flex-col items-center">
             <div className="relative group">
                <div className="absolute -inset-4 bg-yellow-500/10 blur-2xl rounded-full opacity-50 group-hover:opacity-100 transition-opacity"></div>
                <div className="relative w-72 h-72 md:w-80 md:h-80 rounded-full border-4 border-yellow-500/40 p-2 shadow-2xl overflow-hidden transform hover:scale-[1.02] transition-transform duration-700">
                   <img src={capturedImage || ''} className="w-full h-full object-cover rounded-full scale-x-[-1]" alt="Face Analysis" />
                   <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 to-transparent pointer-events-none"></div>
                   <div className="absolute top-0 left-0 right-0 h-1 bg-yellow-500/40 animate-scan-line"></div>
                </div>
             </div>
             <div className="mt-8 glass-card p-6 rounded-[2rem] border-white/5 w-full">
                <p className="text-gray-300 italic text-sm leading-relaxed text-center font-light">"{result.summary}"</p>
             </div>
          </div>

          {/* Facial Features Breakdown */}
          <div className="lg:col-span-7 space-y-6">
            <h3 className="text-xl font-bold text-yellow-400 font-cinzel tracking-[0.2em] uppercase mb-4 pl-4 border-l-2 border-yellow-500">Feature Insights</h3>
            <div className="grid grid-cols-1 gap-4">
              {result.details.map((item, idx) => (
                <div key={idx} className="glass-card p-6 rounded-3xl border border-white/5 hover:border-yellow-500/30 transition-all flex gap-6 items-start group">
                   <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-white/10 flex items-center justify-center text-yellow-500 font-cinzel font-bold text-xl group-hover:scale-110 transition-transform">
                     {idx + 1}
                   </div>
                   <div className="flex-1">
                      <h4 className="text-yellow-400 font-bold uppercase tracking-widest text-sm mb-2 font-cinzel">{item.category}</h4>
                      <p className="text-gray-400 text-sm leading-relaxed font-light">{item.content}</p>
                   </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <button onClick={() => { setReadingResult(null); setCurrentReading(null); setCapturedImage(null); }} className="w-full py-8 border border-white/10 rounded-2xl hover:border-yellow-500/50 transition-all text-xs font-bold uppercase tracking-[0.4em] text-white bg-white/5 hover:bg-yellow-500/5">Dissolve the Vision</button>
      </div>
    );
  };

  const renderIChingResult = (result: ReadingResult) => {
    if (!result.hexagram) return null;
    const { lines, name, changingLines, interpretation } = result.hexagram;
    
    const changesInterpretation = changingLines && changingLines.length > 0
      ? (lang === 'en' 
          ? "Changing lines represent the dynamics of your situation. They indicate where energy is shifting and how the current state is evolving into a new phase. Pay close attention to these specific points of transformation."
          : "变爻代表了当前局势中的动能与转机。它们揭示了能量正在发生位移的节点，以及事物如何从现状演变为下一个阶段。请特别关注这些转化点。")
      : (lang === 'en'
          ? "This hexagram is static, representing a state of temporary stability. Focus on the core message of the present moment."
          : "此卦为静卦，代表局势处于相对稳定的状态。请专注于当下的核心启示。");

    return (
      <div className="max-w-2xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-1000">
        <div className="text-center space-y-4">
          <div className="inline-block px-4 py-1 rounded-full border border-yellow-500/30 text-yellow-500 text-sm font-cinzel tracking-widest uppercase">{t.ichingTitle}</div>
          <h2 className="text-5xl font-bold gold-gradient font-cinzel">{name}</h2>
          <p className="text-lg text-gray-400 max-w-lg mx-auto leading-relaxed">{result.summary}</p>
        </div>
        
        <div className="glass-card py-16 px-8 rounded-3xl relative overflow-hidden group">
          <div className="flex flex-col-reverse gap-4 relative z-10">
            {lines.map((line, idx) => (
              <HexagramLine 
                key={idx} 
                type={line as 0 | 1} 
                isChanging={changingLines?.includes(idx + 1)} 
              />
            ))}
          </div>
          {changingLines && changingLines.length > 0 && (
            <div className="absolute top-4 right-4 flex items-center gap-2 bg-orange-400/10 border border-orange-400/30 px-3 py-1 rounded-full">
              <div className="w-2 h-2 rounded-full bg-orange-400 animate-ping"></div>
              <span className="text-[10px] text-orange-400 font-bold uppercase tracking-widest">Active Changes</span>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="glass-card p-8 rounded-3xl border-l-4 border-l-yellow-500">
            <h3 className="text-xl font-bold text-yellow-400 mb-4 font-cinzel">{lang === 'zh' ? '主卦辞解析' : 'Primary Interpretation'}</h3>
            <p className="text-gray-300 leading-loose text-lg">{interpretation}</p>
          </div>

          <div className="glass-card p-8 rounded-3xl border-l-4 border-l-orange-400 bg-orange-400/5">
            <h3 className="text-xl font-bold text-orange-400 mb-4 font-cinzel">{t.ichingChanges}</h3>
            <p className="text-gray-300 leading-loose text-base italic">{changesInterpretation}</p>
            {changingLines && changingLines.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {changingLines.map(lineNum => (
                  <span key={lineNum} className="px-3 py-1 bg-orange-400/20 rounded-full text-orange-400 text-xs font-bold font-cinzel tracking-wider">
                    Line {lineNum}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {result.details.map((item, idx) => (
              <div key={idx} className="glass-card p-6 rounded-2xl hover:bg-white/5 transition-colors">
                <h4 className="text-yellow-400 font-bold mb-2 uppercase tracking-wider text-xs">{item.category}</h4>
                <p className="text-gray-300 text-sm">{item.content}</p>
              </div>
            ))}
          </div>
        </div>
        <button onClick={() => { setReadingResult(null); setCurrentReading(null); }} className="w-full py-5 border border-white/10 rounded-2xl text-sm font-bold uppercase tracking-widest text-white bg-white/5">Return to Temple</button>
      </div>
    );
  };

  const renderReadingResult = () => {
    if (!readingResult) return null;
    if (currentReading === 'iching') return renderIChingResult(readingResult);
    if (currentReading === 'bazi') return renderBaziResult(readingResult);
    if (currentReading === 'face') return renderFaceResult(readingResult);
    return (
      <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4">
        <div className="text-center">
          <div className="inline-block px-4 py-1 rounded-full border border-yellow-500/30 text-yellow-500 text-sm font-cinzel mb-4">{readingResult.title}</div>
          <h2 className="text-4xl font-bold gold-gradient mb-6">{readingResult.score}/100</h2>
          <p className="text-lg text-gray-300 italic leading-relaxed">"{readingResult.summary}"</p>
        </div>
        <div className="grid grid-cols-1 gap-4">
          {readingResult.details.map((item, idx) => (
            <div key={idx} className="glass-card p-6 rounded-2xl">
              <h4 className="text-yellow-400 font-bold mb-2 uppercase tracking-wider text-xs">{item.category}</h4>
              <p className="text-gray-300">{item.content}</p>
            </div>
          ))}
        </div>
        <button onClick={() => { setReadingResult(null); setCurrentReading(null); }} className="w-full py-4 border border-white/20 rounded-2xl text-sm font-bold uppercase tracking-widest">Return to Temple</button>
      </div>
    );
  };

  const renderForm = (title: string, submitLabel: string, onCancel: () => void, onSubmit: (e: React.FormEvent) => void) => (
    <div className="max-w-lg mx-auto glass-card p-8 rounded-3xl animate-in zoom-in-95 duration-500">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold gold-gradient font-cinzel">{title}</h2>
        <button type="button" onClick={isListening ? stopListening : startListening} className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all ${isListening ? 'bg-yellow-500 text-slate-950 border-yellow-500' : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/20'}`}>
          <Icons.Mic className={isListening ? "w-5 h-5 animate-bounce" : "w-5 h-5"} />
          <span className="text-[10px] font-bold uppercase tracking-widest">{isListening ? t.voiceStop : t.voiceFill}</span>
        </button>
      </div>
      {isListening && (
        <div className="mb-8 py-6 px-6 bg-slate-950/60 rounded-2xl border border-yellow-500/30 text-center animate-in fade-in slide-in-from-top-4">
          <VoiceWaveform />
          <p className="text-[10px] text-yellow-500 font-cinzel font-bold tracking-[0.2em] mt-4 animate-pulse uppercase">{t.voiceListening}</p>
        </div>
      )}
      <form onSubmit={onSubmit} className="space-y-6">
        <div>
          <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">{t.inputName}</label>
          <input type="text" required placeholder="Name" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-yellow-500/50" value={userProfile.name} onChange={(e) => setUserProfile({...userProfile, name: e.target.value})} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">{t.inputBirthDate}</label>
            <input type="date" required className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-yellow-500/50" value={userProfile.birthDate} onChange={(e) => setUserProfile({...userProfile, birthDate: e.target.value})} />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">{t.inputBirthTime}</label>
            <input type="time" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-yellow-500/50" value={userProfile.birthTime} onChange={(e) => setUserProfile({...userProfile, birthTime: e.target.value})} />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">{t.inputGender}</label>
          <div className="flex gap-2">
            {['male', 'female', 'other'].map((g) => (
              <button key={g} type="button" onClick={() => setUserProfile({...userProfile, gender: g as any})} className={`flex-1 py-3 rounded-xl border transition-all text-xs font-bold uppercase tracking-widest ${userProfile.gender === g ? 'bg-yellow-500 border-yellow-500 text-slate-950 shadow-[0_0_15px_rgba(234,179,8,0.3)]' : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20'}`}>
                {g === 'male' ? t.genderMale : g === 'female' ? t.genderFemale : t.genderOther}
              </button>
            ))}
          </div>
        </div>
        <button type="submit" disabled={isListening} className="w-full py-4 bg-yellow-500 text-slate-950 font-bold rounded-2xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50">{submitLabel}</button>
        <button type="button" onClick={onCancel} className="w-full py-2 text-gray-500 hover:text-white transition-colors text-[10px] uppercase font-bold tracking-widest">{lang === 'en' ? 'Back' : '返回'}</button>
      </form>
    </div>
  );

  return (
    <div className="min-h-screen relative pb-20 overflow-x-hidden">
      <Header lang={lang} t={t} setLang={setLang} isPremium={isPremium} onShowPremium={() => setShowPremiumModal(true)} onShowProfile={() => setIsEditingProfile(true)} onGoHome={() => { setCurrentReading(null); setReadingResult(null); setIsEditingProfile(false); stopListening(); if (videoRef.current) stopCamera(); }} />
      <main className="pt-32 px-6 max-w-7xl mx-auto">
        {isEditingProfile ? (
          <div className="min-h-[60vh] flex items-center justify-center">
            {renderForm(t.profile, t.save, () => setIsEditingProfile(false), (e) => { e.preventDefault(); setIsEditingProfile(false); stopListening(); })}
          </div>
        ) : !currentReading ? (
          <div className="flex flex-col items-center">
            <div className="text-center mb-16 animate-in fade-in slide-in-from-top-12 duration-1000">
              <div className="oracle-eye"><div className="oracle-inner"></div></div>
              <h1 className="text-5xl md:text-7xl font-cinzel font-bold mb-4 gold-gradient tracking-[0.2em] uppercase">{t.welcome}</h1>
              <p className="text-xl text-gray-400 max-w-2xl mx-auto italic font-light">{t.tagline}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 w-full animate-in fade-in slide-in-from-bottom-12 duration-1000">
              <FortuneCard title={t.baziTitle} description={lang === 'zh' ? '基于出生时辰的命运蓝图' : 'Destiny blueprint from birth.'} icon={<Icons.Bazi />} onClick={() => handleStartReading('bazi')} />
              <FortuneCard title={t.dailyTitle} description={lang === 'zh' ? '精准的星象与流年运势' : 'Precise daily fortune navigation.'} icon={<Icons.Daily />} onClick={() => handleStartReading('daily')} />
              <FortuneCard title={t.ichingTitle} description={lang === 'zh' ? '连接古老智慧的六爻卜卦' : 'Ancient Book of Changes hexagrams.'} icon={<Icons.IChing />} isLocked={!isPremium} onClick={() => handleStartReading('iching')} />
              <FortuneCard title={t.faceTitle} description={lang === 'zh' ? 'AI解析面部法相背后的秘密' : 'AI face analysis secrets.'} icon={<Icons.Face />} isLocked={!isPremium} onClick={() => handleStartReading('face')} />
            </div>
          </div>
        ) : (
          <div className="min-h-[60vh] flex flex-col items-center justify-center">
            {loading ? (
              <div className="text-center space-y-6">
                <div className="w-16 h-16 border-4 border-yellow-500/20 border-t-yellow-500 rounded-full animate-spin mx-auto"></div>
                <p className="text-xl font-cinzel tracking-widest text-yellow-500 animate-pulse uppercase">{t.loading}</p>
              </div>
            ) : readingResult ? renderReadingResult() : (currentReading === 'face' ? renderFaceCapture() : renderForm(t.baziTitle, t.analyze, () => setCurrentReading(null), handleAnalyze))}
          </div>
        )}
      </main>
      {showPremiumModal && <PremiumModal t={t} onClose={() => setShowPremiumModal(false)} onUpgrade={() => { setIsPremium(true); setShowPremiumModal(false); }} />}
      <footer className="fixed bottom-6 left-0 right-0 pointer-events-none text-center opacity-20">
        <p className="text-[10px] font-cinzel tracking-[0.8em] uppercase">Celestial Sage AI &bull; Est MMXXIV</p>
      </footer>
    </div>
  );
};

export default App;
