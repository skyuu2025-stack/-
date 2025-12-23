
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { Language, UserProfile, ReadingType, ReadingResult } from './types.ts';
import { TRANSLATIONS, Icons } from './constants.tsx';
import { Header } from './components/Header.tsx';
import { FortuneCard } from './components/FortuneCard.tsx';
import { PremiumModal } from './components/PremiumModal.tsx';
import { generateFortune } from './services/geminiService.ts';

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
        <div className="w-full h-full bg-yellow-500 rounded-sm shadow-[0_0_10px_rgba(234,179,8,0.4)]" />
      ) : (
        <>
          <div className="flex-1 h-full bg-yellow-500 rounded-sm shadow-[0_0_10px_rgba(234,179,8,0.4)]" />
          <div className="w-12 h-full bg-transparent" />
          <div className="flex-1 h-full bg-yellow-500 rounded-sm shadow-[0_0_10px_rgba(234,179,8,0.4)]" />
        </>
      )}
      {isChanging && (
        <div className="absolute -right-8 top-1/2 -translate-y-1/2 text-yellow-500 font-bold text-xs">●</div>
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
          className="w-[3px] bg-yellow-500 rounded-full animate-voice-bar"
          style={{
            height: `${20 + Math.random() * 80}%`,
            animationDelay: `${i * 0.05}s`,
            animationDuration: `${0.4 + Math.random() * 0.4}s`
          }}
        />
      ))}
    </div>
  );
};

