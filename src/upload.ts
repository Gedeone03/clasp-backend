// src/upload.ts

import multer from "multer";
import path from "path";
import fs from "fs";

// Cartella upload
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");

// Se non esiste la cartella, la creo
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

// Configurazione Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = Date.now() + "_" + Math.round(Math.random() * 1e9);
    cb(null, base + ext);
  },
});

export const uploadImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // max 5 MB
});
