import { pool } from "./db";
import type { SubscriptionType } from "./subscriptions";
import type { InsertSubscriptionResult, UserSubscription } from "./types";

export type UserSubscriptionNotification = {
  user_id: number;
  subscription_type: SubscriptionType;
};

export const getActiveSubscription = async (
  userId: number
): Promise<UserSubscription | null> => {
  const { rows } = await pool.query<UserSubscription>(
    `
      SELECT subscription_type, subscription_end
      FROM users
      WHERE user_id = $1 AND subscription_end >= CURRENT_DATE
      LIMIT 1;
    `,
    [userId]
  );

  return rows[0] ?? null;
};

export const getUserSubscription = async (
  userId: number
): Promise<UserSubscription | null> => {
  const { rows } = await pool.query<UserSubscription>(
    `
      SELECT subscription_type, subscription_end
      FROM users
      WHERE user_id = $1
      LIMIT 1;
    `,
    [userId]
  );

  return rows[0] ?? null;
};

export const recordSubscriptionPayment = async (
  userId: number,
  subscriptionType: SubscriptionType,
  months: number
) => {
  const { rows } = await pool.query<InsertSubscriptionResult>(
    `
      INSERT INTO users (user_id, subscription_type, subscription_end)
      VALUES ($1, $2, CURRENT_DATE + ($3 || ' month')::INTERVAL)
      ON CONFLICT (user_id) DO UPDATE
      SET
        subscription_type = $2,
        subscription_end =
          CASE
            WHEN users.subscription_end >= CURRENT_DATE
              THEN users.subscription_end + ($3 || ' month')::INTERVAL
            ELSE CURRENT_DATE + ($3 || ' month')::INTERVAL
          END
      WHERE
        users.subscription_type = $2
      RETURNING user_id, subscription_type, subscription_end;
    `,
    [userId, subscriptionType, months]
  );

  const subscription = rows[0];
  if (!subscription) {
    throw new Error("User already has active subscription with another type");
  }

  return subscription;
};

export const getSubscriptionsForNotification = async (daysLeft: number) => {
  const query =
    daysLeft === 0
      ? `
          SELECT user_id, subscription_type
          FROM users
          WHERE subscription_end < CURRENT_DATE;
        `
      : `
          SELECT user_id, subscription_type
          FROM users
          WHERE subscription_end = CURRENT_DATE + ($1 || ' days')::INTERVAL;
        `;

  const params = daysLeft === 0 ? [] : [daysLeft];
  const { rows } = await pool.query<UserSubscriptionNotification>(
    query,
    params
  );

  return rows;
};

export const deleteUserSubscription = async (userId: number) => {
  await pool.query(`DELETE FROM users WHERE user_id = $1`, [userId]);
};
