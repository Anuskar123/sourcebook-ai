import { z } from 'zod';

export function readConfig(env = process.env) {
  return z.object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    MONGODB_URI: z.string().min(1), MONGODB_DB: z.string().default('portfolio'),
    JWT_SECRET: z.string().min(32), INTERNAL_API_TOKEN: z.string().min(32),
    ML_API_TOKEN: z.string().min(32), GEMINI_API_KEY: z.string().min(1),
    GEMINI_MODEL: z.string().default('gemini-3.7-flash'),
    GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
    CHROMA_URL: z.url().default('http://localhost:8000'),
    ML_API_URL: z.url().default('http://localhost:8001'),
    WEB_ORIGIN: z.url().default('http://localhost:5173'),
    SCRAPE_ALLOWED_HOSTS: z.string().min(1),
  }).parse(env);
}
