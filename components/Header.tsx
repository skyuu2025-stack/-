
import React from 'react';
import { Language, Translation } from '../types';
import { Icons } from '../constants';

interface HeaderProps {
  lang: Language;
  t: any; // Using any to accommodate extended translations
  setLang: (l: Language) => void;
  isPremium: boolean;
  onShowPremium: () => void;
  onShowProfile: () => void;
  onGoHome: () => void;
}

export const Header: React.FC<HeaderProps> = ({ lang, t, setLang, isPremium, onShowProfile, onGoHome }) => {
  return (
    <header className="fixed top-0 left-0 right-0 z-40 bg-slate-950/20 backdrop-blur-xl border-b border-white/5">
      <div className="max-w-7xl mx-auto px-6 h-24 flex items-center justify-between">
        <div 
          onClick={onGoHome}
          className="flex items-center gap-4 cursor-pointer group"
        >
          <div className="w-12 h-12 rounded-full bg-yellow-500 flex items-center justify-center text-slate-950 font-cinzel text-xl font-bold group-hover:scale-110 group-hover:rotate-12 transition-all duration-500 shadow-[0_0_20px_rgba(234,179,8,0.3)]">
            天
          </div>
          <div className="flex flex-col">
            <h1 className="font-cinzel text-xl font-bold tracking-[0.3em] uppercase hidden sm:block">{t.welcome}</h1>
            <span className="text-[8px] font-cinzel tracking-[0.4em] text-yellow-500/50 uppercase hidden sm:block">Celestial Oracle</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
            className="px-4 py-1.5 rounded-full border border-white/10 hover:bg-white/5 transition-all text-[10px] font-bold tracking-widest uppercase text-gray-400 hover:text-white"
          >
            {t.switchLang}
          </button>

          <button 
            onClick={onShowProfile}
            className="w-10 h-10 flex items-center justify-center rounded-full border border-white/10 hover:border-yellow-500/50 hover:bg-yellow-500/5 transition-all text-gray-400 hover:text-yellow-500"
            title={t.profile}
          >
            <Icons.User />
          </button>
          
          <button 
            onClick={onGoHome}
            className="p-2 rounded-full border border-white/10 hover:bg-white/5 transition-all text-gray-400 hover:text-white sm:hidden"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
          </button>
        </div>
      </div>
    </header>
  );
};
