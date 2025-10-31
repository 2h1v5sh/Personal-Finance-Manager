import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "finai-platform", // Unique app ID
  name: "FinAI Personal Finance Manager",
  retryFunction: async (attempt) => ({
    delay: Math.pow(2, attempt) * 1000, // Exponential backoff
    maxAttempts: 2,
  }),
});
