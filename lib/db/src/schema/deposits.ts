import { pgTable, integer, bigint, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const depositsTable = pgTable("deposits", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
  amount: integer("amount").notNull(),
  total: integer("total").notNull(),
  merchantRef: text("merchant_ref").notNull().unique(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const insertDepositSchema = createInsertSchema(depositsTable).omit({ createdAt: true });
export type InsertDeposit = z.infer<typeof insertDepositSchema>;
export type Deposit = typeof depositsTable.$inferSelect;
