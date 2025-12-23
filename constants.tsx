
import React from 'react';
import { Translation, Language } from './types.ts';

export const TRANSLATIONS: Record<Language, Translation & { 
  profile: string; 
  genderMale: string; 
  genderFemale: string; 
  genderOther: string; 
  save: string; 
  editProfile: string;
  voiceFill: string;
  voiceListening: string;
  voiceStop: string;
  takePhoto: string;
  retake: string;
  analyzeFace: string;
  cameraAccessError: string;
  faceScanning: string;
}> = {
  en: {
    welcome: "Celestial Sage",
    tagline: "Unveil the mysteries of your destiny with ancient wisdom.",
    baziTitle: "Bazi Reading",
    ichingTitle: "I Ching Divination",
    faceTitle: "Face Reading",
    dailyTitle: "Daily Horoscope",
    getStarted: "Begin Journey",
    premiumLabel: "PRO",
    upgradeText: "Unlock the depths of your destiny with premium insights.",
    unlockPremium: "Upgrade to Premium",
    loading: "Consulting the heavens...",
    inputName: "Full Name",
    inputBirthDate: "Birth Date",
    inputBirthTime: "Birth Time (Optional)",
    inputGender: "Gender",
    analyze: "Decode Fate",
    switchLang: "中文",
    profile: "Profile",
    genderMale: "Male",
    genderFemale: "Female",
    genderOther: "Other",
    save: "Save Profile",
    editProfile: "Edit Profile",
    voiceFill: "Voice Fill",
    voiceListening: "Listening to the universe...",
    voiceStop: "Stop Listening",
    takePhoto: "Capture Aura",
    retake: "Retake Photo",
    analyzeFace: "Analyze Physiognomy",
    cameraAccessError: "Camera access denied. Please enable it in settings.",
    faceScanning: "Scanning facial features..."
  },
  zh: {
    welcome: "天机阁",
    tagline: "汲取古老东方智慧，洞悉命运玄机。",
    baziTitle: "八字排盘",
    ichingTitle: "周易卜卦",
    faceTitle: "AI面相",
    dailyTitle: "每日运势",
    getStarted: "开始探索",
    premiumLabel: "尊享版",
    upgradeText: "解锁深度解析，掌握人生命运蓝图。",
    unlockPremium: "升级尊享版",
    loading: "正在窥探天机...",
    inputName: "姓名",
    inputBirthDate: "出生日期",
    inputBirthTime: "出生时辰",
    inputGender: "性别",
    analyze: "开启测算",
    switchLang: "English",
    profile: "个人信息",
    genderMale: "乾造 (男)",
    genderFemale: "坤造 (女)",
    genderOther: "其他",
    save: "保存信息",
    editProfile: "修改资料",
    voiceFill: "语音填单",
    voiceListening: "正在聆听天机...",
    voiceStop: "结束聆听",
    takePhoto: "定格法相",
    retake: "重新拍摄",
    analyzeFace: "窥探面相",
    cameraAccessError: "无法访问摄像头，请在设置中开启权限。",
    faceScanning: "正在解析面部特征..."
  }
};

export const Icons = {
  Bazi: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  IChing: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8">
      <path d="M4 6h16M4 10h16M4 14h7m2 0h7M4 18h16" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Face: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Daily: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8">
      <circle cx="12" cy="12" r="5" />
      <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  User: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  Mic: ({ className = "w-5 h-5" }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  ),
  Camera: ({ className = "w-6 h-6" }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
};
