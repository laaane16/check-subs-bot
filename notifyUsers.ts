import { CronJob } from 'cron';

import 'dotenv/config'
import { pool } from './db';
import { bot } from '.';


async function notifyUsers(daysLeft: number) {
  const query = `
    SELECT user_id
    FROM users
    WHERE subscription_end = CURRENT_DATE + INTERVAL '${daysLeft} days';
  `;

  const res = await pool.query(query);
  for (const row of res.rows) {
    if (daysLeft >= 1){
      const message = `⏳ Ваша подписка заканчивается через ${daysLeft} ${daysLeft === 1 ? 'день' : 'дня'}! Не забудьте продлить, чтобы не потерять доступ.`;
      try {
        await bot.telegram.sendMessage(row.user_id, message);
      } catch (err) {
        console.error(`Не удалось отправить сообщение пользователю ${row.user_id}:`, err);
      }
    }else{
      const message = `⏳ Ваша подписка закончилась. Вынуждены удалить вас из приватного канала.`;
      try {
        await bot.telegram.sendMessage(row.user_id, message);
        await bot.telegram.banChatMember(process.env.PRIVATE_CHANNEL_ID as string, row.user_id);

      } catch (err) {
        console.error(`Не удалось отправить сообщение пользователю ${row.user_id}:`, err);
      }
    }
  }
}

const job = new CronJob('54 20 * * *', async () => {
    await notifyUsers(3);
    await notifyUsers(2);
    await notifyUsers(1);
    await notifyUsers(0);
  },
  null,
  true,
  'Europe/Moscow'
);

job.start();
console.log('⏰ Напоминания о подписке активированы');

