import { Pool } from 'pg'
import 'dotenv/config'

export const pool = new Pool({
  user: process.env.DB_USERNAME,     
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,            
  password: process.env.DB_PASSWORD,
  port: Number(process.env.PORT) || 5432,                    
});
