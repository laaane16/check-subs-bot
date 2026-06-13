import { Markup, session, Telegraf } from "telegraf";
import { Postgres } from "@telegraf/session/pg";

import "dotenv/config";
import "./notifyUsers";
import { pool } from "./db";
import {
  isSubscriptionType,
  subscriptions,
  SubscriptionType,
} from "./subscriptions";

import {
  getActiveSubscription,
  recordSubscriptionPayment,
} from "./subscriptionRepository";
import { IBotContext, InvoicePayload } from "./types";
import { formatSubscriptionDate, isPositiveNumber } from "./utils";

const token = process.env.TG_SECRET_TOKEN;
const providerToken = process.env.PROVIDER_TOKEN;
const CURRENCY = "RUB";

if (!token || !providerToken) {
  throw new Error("missing required environment");
}

export const bot = new Telegraf<IBotContext>(token);

const store = Postgres({ pool }) as any;

// Мидлвар для пропуска сообщений из чата, так как они тоже идут в бота
bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id;
  if (chatId === subscriptions.vip.chatId) return;

  await next();
});
bot.use(Telegraf.log());
bot.use(session({ store }));
bot.catch((err, ctx) => {
  console.error(`Ошибка в обработке апдейта от ${ctx.from?.id}:`, err);
});

const getInvoice = (
  id: number,
  subscriptionType: SubscriptionType
) => {
  const months = 1;
  const {title, description, price} = subscriptions[subscriptionType];

  return {
    chat_id: id,
    title: `Подписка ${title}`,
    description,
    payload: `subscription_${id}_${months}_${subscriptionType}`,
    currency: CURRENCY,
    provider_token: providerToken,
    prices: [
      {
        label: `Подписка ${title}`,
        amount: 100 * price * months,
      },
    ],
    need_email: true,
    send_email_to_provider: true,
    provider_data: JSON.stringify({
      receipt: {
        items: [
          {
            description: `Подписка ${title}`,
            vat_code: 1,
            quantity: months,
            amount: {
              value: `${price}.00`,
              currency: CURRENCY,
            },
            payment_mode: "full_payment",
          },
        ],
      },
    }),
  };
};

const parseInvoicePayload = (payload: string): InvoicePayload | null => {
  const [, userId, months, subscriptionType] = payload.split("_");

  if (!isSubscriptionType(subscriptionType)) {
    return null;
  }

  const parsedUserId = Number(userId);
  const parsedMonths = Number(months);

  if (
    !isPositiveNumber(parsedUserId, { integer: true }) ||
    !isPositiveNumber(parsedMonths, { integer: true })
  ) {
    return null;
  }

  return {
    userId: parsedUserId,
    months: parsedMonths,
    subscriptionType,
  };
};

const getActiveSubscriptionMessage = (
  activeType: SubscriptionType,
  subscriptionEnd: string
) => {
  const currentTitle = subscriptions[activeType].title;
  const formatted = formatSubscriptionDate(subscriptionEnd);

  return `У тебя активна подписка ${currentTitle} до ${formatted}\n\nКупить другую можно только после окончания текущей.`;
};

const checkSubscriptionPurchase = async (
  userId: number,
  requestedType: SubscriptionType
) => {
  const activeSubscription = await getActiveSubscription(userId);

  if (
    !activeSubscription ||
    activeSubscription.subscription_type === requestedType
  ) {
    return null;
  }

  return getActiveSubscriptionMessage(
    activeSubscription.subscription_type,
    activeSubscription.subscription_end
  );
};

const hasChannelAccess = async (channelId: string, userId: number) => {
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
    "Привет, дорогая! Рада приветствовать тебя на марафоне, где ты можешь сделать шаг навстречу своим изменениям 💋\n\nУ нас есть две подписки: VIP и Lite. Нажми «Приобрести подписку», чтобы посмотреть детали и выбрать подходящий вариант.",
    Markup.keyboard([["📦 Приобрести подписку"], ["🕒 Срок подписки"]])
      .resize()
      .oneTime(false)
  );
};

const requestPaymentMethod = async (ctx: IBotContext) => {
  await ctx.reply(
    "Выбери метод оплаты",
    Markup.inlineKeyboard([
      [Markup.button.callback("Банковская карта / ЮMoney", "yocassa_payment")],
      [Markup.button.callback("Закрыть", "cancel_action")],
    ])
  );
};


const selectSubscription = async (
  ctx: IBotContext,
  subscriptionType: SubscriptionType
) => {
  if (!ctx.session) {
    return restartBot(ctx);
  }

  if (!ctx.from) {
    await ctx.reply("Не удалось определить пользователя. Попробуй еще раз.");
    return;
  }

  const restriction = await checkSubscriptionPurchase(
    ctx.from.id,
    subscriptionType
  );
  if (restriction) {
    await ctx.reply(restriction);
    return;
  }

  ctx.session.subscriptionType = subscriptionType;

  await requestPaymentMethod(ctx);
};


bot.start(async (ctx) => {
  await restartBot(ctx);
});

