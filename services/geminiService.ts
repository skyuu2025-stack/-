
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
  
  const textPrompt = `
    You are a master of Chinese Traditional Metaphysics (Sinology/Guoxue). 
    Context: ${type} reading for ${userData.name}, born on ${userData.birthDate} at ${userData.birthTime}.
    Language: ${lang === 'en' ? 'English' : 'Chinese'}.
    
    ${isIChing ? 
      "For I Ching: Generate a specific hexagram (6 lines from bottom to top). Include the hexagram name, the line composition (0 for Yin, 1 for Yang), any changing lines, and a deep philosophical interpretation." : 
      isFace ?
      "Analyze the provided face image based on Chinese Physiognomy (Mian Xiang). Identify key features like the Forehead (Sky), Chin (Earth), Nose (Wealth), and Eyes (Spirit). Provide insights on luck, character, and future prospects." :
      "Provide a detailed reading including a summary, a score (0-100), and specific categories (e.g. Wealth, Career, Relationship, Health)."}
      
    Be poetic yet insightful, mimicking a professional fortune teller.
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
    model: isFace ? "gemini-3-flash-preview" : "gemini-3-flash-preview",
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
    return JSON.parse(response.text);
  } catch (e) {
    throw new Error("Failed to parse AI response");
  }
};
