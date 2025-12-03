# IntegraLearn Hub Backend API

Backend API for IntegraLearn Hub Emotional Wellness Platform - A comprehensive emotional check-in system for educational staff with AI-powered psychological analysis.

## Features

- ✅ **Custom Authentication** with JWT (weekly expiry)
- ✅ **Emotional Check-in System** for staff/teacher
- ✅ **Google AI Integration** for psychological analysis
- ✅ **Real-time Dashboard** with Socket.io
- ✅ **Role-based Access Control** (Student, Staff, Teacher, Admin, SuperAdmin, Directorate)
- ✅ **Caching System** with NodeCache
- ✅ **Comprehensive Security** (Helmet, CORS, Rate Limiting)
- ✅ **Input Validation** with Joi
- ✅ **Error Handling** with Winston logging

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose
- **Real-time**: Socket.io
- **AI**: Google AI Studio (Gemini)
- **Authentication**: JWT
- **Caching**: NodeCache (in-memory)
- **Validation**: Joi
- **Security**: Helmet, CORS, Rate Limiting
- **Logging**: Winston

## Quick Start

### Prerequisites
- Node.js 18+
- MongoDB (local or cloud)
- Google AI Studio API Key

### Installation

1. **Clone and install dependencies**
```bash
cd be
npm install
```

2. **Environment Setup**
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. **Start MongoDB**
```bash
# Local MongoDB
mongod

# Or use MongoDB Atlas (cloud)
```

4. **Start the server**
```bash
# Development
npm run dev

# Production
npm start
```

Server will be running at `http://localhost:3001`

## API Endpoints

### Authentication
```
POST /api/auth/login          # Login user
GET  /api/auth/me            # Get current user
POST /api/auth/logout        # Logout user
POST /api/auth/register      # Register user (admin only)
```

### Emotional Check-in
```
POST /api/checkin/submit      # Submit emotional check-in
GET  /api/checkin/today       # Get today's check-in
GET  /api/checkin/results/:id # Get check-in with AI analysis
GET  /api/checkin/history     # Get check-in history
```

### Dashboard (Admin only)
```
GET /api/dashboard/stats      # Dashboard statistics
GET /api/dashboard/moods      # Mood distribution
GET /api/dashboard/checkins   # Recent check-ins
```

### Health Check
```
GET /api/health              # API health status
```

## Postman Collection

### Authentication Flow
1. **Login** → Get JWT token
2. **Use token** in Authorization header: `Bearer <token>`
3. **Token expires** every Monday (weekly reset)

### Sample Requests

#### 1. Login
```json
POST /api/auth/login
{
  "email": "staff@school.com",
  "password": "password123"
}
```

#### 2. Submit Emotional Check-in
```json
POST /api/checkin/submit
Authorization: Bearer <token>
{
  "weatherType": "sunny",
  "selectedMoods": ["happy", "excited"],
  "details": "Feeling great today!",
  "presenceLevel": 8,
  "capacityLevel": 7,
  "supportContact": "Ms. Kholida"
}
```

#### 3. Get Dashboard Stats (Admin only)
```json
GET /api/dashboard/stats
Authorization: Bearer <admin_token>
```

## Real-time Features (Socket.io)

### Dashboard Updates
```javascript
// Connect to dashboard
socket.emit('join-dashboard', userId);

// Listen for updates
socket.on('dashboard:update', (data) => {
  console.log('Dashboard updated:', data);
});

// Listen for new check-ins
socket.on('checkin:new', (checkinData) => {
  console.log('New check-in:', checkinData);
});

// Listen for flagged users
socket.on('user:flagged', (userData) => {
  console.log('User needs support:', userData);
});
```

## Database Schema

### User Collection
```javascript
{
  email: String (unique),
  password: String (hashed),
  name: String,
  role: String (enum),
  department: String,
  employeeId: String,
  isActive: Boolean,
  lastLogin: Date
}
```

### EmotionalCheckin Collection
```javascript
{
  userId: ObjectId,
  date: Date,
  weatherType: String,
  selectedMoods: [String],
  details: String,
  presenceLevel: Number (1-10),
  capacityLevel: Number (1-10),
  supportContact: String,
  aiAnalysis: {
    emotionalState: String,
    presenceState: String,
    capacityState: String,
    recommendations: [Object],
    psychologicalInsights: String,
    needsSupport: Boolean,
    confidence: Number
  },
  submittedAt: Date
}
```

## Environment Variables

```env
# Server
PORT=3001
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/integra-learn

# JWT
JWT_SECRET=your_super_secret_jwt_key
JWT_EXPIRES_IN=7d

# Google AI
GOOGLE_AI_API_KEY=your_google_ai_api_key

# Cache
CACHE_TTL=3600
SESSION_CACHE_TTL=86400

# Rate Limiting
RATE_LIMIT_WINDOW=15
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info
```

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm test -- --coverage
```

## Deployment

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
```

### PM2 (Production)
```bash
npm install -g pm2
pm2 start src/server.js --name "integra-learn-backend"
```

## Security Features

- **JWT Authentication** with weekly token rotation
- **Password Hashing** with bcrypt
- **Input Validation** and sanitization
- **Rate Limiting** to prevent abuse
- **CORS** configuration
- **Helmet** security headers
- **Request Logging** for monitoring

## Monitoring & Logging

- **Winston Logger** with structured logging
- **Error Tracking** with stack traces
- **Performance Monitoring** via response times
- **Health Checks** for system status

## Contributing

1. Fork the repository
2. Create feature branch
3. Commit changes
4. Push to branch
5. Create Pull Request

## License

ISC License - IntegraLearn Hub


