import express from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";

const app = express();

// Security middleware
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  })
);

// Request body parsing
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// HTTP request logging
app.use(pinoHttp()); // comment this line to stop log of http headers in terminal

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "InvoiceIQ API is running",
    timestamp: new Date().toISOString(),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Global error handler
app.use((err, req, res, next) => {
  req.log?.error(err);

  res.status(err.status || 500).json({
    success: false,
    message: err.status ? err.message : "Internal server error",
  });
});

export default app;