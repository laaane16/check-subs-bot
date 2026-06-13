import { Context, Markup, session, Telegraf } from "telegraf";
import { Postgres } from "@telegraf/session/pg";

import "dotenv/config";
import "./notifyUsers";
import { pool } from "./db";

interface IBotContext extends Context {
  session: {
    months?: number;
    awaitingMonthsInput?: boolean;
  };
}

const token = process.env.TG_SECRET_TOKEN;
const providerToken = process.env.PROVIDER_TOKEN;
const channelId = process.env.PRIVATE_CHANNEL_ID;
const privateChatId = Number(process.env.PRIVATE_CHAT_ID);
const CURRENCY = "RUB";
const PRICE = Number(process.env.PRICE);

if (!token || !providerToken || !channelId || !PRICE || !privateChatId) {
  throw new Error("missing required environment");
}

export const bot = new Telegraf<IBotContext>(token);

const store = Postgres({ pool }) as any;

bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id;
  if (chatId === privateChatId) return;

  await next();
});
bot.use(Telegraf.log());
bot.use(session({ store }));
bot.catch((err, ctx) => {
  console.error(`Ошибка в обработке апдейта от ${ctx.from?.id}:`, err);
});

const getInvoice = (id: number, months: number) => {
  const invoice = {
    chat_id: id,
    title: "Подписка на приватный канал",
    description: "Ежемесячная подписка на мой приватный канал",
    payload: `subscription_${id}_${months}`,
    currency: CURRENCY,
    provider_token: providerToken,
    prices: [{ label: "Invoice Title", amount: 100 * PRICE * months }],
    need_email: true,
    send_email_to_provider: true,
    provider_data: JSON.stringify({
      receipt: {
        items: [
          {
            description: "Подписка на приватный канал",
            vat_code: 1,
            quantity: months,
            amount: {
              value: `${PRICE}.00`,
              currency: CURRENCY,
            },
            payment_mode: "full_payment",
          },
        ],
      },
    }),
  };

  return invoice;
};

const hasChannelAccess = async (userId: number) => {
  try {
    const member = await bot.telegram.getChatMember(channelId, userId);
    return ["creator", "administrator", "member", "restricted"].includes(
      member.status
    );
  } catch (error) {
    console.error(`Не удалось проверить доступ пользователя ${userId}:`, error);
    return false;
  }
};

const restartBot = async (ctx: IBotContext) => {
  ctx.session = {
    months: 1,
    awaitingMonthsInput: false,
  };

  await ctx.reply(
    "Привет! Здесь ты можешь оформить подписку и получить доступ к моему приватному фитнес-каналу с тренировками, советами и мотивацией.",
    Markup.keyboard([["📦 Приобрести подписку"], ["🕒 Срок подписки"]])
      .resize()
      .oneTime(false)
  );
};

bot.start(async (ctx) => {
  await restartBot(ctx);
});

bot.hears("📦 Приобрести подписку", async (ctx) => {
  await ctx.reply(
    "Выберите метод оплаты",
    Markup.inlineKeyboard([
      [Markup.button.callback("Банковская карта/ ЮMoney", "yocassa_payment")],
      [Markup.button.callback("Закрыть", "cancel_action")],
    ])
  );
});

bot.hears("🕒 Срок подписки", async (ctx) => {
  const userId = ctx.from.id;

  const { rows } = await pool.query(
    `
  SELECT "subscription_end" FROM users where user_id = $1
  `,
    [userId]
  );
  const result = rows[0];

  if (result && result.subscription_end) {
    const date = new Date(result.subscription_end);
    const formatted = date.toLocaleDateString("ru-RU", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    if (date < new Date()) {
      await ctx.reply("Подписка неактивна");
    } else {
      await ctx.reply(`Подписка активна до ${formatted}`);
    }
  } else {
    await ctx.reply("Подписка неактивна");
  }
});

bot.action("yocassa_payment", async (ctx) => {
  if (!ctx.session) {
    return restartBot(ctx);
  }

  ctx.session.awaitingMonthsInput = true;

  await ctx.reply(
    "В данный момент можно приобрести только 1 месяц подписки по заниженной цене, введите любой символ для подтверждения",
    // "Введите количество месяцев подписки (от 1 до 12):",
    Markup.inlineKeyboard([[Markup.button.callback("Отмена", "cancel_action")]])
  );

  await ctx.answerCbQuery();
});

bot.action("cancel_action", async (ctx) => {
  await ctx.editMessageText("Действие отменено. Возвращаюсь в главное меню...");

  await restartBot(ctx);

  await ctx.answerCbQuery();
});

bot.on("text", async (ctx) => {
  // const months = Number(text);
  const months = 1;

  if (!ctx.session || !ctx.session?.awaitingMonthsInput) {
    return restartBot(ctx);
  }

  // if (!Number.isInteger(months) || months < 1 || months > 12) {
  //   return ctx.reply("Пожалуйста, введите число от 1 до 12.", Markup.inlineKeyboard([
  //     [Markup.button.callback("Отмена", "cancel_action")]
  //   ]));
  // }

  ctx.session.months = months;

  await ctx.reply(
    `Вы выбрали ${months} мес. подписки.`,
    Markup.inlineKeyboard([
      [Markup.button.callback("Оплатить", "confirm_payment")],
      [Markup.button.callback("Отмена", "cancel_action")],
    ])
  );
});

bot.on(
  "pre_checkout_query",
  async (ctx) => await ctx.answerPreCheckoutQuery(true)
);

bot.action("confirm_payment", async (ctx) => {
  await ctx.answerCbQuery();

  const id = ctx.from.id;

  if (!ctx.session || !ctx.session.months) {
    return restartBot(ctx);
  }
  const months = ctx.session.months;

  await ctx.replyWithInvoice(getInvoice(id, months));
});

bot.on("successful_payment", async (ctx) => {
  const subscriptionDuration = ctx.session.months;
  const userId = ctx.from.id;
  const alreadyHasAccess = await hasChannelAccess(userId);

  const insertQuery = `
  INSERT INTO users (user_id, subscription_end)
  VALUES ($1, CURRENT_DATE + ($2 || ' month')::INTERVAL)
  ON CONFLICT (user_id) DO UPDATE
  SET subscription_end = 
    CASE
      WHEN users.subscription_end > CURRENT_DATE THEN users.subscription_end + ($2 || ' month')::INTERVAL
      ELSE CURRENT_DATE + ($2 || ' month')::INTERVAL
    END
  RETURNING user_id, subscription_end;
`;

  let attempts = 0;
  let res;

  while (attempts < 5 && !res) {
    try {
      res = await pool.query(insertQuery, [userId, subscriptionDuration]);

      console.log("Пользователь добавлен или обновлен:", res.rows[0]);
    } catch (e) {
      attempts++;
      if (attempts === 5) {
        await ctx.reply(
          "Произошла какая-то ошибка, пожалуйста, напишите об этом @pkorovkina"
        );
        console.log(
          `Произошла ${e} ошибка при записывании в бд оплаты для ${userId}`
        );
      }
    }
  }

  if (alreadyHasAccess) {
    await ctx.reply("Подписка обновлена.");
    return;
  }

  try {
    const inviteLink = await bot.telegram.createChatInviteLink(channelId, {
      expire_date: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
      member_limit: 1,
    });

    await ctx.reply(`Вот ваша временная ссылка: ${inviteLink.invite_link}`);
  }catch(e){
    await ctx.reply(
      "Произошла какая-то ошибка при создании сссылки,пожалуйста, напишите об этом @pkorovkina"
    );
  }

});

bot.launch();
