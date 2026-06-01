"""
RAG Service for Career Guidance Chatbot
This service wraps the RAG chatbot functionality for integration with the Node.js backend.
"""
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.messages import HumanMessage, AIMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.documents import Document
from langchain_chroma import Chroma
from langchain_text_splitters import RecursiveCharacterTextSplitter
from dotenv import load_dotenv
import json
import os
import sys
import io
from typing import List, Dict, Optional
from pathlib import Path

# CRITICAL: Set up proper UTF-8 encoding for stdin/stdout
# This fixes encoding issues with Hindi, Telugu, and other Unicode languages
sys.stdin = io.TextIOWrapper(
    sys.stdin.buffer, encoding='utf-8', errors='replace')
sys.stdout = io.TextIOWrapper(
    sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(
    sys.stderr.buffer, encoding='utf-8', errors='replace')

# Load environment variables from .env file
# Look for .env in backend directory (parent of src)
backend_dir = Path(__file__).parent.parent.parent
env_path = backend_dir / '.env'
if env_path.exists():
    load_dotenv(env_path)
    print(f"Loaded .env from {env_path}", file=sys.stderr)
else:
    print(f"Warning: .env not found at {env_path}", file=sys.stderr)
    load_dotenv()  # Try to load from current directory

# Add parent directory to path for imports
sys.path.insert(0, str(backend_dir))


# Configuration
CHUNK_SIZE = 512
CHUNK_OVERLAP = 150


class RAGChatService:
    def __init__(self, careers_json_path: str, chroma_persist_dir: str, provider: str = "google"):
        """
        Initialize the RAG Chat Service

        Args:
            careers_json_path: Path to careers_cleaned.json
            chroma_persist_dir: Path to chroma_data_full directory
            provider: LLM provider to use ("google" or "groq")
        """
        self.provider = provider
        self.careers_json_path = careers_json_path
        self.chroma_persist_dir = chroma_persist_dir

        # Initialize embeddings
        # self.embeddings = HuggingFaceEmbeddings(
        #     model_name="sentence-transformers/all-mpnet-base-v2"
        # )

        self.embeddings = HuggingFaceEmbeddings(
            model_name="BAAI/bge-m3"
        )

        # Initialize or load vector database
        self.vectordb = self._init_vectordb()

        # Initialize LLM
        self.llm = self._init_llm()

        # Initialize retriever
        self.retriever = self.vectordb.as_retriever(search_kwargs={"k": 3})

        # Build the chain
        self.chain = self._build_chain()

    def _reformulate_query(self, question: str, chat_history: List) -> str:
        """
        Reformulate the user's question by incorporating context from chat history.
        This helps with follow-up questions like "any scholarship in this?" where
        "this" refers to a career mentioned earlier.
        
        Args:
            question: The user's current question
            chat_history: List of previous HumanMessage/AIMessage objects
            
        Returns:
            A reformulated, self-contained question for retrieval
        """
        # Debug logging
        print(f"[RAG DEBUG] _reformulate_query called with question='{question}', history_len={len(chat_history)}", file=sys.stderr)
        
        # If no chat history, return as-is
        if not chat_history:
            print(f"[RAG DEBUG] No chat history, skipping reformulation", file=sys.stderr)
            return question
        
        # Always reformulate short questions (under 8 words) when there's chat history
        # Short questions are often follow-ups that need context like:
        # - "give example from the field"
        # - "any scholarships?"
        # - "what about salary?"
        # - "how long does it take?"
        is_short_question = len(question.split()) < 8
        
        # Also check for pronouns/references that definitely need context
        context_words = ['this', 'that', 'it', 'these', 'those', 'above', 'same', 'such', 'mentioned', 'the field', 'career', 'job']
        has_context_words = any(word in question.lower() for word in context_words)
        
        # Reformulate if question is short OR has context words
        if not (is_short_question or has_context_words):
            return question
        
        try:
            # Build context from recent messages
            recent_context = []
            for msg in chat_history[-4:]:  # Last 4 messages
                if isinstance(msg, HumanMessage):
                    recent_context.append(f"User: {msg.content}")
                elif isinstance(msg, AIMessage):
                    # Only include a summary of AI responses
                    content = msg.content[:200] + "..." if len(msg.content) > 200 else msg.content
                    recent_context.append(f"Assistant: {content}")
            
            context_text = "\n".join(recent_context)
            
            reformulation_prompt = f"""Given this conversation context:
{context_text}

The user now asks: "{question}"

Rewrite the user's question to be a self-contained search query that includes the relevant context (like career name, topic, etc.). 
Only output the reformulated question, nothing else. Keep it concise (under 20 words).

Reformulated question:"""
            
            # Use the LLM to reformulate
            reformulated = self.llm.invoke(reformulation_prompt)
            if hasattr(reformulated, 'content'):
                reformulated = reformulated.content
            reformulated = str(reformulated).strip()
            
            # Log for debugging
            print(f"[RAG] Query reformulation: '{question}' -> '{reformulated}'", file=sys.stderr)
            
            return reformulated if reformulated else question
            
        except Exception as e:
            print(f"[RAG] Query reformulation failed: {e}, using original", file=sys.stderr)
            return question


    def _init_vectordb(self) -> Chroma:
        """Initialize or load Chroma vector database"""
        if os.path.exists(self.chroma_persist_dir) and os.listdir(self.chroma_persist_dir):
            print(
                f"Loading existing Chroma DB from {self.chroma_persist_dir}", file=sys.stderr)
            return Chroma(
                persist_directory=self.chroma_persist_dir,
                embedding_function=self.embeddings
            )
        else:
            print(
                f"Creating new Chroma DB at {self.chroma_persist_dir}", file=sys.stderr)
            items = self._load_json(self.careers_json_path)
            docs = self._json_to_docs(items)
            return Chroma.from_documents(
                documents=docs,
                embedding=self.embeddings,
                persist_directory=self.chroma_persist_dir
            )

    def _load_json(self, path: str) -> List[Dict]:
        """Load careers JSON file with proper UTF-8 encoding"""
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _json_to_docs(self, items: List[Dict]) -> List[Document]:
        """Convert JSON items to Document chunks"""
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=CHUNK_SIZE,
            chunk_overlap=CHUNK_OVERLAP,
            separators=["\n\n", "\n", " ", ""],
        )

        docs = []
        for item in items:
            combined = f"{item['title']}\n\n{item['content']}"
            chunks = splitter.split_text(combined)

            for i, ch in enumerate(chunks):
                docs.append(Document(
                    page_content=ch,
                    metadata={
                        "source_id": item["id"],
                        "title": item["title"],
                        "chunk_index": i
                    }
                ))
        return docs

    def _init_llm(self):
        """Initialize the LLM based on provider"""
        if self.provider == "groq":
            from langchain_groq import ChatGroq
            return ChatGroq(
                model="llama-3.3-70b-versatile",
                temperature=0.1,
                max_tokens=1500
            )
        elif self.provider == "google":
            from langchain_google_genai import ChatGoogleGenerativeAI
            # Use gemini-2.5-flash instead of gemini-2.5-pro for better free tier limits
            # Flash has 15 requests/minute vs Pro's 2 requests/minute on free tier
            # Get API key from environment (support both GEMINI_API_KEY and GOOGLE_API_KEY)
            api_key = os.environ.get(
                "GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
            if not api_key:
                raise ValueError(
                    "GEMINI_API_KEY or GOOGLE_API_KEY environment variable is required")
            print(
                f"[DEBUG] Using Google API key: {api_key[:10]}...", file=sys.stderr)
            return ChatGoogleGenerativeAI(
                model="gemini-2.5-flash",
                temperature=0.1,
                max_output_tokens=1500,
                google_api_key=api_key
            )
        else:
            raise ValueError(f"Unknown provider: {self.provider}")

    def _build_chain(self):
        """Build the conversational RAG chain"""
        prompt = ChatPromptTemplate.from_messages([
            ("system",
             """You are a helpful and friendly multilingual career guidance assistant for Indian students aged 13-15.

            LANGUAGE INSTRUCTION:
            You MUST respond in this language: {language}
            - If the user's input is not in {language}, translate internally as needed.
            - All final answers MUST be in {language}.

            When answering questions about careers, education paths, or professional guidance:
            - Keep responses SHORT and CONCISE (2-4 paragraphs maximum)
            - Prioritize information from the Context provided below
            - Use the context to give detailed, specific answers
            - If the context has relevant information, base your answer primarily on it
            - If the context doesn't have the information, you can provide general career guidance relevant to India
            - If the question is unrelated to career guidance/education/careers, politely inform the user that you can only assist with career-related queries
            - Keep responses age-appropriate, encouraging, and culturally sensitive

            Context:
            {context}"""),
            MessagesPlaceholder("chat_history"),
            ("human", "{question}")
        ])

        def format_docs(docs):
            if not docs:
                return "No relevant information found."
            formatted = []
            for i, doc in enumerate(docs, 1):
                formatted.append(
                    f"[Source {i}: {doc.metadata.get('title', 'Unknown')}]\n{doc.page_content}")
            return "\n\n---\n\n".join(formatted)

        def get_context(inputs):
            question = inputs["question"]
            docs = self.retriever.invoke(question)
            return format_docs(docs)

        chain = (
            {
                "context": get_context,
                "question": lambda x: x["question"],
                "language": lambda x: x.get("language", "en"),
                "chat_history": lambda x: x.get("chat_history", [])
            }
            | prompt
            | self.llm
            | StrOutputParser()
        )

        return chain

    def chat(self, message: str, chat_history: List[Dict], language: str = "en") -> Dict:
        """
        Process a chat message and return a response
        Handles full multilingual flow including Hindi, Telugu, etc.

        Args:
            message: User's message (can be in any language including Hindi/Telugu)
            chat_history: List of previous messages in format [{"role": "user"|"assistant", "content": "..."}]
                         All content fields can contain multilingual text
            language: Language code (en, hi, te, ta, bn, gu)

        Returns:
            Dict with 'response' and 'sources'
        """
        try:
            # Verify message encoding (defensive check)
            if not isinstance(message, str):
                message = str(message)

            # Convert chat history to LangChain format
            # This preserves all Unicode characters from previous conversations
            lc_history = []
            for msg in chat_history[-10:]:  # Keep last 10 messages for context
                content = msg.get("content", "")
                # Ensure content is properly decoded string
                if not isinstance(content, str):
                    content = str(content)

                if msg["role"] == "user":
                    lc_history.append(HumanMessage(content=content))
                elif msg["role"] == "assistant":
                    lc_history.append(AIMessage(content=content))

            # Get relevant documents
            print(
                f"[DEBUG] Retrieving documents for message: {message[:50]}...", file=sys.stderr)
            docs = self.retriever.invoke(message)
            print(f"[DEBUG] Retrieved {len(docs)} documents", file=sys.stderr)

            # Generate response - LLM will respond in specified language
            print(
                f"[DEBUG] Calling LLM chain with language: {language}", file=sys.stderr)
            response = self.chain.invoke({
                "question": message,
                "chat_history": lc_history,
                "language": language
            })
            print(
                f"[DEBUG] LLM responded with {len(response) if response else 0} chars", file=sys.stderr)

            # Verify response is string (should contain Hindi/Telugu if input was)
            if not isinstance(response, str):
                response = str(response)

            # Format sources
            sources = []
            for doc in docs[:4]:  # Top 4 sources
                sources.append({
                    "title": doc.metadata.get("title", "Unknown"),
                    "chunk_index": doc.metadata.get("chunk_index", 0),
                    "snippet": doc.page_content[:250]
                })

            return {
                "response": response,
                "sources": sources,
                "error": None
            }

        except Exception as e:
            error_msg = str(e)
            print(f"Error in chat: {error_msg}", file=sys.stderr)
            return {
                "response": None,
                "sources": [],
                "error": error_msg
            }

    def generate_initial_greeting(self, assessment_summary: str, language: str = "en") -> Dict:
        """
        Generate an initial greeting based on assessment results

        Args:
            assessment_summary: Summary of the assessment results
            language: Language code (currently only 'en' is fully supported)

        Returns:
            Dict with 'response' and 'sources'
        """
        try:
            # Language-specific instructions
            lang_instructions = {
                "en": "Generate in English",
                "hi": "Generate in Hindi (हिंदी में जवाब दें)",
                "te": "Generate in Telugu (తెలుగులో సమాధానం ఇవ్వండి)",
                "ta": "Generate in Tamil (தமிழில் பதிலளிக்கவும்)",
                "mr": "Generate in Marathi (मराठीत उत्तर द्या)",
                "bn": "Generate in Bengali (বাংলায় উত্তর দিন)"
            }

            lang_instruction = lang_instructions.get(
                language, "Generate in English")

            greeting_prompt = f"""Based on this student's assessment results, generate a warm, encouraging greeting that:
1. Welcomes them to the career guidance chat
2. Briefly acknowledges their assessment results
3. Invites them to ask questions about their career recommendations
4. Is age-appropriate for students aged 13-15

{lang_instruction}

Assessment Summary:
{assessment_summary}

Keep the greeting concise (2-3 sentences) and friendly."""

            result = self.chat(greeting_prompt, [], language)
            return result

        except Exception as e:
            print(
                f"Error generating initial greeting: {str(e)}", file=sys.stderr)
            return {
                "response": f"Hello! I'm your career guidance assistant. I'm here to help you explore your career options based on your assessment results. What would you like to know?",
                "sources": [],
                "error": str(e)
            }


def safe_json_dumps(obj):
    """Safely serialize JSON with proper UTF-8 encoding"""
    return json.dumps(obj, ensure_ascii=False, indent=None)


def main():
    """
    Main function to handle JSON-based API requests from Node.js
    Reads JSON from stdin (one command per line) and writes JSON to stdout
    """
    # Global service instance
    rag_service = None

    # Read all input lines
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            input_data = json.loads(line)
            command = input_data.get("command")

            if command == "initialize":
                # Initialize the service
                careers_json = input_data.get("careers_json_path")
                chroma_dir = input_data.get("chroma_persist_dir")
                provider = input_data.get("provider", "google")

                # Create service instance
                rag_service = RAGChatService(
                    careers_json, chroma_dir, provider)

                print(safe_json_dumps({
                    "status": "success",
                    "message": "RAG service initialized"
                }), flush=True)

            elif command == "chat":
                message = input_data.get("message")
                chat_history = input_data.get("chat_history", [])
                language = input_data.get("language", "en")

                if rag_service is None:
                    raise Exception(
                        "Service not initialized. Call 'initialize' first.")

                result = rag_service.chat(message, chat_history, language)

                # Debug: log what we're about to send
                print(
                    f"[DEBUG] Chat result: response={result.get('response') is not None}, error={result.get('error')}", file=sys.stderr)

                # If the chat method returned an error, propagate it properly
                if result.get("error"):
                    print(safe_json_dumps({
                        "status": "error",
                        "message": result["error"],
                        "data": result
                    }), flush=True)
                else:
                    print(safe_json_dumps({
                        "status": "success",
                        "data": result
                    }), flush=True)

            elif command == "greeting":
                assessment_summary = input_data.get("assessment_summary")
                language = input_data.get("language", "en")

                if rag_service is None:
                    raise Exception(
                        "Service not initialized. Call 'initialize' first.")

                result = rag_service.generate_initial_greeting(
                    assessment_summary, language)

                # If the greeting method returned an error, propagate it properly
                if result.get("error"):
                    print(safe_json_dumps({
                        "status": "error",
                        "message": result["error"],
                        "data": result
                    }), flush=True)
                else:
                    print(safe_json_dumps({
                        "status": "success",
                        "data": result
                    }), flush=True)

            else:
                print(safe_json_dumps({
                    "status": "error",
                    "message": f"Unknown command: {command}"
                }), flush=True)

        except Exception as e:
            print(safe_json_dumps({
                "status": "error",
                "message": str(e)
            }), flush=True)


if __name__ == "__main__":
    main()

# """
# RAG Service for Career Guidance Chatbot
# This service wraps the RAG chatbot functionality for integration with the Node.js backend.
# """
# from langchain_huggingface import HuggingFaceEmbeddings
# from langchain_core.messages import HumanMessage, AIMessage
# from langchain_core.output_parsers import StrOutputParser
# from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
# from langchain_core.documents import Document
# from langchain_chroma import Chroma
# from langchain_text_splitters import RecursiveCharacterTextSplitter
# from dotenv import load_dotenv
# import json
# import os
# import sys
# from typing import List, Dict, Optional
# from pathlib import Path

# # Load environment variables from .env file
# # Look for .env in backend directory (parent of src)
# backend_dir = Path(__file__).parent.parent.parent
# env_path = backend_dir / '.env'
# if env_path.exists():
#     load_dotenv(env_path)
#     print(f"Loaded .env from {env_path}", file=sys.stderr)
# else:
#     print(f"Warning: .env not found at {env_path}", file=sys.stderr)
#     load_dotenv()  # Try to load from current directory

# # Add parent directory to path for imports
# sys.path.insert(0, str(backend_dir))


# # Configuration
# CHUNK_SIZE = 512
# CHUNK_OVERLAP = 150


# class RAGChatService:
#     def __init__(self, careers_json_path: str, chroma_persist_dir: str, provider: str = "google"):
#         """
#         Initialize the RAG Chat Service

#         Args:
#             careers_json_path: Path to careers_cleaned.json
#             chroma_persist_dir: Path to chroma_data_full directory
#             provider: LLM provider to use ("google" or "groq")
#         """
#         self.provider = provider
#         self.careers_json_path = careers_json_path
#         self.chroma_persist_dir = chroma_persist_dir

#         # Initialize embeddings
#         self.embeddings = HuggingFaceEmbeddings(
#             model_name="sentence-transformers/all-mpnet-base-v2"
#         )
#         # self.embeddings = HuggingFaceEmbeddings(
#         #     model_name="BAAI/bge-m3"
#         # )

#         # Initialize or load vector database
#         self.vectordb = self._init_vectordb()

#         # Initialize LLM
#         self.llm = self._init_llm()

#         # Initialize retriever
#         self.retriever = self.vectordb.as_retriever(search_kwargs={"k": 3})

#         # Build the chain
#         self.chain = self._build_chain()

#     def _init_vectordb(self) -> Chroma:
#         """Initialize or load Chroma vector database"""
#         if os.path.exists(self.chroma_persist_dir) and os.listdir(self.chroma_persist_dir):
#             print(
#                 f"Loading existing Chroma DB from {self.chroma_persist_dir}", file=sys.stderr)
#             return Chroma(
#                 persist_directory=self.chroma_persist_dir,
#                 embedding_function=self.embeddings
#             )
#         else:
#             print(
#                 f"Creating new Chroma DB at {self.chroma_persist_dir}", file=sys.stderr)
#             items = self._load_json(self.careers_json_path)
#             docs = self._json_to_docs(items)
#             return Chroma.from_documents(
#                 documents=docs,
#                 embedding=self.embeddings,
#                 persist_directory=self.chroma_persist_dir
#             )

#     def _load_json(self, path: str) -> List[Dict]:
#         """Load careers JSON file"""
#         with open(path, "r", encoding="utf-8") as f:
#             return json.load(f)

#     def _json_to_docs(self, items: List[Dict]) -> List[Document]:
#         """Convert JSON items to Document chunks"""
#         splitter = RecursiveCharacterTextSplitter(
#             chunk_size=CHUNK_SIZE,
#             chunk_overlap=CHUNK_OVERLAP,
#             separators=["\n\n", "\n", " ", ""],
#         )

#         docs = []
#         for item in items:
#             combined = f"{item['title']}\n\n{item['content']}"
#             chunks = splitter.split_text(combined)

#             for i, ch in enumerate(chunks):
#                 docs.append(Document(
#                     page_content=ch,
#                     metadata={
#                         "source_id": item["id"],
#                         "title": item["title"],
#                         "chunk_index": i
#                     }
#                 ))
#         return docs

#     def _init_llm(self):
#         """Initialize the LLM based on provider"""
#         if self.provider == "groq":
#             from langchain_groq import ChatGroq
#             return ChatGroq(
#                 model="llama-3.3-70b-versatile",
#                 temperature=0.1,
#                 max_tokens=1500
#             )
#         elif self.provider == "google":
#             from langchain_google_genai import ChatGoogleGenerativeAI
#             return ChatGoogleGenerativeAI(
#                 model="gemini-2.5-pro",
#                 temperature=0.1,
#                 max_output_tokens=1500
#             )
#         else:
#             raise ValueError(f"Unknown provider: {self.provider}")

#     def _build_chain(self):
#         """Build the conversational RAG chain"""
#         prompt = ChatPromptTemplate.from_messages([
#             ("system",
#              """You are a helpful and friendly career guidance assistant for Indian students aged 13-15.

#             When answering questions about careers, education paths, or professional guidance:
#             - Keep responses SHORT and CONCISE (2-4 paragraphs maximum)
#             - Prioritize information from the Context provided below
#             - Use the context to give detailed, specific answers
#             - Consider Indian cultural context, family expectations, and local opportunities
#             - If the context has relevant information, base your answer primarily on it
#             - If the context doesn't have the information, you can provide general career guidance relevant to India
#             - If the question is unrelated to career guidance/education/careers, politely inform the user that you can only assist with career-related queries
#             - Keep responses age-appropriate, encouraging, and culturally sensitive

#             Context:
#             {context}"""),
#             MessagesPlaceholder("chat_history"),
#             ("human", "{question}")
#         ])

#         def format_docs(docs):
#             if not docs:
#                 return "No relevant information found."
#             formatted = []
#             for i, doc in enumerate(docs, 1):
#                 formatted.append(
#                     f"[Source {i}: {doc.metadata.get('title', 'Unknown')}]\n{doc.page_content}")
#             return "\n\n---\n\n".join(formatted)

#         def get_context(inputs):
#             question = inputs["question"]
#             docs = self.retriever.invoke(question)
#             return format_docs(docs)

#         chain = (
#             {
#                 "context": get_context,
#                 "question": lambda x: x["question"],
#                 "chat_history": lambda x: x.get("chat_history", [])
#             }
#             | prompt
#             | self.llm
#             | StrOutputParser()
#         )

#         return chain

#     def chat(self, message: str, chat_history: List[Dict]) -> Dict:
#         """
#         Process a chat message and return a response

#         Args:
#             message: User's message
#             chat_history: List of previous messages in format [{"role": "user"|"assistant", "content": "..."}]

#         Returns:
#             Dict with 'response' and 'sources'
#         """
#         try:
#             # Convert chat history to LangChain format
#             lc_history = []
#             for msg in chat_history[-10:]:  # Keep last 10 messages for context
#                 if msg["role"] == "user":
#                     lc_history.append(HumanMessage(content=msg["content"]))
#                 elif msg["role"] == "assistant":
#                     lc_history.append(AIMessage(content=msg["content"]))

#             # Get relevant documents
#             docs = self.retriever.invoke(message)

#             # Generate response
#             response = self.chain.invoke({
#                 "question": message,
#                 "chat_history": lc_history
#             })

#             # Format sources
#             sources = []
#             for doc in docs[:4]:  # Top 4 sources
#                 sources.append({
#                     "title": doc.metadata.get("title", "Unknown"),
#                     "chunk_index": doc.metadata.get("chunk_index", 0),
#                     "snippet": doc.page_content[:250]
#                 })

#             return {
#                 "response": response,
#                 "sources": sources,
#                 "error": None
#             }

#         except Exception as e:
#             print(f"Error in chat: {str(e)}", file=sys.stderr)
#             return {
#                 "response": None,
#                 "sources": [],
#                 "error": str(e)
#             }

#     def generate_initial_greeting(self, assessment_summary: str, language: str = "en") -> Dict:
#         """
#         Generate an initial greeting based on assessment results

#         Args:
#             assessment_summary: Summary of the assessment results
#             language: Language code (currently only 'en' is fully supported)

#         Returns:
#             Dict with 'response' and 'sources'
#         """
#         try:
#             greeting_prompt = f"""Based on this student's assessment results, generate a warm, encouraging greeting that:
# 1. Welcomes them to the career guidance chat
# 2. Briefly acknowledges their assessment results
# 3. Invites them to ask questions about their career recommendations
# 4. Is age-appropriate for students aged 13-15

# Assessment Summary:
# {assessment_summary}

# Keep the greeting concise (2-3 sentences) and friendly."""

#             result = self.chat(greeting_prompt, [])
#             return result

#         except Exception as e:
#             print(
#                 f"Error generating initial greeting: {str(e)}", file=sys.stderr)
#             return {
#                 "response": f"Hello! I'm your career guidance assistant. I'm here to help you explore your career options based on your assessment results. What would you like to know?",
#                 "sources": [],
#                 "error": str(e)
#             }


# def main():
#     """
#     Main function to handle JSON-based API requests from Node.js
#     Reads JSON from stdin (one command per line) and writes JSON to stdout
#     """
#     # Global service instance
#     rag_service = None

#     # Read all input lines
#     for line in sys.stdin:
#         line = line.strip()
#         if not line:
#             continue

#         try:
#             input_data = json.loads(line)
#             command = input_data.get("command")

#             if command == "initialize":
#                 # Initialize the service
#                 careers_json = input_data.get("careers_json_path")
#                 chroma_dir = input_data.get("chroma_persist_dir")
#                 provider = input_data.get("provider", "google")

#                 # Create service instance
#                 rag_service = RAGChatService(
#                     careers_json, chroma_dir, provider)

#                 print(json.dumps({
#                     "status": "success",
#                     "message": "RAG service initialized"
#                 }), flush=True)

#             elif command == "chat":
#                 message = input_data.get("message")
#                 chat_history = input_data.get("chat_history", [])

#                 if rag_service is None:
#                     raise Exception(
#                         "Service not initialized. Call 'initialize' first.")

#                 result = rag_service.chat(message, chat_history)
#                 print(json.dumps({
#                     "status": "success",
#                     "data": result
#                 }), flush=True)

#             elif command == "greeting":
#                 assessment_summary = input_data.get("assessment_summary")
#                 language = input_data.get("language", "en")

#                 if rag_service is None:
#                     raise Exception(
#                         "Service not initialized. Call 'initialize' first.")

#                 result = rag_service.generate_initial_greeting(
#                     assessment_summary, language)
#                 print(json.dumps({
#                     "status": "success",
#                     "data": result
#                 }), flush=True)

#             else:
#                 print(json.dumps({
#                     "status": "error",
#                     "message": f"Unknown command: {command}"
#                 }), flush=True)

#         except Exception as e:
#             print(json.dumps({
#                 "status": "error",
#                 "message": str(e)
#             }), flush=True)


# if __name__ == "__main__":
#     main()
