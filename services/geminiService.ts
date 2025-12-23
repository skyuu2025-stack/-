
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
  
  const textPrompt = `
    You are a master of Chinese Traditional Metaphysics (Sinology/Guoxue). 
    Context: ${type} reading for ${userData.name}, born on ${userData.birthDate} at ${userData.birthTime || 'unknown time'}.
    Gender: ${userData.gender}.
    Language: ${lang === 'en' ? 'English' : 'Chinese'}.
    
    ${isIChing ? 
      "For I Ching: Generate a specific hexagram (6 lines from bottom to top). Include the hexagram name, the line composition (0 for Yin, 1 for Yang), any changing lines, and a deep philosophical interpretation." : 
      isFace ?
      "Analyze the provided face image based on Chinese Physiognomy (Mian Xiang). You MUST provide a breakdown of these specific facial features in the 'details' array: 'Forehead (Sky Pillar)', 'Eyes (Spirit Light)', 'Nose (Wealth Palace)', 'Mouth (River of Life)', and 'Chin (Earth Foundation)'. For each, provide a detailed interpretation. Provide a general summary and a score." :
      isBazi ?
      "For Bazi (Four Pillars of Destiny): Calculate the four pillars (Year, Month, Day, Hour). Use the Heavenly Stems and Earthly Branches. Identify the Day Master (Day Stem). Provide a strength analysis (percentage 0-100) for the Five Elements (Wood, Fire, Earth, Metal, Water). Crucially, provide a separate, detailed interpretation for each pillar explaining its specific influence on the user's life (Year: ancestry/roots, Month: parents/career, Day: self/spouse, Hour: children/legacy). Give a detailed reading on life path, career, and wealth." :
      "Provide a detailed reading including a summary, a score (0-100), and specific categories (e.g. Wealth, Career, Relationship, Health)."}
      
    Be poetic yet insightful, mimicking a professional high-end fortune teller.
  `;

  const parts: any[] = [{ text: textPrompt }];
  if (isFace && imageData) {
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: imageData.split(',')[1] || imageData
      }
    });
  }

  const response = await ai.models.generateContent({
    model: isFace || isBazi ? "gemini-3-pro-preview" : "gemini-3-flash-preview",
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
          ...(isBazi ? {
            baziChart: {
              type: Type.OBJECT,
              properties: {
                pillars: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING, description: "Year, Month, Day, or Hour" },
                      stem: { type: Type.STRING },
                      branch: { type: Type.STRING },
                      element: { type: Type.STRING },
                      interpretation: { type: Type.STRING, description: "Detailed interpretation of this specific pillar's influence." }
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
              },
              required: ["pillars", "dayMaster", "fiveElements"]
            }
          } : {}),
          ...(isIChing ? {
            hexagram: {
              type: Type.OBJECT,
              properties: {
                lines: { 
                  type: Type.ARRAY, 
                  items: { type: Type.INTEGER },
                  description: "6 lines from bottom to top. 1 for Yang (solid), 0 for Yin (broken)."
                },
                name: { type: Type.STRING },
                changingLines: { 
                  type: Type.ARRAY, 
                  items: { type: Type.INTEGER },
                  description: "Indices of changing lines (1 to 6)."
                },
                interpretation: { type: Type.STRING }
              },
              required: ["lines", "name", "interpretation"]
            }
          } : {})
        },
        required: ["title", "summary", "score", "details"]
      }
    }
  });

  try {
    const text = response.text;
    if (!text) throw new Error("Empty response");
    return JSON.parse(text);
  } catch (e) {
    console.error("Parse error:", e);
    throw new Error("Failed to parse AI response");
  }
};
