import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middleware/auth';
import { RAGChatService } from '../services/ragChat';
import { GeminiService } from '../services/gemini';
import type {
  ChatStartRequest,
  ChatMessageRequest,
  ChatMessageResponse,
} from '../types';

const router = Router();
const prisma = new PrismaClient({
  log: ['error', 'warn'],
  // Ensure UTF-8 for all database operations
});

// Lazy initialization of services
let ragService: RAGChatService | null = null;
let geminiService: GeminiService | null = null;

export function getRAGService(): RAGChatService {
  if (!ragService) {
    // Use Google provider by default (can also use 'groq')
    const provider = process.env.RAG_PROVIDER || 'google';
    ragService = new RAGChatService(provider);
  }
  return ragService;
}

function getGeminiService(): GeminiService {
  if (!geminiService) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY is required for assessment greetings');
    }
    geminiService = new GeminiService(apiKey);
  }
  return geminiService;
}

// POST /api/chat/start - Start a new chat session
router.post('/start', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const {
      sessionId,
      assessmentId,
      assessmentSummary,
      language = 'en',
    }: ChatStartRequest = req.body;

    if (!sessionId) {
      return res.status(400).json({
        error: 'sessionId is required',
      });
    }

    // Get or create chat session context
    let assessment = null;
    if (assessmentId) {
      assessment = await prisma.assessment.findFirst({
        where: {
          id: assessmentId,
          user_id: userId,
        },
      });
    }

    // Get existing chat messages for this assessment ONLY (strictly filter by assessment_id)
    // Never mix messages from different assessments
    // IMPORTANT: If no assessmentId is provided, don't load any old messages - start fresh
    let existingMessages: any[] = [];
    if (assessment) {
      // Only load messages if we have a specific assessment
      existingMessages = await prisma.chatMessage.findMany({
        where: {
          user_id: userId,
          assessment_id: assessment.id, // Use assessment.id to ensure we get messages for THIS assessment only
        },
        orderBy: { created_at: 'asc' },
        take: 50,
      });
    }
    // If no assessment, don't load any old messages - start with a clean chat session

    // IMPORTANT: Double-check database to prevent race conditions
    // Even if existingMessages is empty, check if an initial message exists in the database
    // This prevents duplicates when /assessment/complete creates a message and /chat/start is called immediately
    let dbHasInitialMessage = false;
    if (assessment && existingMessages.length === 0) {
      const dbCheck = await prisma.chatMessage.findFirst({
        where: {
          user_id: userId,
          assessment_id: assessment.id,
          sender: 'bot',
          is_results_chat: true,
        },
      });
      dbHasInitialMessage = !!dbCheck;
      
      // If we found a message in the database but not in existingMessages, reload all messages
      if (dbCheck) {
        existingMessages = await prisma.chatMessage.findMany({
          where: {
            user_id: userId,
            assessment_id: assessment.id,
          },
          orderBy: { created_at: 'asc' },
          take: 50,
        });
      }
    }

    // Format existing messages for frontend
    // Include assessment_id so frontend can verify messages belong to the correct assessment
    const formattedMessages = existingMessages.map((msg) => ({
      id: msg.id,
      text: msg.message_text,
      sender: msg.sender as 'user' | 'bot',
      timestamp: msg.created_at,
      assessment_id: msg.assessment_id, // Include for frontend filtering
    }));

    let initialMessage: ChatMessageResponse | null = null;

    // Check if there's already an initial bot message for this assessment
    // Since existingMessages are already filtered by assessment_id, we just need to check sender and is_results_chat
    const hasInitialBotMessage = existingMessages.some(
      (msg) => msg.sender === 'bot' && msg.is_results_chat
    );

    // Only generate initial greeting if:
    // 1. No existing messages (after double-check)
    // 2. No initial message in database (prevents race conditions)
    // 3. We have an assessment summary
    // 4. We have an assessment (to ensure it's assessment-specific)
    if (existingMessages.length === 0 && !dbHasInitialMessage && assessmentSummary && !hasInitialBotMessage && assessment) {
      try {
        // Double-check one more time before creating (race condition protection)
        const finalCheck = await prisma.chatMessage.findFirst({
          where: {
            user_id: userId,
            assessment_id: assessment.id,
            sender: 'bot',
            is_results_chat: true,
          },
        });

        // Only create if still doesn't exist after final check
        if (!finalCheck) {
          // OPTIMIZATION: Initialize RAG in parallel with Gemini greeting generation
          // This ensures RAG is ready when user asks follow-up questions (no loading delay)
          const ragInitPromise = getRAGService().initialize().catch(err => {
            console.error('Failed to preload RAG service:', err);
            // Don't fail the request if RAG preload fails - it will lazy load on first use
            return undefined;
          });

          // Use Gemini for post-assessment initial greeting (preserves recommendation logic)
          const geminiPromise = getGeminiService().generateInitialGreeting(
            assessmentSummary,
            language
          );

          // Wait for both to complete (RAG init happens in parallel with Gemini)
          const [aiResponse, _ragInit] = await Promise.all([geminiPromise, ragInitPromise]);

          initialMessage = {
            reply: aiResponse.reply,
            intent: aiResponse.intent,
          };

          // Save bot message to database
          await prisma.chatMessage.create({
            data: {
              user_id: userId,
              assessment_id: assessment.id,
              message_text: aiResponse.reply,
              sender: 'bot',
              is_results_chat: true,
            },
          });
        }
      } catch (error) {
        console.error('Failed to generate initial chat message:', error);
      }
    }

    res.json({
      sessionId,
      assessmentId: assessment?.id,
      messageCount: existingMessages.length + (initialMessage ? 1 : 0),
      initialMessage,
      existingMessages: formattedMessages,
    });
  } catch (error: any) {
    console.error('Error starting chat session:', error);
    res.status(500).json({
      error: 'Failed to start chat session',
    });
  }
});

