import type { Context } from "telegraf";
import type { SubscriptionType } from "./subscriptions";

export interface IBotContext extends Context {
  session: {
    months?: number;
    awaitingMonthsInput?: boolean;
    subscriptionType?: SubscriptionType;
  };
}

export type UserSubscription = {
  subscription_type: SubscriptionType;
  subscription_end: string;
};

export type InsertSubscriptionResult = {
  user_id: string;
  subscription_type: SubscriptionType;
  subscription_end: string;
};

export type InvoicePayload = {
  userId: number;
  months: number;
  subscriptionType: SubscriptionType;
};
