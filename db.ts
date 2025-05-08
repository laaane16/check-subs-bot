import {Pool} from 'pg'
import 'dotenv/config'

export const pool = new Pool({
  user: process.env.DB_USERNAME,     
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,            
  password: process.env.DB_PASSWORD,
  port: Number(process.env.PORT) || 5432,                    
});

async function createTableOnce() {
  const createTableQuery = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    subscription_end DATE NOT NULL
  );
`;

  try {
    await pool.query(createTableQuery);
    console.log('Таблица "users" была успешно создана или уже существует.');
  } catch (err) {
    console.error('Ошибка при создании таблицы:', err);
  }
}

createTableOnce();