// POST /api/chat/message - Send a message and get AI response
router.post('/message', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { sessionId, message, language, assessmentId }: ChatMessageRequest =
      req.body;

    if (
      !sessionId ||
      !message ||
      typeof message !== 'string' ||
      message.trim().length === 0
    ) {
      return res.status(400).json({
        error: 'sessionId and message (non-empty string) are required',
      });
    }

    // Get assessment if provided
    let assessment = null;
    let assessmentSummary = '';
    if (assessmentId) {
      assessment = await prisma.assessment.findFirst({
        where: {
          id: assessmentId,
          user_id: userId,
        },
        include: {
          test_responses: {
            where: { is_completed: true },
          },
        },
      });

      if (assessment) {
        // Get user info
        const user = await prisma.customUser.findUnique({
          where: { id: userId },
        });

        // Build detailed assessment summary from test responses
        const testResponses = assessment.test_responses.map((tr) => ({
          type: tr.test_type,
          answers: JSON.parse(tr.responses || '{}'),
        }));

        // Create a more detailed summary for better AI understanding
        const summaryParts = [
          `Assessment #${assessment.assessment_number} completed on ${assessment.completed_at?.toISOString()}.`,
          `Student: ${user?.name || 'Student'}, Grade: ${user?.grade || 'N/A'}, Age: ${user?.age || 'N/A'}`,
          `Test Responses:`,
        ];

        testResponses.forEach((tr) => {
          summaryParts.push(`\n${tr.type.toUpperCase()} Test:`);
          Object.entries(tr.answers).forEach(([qId, answer]) => {
            const answerStr = Array.isArray(answer) ? answer.join(', ') : String(answer);
            summaryParts.push(`  Question ${qId}: ${answerStr}`);
          });
        });

        assessmentSummary = summaryParts.join('\n');
      }
    }

    // Save user message to database first
    const userMessage = await prisma.chatMessage.create({
      data: {
        user_id: userId,
        assessment_id: assessment?.id || null,
        message_text: message.trim(),
        sender: 'user',
        is_results_chat: !!assessment,
      },
    });

    // Get previous messages for context (excluding the one we just created)
    // CRITICAL: For assessment-specific chats, only load messages from that assessment
    // For general chats (no assessment), load recent messages to maintain conversation context
    let previousMessages;
    if (assessment) {
      // Assessment-specific chat: only load messages from that assessment
      previousMessages = await prisma.chatMessage.findMany({
        where: {
          user_id: userId,
          assessment_id: assessment.id,
          id: { not: userMessage.id },
        },
        orderBy: { created_at: 'desc' },
        take: 10,
      });
    } else {
      // General chat: load recent messages (without assessment_id) for conversation context
      // Only include messages from the last 10 minutes to create natural session boundaries
      // This prevents old conversations from polluting new chat sessions
      const tenMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      previousMessages = await prisma.chatMessage.findMany({
        where: {
          user_id: userId,
          assessment_id: null, // Only general chat messages
          id: { not: userMessage.id },
          created_at: { gte: tenMinutesAgo }, // Only messages from last 10 minutes
        },
        orderBy: { created_at: 'desc' },
        take: 10,
      });
    }

    // Reverse to get chronological order
    const contextMessages = previousMessages.reverse().map((msg) => ({
      role: msg.sender === 'bot' ? ('assistant' as const) : ('user' as const),
      content: msg.message_text,
      timestamp: msg.created_at,
    }));

    // Use provided language or default to English
    const userLanguage = language || 'en';

    // Generate bot response using RAG with language parameter
    const botReply = await getRAGService().chat(
      message,
      contextMessages,
      userLanguage
    );

    // Save bot message to database
    await prisma.chatMessage.create({
      data: {
        user_id: userId,
        assessment_id: assessment?.id || null,
        message_text: botReply,
        sender: 'bot',
        is_results_chat: !!assessment,
      },
    });

    const response: ChatMessageResponse = {
      reply: botReply,
      intent: 'general', // RAG doesn't provide intent classification
    };

    res.json(response);
  } catch (error: any) {
    console.error('Error processing chat message:', error);

    // Return fallback response
    const fallback: ChatMessageResponse = {
      reply:
        "I'm having trouble processing that right now. Could you try rephrasing your question?",
      intent: 'error',
    };

    res.status(500).json(fallback);
  }
});

