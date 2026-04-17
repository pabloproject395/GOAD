import { pgTable, integer, text, bigint, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const transactionsTable = pgTable("transactions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
  productId: text("product_id").notNull(),
  price: integer("price").notNull(),
  uniqueCode: integer("unique_code").notNull().default(0),
  total: integer("total").notNull(),
  merchantRef: text("merchant_ref").notNull().unique(),
  status: text("status").notNull().default("pending"),
  keyDelivered: text("key_delivered"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({ createdAt: true });
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;
