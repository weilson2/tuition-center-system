const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health check route
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Tuition Center API is running',
    timestamp: new Date().toISOString()
  });
});

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Auth routes
app.use('/api/auth', require('./routes/auth'));

app.use('/api/password-reset', require('./routes/passwordReset'));

// Admin routes 
app.use('/api/admin', require('./routes/admin'));

// Profile route
app.use('/api/profile', require('./routes/profile'));

app.use('/api/storage', require('./routes/storage'));

app.use('/api/users', require('./routes/users'));

app.use('/api/classroom', require('./routes/classroom'));
app.use('/api/venues', require('./routes/venue'));




// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal Server Error',
      status: err.status || 500
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV}`);
  console.log(`✅ Auth endpoints available at http://localhost:${PORT}/api/auth`);
});
