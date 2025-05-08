import { Context, Markup, session, Telegraf } from 'telegraf'

import 'dotenv/config'
import './notifyUsers'
import {pool} from './db'

interface IBotContext extends Context {
  session: {
    months: number;
    awaitingMonthsInput?: boolean;
  }
}

const token = process.env.TG_SECRET_TOKEN;
const CURRENCY = "RUB"
const PRICE = 3499

if (!token){
  throw new Error('No bot token')
}

export const bot = new Telegraf<IBotContext>(token)

const getInvoice = (id: number, months: number) => {
  const providerToken = process.env.TEST_PROVIDER_TOKEN;
  if (!providerToken){
    throw new Error('Invalid provider token')
  }

  const invoice = {
    "chat_id" : id,
    "title" : 'Подписка на приватный канал',
    "description" : "Ежемесячная подписка на мой приватный канал",
    "payload" : "YourPayload",
    "currency" : CURRENCY,
    "provider_token" : providerToken,
    prices: [{ label: 'Invoice Title', amount: 100 * PRICE * months }],
}

  return invoice
}

const restartBot = async (ctx: IBotContext) => {
  ctx.session = {
    months: 1,
    awaitingMonthsInput: false,
  }

  await ctx.reply("Привет! Здесь ты можешь оформить подписку и получить доступ к моему приватному фитнес-каналу с тренировками, советами и мотивацией.", Markup.keyboard([
    ['📦 Приобрести подписку'],
    ['🕒 Срок подписки']
    ])
    .resize()
    .oneTime(false));
}

bot.use(Telegraf.log())
bot.use(session());

bot.start((ctx) => {
  restartBot(ctx)
})

bot.hears("📦 Приобрести подписку", (ctx) => {
  ctx.reply(
    "Выберите метод оплаты",
    Markup.inlineKeyboard([
      [Markup.button.callback("Банковская карта/ ЮMoney", "yocassa_payment")],
      [Markup.button.callback("Закрыть", "cancel_action")],
    ])
  )
})

bot.hears("🕒 Срок подписки",async (ctx) => {
  const userId = ctx.from.id

  const { rows } = await pool.query(`
  SELECT "subscription_end" FROM users where user_id = $1
  `, [userId])
  const result = rows[0];

  if (result && result.subscription_end){
    const formatted = result.subscription_end.toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    ctx.reply(`Подписка активна до ${formatted}`)
  }
  else{
    ctx.reply("Подписка неактивна")
  }
})


bot.action("yocassa_payment", async (ctx) => {
  ctx.session.awaitingMonthsInput = true;

  await ctx.reply(
    "Введите количество месяцев подписки (от 1 до 12):",
    Markup.inlineKeyboard([
      [Markup.button.callback("Отмена", "cancel_action")]
    ])
  );
});

bot.action('cancel_action', async (ctx) => {
    await ctx.editMessageText(
      "Действие отменено. Возвращаюсь в главное меню...",
    );

    ctx.session = { months: 1 };

    restartBot(ctx);
})


bot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();
  const months = Number(text);

  if (
    ctx.session.awaitingMonthsInput === true
  ) {
    if (!Number.isInteger(months) || months < 1 || months > 12) {
      return ctx.reply("Пожалуйста, введите число от 1 до 12.", Markup.inlineKeyboard([
        [Markup.button.callback("Отмена", "cancel_action")]
      ]));
    }

    ctx.session.months = months;

    ctx.reply(
      `Вы выбрали ${months} мес. подписки.`,
      Markup.inlineKeyboard([
        [Markup.button.callback("Оплатить", "confirm_payment")],
        [Markup.button.callback("Отмена", "cancel_action")]
      ])
    );
  }
});

bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true))

bot.action("confirm_payment",  (ctx) => {
  const id = ctx.from.id;
  const months = ctx.session.months
  return ctx.replyWithInvoice(getInvoice(id, months))
})

bot.on('successful_payment', async (ctx) => {
  const channelId = process.env.PRIVATE_CHANNEL_ID as string;
  const inviteLink = await bot.telegram.createChatInviteLink(channelId, {
    expire_date: Math.floor(Date.now() / 1000) + 60 * 60 * 24, 
    member_limit: 1,
  });    
  
  const subscriptionDuration = ctx.session.months;
  const userId = ctx.from.id;

  const insertQuery = `
  INSERT INTO users (user_id, subscription_end)
  VALUES ($1, CURRENT_DATE + ($2 || ' month')::INTERVAL)
  ON CONFLICT (user_id) DO UPDATE
  SET subscription_end = 
    CASE
      WHEN users.subscription_end IS NOT NULL THEN users.subscription_end + ($2 || ' month')::INTERVAL
      ELSE CURRENT_DATE + ($2 || ' month')::INTERVAL
    END
  RETURNING user_id, subscription_end;
`;
  

  let attempts = 0
  let res;

  while (attempts < 5 && !res){
    try{
      res = await pool.query(insertQuery, [userId, subscriptionDuration]);

      console.log('User added or updated:', res.rows[0]);
    }catch(e){
      attempts++;
      if (attempts === 5){
        console.log(`Произошла ${e} ошибка при записывании в бд оплаты для ${userId}`)
      }
    }
  }

  await ctx.reply(`Вот ваша временная ссылка: ${inviteLink.invite_link}`); 
})

bot.launch();