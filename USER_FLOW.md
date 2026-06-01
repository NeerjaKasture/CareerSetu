# User Interaction Flow Schema

## High-Level Architecture

```mermaid
graph TB
    User[User] --> Frontend[React Frontend]
    Frontend --> Backend[Node.js Backend]
    Backend --> DB[(SQLite DB)]
    Backend --> Gemini[Google Gemini API]
    Backend --> RAG[Python RAG Service]
    RAG --> ChromaDB[(ChromaDB)]
    RAG --> LLM[Groq/Gemini LLM]
```

## Authentication Flow

```mermaid
stateDiagram-v2
    [*] --> Unauthenticated
    Unauthenticated --> LoginPage: Open App
    LoginPage --> Authenticated: POST /api/auth/login<br/>{email, password}
    LoginPage --> RegisterPage: Click Register
    RegisterPage --> Authenticated: POST /api/auth/register<br/>{email, password, name}
    Authenticated --> HomePage: Redirect
    HomePage --> [*]: Logout
```

## Complete User Journey

```mermaid
flowchart TD
    Start([User Opens App]) --> Auth{Authenticated?}
    Auth -->|No| Login[Login/Register Page]
    Login --> |Success| Home[Home Page]
    Auth -->|Yes| Home

    Home --> Choice{User Choice}

    Choice -->|Take Assessment| Assessment[Assessment Flow]
    Choice -->|Talk to Career Guide| FreshChat[Fresh Chat Flow]
    Choice -->|Assessment History| History[History Page]

    Assessment --> AssessmentDetails[Assessment Sequence]
    History --> HistoryChoice{Select Item}
    HistoryChoice -->|View Results| Results[Assessment Results Page]
    HistoryChoice -->|Open Chat| AssessmentChat[Assessment-Specific Chat Flow]

    AssessmentDetails --> Home
    FreshChat --> Home
    AssessmentChat --> Home
    Results --> Home
```

## Assessment Flow (Detailed)

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant B as Backend<br/>/api/assessments
    participant G as Gemini Service
    participant R as RAG Service
    participant D as Database

    U->>F: Click "Take Assessment"
    F->>F: Navigate to TestSelectionPage
    U->>F: Select Assessment Type<br/>(RIASEC/Values/Preferences)
    F->>F: Navigate to TestFormPage

    loop For Each Question
        F->>U: Display Question
        U->>F: Select Answer
        F->>F: Store answer locally
    end

    U->>F: Submit Assessment
    F->>F: Navigate to ProcessingPage
    F->>B: POST /api/assessments<br/>{user_id, answers[], type}

    B->>D: Save Assessment Record
    B->>G: generateRecommendations(answers)
    G->>G: Calculate RIASEC scores
    G-->>B: Return recommendations

    B->>G: generateGreeting(summary, language)
    G-->>B: Return personalized greeting

    B->>R: generateInitialGreeting(summary, language)
    R-->>B: Return RAG greeting

    B->>D: Save assessment_summary<br/>Save initial chat message
    B-->>F: Return {assessment_id, summary, recommendations}

    F->>F: Navigate to AssessmentResponsesPage
    F->>U: Display Results + Chat Option
```

## Fresh Chat Flow (No Context)

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend<br/>ChatbotPage
    participant B as Backend<br/>/api/chat
    participant R as RAG Service<br/>ragChat.ts
    participant P as Python Service<br/>rag_service.py
    participant C as ChromaDB

    U->>F: Click "Talk to career guide"
    F->>F: navigateTo('chatbot')<br/>setSelectedAssessmentId(undefined)
    F->>F: Clear message history<br/>Show empty chat UI

    U->>F: Type message in {language}
    U->>F: Click Send

    F->>B: POST /api/chat<br/>{message, language: 'hi', assessment_id: null}

    Note over B: assessment_id is null
    B->>B: previousMessages = []<br/>(Empty array)

    B->>R: chat(message, [], language)
    R->>P: Send command via stdin<br/>{"command":"chat",<br/>"message":"...",<br/>"chat_history":[],<br/>"language":"hi"}

    P->>C: Retrieve relevant docs<br/>(semantic search)
    C-->>P: Return career documents

    P->>P: Generate response using<br/>Groq/Gemini with context
    P-->>R: {"status":"success",<br/>"data":{"response":"...",<br/>"sources":[...],"error":null}}

    R->>R: Check for data.error
    R-->>B: Return response string

    B->>B: Create ChatMessage record<br/>(user + assistant)
    B-->>F: {reply, sources, timestamp}

    F->>F: Add messages to UI
    F->>U: Display response in Hindi
```

