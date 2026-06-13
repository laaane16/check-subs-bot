export type SubscriptionType = "vip" | "lite";

type SubscriptionConfig = {
  title: string;
  channelId: string;
  chatId?: number;
  price: number;
  description: string;
};

const vipChannelId = process.env.VIP_CHANNEL_ID;
const liteChannelId = process.env.LITE_CHANNEL_ID;
const vipPrice = Number(process.env.VIP_PRICE);
const litePrice = Number(process.env.LITE_PRICE);
const vipChatId = Number(process.env.VIP_CHAT_ID);

if (!vipChannelId || !vipChatId || !vipPrice || !liteChannelId || !litePrice) {
  throw new Error("missing required subscription environment");
}

export const subscriptions: Record<SubscriptionType, SubscriptionConfig> = {
  vip: {
    title: "VIP",
    channelId: vipChannelId,
    chatId: vipChatId,
    price: vipPrice,
    description:
      "Занятия с психологом, чат и общение, йога, меню от нутрициолога",
  },
  lite: {
    title: "Lite",
    channelId: liteChannelId,
    price: litePrice,
    description: "Только тренировки, без йоги и чата",
  },
};

export const subscriptionTypes: SubscriptionType[] = ["vip", "lite"];

export const isSubscriptionType = (value: unknown): value is SubscriptionType =>
  value === "vip" || value === "lite";
