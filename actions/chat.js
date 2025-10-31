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
    const systemPrompt = `You are a helpful personal finance advisor AI assistant. You have access to the user's financial data and should provide personalized advice based on their situation.

User's Financial Summary:
- Total Balance: $${financialContext?.totalBalance?.toFixed(2) || 'N/A'}
- Monthly Income: $${financialContext?.monthlyIncome?.toFixed(2) || 'N/A'}
- Monthly Expenses: $${financialContext?.monthlyExpenses?.toFixed(2) || 'N/A'}
- Net Monthly Income: $${financialContext?.netIncome?.toFixed(2) || 'N/A'}
- Budget: $${financialContext?.budget?.toFixed(2) || 'No budget set'}

Accounts:
${financialContext?.accounts?.map(acc => 
  `- ${acc.name} (${acc.type}): $${acc.balance.toFixed(2)}${acc.isDefault ? ' (Default)' : ''}`
).join('\n') || 'No accounts found'}

Monthly Expenses by Category:
${financialContext?.expensesByCategory ? 
  Object.entries(financialContext.expensesByCategory)
    .map(([cat, amount]) => `- ${cat}: $${amount.toFixed(2)}`)
    .join('\n') : 'No expense data available'}

Recent Transactions:
${financialContext?.recentTransactions?.slice(0, 5).map(t => 
  `- ${t.date}: ${t.type === 'EXPENSE' ? '-' : '+'}$${t.amount.toFixed(2)} - ${t.description} (${t.category})`
).join('\n') || 'No recent transactions'}

Provide helpful, actionable financial advice. Be encouraging and supportive. If asked about specific transactions or account balances, refer to the data above. Keep responses concise but informative.

Format your response using markdown for better readability:
- Use **bold** for important points and action items
- Use bullet points for lists and recommendations
- Use numbered lists for step-by-step advice
- Keep paragraphs short and focused
- Use clear headings when appropriate

Previous conversation:
${conversationHistory}

Current user message: ${content}`;

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