## Assessment-Specific Chat Flow (With Context)

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant B as Backend<br/>/api/chat
    participant D as Database
    participant R as RAG Service

    U->>F: Open Assessment from History
    F->>F: setSelectedAssessmentId(assessment_id)

    F->>B: GET /api/chats?assessmentId={id}
    B->>D: Query last 10 messages<br/>WHERE assessment_id = {id}
    D-->>B: Return messages[]
    B-->>F: Return chat history

    F->>F: Preload messages in UI
    F->>U: Display previous conversation

    U->>F: Send new message
    F->>B: POST /api/chat<br/>{message, language, assessment_id: {id}}

    Note over B: assessment_id exists
    B->>D: Query last 10 messages<br/>WHERE assessment_id = {id}<br/>AND id != userMessage.id
    D-->>B: Return previousMessages[10]

    B->>R: chat(message, previousMessages, language)
    R-->>B: Return response

    B->>D: Save user + assistant messages<br/>WITH assessment_id = {id}
    B-->>F: Return {reply, sources, timestamp}

    F->>U: Display response
```

## Language Change Flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant B as Backend
    participant R as RAG Service

    U->>F: Open Chat (any type)
    F->>F: Current language: English
    F->>U: Display chat in English

    U->>F: Click Language Selector
    U->>F: Select "हिंदी" (Hindi)

    F->>F: setSelectedLanguage('hi')
    F->>F: Clear displayed messages<br/>(UI reset)
    F->>U: Show empty chat interface

    Note over F,B: Backend still has old messages<br/>but they won't be displayed

    U->>F: Send new message in Hindi
    F->>B: POST /api/chat<br/>{message: "...", language: "hi", assessment_id}

    Note over B: Backend loads previous messages<br/>(may include English messages)
    B->>R: chat(message, previousMessages, "hi")

    Note over R: RAG processes multilingual context<br/>Responds in requested language
    R-->>B: Response in Hindi
    B-->>F: {reply in Hindi, sources}

    F->>U: Display Hindi response
```

## Error Handling Flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant B as Backend<br/>/api/chat
    participant R as RAG Service
    participant P as Python Service

    U->>F: Send chat message
    F->>B: POST /api/chat<br/>{message, language, assessment_id}

    B->>R: chat(message, history, language)
    R->>P: Send command via stdin

    alt Python Error (e.g., API Key Expired)
        P->>P: Exception in chat()<br/>catch block
        P-->>R: {"status":"success",<br/>"data":{"response":null,<br/>"sources":[],<br/>"error":"API key expired..."}}

        R->>R: Check response.data.error
        R->>R: throw Error("RAG service error: API key expired...")
        R-->>B: Throw error

        B->>B: Catch error in route
        B-->>F: 500 {error: "RAG service error: API key expired..."}

        F->>F: Display error banner
        F->>U: Show error message:<br/>"AI service error. Please contact admin."
    else Success
        P-->>R: {"status":"success",<br/>"data":{"response":"...","error":null}}
        R-->>B: Return response
        B-->>F: 200 {reply, sources}
        F->>U: Display response
    end

    Note over F,P: Recent Fix: Added error checking<br/>in ragChat.ts to surface Python errors
