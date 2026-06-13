import { CronJob } from "cron";

import "dotenv/config";
import { bot } from "./index";
import { subscriptions } from "./subscriptions";
import {
  deleteUserSubscription,
  getSubscriptionsForNotification,
} from "./subscriptionRepository";

async function notifyUsers(daysLeft: number) {
  const subscriptionsForNotification =
    await getSubscriptionsForNotification(daysLeft);

  for (const row of subscriptionsForNotification) {
    const subscriptionType = row.subscription_type;
    const subscription = subscriptions[subscriptionType];

    if (daysLeft >= 1) {
      const message = `⏳ Твоя подписка ${subscription.title} заканчивается через ${daysLeft} ${
        daysLeft === 1 ? "день" : "дня"
      }! Не забудь продлить, чтобы не потерять доступ`;
      try {
        await bot.telegram.sendMessage(row.user_id, message, {
          disable_notification: true,
        });
      } catch (err) {
        console.error(
          `Не удалось отправить сообщение пользователю ${row.user_id}:`,
          err
        );
      }
    } else {
      const message = `⏳ Твоя подписка ${subscription.title} закончилась. Придется удалить тебя из приватного канала`;
      try {
        await bot.telegram
          .sendMessage(row.user_id, message, {
            disable_notification: true,
          })
          .catch((err) => console.error(err));
        // Удаляем из канала
        await bot.telegram.banChatMember(
          subscription.channelId,
          row.user_id,
          Math.floor(Date.now() / 1000) + 31
        );

        if (subscription.chatId) {
          await bot.telegram.banChatMember(
            subscription.chatId,
            row.user_id,
            Math.floor(Date.now() / 1000) + 31
          );
        }

        await deleteUserSubscription(row.user_id);
        console.log(
          `Пользователь ${row.user_id} удален после окончания подписки ${subscription.title}.`
        );
      } catch (err) {
        console.error(
          `Не удалось обработать окончание подписки пользователя ${row.user_id}:`,
          err
        );
      }
    }
  }
  return;
}

const job = new CronJob(
  "05 00 * * *",
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
