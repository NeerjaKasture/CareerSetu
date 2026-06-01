# Use Node.js base image
FROM node:20-slim

# Install Python and build tools for RAG chatbot
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package configurations
COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY backend/package*.json ./backend/

# Install dependencies for both frontend and backend
RUN npm install
RUN cd frontend && npm install
RUN cd backend && npm install

# Copy Python requirements and set up Python venv
COPY backend/requirements.txt ./backend/
RUN python3 -m venv backend/venv
ENV PATH="/app/backend/venv/bin:$PATH"
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy all source files
COPY . .

# Build frontend static files (outputs to frontend/build)
RUN cd frontend && npm run build

# Generate Prisma Client and Build TypeScript backend
RUN cd backend && npx prisma generate && npm run build

# Expose port (Hugging Face Spaces exposes 7860, Render uses PORT)
ENV PORT=7860
EXPOSE 7860

# Start Express server from backend
CMD ["node", "backend/dist/server.js"]
