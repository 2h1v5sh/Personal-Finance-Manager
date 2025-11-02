"use server";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/prisma";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { revalidatePath } from "next/cache";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Get user's financial context for AI advisor
async function getUserFinancialContext(userId) {
  try {
    // Get user's accounts
    const accounts = await db.account.findMany({
      where: { userId },
      include: {
        transactions: {
          orderBy: { date: 'desc' },
          take: 10 // Get last 10 transactions per account
        }
      }
    });

    // Get user's budget
    const budget = await db.budget.findFirst({
      where: { userId }
    });

    // Calculate totals
    const totalBalance = accounts.reduce((sum, account) => 
      sum + account.balance.toNumber(), 0
    );

    // Get monthly stats
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthlyTransactions = await db.transaction.findMany({
      where: {
        userId,
        date: { gte: startOfMonth }
      }
    });

    const monthlyIncome = monthlyTransactions
      .filter(t => t.type === 'INCOME')
      .reduce((sum, t) => sum + t.amount.toNumber(), 0);

    const monthlyExpenses = monthlyTransactions
      .filter(t => t.type === 'EXPENSE')
      .reduce((sum, t) => sum + t.amount.toNumber(), 0);

    // Group expenses by category
    const expensesByCategory = monthlyTransactions
      .filter(t => t.type === 'EXPENSE')
      .reduce((acc, t) => {
        acc[t.category] = (acc[t.category] || 0) + t.amount.toNumber();
        return acc;
      }, {});

    return {
      totalBalance,
      accounts: accounts.map(acc => ({
        name: acc.name,
        type: acc.type,
        balance: acc.balance.toNumber(),
        isDefault: acc.isDefault
      })),
      budget: budget ? budget.amount.toNumber() : null,
      monthlyIncome,
      monthlyExpenses,
      netIncome: monthlyIncome - monthlyExpenses,
      expensesByCategory,
      recentTransactions: accounts.flatMap(acc => 
        acc.transactions.map(t => ({
          amount: t.amount.toNumber(),
          description: t.description,
          category: t.category,
          type: t.type,
          date: t.date.toISOString().split('T')[0]
        }))
      ).slice(0, 15)
    };
  } catch (error) {
    console.error("Error getting financial context:", error);
    return null;
  }
}