```

## State Diagram: Chat Context Management

```mermaid
stateDiagram-v2
    [*] --> HomePage

    HomePage --> FreshChat: Click "Talk to career guide"<br/>assessmentId = undefined
    HomePage --> AssessmentChat: Click chat from history<br/>assessmentId = {id}

    state FreshChat {
        [*] --> NoContext
        NoContext: previousMessages = []
        NoContext --> SendMessage: User types message
        SendMessage --> NoContext: Response received
    }

    state AssessmentChat {
        [*] --> LoadContext
        LoadContext: Load last 10 messages<br/>WHERE assessment_id = {id}
        LoadContext --> WithContext
        WithContext: previousMessages = [msg1...msg10]
        WithContext --> SendMessage: User types message
        SendMessage --> WithContext: Response received
    }

    FreshChat --> HomePage: Navigate back
    AssessmentChat --> HomePage: Navigate back

    state LanguageChange <<choice>>
    FreshChat --> LanguageChange: User changes language
    AssessmentChat --> LanguageChange: User changes language

    LanguageChange --> FreshChat: Clear UI messages<br/>Keep same state
    LanguageChange --> AssessmentChat: Clear UI messages<br/>Keep same state
```

## API Endpoints Summary

```mermaid
graph LR
    A[API Endpoints] --> B[Auth]
    A --> C[Assessment]
    A --> D[Chat]
    A --> E[Profile]

    B --> B1[POST /api/auth/login]
    B --> B2[POST /api/auth/register]
    B --> B3[POST /api/auth/logout]

    C --> C1[POST /api/assessments]
    C --> C2[GET /api/assessments/:id]
    C --> C3[GET /api/assessments/history]

    D --> D1[POST /api/chat]
    D --> D2[GET /api/chats?assessmentId=id]
    D --> D3[POST /api/chat/greeting]

    E --> E1[GET /api/profile]
    E --> E2[PUT /api/profile]
