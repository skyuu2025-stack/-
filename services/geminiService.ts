
import { GoogleGenAI, Type } from "@google/genai";
import { Language, ReadingType, ReadingResult } from "../types";

export const generateFortune = async (
  type: ReadingType,
  userData: any,
  lang: Language,
  imageData?: string // base64 string
): Promise<ReadingResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const isIChing = type === 'iching';
  const isFace = type === 'face';
  const isBazi = type === 'bazi';
  const isDaily = type === 'daily';

  const today = new Date().toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  });
  
  const textPrompt = `
    You are a legendary grand master of Chinese Traditional Metaphysics (Guoxue). 
    Your task is to generate a comprehensive "Destiny Report" for ${userData.name}.
    Context: ${type} analysis.
    User Profile: ${userData.gender}, born on ${userData.birthDate} at ${userData.birthTime || 'unknown time'}.
    Current Date: ${today}.
    Language: ${lang === 'en' ? 'English' : 'Chinese'}.
    
    Specific Instructions for ${type}:
    ${isIChing ? 
      `For I Ching (Divination): The user's specific question is: "${userData.ichingQuestion || 'General Fortune'}". 
      Cast a hexagram reflecting this query. You MUST populate the 'hexagram' object. 
      Include 6 'lines' (from bottom to top, index 0 to 5, 0 for Yin, 1 for Yang), a meaningful 'name', 'changingLines' (if any, indices 1-6), and a deep philosophical 'interpretation'. 
      Provide 4 detailed categories in 'details': 'Current Situation', 'Potential Obstacles', 'Recommended Action', 'Final Outcome'.` : 
      isFace ?
      "For AI Face Reading (Physiognomy): Analyze the provided image using Mian Xiang principles. You MUST provide 5 detailed categories in 'details': 'Forehead (Career/Wisdom)', 'Eyes (Spirit/Character)', 'Nose (Wealth/Prosperity)', 'Mouth (Communication/Heritage)', and 'Chin (Late-life Fortune)'. Provide a 'score' and a summary of their 'Aura'." :
      isBazi ?
      "For Bazi Reading (Four Pillars): You MUST populate the 'baziChart' object. Calculate the Year, Month, Day, and Hour pillars (Heavenly Stems and Earthly Branches). Identify the 'dayMaster'. Calculate strength percentages for Wood, Fire, Earth, Metal, Water. Provide 4 detailed categories in 'details': 'Wealth Outlook', 'Career Path', 'Love & Relationships', 'Health & Vitality'." :
      "For Daily Horoscope: Provide a precise analysis for today (${today}). Give a daily fortune 'score'. Provide 4 categories in 'details': 'Today's Luck', 'Career Guidance', 'Relationship Harmony', 'Health Watch'. Mention the 'Lucky Element' and 'Lucky Color' for today."}
      
    Your tone must be mystical, authoritative, yet compassionate. Return ONLY valid JSON.
  `;

  const parts: any[] = [{ text: textPrompt }];
  if (isFace && imageData) {
    const base64Data = imageData.includes('base64,') ? imageData.split('base64,')[1] : imageData;
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: base64Data
      }
    });
  }

  // Use Pro for complex reasoning tasks (Bazi, I Ching, Face) and Flash for simpler daily tasks
  const modelName = (isBazi || isFace || isIChing) ? "gemini-3-pro-preview" : "gemini-3-flash-preview";

  const response = await ai.models.generateContent({
    model: modelName,
    contents: { parts },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          summary: { type: Type.STRING },
          score: { type: Type.NUMBER },
          details: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                category: { type: Type.STRING },
                content: { type: Type.STRING }
              },
              required: ["category", "content"]
            }
          },
          baziChart: {
            type: Type.OBJECT,
            properties: {
              pillars: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    stem: { type: Type.STRING },
                    branch: { type: Type.STRING },
                    element: { type: Type.STRING },
                    interpretation: { type: Type.STRING }
                  },
                  required: ["label", "stem", "branch", "element", "interpretation"]
                }
              },
              dayMaster: { type: Type.STRING },
              fiveElements: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    element: { type: Type.STRING },
                    strength: { type: Type.NUMBER }
                  },
                  required: ["element", "strength"]
                }
              }
            }
          },
          hexagram: {
            type: Type.OBJECT,
            properties: {
              lines: { type: Type.ARRAY, items: { type: Type.INTEGER } },
              name: { type: Type.STRING },
              changingLines: { type: Type.ARRAY, items: { type: Type.INTEGER } },
              interpretation: { type: Type.STRING }
            }
          }
        },
        required: ["title", "summary", "score", "details"]
      },
      thinkingConfig: modelName === 'gemini-3-flash-preview' ? { thinkingBudget: 0 } : undefined
    }
  });

  try {
    const text = response.text;
    if (!text) throw new Error("Divine connection lost.");
    return JSON.parse(text);
  } catch (e) {
    console.error("Report generation failed:", e);
    throw new Error("Heavenly signal obscured. Please try again.");
  }
};
