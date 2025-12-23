
export type Language = 'en' | 'zh';

export type ReadingType = 'bazi' | 'iching' | 'face' | 'daily';

export interface UserProfile {
  name: string;
  birthDate: string;
  birthTime: string;
  gender: 'male' | 'female' | 'other';
  isPremium: boolean;
}

export interface ReadingResult {
  title: string;
  summary: string;
  details: {
    category: string;
    content: string;
  }[];
  score: number;
  // Specialized I Ching fields
  hexagram?: {
    lines: (0 | 1)[]; // 0 for Yin (broken), 1 for Yang (solid)
    name: string;
    changingLines?: number[]; // indices 1-6
    interpretation: string;
  };
}

export interface Translation {
  welcome: string;
  tagline: string;
  baziTitle: string;
  ichingTitle: string;
  faceTitle: string;
  dailyTitle: string;
  getStarted: string;
  premiumLabel: string;
  upgradeText: string;
  unlockPremium: string;
  loading: string;
  inputName: string;
  inputBirthDate: string;
  inputBirthTime: string;
  inputGender: string;
  analyze: string;
  switchLang: string;
}