```

## Data Flow: Message Storage

```mermaid
erDiagram
    USER ||--o{ ASSESSMENT : takes
    USER ||--o{ CHAT_MESSAGE : sends
    ASSESSMENT ||--o{ CHAT_MESSAGE : "has context"

    USER {
        string id PK
        string email
        string name
        datetime created_at
    }

    ASSESSMENT {
        string id PK
        string user_id FK
        string type
        json answers
        json summary
        datetime created_at
    }

    CHAT_MESSAGE {
        string id PK
        string user_id FK
        string assessment_id FK "nullable"
        string role "user or assistant"
        string content
        string language
        json sources "nullable"
        datetime created_at
    }
```

## Key Architectural Decisions

### Context Isolation Rules

| Scenario        | assessment_id  | previousMessages | Description                           |
| --------------- | -------------- | ---------------- | ------------------------------------- |
| Fresh Chat      | `null`         | `[]` (empty)     | No context passed to RAG              |
| Assessment Chat | `{uuid}`       | Last 10 from DB  | Filtered by exact assessment_id       |
| Language Change | Same as before | Same as before   | Frontend clears UI, backend unchanged |

### Error Propagation Chain

```mermaid
flowchart LR
    A[Python Service Error] -->|return data.error| B[ragChat.ts]
    B -->|throw Error| C[chat.ts route]
    C -->|res.status 500| D[Frontend]
    D -->|Show banner| E[User]

    style A fill:#f9d5d5
    style E fill:#d5f9d5
```

## File-to-Flow Mapping

| Flow Step         | Frontend File          | Backend File           | Service File                 |
| ----------------- | ---------------------- | ---------------------- | ---------------------------- |
| Authentication    | `LoginPage.tsx`        | `routes/auth.ts`       | -                            |
| Assessment Submit | `TestFormPage.tsx`     | `routes/assessment.ts` | `services/gemini.ts`         |
| Fresh Chat        | `ChatbotPage.tsx`      | `routes/chat.ts`       | `services/ragChat.ts`        |
| Assessment Chat   | `ChatbotPage.tsx`      | `routes/chat.ts`       | `services/ragChat.ts`        |
| Language Change   | `LanguageSelector.tsx` | -                      | -                            |
| Navigation        | `App.tsx` (navigateTo) | -                      | -                            |
| RAG Processing    | -                      | `services/ragChat.ts`  | `services/rag_service.py`    |
| Error Handling    | All components         | All routes             | `ragChat.ts` (lines 323-327) |

## Technical Implementation Notes

### Frontend State Management (`App.tsx`)

```typescript
// Context isolation for fresh chat
if (page === "chatbot" && assessmentId === undefined) {
  setSelectedAssessmentId(undefined); // Clear for fresh chat
} else if (assessmentId !== undefined) {
  setSelectedAssessmentId(assessmentId);
}
```

### Backend Context Filtering (`routes/chat.ts`)

```typescript
// Empty array for fresh chat, last 10 for assessment chat
const previousMessages = assessment
  ? await prisma.chatMessage.findMany({
      where: {
        user_id: userId,
        assessment_id: assessment.id,
        id: { not: userMessage.id },
      },
      orderBy: { created_at: "desc" },
      take: 10,
    })
  : []; // No context for general chat
```

### RAG Service Error Handling (`ragChat.ts`)

```typescript
// Check for Python-level errors first
if (response.data && response.data.error) {
  throw new Error(`RAG service error: ${response.data.error}`);
}

if (response.data && response.data.response) {
  return response.data.response;
}

throw new Error("Invalid chat response from RAG service");
```

### Python Service Response Structure (`rag_service.py`)

```python
# Success case
return {
    "response": response,
    "sources": sources,
    "error": None
}

# Error case
return {
    "response": None,
    "sources": [],
    "error": error_msg
}
```

## Payload Schemas

### Chat Request

```json
{
  "message": "string (required)",
  "language": "en|hi|te|ta|bn|gu (required, default: en)",
  "assessment_id": "uuid|null (optional)"
}
```

### Chat Response (Success)

```json
{
  "reply": "string",
  "sources": [
    {
      "title": "string",
      "chunk_index": 0,
      "snippet": "string (first 250 chars)"
    }
  ],
  "timestamp": "2025-11-19T10:30:00.000Z"
}
```

### Chat Response (Error)

```json
{
  "error": "string (error message)"
}
```

### Assessment Submission

```json
{
  "type": "riasec|values|preferences",
  "answers": [{ "question_id": "string", "answer": "string" }]
}
```

### Assessment Response

```json
{
  "assessment_id": "uuid",
  "summary": "string (assessment summary for RAG context)",
  "recommendations": [
    {
      "career_name": "string",
      "match_percentage": 85,
      "reasoning": "string"
    }
  ],
  "scores": {
    "RIASEC": {
      "realistic": 7.5,
      "investigative": 8.2,
      ...
    }
  }
}
```

## Environment Configuration

### Required Environment Variables

```env
# Backend (.env)
GEMINI_API_KEY=your_gemini_api_key
GOOGLE_API_KEY=your_gemini_api_key
RAG_PROVIDER=google  # or 'groq'
HUGGINGFACEHUB_API_TOKEN=your_hf_token
GROQ_API_KEY=your_groq_api_key  # if using Groq
JWT_SECRET=your_secret_key
DATABASE_URL=file:./db.sqlite3
FRONTEND_URL=http://localhost:5173
```

### Service Initialization

```mermaid
sequenceDiagram
    participant B as Backend Server
    participant R as RAG Service (ragChat.ts)
    participant P as Python Process

    B->>B: Start Express server
    B->>R: First chat/greeting request
    R->>R: Check if initialized
    R->>P: spawn python rag_service.py
    P->>P: Load environment variables
    P->>P: Initialize embedding model (BGE-M3)
    P->>P: Load ChromaDB (multilingual)
    P->>P: Initialize LLM (Groq/Gemini)
    P-->>R: {"status":"success","message":"initialized"}
    R->>R: Set isInitialized = true
    R-->>B: Ready to process requests

    Note over R,P: Initialization takes 1-3 minutes<br/>on first run (model download)
```
