import type { Messages } from "./types";

/** Messages the server sends (the AI setup error). */
export const part10: Messages = {
  "GROQ_API_KEY is not configured. Add GROQ_API_KEY=gsk_... to your .env file (see .env.example) and restart the dev server.": [
    "Hindi pa naka-set up ang AI (GROQ_API_KEY). Idagdag ang GROQ_API_KEY=gsk_... sa .env file (tingnan ang .env.example) at i-restart ang server.",
    "Wala pa na-set up ang AI (GROQ_API_KEY). Idugang ang GROQ_API_KEY=gsk_... sa .env file (tan-awa ang .env.example) ug i-restart ang server.",
  ],
};
