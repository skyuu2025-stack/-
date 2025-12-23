
import React from 'react';

interface FortuneCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  isLocked?: boolean;
  onClick: () => void;
}

export const FortuneCard: React.FC<FortuneCardProps> = ({ title, description, icon, isLocked, onClick }) => {
  return (
    <div 
      onClick={onClick}
      className="group relative glass-card p-8 rounded-[2rem] cursor-pointer border border-white/5 hover:border-yellow-500/40 transition-all duration-700 transform hover:-translate-y-3 overflow-hidden"
    >
      {/* Background Glow */}
      <div className="absolute -inset-1 bg-gradient-to-br from-yellow-500/20 to-purple-500/20 opacity-0 group-hover:opacity-100 blur-2xl transition-opacity duration-700" />
      
      <div className="relative z-10 flex flex-col items-center text-center">
        <div className="w-16 h-16 mb-6 rounded-2xl bg-slate-900/50 flex items-center justify-center text-yellow-500 group-hover:text-yellow-400 group-hover:scale-110 group-hover:rotate-3 transition-all duration-500 shadow-inner border border-white/5">
          {icon}
        </div>
        <h3 className="text-xl font-cinzel font-bold mb-3 text-white tracking-widest group-hover:text-yellow-400 transition-colors uppercase">{title}</h3>
        <p className="text-sm text-gray-400 leading-relaxed font-light">{description}</p>
      </div>

      {isLocked && (
        <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-[4px] flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-500 translate-y-4 group-hover:translate-y-0">
          <svg className="w-8 h-8 text-yellow-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-500 px-4 py-1 rounded-full text-[10px] font-bold tracking-[0.2em] uppercase">Premium</div>
        </div>
      )}
    </div>
  );
};
