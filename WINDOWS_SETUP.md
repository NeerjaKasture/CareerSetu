# Windows Setup Guide

Step-by-step instructions to run the Career Guidance Web App on Windows.

## Prerequisites

1. **Node.js 18+** - Download from [nodejs.org](https://nodejs.org/)
2. **Python 3.10 or 3.11** - Download from [python.org](https://www.python.org/downloads/)
   > ⚠️ **Important**: Use Python 3.10 or 3.11, NOT 3.12+ (compatibility issues with ML libraries)
3. **Git** - Download from [git-scm.com](https://git-scm.com/download/win)

## Setup Steps

### Step 1: Clone the Repository

```powershell
git clone https://github.com/ashmitchhoker/assignment_HCI.git
cd assignment_HCI
```

### Step 2: Backend Setup

Open PowerShell and run:

```powershell
cd backend
```

#### 2.1 Install Node.js dependencies:
```powershell
npm install
```

#### 2.2 Create Python virtual environment:
```powershell
python -m venv venv
.\venv\Scripts\Activate
pip install -r requirements.txt
```

#### 2.3 Create `.env` file:

Create a file named `.env` in the `backend` folder with:

```env
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

DATABASE_URL="file:./db.sqlite3"

JWT_SECRET=your-secret-key-change-in-production
JWT_ACCESS_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

# AI Configuration (get from https://aistudio.google.com/apikey)
GEMINI_API_KEY=your_gemini_api_key_here
GOOGLE_API_KEY=your_gemini_api_key_here

# RAG Service Configuration
RAG_PROVIDER=google

# Optional: Groq API (get from https://console.groq.com/)
# GROQ_API_KEY=your_groq_api_key_here
```

#### 2.4 Initialize the database:
```powershell
npx prisma generate
npx prisma migrate dev --name init
```

#### 2.5 Start the backend:
```powershell
npm run dev
```

> The first run will build the vector database (takes 2-5 minutes).

### Step 3: Frontend Setup

Open a **new PowerShell window** and run:

```powershell
cd assignment_HCI\frontend
npm install
npm run dev
```

### Step 4: Access the App

Open your browser and go to: **http://localhost:5173**

## Troubleshooting

### "python is not recognized"
- Make sure Python is added to PATH during installation
- Try using `py` instead of `python`

### Port 3000 already in use
```powershell
netstat -ano | findstr :3000
taskkill /PID <PID_NUMBER> /F
```

### Gemini API quota exceeded
- Get a new API key from [Google AI Studio](https://aistudio.google.com/apikey)
- Or switch to Groq (free): Set `RAG_PROVIDER=groq` in `.env`

### Vector database issues
Delete and rebuild:
```powershell
Remove-Item -Recurse backend\chroma_data_multilingual
npm run dev  # Will rebuild automatically
```