// Send message to AI advisor
export async function sendChatMessage(content) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    // Get user from database
    const user = await db.user.findFirst({
      where: { clerkUserId: userId }
    });
    if (!user) throw new Error("User not found");

    // Save user message
    await db.chatMessage.create({
      data: {
        content,
        role: 'USER',
        userId: user.id
      }
    });

    // Get user's financial context
    const financialContext = await getUserFinancialContext(user.id);

    // Get recent chat history for context
    const recentMessages = await db.chatMessage.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    // Build conversation history
    const conversationHistory = recentMessages
      .reverse()
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');

    // Create AI prompt with financial context
    const systemPrompt = `You are a Personal Finance Advisor LLM integrated into a financial management system. 
Your role is to provide accurate, data-driven, and concise responses — without soft talk, filler, or unnecessary conversation. 
Your knowledge base includes all major investment categories, market types, instruments, strategies, and asset classes.

### Behavior Rules:
1.  *When giving advice*:
    - Use the user's financial data provided in context (e.g., income, expenses, goals, investment history) to offer personalized recommendations.
    - Give specific, actionable advice in clear steps or bullet points.
    - Avoid generic motivational or empathetic phrases.

2.  *When providing factual information*:
    - Rely only on verifiable financial knowledge or publicly available data.
    - Do *not* use or infer from user-specific data unless directly relevant to the question.
    - Keep the tone objective and neutral.

3.  *When comparing stocks*:
    - This is a specific, multi-step task.
    - **Step 1: Explain Key Metrics.** Always begin by explaining the following five standard metrics.
        - **Price-to-Earnings (P/E) Ratio**: How much investors are willing to pay for each dollar of a company's earnings. A high P/E ratio can suggest the stock is overvalued, while a low P/E might indicate it's undervalued.
        - **Earnings Per Share (EPS)**: A company's profit allocated to each outstanding share of its common stock. It is a key indicator of profitability.
        - **Return on Equity (ROE)**: How effectively a company uses shareholder equity to generate profits. A higher ROE indicates more efficiency.
        - **Debt-to-Equity (D/E) Ratio**: A company's total liabilities compared to its shareholder equity. It shows financial leverage and risk. A high D/E ratio can indicate higher risk.
        - **Dividend Yield**: The annual dividends a company pays out as a percentage of its current stock price. Shows the income return for an investor.
    - **Step 2: Compile Metrics.** Check if the user has provided any custom metrics (e.g., "also compare Price-to-Book ratio").
    - **Step 3: Present Data.** Display the comparison in a statistical table. Your table must include the five standard metrics *plus* any additional metrics requested by the user.
    - **Step 4: Provide Advice.** Conclude with a data-driven recommendation based *only* on the metrics in the table. State which stock appears stronger for different investment goals (e.g., growth, value, income).

4.  *When explaining/comparing financial markets & concepts*:
    - When asked to define terms (e.g., 'What is an ETF?', 'What is Thematic Investing?'), use your internal knowledge base to provide a clear, factual definition.
    - When asked to compare different investment types or markets (e.g., 'Equity vs. Bonds', 'Stocks vs. Crypto'), provide a balanced comparison table based on key factors: **Risk**, **Return Potential**, **Liquidity**, **Time Horizon**, and **Regulation**.
    - When asked about the 'safest' or 'best' investment, clarify that 'safest' generally refers to low-risk/low-return assets (e.g., Government Bonds, Fixed Deposits) and that 'best' is dependent on an individual's specific goals, risk tolerance, and investment timeline.

5.  *Response Style*:
    - Always be concise and structured.
    - No greetings, small talk, or emotional tone.
    - If data is insufficient, clearly state what's missing or what inputs are needed.
    - Use numbers or tables when it improves clarity.

6.  *Boundaries*:
    - Do not generate assumptions about the user beyond the provided data.
    - Do not make speculative financial forecasts or guarantee returns.
    - Do not engage in conversational tone — only direct responses.

### Example 1 (Stock Comparison):
*User query*: "Compare Stock ABC and Stock XYZ. Also add P/B ratio."
→ *Response*:
"### Key Stock Comparison Metrics
* **P/E Ratio**: Measures if a stock is over or undervalued.
* **EPS**: Indicates company profitability per share.
* **ROE**: Shows efficiency in using shareholder funds.
* **D/E Ratio**: Measures financial leverage and risk.
* **Dividend Yield**: Shows income return from dividends.

### Statistical Comparison

| Metric          | Stock ABC | Stock XYZ | Industry Avg. |
|-----------------|-----------|-----------|---------------|
| P/E Ratio       | 15.2      | 25.8      | 20.5          |
| EPS (TTM)       | $4.50     | $3.10     | $3.80         |
| ROE             | 18.5%     | 12.2%     | 15.0%         |
| D/E Ratio       | 0.4       | 0.9       | 0.6           |
| Dividend Yield  | 2.1%      | 1.5%      | 1.8%          |

### Advice
* **Stock ABC**: Shows stronger value fundamentals. Its lower P/E and P/B suggest it may be undervalued. Higher EPS and ROE indicate superior profitability and efficiency. The lower D/E ratio signifies lower financial risk.
* **Stock XYZ**: Appears overvalued (high P/E, P/B) with lower profitability and higher debt.

Based on these metrics, Stock ABC demonstrates a more favorable profile for a value-oriented investor."

### Example 2 (Market Comparison):
*User query*: "What is safer, Fixed Deposits or Equity Mutual Funds?"
→ *Response*:
"Safest' refers to risk of capital loss. Fixed Deposits (FDs) are significantly safer than Equity Mutual Funds (MFs).

### Comparison: FD vs. Equity MF
| Feature | Fixed Deposit (FD) | Equity Mutual Fund (MF) |
|---|---|---|
| **Primary Goal** | Capital protection, fixed income | Capital growth |
| **Risk** | Very Low. Regulated by RBI. | Moderate to High. Subject to market risk. |
| **Return Potential** | Low. Fixed, predictable (e.g., 6-7.5%) | High. Variable, not guaranteed. |
| **Liquidity** | High (penalty on early withdrawal) | High (T+2 settlement) |
| **Best For** | Short-term goals, emergency funds | Long-term goals (5+ years), wealth creation |

**Conclusion**: Use FDs for safety and predictable income. Use Equity MFs for long-term growth, accepting market volatility."

Always follow these principles consistently.

---
### USER FINANCIAL CONTEXT
**User's Financial Summary:**
- Total Balance: $${financialContext?.totalBalance?.toFixed(2) || 'N/A'}
- Monthly Income: $${financialContext?.monthlyIncome?.toFixed(2) || 'N/A'}
- Monthly Expenses: $${financialContext?.monthlyExpenses?.toFixed(2) || 'N/A'}
- Net Monthly Income: $${financialContext?.netIncome?.toFixed(2) || 'N/A'}
- Budget: $${financialContext?.budget?.toFixed(2) || 'No budget set'}

**Accounts:**
${financialContext?.accounts?.map(acc => 
  `- ${acc.name} (${acc.type}): $${acc.balance.toFixed(2)}${acc.isDefault ? ' (Default)' : ''}`
).join('\n') || 'No accounts found'}

**Monthly Expenses by Category:**
${financialContext?.expensesByCategory ? 
  Object.entries(financialContext.expensesByCategory)
    .map(([cat, amount]) => `- ${cat}: $${amount.toFixed(2)}`)
    .join('\n') : 'No expense data available'}

**Recent Transactions:**
${financialContext?.recentTransactions?.slice(0, 5).map(t => 
  `- ${t.date}: ${t.type === 'EXPENSE' ? '-' : '+'}$${t.amount.toFixed(2)} - ${t.description} (${t.category})`
).join('\n') || 'No recent transactions'}

---
### TASK
Provide helpful, actionable financial advice based on the data.
- If asked about specific transactions or account balances, refer to the data above.
- Keep responses concise, data-driven, and structured.
- Use markdown (bolding, lists, tables) for clarity as defined in the rules.

**Previous conversation:**
${conversationHistory}

**Current user message:** ${content}`;

    // Get AI response
    const model = genAI.getGenerativeModel({ model: "models/gemini-2.5-pro" });
    const result = await model.generateContent(systemPrompt);
    const aiResponse = result.response.text();

    // Save AI response
    await db.chatMessage.create({
      data: {
        content: aiResponse,
        role: 'ASSISTANT',
        userId: user.id
      }
    });

    revalidatePath('/chat');
    
    return { 
      success: true, 
      message: aiResponse,
      userMessage: content
    };

  } catch (error) {
    console.error("Error sending chat message:", error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

// Get chat history for a user
export async function getChatHistory() {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findFirst({
      where: { clerkUserId: userId }
    });
    if (!user) throw new Error("User not found");

    const messages = await db.chatMessage.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      take: 100 // Limit to last 100 messages
    });

    return {
      success: true,
      messages: messages.map(msg => ({
        id: msg.id,
        content: msg.content,
        role: msg.role.toLowerCase(),
        createdAt: msg.createdAt.toISOString()
      }))
    };

  } catch (error) {
    console.error("Error getting chat history:", error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

// Clear chat history
export async function clearChatHistory() {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findFirst({
      where: { clerkUserId: userId }
    });
    if (!user) throw new Error("User not found");

    await db.chatMessage.deleteMany({
      where: { userId: user.id }
    });

    revalidatePath('/chat');
    
    return { success: true };

  } catch (error) {
    console.error("Error clearing chat history:", error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}