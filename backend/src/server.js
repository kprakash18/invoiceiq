import "dotenv/config";
import app from "./app.js";

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`InvoiceIQ API running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received. Closing server...");

  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received. Closing server...");

  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
});