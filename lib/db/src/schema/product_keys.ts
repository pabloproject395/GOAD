import { pgTable, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productKeysTable = pgTable("product_keys", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  productId: text("product_id").notNull(),
  keyValue: text("key_value").notNull(),
  isSold: boolean("is_sold").notNull().default(false),
  transactionId: integer("transaction_id"),
  soldAt: timestamp("sold_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProductKeySchema = createInsertSchema(productKeysTable).omit({ createdAt: true });
export type InsertProductKey = z.infer<typeof insertProductKeySchema>;
export type ProductKey = typeof productKeysTable.$inferSelect;