const FaceScanOverlay: React.FC<{ image: string; size?: string; animate?: boolean }> = ({ image, size = "w-32 h-32", animate = true }) => {
  return (
    <div className={`${size} rounded-full border-4 border-yellow-500/30 overflow-hidden shadow-[0_0_30px_rgba(234,179,8,0.2)] relative transform transition-transform duration-700`}>
      <img src={image} className="w-full h-full object-cover scale-x-[-1]" />
      {animate && (
        <>
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-yellow-400 animate-scan-line shadow-[0_0_10px_#eab308] z-10" />
          <div className="absolute inset-0 bg-yellow-500/5 mix-blend-overlay" />
        </>
      )}
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
          if (msg.serverContent?.interrupted) {
            activeSourcesRef.current.forEach(s => s.stop());
            activeSourcesRef.current.clear();
            nextStartTimeRef.current = 0;
          }
        },
        onclose: () => stopListening(),
        onerror: (e) => console.error("Live Error", e)
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
            <button 
              onClick={capturePhoto}
              className="w-16 h-16 rounded-full bg-white flex items-center justify-center border-4 border-yellow-500 shadow-[0_0_20px_rgba(255,255,255,0.4)] hover:scale-110 active:scale-95 transition-all animate-pulse-ring"
            >
              <div className="w-12 h-12 rounded-full border-2 border-slate-950" />
            </button>
          </div>
        </div>
      ) : (
        <div className="relative aspect-[3/4] rounded-2xl border-2 border-yellow-500/50 overflow-hidden mb-8">
          <img src={capturedImage} className="w-full h-full object-cover scale-x-[-1]" />
          <div className="absolute top-0 left-0 right-0 h-1 bg-yellow-500 animate-scan-line shadow-[0_0_15px_#eab308]" />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
             <p className="text-yellow-500 font-bold font-cinzel tracking-widest bg-slate-950/60 px-4 py-2 rounded-full backdrop-blur-md animate-pulse">
                {t.faceScanning}
             </p>
          </div>
        </div>
      )}

      <div className="flex gap-4">
        {capturedImage ? (
          <>
            <button 
              onClick={() => { setCapturedImage(null); startCamera(); }}
              className="flex-1 py-4 border border-white/20 rounded-2xl hover:bg-white/5 transition-all text-xs font-bold uppercase tracking-widest text-gray-300"
            >
              {t.retake}
            </button>
            <button 
              onClick={() => handleAnalyze()}
              className="flex-[2] py-4 bg-yellow-500 text-slate-950 font-bold rounded-2xl hover:scale-[1.02] transition-all shadow-lg active:scale-[0.98]"
            >
              {t.analyzeFace}
            </button>
          </>
        ) : (
          <button 
            onClick={() => { setCurrentReading(null); stopCamera(); }}
            className="w-full py-2 text-gray-500 hover:text-white transition-colors text-sm font-medium"
          >
            {lang === 'en' ? 'Back' : '返回'}
          </button>
        )}
      </div>
    </div>
  );

  const renderIChingResult = (result: ReadingResult) => {
    if (!result.hexagram) return null;
    const { lines, name, changingLines, interpretation } = result.hexagram;

    return (
      <div className="max-w-2xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-1000">
        <div className="text-center space-y-4">
          <div className="inline-block px-4 py-1 rounded-full border border-yellow-500/30 text-yellow-500 text-sm font-cinzel tracking-widest uppercase">
            {t.ichingTitle}
          </div>
          <h2 className="text-5xl font-bold gold-gradient font-cinzel">{name}</h2>
          <p className="text-lg text-gray-400 max-w-lg mx-auto leading-relaxed">{result.summary}</p>
        </div>

        <div className="glass-card py-16 px-8 rounded-3xl relative overflow-hidden group">
          <div className="absolute inset-0 bg-yellow-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
          <div className="flex flex-col-reverse gap-4 relative z-10">
            {lines.map((line, idx) => (
              <HexagramLine 
                key={idx} 
                type={line as 0 | 1} 
                isChanging={changingLines?.includes(idx + 1)} 
              />
            ))}
          </div>
          <div className="mt-8 text-center">
             <div className="text-4xl font-bold text-yellow-500/80 font-cinzel opacity-20 select-none">卦象</div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="glass-card p-8 rounded-3xl border-l-4 border-l-yellow-500">
            <h3 className="text-xl font-bold text-yellow-400 mb-4 font-cinzel">{lang === 'zh' ? '卦辞解析' : 'Hexagram Interpretation'}</h3>
            <p className="text-gray-300 leading-loose text-lg">{interpretation}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {result.details.map((item, idx) => (
              <div key={idx} className="glass-card p-6 rounded-2xl hover:bg-white/5 transition-colors">
                <h4 className="text-yellow-400 font-bold mb-2 uppercase tracking-wider text-sm">{item.category}</h4>
                <p className="text-gray-300 text-sm leading-relaxed">{item.content}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <button onClick={() => { setReadingResult(null); setCurrentReading(null); }} className="w-full py-5 bg-gradient-to-r from-yellow-500/10 to-purple-500/10 border border-white/10 rounded-2xl hover:border-yellow-500/50 transition-all text-sm font-bold uppercase tracking-widest text-white shadow-xl">
            Return to Temple
          </button>
        </div>
      </div>
    );
  };

  const renderReadingResult = () => {
    if (!readingResult) return null;
    
    if (currentReading === 'iching') {
      return renderIChingResult(readingResult);
    }

    return (
      <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
        <div className="text-center">
          <div className="inline-block px-4 py-1 rounded-full border border-yellow-500/30 text-yellow-500 text-sm font-cinzel mb-4">{readingResult.title}</div>
          <h2 className="text-4xl font-bold gold-gradient mb-6">{readingResult.score}/100</h2>
          <p className="text-lg text-gray-300 italic leading-relaxed">"{readingResult.summary}"</p>
        </div>
        
        {currentReading === 'face' && capturedImage && (
           <div className="flex justify-center mb-8">
              <FaceScanOverlay image={capturedImage} animate={true} />
           </div>
        )}

        <div className="grid grid-cols-1 gap-4">
          {readingResult.details.map((item, idx) => (
            <div key={idx} className="glass-card p-6 rounded-2xl">
              <h4 className="text-yellow-400 font-bold mb-2 uppercase tracking-wider text-sm">{item.category}</h4>
              <p className="text-gray-300">{item.content}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-4">
          <button onClick={() => setIsEditingProfile(true)} className="w-full py-4 border border-yellow-500/20 text-yellow-500 rounded-2xl hover:bg-yellow-500/5 transition-all text-sm font-bold uppercase tracking-widest">{t.editProfile}</button>
          <button onClick={() => { setReadingResult(null); setCurrentReading(null); setCapturedImage(null); }} className="w-full py-4 border border-white/20 rounded-2xl hover:bg-white/5 transition-all text-sm font-bold uppercase tracking-widest">Return to Temple</button>
        </div>
      </div>
    );
  };

  const renderForm = (title: string, submitLabel: string, onCancel: () => void, onSubmit: (e: React.FormEvent) => void) => (
    <div className="max-w-lg mx-auto glass-card p-8 rounded-3xl animate-in zoom-in-95 duration-500 shadow-2xl relative overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold gold-gradient font-cinzel">{title}</h2>
        
        <div className="relative">
          {isListening && (
            <div className="absolute inset-0 bg-yellow-500/30 rounded-full blur-xl animate-pulse -z-10" />
          )}
          <button 
            type="button"
            onClick={isListening ? stopListening : startListening}
            className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all border z-10 relative overflow-hidden group ${
              isListening 
                ? 'bg-yellow-500 text-slate-950 border-yellow-500' 
                : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/20'
            }`}
          >
            {isListening && (
               <div className="absolute inset-0 bg-white/20 animate-voice-ripple" />
            )}
            <Icons.Mic className={isListening ? "w-5 h-5 animate-bounce" : "w-5 h-5"} />
            <span className="text-xs font-bold uppercase tracking-widest relative">
              {isListening ? t.voiceStop : t.voiceFill}
            </span>
          </button>
        </div>
      </div>

      {isListening && (
        <div className="mb-8 py-6 px-6 bg-slate-950/60 rounded-2xl border border-yellow-500/30 text-center animate-in fade-in slide-in-from-top-4 shadow-[0_0_20px_rgba(234,179,8,0.1)]">
          <VoiceWaveform />
          <p className="text-sm text-yellow-500 font-cinzel font-bold tracking-widest mt-4 animate-pulse">
            {t.voiceListening}
          </p>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">{t.inputName}</label>
          <input 
            type="text" required placeholder="e.g. Li Bai"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-yellow-500/50 transition-all text-white"
            value={userProfile.name}
            onChange={(e) => setUserProfile({...userProfile, name: e.target.value})}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">{t.inputBirthDate}</label>
            <input 
              type="date" required
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-yellow-500/50 transition-all text-white"
              value={userProfile.birthDate}
              onChange={(e) => setUserProfile({...userProfile, birthDate: e.target.value})}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">{t.inputBirthTime}</label>
            <input 
              type="time" 
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-yellow-500/50 transition-all text-white"
              value={userProfile.birthTime}
              onChange={(e) => setUserProfile({...userProfile, birthTime: e.target.value})}
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">{t.inputGender}</label>
          <div className="flex gap-2">
            {[
              { id: 'male', label: t.genderMale },
              { id: 'female', label: t.genderFemale },
              { id: 'other', label: t.genderOther }
            ].map((g) => (
              <button
                key={g.id} type="button"
                onClick={() => setUserProfile({...userProfile, gender: g.id as any})}
                className={`flex-1 py-3 rounded-xl border transition-all text-sm font-medium ${
                  userProfile.gender === g.id 
                    ? 'bg-yellow-500 border-yellow-500 text-slate-950 shadow-[0_0_15px_rgba(234,179,8,0.3)]' 
                    : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
        <button 
          type="submit"
          disabled={isListening}
          className="w-full py-4 bg-yellow-500 text-slate-950 font-bold rounded-2xl hover:scale-[1.02] transition-all shadow-lg active:scale-[0.98] mt-4 disabled:opacity-50 disabled:scale-100"
        >
          {submitLabel}
        </button>
        <button 
          type="button" onClick={onCancel}
          className="w-full py-2 text-gray-500 hover:text-white transition-colors text-sm font-medium"
        >
          {lang === 'en' ? 'Back' : '返回'}
        </button>
      </form>
    </div>
  );

  return (
    <div className="min-h-screen relative pb-20 overflow-x-hidden">
      <Header 
        lang={lang} t={t} setLang={setLang} isPremium={isPremium}
        onShowPremium={() => setShowPremiumModal(true)}
        onShowProfile={() => { setIsEditingProfile(true); setCurrentReading(null); setReadingResult(null); stopCamera(); }}
        onGoHome={() => { setCurrentReading(null); setReadingResult(null); setIsEditingProfile(false); stopListening(); stopCamera(); }}
      />

      <main className="pt-32 px-6 max-w-7xl mx-auto">
        {isEditingProfile ? (
          <div className="min-h-[60vh] flex flex-col items-center justify-center">
            {renderForm(t.profile, t.save, () => { setIsEditingProfile(false); stopListening(); }, (e) => { e.preventDefault(); setIsEditingProfile(false); stopListening(); })}
          </div>
        ) : !currentReading ? (
          <div className="flex flex-col items-center">
            {/* Oracle Hero Section */}
            <div className="text-center mb-16 animate-in fade-in slide-in-from-top-12 duration-1000">
              <div className="oracle-eye">
                <div className="oracle-inner"></div>
              </div>
              <h1 className="text-5xl md:text-7xl font-cinzel font-bold mb-4 gold-gradient tracking-[0.2em]">{t.welcome}</h1>
              
              <div className="max-w-md mx-auto py-2 px-6 bg-white/5 border border-white/10 rounded-full backdrop-blur-md mb-12">
                <p className="text-xs font-cinzel text-yellow-500/80 tracking-widest uppercase animate-pulse">
                  {lang === 'zh' ? '今日天机：虚怀若谷，必有回响' : 'Today’s Verse: Remain humble, and the universe will respond.'}
                </p>
              </div>

              <p className="text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed font-light italic">
                {t.tagline}
              </p>
            </div>

            {/* Grid layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 w-full animate-in fade-in slide-in-from-bottom-12 duration-1000 delay-300">
              <FortuneCard 
                title={t.baziTitle} 
                description={lang === 'zh' ? '基于出生时辰的命运蓝图' : 'The destiny blueprint based on your birth.'} 
                icon={<Icons.Bazi />} 
                onClick={() => handleStartReading('bazi')} 
              />
              <FortuneCard 
                title={t.dailyTitle} 
                description={lang === 'zh' ? '精准的星象与流年运势' : 'Precise astrological and daily fortune navigation.'} 
                icon={<Icons.Daily />} 
                onClick={() => handleStartReading('daily')} 
              />
              <FortuneCard 
                title={t.ichingTitle} 
                description={lang === 'zh' ? '连接古老智慧的六爻卜卦' : 'Ancient Book of Changes hexagram divination.'} 
                icon={<Icons.IChing />} 
                isLocked={!isPremium} 
                onClick={() => handleStartReading('iching')} 
              />
              <FortuneCard 
                title={t.faceTitle} 
                description={lang === 'zh' ? 'AI解析面部法相背后的秘密' : 'AI analysis of the secrets behind facial features.'} 
                icon={<Icons.Face />} 
                isLocked={!isPremium} 
                onClick={() => handleStartReading('face')} 
              />
            </div>
            
            {/* Bottom Insight Section */}
            {!isPremium && (
              <div className="mt-20 w-full max-w-4xl glass-card p-8 rounded-[2.5rem] flex flex-col md:flex-row items-center gap-8 border-yellow-500/10 hover:border-yellow-500/30 transition-all duration-700 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-500">
                <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-yellow-500 to-purple-500 flex items-center justify-center text-slate-950 shadow-[0_0_40px_rgba(234,179,8,0.2)]">
                  <Icons.IChing />
                </div>
                <div className="flex-1 text-center md:text-left">
                  <h3 className="text-2xl font-cinzel font-bold mb-2 gold-gradient uppercase">{t.upgradeText}</h3>
                  <p className="text-gray-400 text-sm font-light leading-relaxed">Join 10,000+ seekers who have unlocked their deep cosmic alignment with our PRO features.</p>
                </div>
                <button 
                  onClick={() => setShowPremiumModal(true)}
                  className="px-8 py-4 bg-yellow-500 text-slate-950 font-bold rounded-2xl hover:bg-yellow-400 transition-all shadow-lg active:scale-95 whitespace-nowrap"
                >
                  {t.unlockPremium}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="min-h-[60vh] flex flex-col items-center justify-center">
            {loading ? (
              <div className="text-center space-y-6">
                {currentReading === 'face' && capturedImage ? (
                  <div className="mb-4 flex justify-center">
                    <FaceScanOverlay image={capturedImage} size="w-48 h-48" animate={true} />
                  </div>
                ) : (
                  <div className="w-16 h-16 border-4 border-yellow-500/20 border-t-yellow-500 rounded-full animate-spin mx-auto"></div>
                )}
                <p className="text-xl font-cinzel tracking-widest text-yellow-500 animate-pulse">{t.loading}</p>
              </div>
            ) : (
              <>
                {readingResult ? renderReadingResult() : (currentReading === 'face' ? renderFaceCapture() : renderForm(t.baziTitle, t.analyze, () => { setCurrentReading(null); stopListening(); }, handleAnalyze))}
              </>
            )}
          </div>
        )}
      </main>

      {showPremiumModal && <PremiumModal t={t} onClose={() => setShowPremiumModal(false)} onUpgrade={() => { setIsPremium(true); setShowPremiumModal(false); }} />}
      <footer className="fixed bottom-6 left-0 right-0 pointer-events-none text-center opacity-20">
        <p className="text-[10px] font-cinzel tracking-[0.8em] uppercase">Celestial Sage AI &bull; Est MMXXIV &bull; Wisdom of the Ancients</p>
      </footer>
    </div>
  );
};

export default App;
