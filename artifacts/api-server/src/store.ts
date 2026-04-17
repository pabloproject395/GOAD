import { db } from "@workspace/db";
import {
  usersTable,
  transactionsTable,
  depositsTable,
  productKeysTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

export type Product = {
  id: string;
  name: string;
  category: "root" | "apkmod";
  price: number;
  stockDisplay?: number;
};

export const products: Product[] = [
  { id: "root-1day", name: "Drip Client Root 1 Day", category: "root", price: 5000 },
  { id: "root-7day", name: "Drip Client Root 7 Day", category: "root", price: 25000 },
  { id: "root-30day", name: "Drip Client Root 30 Day", category: "root", price: 75000 },
  { id: "apkmod-1day", name: "DripClient ApkMod 1 Day", category: "apkmod", price: 3000, stockDisplay: 0 },
  { id: "apkmod-7day", name: "DripClient ApkMod 7 Day", category: "apkmod", price: 15000, stockDisplay: 0 },
  { id: "apkmod-30day", name: "DripClient ApkMod 30 Day", category: "apkmod", price: 50000, stockDisplay: 0 },
];

export const depositAmounts = [10000, 25000, 50000, 100000, 200000, 500000];

function generateUniqueCode(): number {
  return Math.floor(Math.random() * 999) + 1;
}

function generateMerchantRef(prefix: string): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}

async function getOrCreateUser(telegramUserId: number, username?: string, firstName?: string) {
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.telegramId, telegramUserId))
    .limit(1);

  if (existing[0]) {
    return existing[0];
  }

  const [created] = await db
    .insert(usersTable)
    .values({ telegramId: telegramUserId, username, firstName, balance: 0 })
    .returning();

  return created!;
}

async function createInvoice(telegramUserId: number, productId: string) {
  const product = products.find((p) => p.id === productId);
  if (!product) {
    throw new Error(`Product not found: ${productId}`);
  }

  await getOrCreateUser(telegramUserId);

  const uniqueCode = generateUniqueCode();
  const total = product.price + uniqueCode;
  const merchantRef = generateMerchantRef("TRX");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  const [transaction] = await db
    .insert(transactionsTable)
    .values({
      telegramUserId,
      productId,
      price: product.price,
      uniqueCode,
      total,
      merchantRef,
      status: "pending",
      expiresAt,
    })
    .returning();

  return { transaction: transaction!, product };
}

async function expireTransaction(transactionId: number): Promise<boolean> {
  const [updated] = await db
    .update(transactionsTable)
    .set({ status: "expired" })
    .where(
      and(
        eq(transactionsTable.id, transactionId),
        eq(transactionsTable.status, "pending"),
      ),
    )
    .returning();

  return !!updated;
}

async function createDeposit(telegramUserId: number, amount: number) {
  await getOrCreateUser(telegramUserId);

  const uniqueCode = generateUniqueCode();
  const total = amount + uniqueCode;
  const merchantRef = generateMerchantRef("DEP");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  const [deposit] = await db
    .insert(depositsTable)
    .values({
      telegramUserId,
      amount,
      total,
      merchantRef,
      status: "pending",
      expiresAt,
    })
    .returning();

  return deposit!;
}

async function expireDeposit(depositId: number): Promise<boolean> {
  const [updated] = await db
    .update(depositsTable)
    .set({ status: "expired" })
    .where(
      and(
        eq(depositsTable.id, depositId),
        eq(depositsTable.status, "pending"),
      ),
    )
    .returning();

  return !!updated;
}

async function getCreditMatrix(telegramUserId: number) {
  const user = await getOrCreateUser(telegramUserId);

  const transactions = await db
    .select({
      id: transactionsTable.id,
      merchantRef: transactionsTable.merchantRef,
      total: transactionsTable.total,
      status: transactionsTable.status,
      productId: transactionsTable.productId,
      createdAt: transactionsTable.createdAt,
    })
    .from(transactionsTable)
    .where(eq(transactionsTable.telegramUserId, telegramUserId))
    .orderBy(desc(transactionsTable.createdAt))
    .limit(5);

  return { balance: user.balance, transactions };
}

async function markTransactionPaid(merchantRef: string): Promise<{ key?: string; status: "paid" | "already_paid" | "not_found" | "stock_empty" }> {
  const [transaction] = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.merchantRef, merchantRef))
    .limit(1);

  if (!transaction) {
    return { status: "not_found" };
  }

  if (transaction.status === "paid") {
    return { status: "already_paid", key: transaction.keyDelivered ?? undefined };
  }

  if (transaction.status !== "pending") {
    return { status: "not_found" };
  }

  const availableKey = await db
    .select()
    .from(productKeysTable)
    .where(
      and(
        eq(productKeysTable.productId, transaction.productId),
        eq(productKeysTable.isSold, false),
      ),
    )
    .limit(1);

  const key = availableKey[0];

  if (!key) {
    await db
      .update(transactionsTable)
      .set({ status: "paid", paidAt: new Date() })
      .where(eq(transactionsTable.id, transaction.id));
    return { status: "stock_empty" };
  }

  await db
    .update(productKeysTable)
    .set({ isSold: true, transactionId: transaction.id, soldAt: new Date() })
    .where(eq(productKeysTable.id, key.id));

  await db
    .update(transactionsTable)
    .set({ status: "paid", paidAt: new Date(), keyDelivered: key.keyValue })
    .where(eq(transactionsTable.id, transaction.id));

  return { status: "paid", key: key.keyValue };
}

async function markDepositPaid(merchantRef: string): Promise<{ amount?: number; balance?: number; status: "paid" | "already_paid" | "not_found" }> {
  const [deposit] = await db
    .select()
    .from(depositsTable)
    .where(eq(depositsTable.merchantRef, merchantRef))
    .limit(1);

  if (!deposit) {
    return { status: "not_found" };
  }

  if (deposit.status === "paid") {
    return { status: "already_paid", amount: deposit.amount };
  }

  if (deposit.status !== "pending") {
    return { status: "not_found" };
  }

  await db
    .update(depositsTable)
    .set({ status: "paid", paidAt: new Date() })
    .where(eq(depositsTable.id, deposit.id));

  const user = await getOrCreateUser(deposit.telegramUserId);
  const newBalance = user.balance + deposit.amount;

  await db
    .update(usersTable)
    .set({ balance: newBalance })
    .where(eq(usersTable.telegramId, deposit.telegramUserId));

  return { status: "paid", amount: deposit.amount, balance: newBalance };
}

async function getStockCount(productId: string): Promise<number> {
  const keys = await db
    .select({ id: productKeysTable.id })
    .from(productKeysTable)
    .where(
      and(
        eq(productKeysTable.productId, productId),
        eq(productKeysTable.isSold, false),
      ),
    );
  return keys.length;
}

async function getProductsWithStock(): Promise<Product[]> {
  const result: Product[] = [];
  for (const product of products) {
    const stock = await getStockCount(product.id);
    result.push({ ...product, stockDisplay: stock });
  }
  return result;
}

export const storeService = {
  createInvoice,
  expireTransaction,
  createDeposit,
  expireDeposit,
  getCreditMatrix,
  markTransactionPaid,
  markDepositPaid,
  getProductsWithStock,
  getOrCreateUser,
};