// GET /api/chat/history - Get chat history
router.get('/history', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const assessmentIdParam = req.query.assessment_id;
    const assessmentId = assessmentIdParam
      ? parseInt(assessmentIdParam as string)
      : null;

    // If assessmentId is provided, verify it belongs to the user and strictly filter by it
    // If assessmentId is not provided, only return non-assessment-specific messages
    if (assessmentId !== null && !isNaN(assessmentId)) {
      // Verify assessment belongs to user
      const assessment = await prisma.assessment.findFirst({
        where: {
          id: assessmentId,
          user_id: userId,
        },
      });

      if (!assessment) {
        return res.status(404).json({ error: 'Assessment not found' });
      }

      // CRITICAL: Strictly filter by assessment_id - ONLY return messages for this specific assessment
      // NEVER return messages from other assessments or messages without assessment_id
      const messages = await prisma.chatMessage.findMany({
        where: {
          user_id: userId,
          assessment_id: assessmentId, // Strict filter - ONLY this assessment, no null values
        },
        orderBy: { created_at: 'asc' },
        take: 50,
      });
      
      // Double-check: filter out any messages that don't match (shouldn't happen, but safety check)
      const validMessages = messages.filter(msg => msg.assessment_id === assessmentId);

      const messagesData = validMessages.map((msg) => ({
        id: msg.id,
        message_text: msg.message_text,
        sender: msg.sender,
        created_at: msg.created_at,
        timestamp: msg.created_at,
        is_results_chat: msg.is_results_chat,
        assessment_id: msg.assessment_id, // Include for frontend filtering
      }));

      return res.json(messagesData);
    }

    // If no assessmentId, return only non-assessment-specific messages
    const messages = await prisma.chatMessage.findMany({
      where: {
        user_id: userId,
        assessment_id: null, // Only general chats, not assessment-specific
      },
      orderBy: { created_at: 'asc' },
      take: 50,
    });

    const messagesData = messages.map((msg) => ({
      id: msg.id,
      message_text: msg.message_text,
      sender: msg.sender,
      created_at: msg.created_at,
      timestamp: msg.created_at, // Add timestamp alias for frontend compatibility
      is_results_chat: msg.is_results_chat,
    }));

    // Return as array directly for easier frontend consumption
    res.json(messagesData);
  } catch (error: any) {
    console.error('Error getting chat history:', error);
    res.status(500).json({ error: 'Failed to get chat history' });
  }
});

// DELETE /api/chat/history - Delete chat history for an assessment or all chats
router.delete('/history', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const assessmentId = req.query.assessment_id
      ? parseInt(req.query.assessment_id as string)
      : undefined;

    if (assessmentId) {
      // Delete chat history for specific assessment
      const deleted = await prisma.chatMessage.deleteMany({
        where: {
          user_id: userId,
          assessment_id: assessmentId,
        },
      });

      res.json({
        success: true,
        message: `Deleted ${deleted.count} messages for assessment ${assessmentId}`,
        deletedCount: deleted.count,
      });
    } else {
      // Delete all chat history for user
      const deleted = await prisma.chatMessage.deleteMany({
        where: {
          user_id: userId,
        },
      });

      res.json({
        success: true,
        message: `Deleted ${deleted.count} messages`,
        deletedCount: deleted.count,
      });
    }
  } catch (error: any) {
    console.error('Error deleting chat history:', error);
    res.status(500).json({ error: 'Failed to delete chat history' });
  }
});

export default router;

