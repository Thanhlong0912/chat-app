import dotenv from "dotenv";
import express from "express";

import { connectDB } from "./libs/db.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 5001;

// Middleware
app.use(express.json());

connectDB().then(() => {
  // Start the server after successful database connection
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}).catch((error) => {
  console.error("Failed to start the server:", error);
});