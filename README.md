---
title: CareerSetu
emoji: 🎓
colorFrom: indigo
colorTo: blue
sdk: docker
pinned: false
---

# Career Guidance Web App 

A web-based career guidance platform that combines psychometric assessments with AI-powered career recommendations. Students complete RIASEC, values, and preference assessments, after which Google Gemini AI generates personalized career suggestions with clear reasoning. A multilingual RAG chatbot (with built-in guardrails) enables safe, contextual career exploration in six Indian languages. All guidance content is sourced from cleaned and processed NCERT Career Cards. The platform includes dashboards for reviewing assessment history, results, and chat transcripts.

## Documentation

Each phase of this project has been documented thoroughly.

The first phase involved literature and design space review which can be found in [assignment 1 report](https://github.com/ashmitchhoker/assignment_HCI/blob/master/HCI_report1.pdf)

The second phase involved building a low fi prototype which was built using Figma. We also made a presentation that included personas and storyboarding, system feedback, sitemap etc.  Check our [report](https://github.com/ashmitchhoker/assignment_HCI/blob/master/HCI%20Task%202%20report.pdf) and [presentation](https://github.com/ashmitchhoker/assignment_HCI/blob/master/HCI%20task%202%20ppt%20Group%201.pptx)

The third phase involved building a low fi prototype which is the majority of the codebase here. We also conducted user testing and mapped user interaction flow and system architecture shown in our presentation. Check our [report](https://github.com/ashmitchhoker/assignment_HCI/blob/master/HCI%20Task%203%20Report.pdf) and [presentation](https://github.com/ashmitchhoker/assignment_HCI/blob/master/task3_ppt_HCI.pdf)

## How to Use

1. Setup as instructed
2. **Start the app** (backend + frontend)
3. **Login/Register** in the web interface
4. **Take an assessment** or **Talk to career guide** from the home page
6. **Ask career questions** - the RAG chatbot will respond with:
   - Accurate information from NCERT sourced career database
   - Context-aware responses based on assessment results

## Demo Video

<p align="center">
  <a href="https://drive.google.com/file/d/1ITmBoVXgdBZyP-qMDiVIFe9UQ6swHkgh/view?usp=drive_link">
    <img src="Thumbnail.png" alt="User Journey Video" width="600">
  </a>
</p>

<p align="center">
  <a href="https://drive.google.com/file/d/1ITmBoVXgdBZyP-qMDiVIFe9UQ6swHkgh/view?usp=drive_link">
    ▶ Watch User Journey Video
  </a>
</p>

## Tech Stack Requirement

### Backend

- **Node.js** + **Express** + **TypeScript**
- **Prisma** ORM with **SQLite** database
- **Google Gemini API** for recommendations and chat
- **Python RAG Service** with LangChain + ChromaDB for advanced chatbot
- **HuggingFace Embeddings** for vector db

### Frontend

- **React** + **TypeScript** + **Vite**
- **Tailwind CSS** for styling
- **Radix UI** components
- **Axios** for API calls

## Setup Instructions

### Prerequisites

- Node.js 18+ and npm
- Python 3.8+ 

### Backend Setup

1. Navigate to backend directory:

```bash
cd backend
```

2. Install Node.js dependencies:

```bash
npm install
```

3. Set up Python virtual environment:

**macOS/Linux:**
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

**Windows (PowerShell):**
```powershell
python -m venv venv
.\venv\Scripts\Activate
pip install -r requirements.txt
```

5. Add `.env` and add your configuration:

```env
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

DATABASE_URL="file:./db.sqlite3"

JWT_SECRET=your-secret-key-change-in-production
JWT_ACCESS_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

# AI Configuration
GEMINI_API_KEY=your_gemini_api_key_here
GOOGLE_API_KEY=your_gemini_api_key_here

# RAG Service Configuration
RAG_PROVIDER=google  # Options: 'google' or 'groq'
HUGGINGFACEHUB_API_TOKEN=your_huggingface_token_here
HF_TOKEN=your_huggingface_token_here
HUGGINGFACE_TOKEN=your_huggingface_token_here

# Optional: Groq API if using Groq provider
GROQ_API_KEY=your_groq_api_key_here

MAX_RETRY_ATTEMPTS=3
RETRY_DELAY_MS=1000
```

6. Initialize Prisma and database:

```bash
npx prisma generate
npx prisma migrate dev --name init
```

7. Start the backend server:

```bash
npm run dev
```

The backend will run on `http://localhost:3000`

> **Note**: For detailed RAG setup instructions, see [backend/RAG_SETUP.md](backend/RAG_SETUP.md)

### Frontend Setup

1. Navigate to frontend directory:

```bash
cd frontend
```

2. Install dependencies:

```bash
npm install
```

3. Create `.env` file (optional, defaults to localhost:3000):

```env
VITE_API_BASE_URL=http://localhost:3000/api
```

4. Start the frontend development server:

```bash
npm run dev
```

The frontend will run on `http://localhost:5173`

## Project Structure

```
Final/
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── auth.ts          # Authentication routes
│   │   │   ├── home.ts          # Home page data
│   │   │   ├── assessment.ts   # Assessment routes
│   │   │   ├── chat.ts          # Chat routes
│   │   │   └── profile.ts       # Profile management
│   │   ├── services/
│   │   │   └── gemini.ts        # Gemini AI service
│   │   ├── middleware/
│   │   │   └── auth.ts          # JWT authentication middleware
│   │   ├── types.ts             # TypeScript types
│   │   └── server.ts            # Express server setup
│   ├── prisma/
│   │   └── schema.prisma        # Database schema
│   ├── package.json
│   └── .env
│
└── frontend/
    ├── src/
    │   ├── components/          # React components
    │   ├── services/
    │   │   ├── api.ts           # Axios client
    │   │   ├── authService.ts  # Auth service
    │   │   └── assessmentService.ts # Assessment service
    │   ├── App.tsx              # Main app component
    │   └── main.tsx            # Entry point
    ├── package.json
    └── vite.config.ts
```

