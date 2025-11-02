import { CronJob } from "cron";

import "dotenv/config";
import { pool } from "./db";
import { bot } from "./index";

async function notifyUsers(daysLeft: number) {
  let query: string;

  if (daysLeft === 0) {
    // Выбираем всех пользователей с просроченной подпиской
    query = `
      SELECT user_id
      FROM users
      WHERE subscription_end <= CURRENT_DATE;
    `;
  } else {
    // Выбираем пользователей, у которых подписка заканчивается через daysLeft дней
    query = `
      SELECT user_id
      FROM users
      WHERE subscription_end = CURRENT_DATE + INTERVAL '${daysLeft} days';
    `;
  }

  const res = await pool.query(query);
  for (const row of res.rows) {
    if (daysLeft >= 1) {
      const message = `⏳ Ваша подписка заканчивается через ${daysLeft} ${
        daysLeft === 1 ? "день" : "дня"
      }! Не забудьте продлить, чтобы не потерять доступ.`;
      try {
        await bot.telegram.sendMessage(row.user_id, message);
      } catch (err) {
        console.error(
          `Не удалось отправить сообщение пользователю ${row.user_id}:`,
          err
        );
      }
    } else {
      const message = `⏳ Ваша подписка закончилась. Вынуждены удалить вас из приватного канала.`;
      try {
        await bot.telegram.sendMessage(row.user_id, message);
        // Удаляем из канала
        await bot.telegram.banChatMember(
          process.env.PRIVATE_CHANNEL_ID as string,
          row.user_id,
          Math.floor(Date.now() / 1000) + 31
        );
        // Удаляем из чата
        await bot.telegram.banChatMember(
          Number(process.env.PRIVATE_CHAT_ID),
          row.user_id,
          Math.floor(Date.now() / 1000) + 31
        );
        // Удаляем из бд
        await pool.query(`DELETE FROM users WHERE user_id = $1`, [row.user_id]);
        console.log(
          `Пользователь ${row.user_id} удален из таблицы после окончания подписки.`
        );
      } catch (err) {
        console.error(
          `Не удалось отправить сообщение пользователю ${row.user_id}:`,
          err
        );
      }
    }
  }
  return;
}

const job = new CronJob(
  "00 22 * * *",
  async () => {
    await notifyUsers(3);
    await notifyUsers(2);
    await notifyUsers(1);
    await notifyUsers(0);
  },
  null,
  true,
  "Europe/Moscow"
);

job.start();
console.log("⏰ Напоминания о подписке активированы");
