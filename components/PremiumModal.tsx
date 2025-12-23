
import React from 'react';
import { Translation } from '../types';

interface PremiumModalProps {
  t: Translation;
  onClose: () => void;
  onUpgrade: () => void;
}

export const PremiumModal: React.FC<PremiumModalProps> = ({ t, onClose, onUpgrade }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-md glass-card rounded-3xl p-8 text-center relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-yellow-500 via-purple-500 to-yellow-500"></div>
        
        <h2 className="text-3xl font-cinzel text-yellow-400 mb-4">{t.premiumLabel}</h2>
        <p className="text-gray-300 mb-8">{t.upgradeText}</p>
        
        <div className="space-y-4 mb-8">
          <div className="flex items-center gap-3 text-left bg-white/5 p-4 rounded-xl">
            <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
            <p className="text-sm">Deep Bazi House Analysis</p>
          </div>
          <div className="flex items-center gap-3 text-left bg-white/5 p-4 rounded-xl">
            <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
            <p className="text-sm">Unlimited I Ching Hexagrams</p>
          </div>
          <div className="flex items-center gap-3 text-left bg-white/5 p-4 rounded-xl">
            <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
            <p className="text-sm">Real-time Luck Tracking</p>
          </div>
        </div>

        <button 
          onClick={onUpgrade}
          className="w-full py-4 bg-yellow-500 text-black font-bold rounded-2xl hover:bg-yellow-400 transition-colors mb-4"
        >
          {t.unlockPremium} - $19.99/mo
        </button>
        
        <button 
          onClick={onClose}
          className="text-gray-500 hover:text-white transition-colors"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
};