bot.hears("📦 Приобрести подписку", async (ctx) => {
  const activeSubscription = await getActiveSubscription(ctx.from.id);

  if (activeSubscription) {
    const subscription = subscriptions[activeSubscription.subscription_type];

    await ctx.reply(
      `${getActiveSubscriptionMessage(
        activeSubscription.subscription_type,
        activeSubscription.subscription_end
      )}. Но ты всегда можешь продлить активный вариант`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            `Продлить ${subscription.title} — ${subscription.price} ₽`,
            `select_subscription_${activeSubscription.subscription_type}`
          ),
        ],
        [Markup.button.callback("Закрыть", "cancel_action")],
      ])
    );
    return;
  }

  await ctx.reply(
    `Выбери подписку:\n\nVIP — ${subscriptions.vip.price} ₽\n• занятия с психологом\n• чат и общение\n• йога\n• меню от нутрициолога\n\nLite — ${subscriptions.lite.price} ₽\n• только тренировки\n• без йоги\n• без чата`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          `${subscriptions.vip.title} — ${subscriptions.vip.price} ₽`,
          "select_subscription_vip"
        ),
      ],
      [
        Markup.button.callback(
          `${subscriptions.lite.title} — ${subscriptions.lite.price} ₽`,
          "select_subscription_lite"
        ),
      ],
      [Markup.button.callback("Закрыть", "cancel_action")],
    ])
  );
});

bot.hears("🕒 Срок подписки", async (ctx) => {
  const result = await getActiveSubscription(ctx.from.id);

  if (result) {
    const formatted = formatSubscriptionDate(result.subscription_end);
    const title = subscriptions[result.subscription_type].title;

    await ctx.reply(`Подписка ${title} активна до ${formatted}`);
  } else {
    await ctx.reply("Подписка неактивна");
  }
});

bot.action("select_subscription_vip", async (ctx) => {
  await selectSubscription(ctx, "vip");
  await ctx.answerCbQuery();
});

bot.action("select_subscription_lite", async (ctx) => {
  await selectSubscription(ctx, "lite");
  await ctx.answerCbQuery();
});

bot.action("yocassa_payment", async (ctx) => {
  if (!ctx.session || !ctx.session.subscriptionType) {
    await ctx.answerCbQuery();
    return restartBot(ctx);
  }

  const restriction = await checkSubscriptionPurchase(
    ctx.from.id,
    ctx.session.subscriptionType
  );
  if (restriction) {
    await ctx.reply(restriction);
    await ctx.answerCbQuery();
    return;
  }

  await ctx.replyWithInvoice(
    getInvoice(ctx.from!.id, ctx.session.subscriptionType)
  );
  await ctx.answerCbQuery();
});

bot.action("cancel_action", async (ctx) => {
  await ctx.editMessageText("Действие отменено. Возвращаюсь в главное меню...");

  await restartBot(ctx);

  await ctx.answerCbQuery();
});

bot.on(
  "pre_checkout_query",
  async (ctx) => {
    const payload = parseInvoicePayload(ctx.preCheckoutQuery.invoice_payload);

    if (!payload || payload.userId !== ctx.from.id) {
      return ctx.answerPreCheckoutQuery(
        false,
        "Не удалось проверить подписку. Создай новый счет."
      );
    }

    const restriction = await checkSubscriptionPurchase(
      ctx.from.id,
      payload.subscriptionType
    );

    if (restriction) {
      return ctx.answerPreCheckoutQuery(
        false,
        restriction
      );
    }

    return ctx.answerPreCheckoutQuery(true);
  }
);

bot.on("successful_payment", async (ctx) => {
  const payload = parseInvoicePayload(
    ctx.message.successful_payment.invoice_payload
  );
  const subscriptionDuration = payload?.months;
  const subscriptionType = payload?.subscriptionType;
  const userId = ctx.from.id;

  if (!subscriptionDuration || !subscriptionType) {
    await ctx.reply(
      "Оплата прошла, но не удалось определить подписку. Пожалуйста, напиши @pkorovkina."
    );
    return;
  }

  const restriction = await checkSubscriptionPurchase(userId, subscriptionType);
  if (restriction) {
    await ctx.reply(`Оплата прошла, но не по той подписке, пожалуйста, напиши @pkorovkina.`);
    return;
  }

  const subscription = subscriptions[subscriptionType];
  const alreadyHasAccess = await hasChannelAccess(
    subscription.channelId,
    userId
  );

  try {
    const res = await recordSubscriptionPayment(
      userId,
      subscriptionType,
      subscriptionDuration
    );

    console.log("Пользователь добавлен или обновлен:", res);
  } catch (e) {
    await ctx.reply(
      "Произошла ошибка при записи оплаты. Пожалуйста, напиши @pkorovkina."
    );
    console.log(`Ошибка ${e} при записи оплаты в БД для пользователя ${userId}`);
    return;
  }

  if (alreadyHasAccess) {
    await ctx.reply("Подписка обновлена.");
    return;
  }

  try {
    const inviteLink = await bot.telegram.createChatInviteLink(
      subscription.channelId,
      {
        expire_date: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
        member_limit: 1,
      }
    );

    await ctx.reply(`Вот твоя временная ссылка: ${inviteLink.invite_link}`);
  } catch (e) {
    await ctx.reply(
      "Произошла ошибка при создании ссылки. Пожалуйста, напиши @pkorovkina."
    );
  }
});

bot.launch();
