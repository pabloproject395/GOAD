import type { Logger } from "pino";
import { depositAmounts, storeService, products, type Product } from "./store";

type TelegramMessage = {
  message_id: number;
  chat: { id: number };
  from?: { id: number; username?: string; first_name?: string };
  text?: string;
};

type TelegramCallbackQuery = {
  id: string;
  from: { id: number; username?: string; first_name?: string };
  message?: TelegramMessage;
  data?: string;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result: T;
  description?: string;
};

const MENU_LABELS = {
  products: "🟣 Drip Client Root",
  apkmod: "🟣 DripClient ApkMod",
  deposit: "💳 Deposit",
  balance: "👛 My Balance",
  support: "📞 Support",
};

export class TelegramStoreBot {
  private offset = 0;
  private running = false;
  private readonly token = process.env["TELEGRAM_BOT_TOKEN"];
  private readonly qrisImageUrl = process.env["QRIS_IMAGE_URL"];
  private readonly qrisApiUrl = process.env["QRIS_API_URL"];
  private readonly qrisApiToken = process.env["QRIS_API_TOKEN"];

  constructor(private readonly logger: Logger) {}

  start() {
    if (!this.token) {
      this.logger.warn(
        "TELEGRAM_BOT_TOKEN is not set. Telegram bot polling is disabled.",
      );
      return;
    }

    if (this.running) {
      return;
    }

    this.running = true;
    void this.poll();
  }

  async notifyPaymentResult(
    userId: number,
    payload:
      | { type: "paid"; key: string }
      | { type: "stock_empty" }
      | { type: "already_paid"; key?: string }
      | { type: "deposit_paid"; amount: number; balance: number }
      | { type: "deposit_already_paid"; amount: number },
  ) {
    if (!this.token) {
      return;
    }

    if (payload.type === "paid") {
      await this.sendMessage(
        userId,
        `Pembayaran berhasil.\\n\\nKey:\\n${payload.key}`,
      );
      return;
    }

    if (payload.type === "already_paid") {
      await this.sendMessage(
        userId,
        payload.key
          ? `Invoice ini sudah dibayar.\\n\\nKey:\\n${payload.key}`
          : "Invoice ini sudah dibayar.",
      );
      return;
    }

    if (payload.type === "deposit_paid") {
      await this.sendMessage(
        userId,
        `✅ Deposit berhasil.\\n\\nSaldo masuk: Rp ${this.formatRupiah(payload.amount)}\\nBalance sekarang: Rp ${this.formatRupiah(payload.balance)}`,
      );
      return;
    }

    if (payload.type === "deposit_already_paid") {
      await this.sendMessage(
        userId,
        `Deposit Rp ${this.formatRupiah(payload.amount)} sudah pernah diproses.`,
      );
      return;
    }

    await this.sendMessage(
      userId,
      "Pembayaran berhasil, tetapi stok produk sedang habis. Hubungi support.",
    );
  }

  private async poll() {
    while (this.running) {
      try {
        const updates = await this.api<TelegramUpdate[]>("getUpdates", {
          offset: this.offset,
          timeout: 25,
          allowed_updates: ["message", "callback_query"],
        });

        for (const update of updates) {
          this.offset = update.update_id + 1;
          await this.handleUpdate(update);
        }
      } catch (error) {
        this.logger.error({ err: error }, "Telegram polling failed");
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
  }

  private async handleUpdate(update: TelegramUpdate) {
    if (update.message) {
      await this.handleMessage(update.message);
    }

    if (update.callback_query) {
      await this.handleCallback(update.callback_query);
    }
  }

  private async handleMessage(message: TelegramMessage) {
    if (!message.text) {
      return;
    }

    if (message.text === "/start") {
      await this.sendMainMenu(message.chat.id);
      return;
    }

    if (
      message.text === MENU_LABELS.products ||
      message.text === "Drip Client Root"
    ) {
      await this.sendProducts(message.chat.id, "root");
      return;
    }

    if (
      message.text === MENU_LABELS.apkmod ||
      message.text === "DripClient ApkMod"
    ) {
      await this.sendProducts(message.chat.id, "apkmod");
      return;
    }

    if (message.text === MENU_LABELS.balance || message.text === "My Balance") {
      await this.sendBalance(message);
      return;
    }

    if (message.text === MENU_LABELS.deposit || message.text === "Deposit") {
      await this.sendDepositMenu(message);
      return;
    }

    if (message.text === MENU_LABELS.support || message.text === "Support") {
      await this.sendMessage(
        message.chat.id,
        "📞 Support tersedia di @qyotyt",
        {
          inline_keyboard: [
            [{ text: "Chat Support @qyotyt", url: "https://t.me/qyotyt" }],
          ],
        },
      );
      return;
    }

    await this.sendMainMenu(message.chat.id);
  }

  private async handleCallback(query: TelegramCallbackQuery) {
    await this.answerCallbackQuery(query.id);

    if (query.data === "cancel") {
      const chatId = query.message?.chat.id ?? query.from.id;
      await this.sendMainMenu(chatId);
      return;
    }

    if (query.data?.startsWith("deposit:")) {
      await this.createDepositInvoice(query);
      return;
    }

    if (!query.data || !products.some((product) => product.id === query.data)) {
      return;
    }

    const chatId = query.message?.chat.id ?? query.from.id;
    const { transaction, product } = await storeService.createInvoice(
      query.from.id,
      query.data,
    );

    const invoiceText =
      product.category === "apkmod"
        ? [
            "⭐ 𝐈𝐍𝐕𝐎𝐈𝐂𝐄: DRIP CLIENT APKMOD",
            "⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯",
            `⭐ 𝐏𝐥𝐚𝐧: ${this.getPlanLabel(product)}`,
            `⭐ 𝐂𝐨𝐬𝐭: ${transaction.price} Rp`,
            "⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯",
            "",
            "⚡ 𝐐𝐑𝐈𝐒 𝐏𝐀𝐘𝐌𝐄𝐍𝐓",
            `┗ Pay: Rp ${this.formatPaymentAmount(transaction.total)}`,
            `┗ Deposit ID: ${transaction.merchantRef}`,
            "",
            "⏳ 𝐒𝐭𝐚𝐭𝐮𝐬: 𝐖𝐚𝐢𝐭𝐢𝐧𝐠...",
          ].join("\n")
        : [
            `Invoice #${transaction.id}`,
            "",
            `Produk: ${product.name}`,
            `Harga: Rp${this.formatRupiah(transaction.price)}`,
            `Kode unik: ${transaction.uniqueCode}`,
            `Total bayar: Rp${this.formatRupiah(transaction.total)}`,
            `Merchant ref: ${transaction.merchantRef}`,
            "",
            "Status: Waiting",
            "Expired: 5 menit",
          ].join("\n");

    const qrisPhotoUrl = await this.getQrisPhotoUrl({
      amount: transaction.total,
      depositId: transaction.merchantRef,
      productName: product.name,
      userId: query.from.id,
    });

    if (qrisPhotoUrl) {
      await this.sendPhoto(chatId, qrisPhotoUrl, invoiceText);
    } else {
      await this.sendMessage(chatId, invoiceText);
    }

    setTimeout(
      () => {
        void storeService.expireTransaction(transaction.id).then((expired) => {
          if (expired) {
            return this.sendMessage(
              chatId,
              `Invoice #${transaction.id} expired.`,
            );
          }
        });
      },
      5 * 60 * 1000,
    );
  }

  private async sendMainMenu(chatId: number) {
    await this.sendMessage(chatId, "AUTO STORE SYSTEM\\nKlik menu di bawah", {
      keyboard: [
        [MENU_LABELS.products],
        [MENU_LABELS.apkmod],
        [MENU_LABELS.deposit, MENU_LABELS.balance],
        [MENU_LABELS.support],
      ],
      resize_keyboard: true,
    });
  }

  private async sendProducts(chatId: number, category: Product["category"]) {
    const categoryProducts = products.filter(
      (product) => product.category === category,
    );
    const text =
      category === "apkmod"
        ? [
            "⭐ DRIP CLIENT APKMOD 𝐒𝐄𝐋𝐄𝐂𝐓𝐈𝐎𝐍",
            "⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯",
            ...categoryProducts.flatMap((product) => [
              `⭐ ${this.getPlanLabel(product)} ➔ ${this.formatRupiah(product.price)} Rp`,
              `┗ ⭐ [IN STOCK: ${product.stockDisplay ?? 0}]`,
              "",
            ]),
            "⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯",
            "Select a plan to generate your invoice:",
          ].join("\n")
        : "Pilih produk";

    await this.sendMessage(chatId, text, {
      inline_keyboard: categoryProducts.map((product: Product) => [
        {
          text:
            category === "apkmod"
              ? `⭐ ${this.getPlanLabel(product)} - Rp${this.formatRupiah(product.price)}`
              : product.name,
          callback_data: product.id,
        },
      ]),
    });
  }

  private async sendDepositMenu(message: TelegramMessage) {
    const userId = message.from?.id ?? message.chat.id;
    const { balance } = await storeService.getCreditMatrix(userId);

    await this.sendMessage(
      message.chat.id,
      [
        "💳 TOP UP BALANCE 💳",
        "━━━━━━━━━━━━━━━━━━━━",
        `💵 Current balance: ${this.formatRupiah(balance)} Rp`,
        "",
        "Select amount to deposit:",
      ].join("\n"),
      {
        inline_keyboard: [
          ...this.chunk(
            depositAmounts.map((amount) => ({
              text: `Rp ${this.formatRupiah(amount)}`,
              callback_data: `deposit:${amount}`,
            })),
            2,
          ),
          [{ text: "❌ Cancel", callback_data: "cancel" }],
        ],
      },
    );
  }

  private async createDepositInvoice(query: TelegramCallbackQuery) {
    const chatId = query.message?.chat.id ?? query.from.id;
    const amount = Number(query.data?.split(":")[1]);
    const deposit = await storeService.createDeposit(query.from.id, amount);
    const invoiceText = [
      "💳 DEPOSIT INVOICE",
      "━━━━━━━━━━━━━━━━━━━━",
      `Amount: Rp ${this.formatPaymentAmount(deposit.amount)}`,
      `To pay: Rp ${this.formatPaymentAmount(deposit.total)}`,
      `ID: ${deposit.merchantRef}`,
      "",
      "📌 Instructions:",
      "1. Scan the QR code",
      "2. Complete payment using any QRIS app",
      "3. Your balance will be automatically credited within 1-2 minutes",
      "",
      "— The system will detect the payment.",
    ].join("\n");

    const qrisPhotoUrl = await this.getQrisPhotoUrl({
      amount: deposit.total,
      depositId: deposit.merchantRef,
      productName: "Balance Deposit",
      userId: query.from.id,
    });

    if (qrisPhotoUrl) {
      await this.sendPhoto(chatId, qrisPhotoUrl, invoiceText);
    } else {
      await this.sendMessage(chatId, invoiceText);
    }

    setTimeout(
      () => {
        void storeService.expireDeposit(deposit.id).then((expired) => {
          if (expired) {
            return this.sendMessage(
              chatId,
              `Deposit ${deposit.merchantRef} expired.`,
            );
          }
        });
      },
      5 * 60 * 1000,
    );
  }

  private async sendBalance(message: TelegramMessage) {
    const userId = message.from?.id ?? message.chat.id;
    const username =
      message.from?.username ?? message.from?.first_name ?? "verified_user";
    const holder = process.env["CREDIT_HOLDER_NAME"] ?? "JOOEL X DRIPCLIENT";
    const { balance, transactions } =
      await storeService.getCreditMatrix(userId);
    const transactionLines =
      transactions.length === 0
        ? ["- Tidak ada data"]
        : transactions.map(
            (transaction) =>
              `- ${transaction.merchantRef} | Rp ${this.formatRupiah(transaction.total)} | ${transaction.status}`,
          );

    await this.sendMessage(
      message.chat.id,
      [
        "🏦 CREDIT MATRIX",
        "",
        `👤 User : ${username}`,
        `👑 Holder : ${holder}`,
        "",
        `💳 Balance : Rp ${this.formatRupiah(balance)}`,
        "",
        "📊 Last Transactions:",
        ...transactionLines,
        "",
        "⚡ Status : Online",
      ].join("\n"),
    );
  }

  private getPlanLabel(product: Product) {
    const match = product.name.match(/(\d+\s+Day)/i);
    return match?.[1] ?? product.name;
  }

  private async getQrisPhotoUrl(input: {
    amount: number;
    depositId: string;
    productName: string;
    userId: number;
  }) {
    if (!this.qrisApiUrl) {
      return this.qrisImageUrl;
    }

    try {
      const response = await fetch(this.qrisApiUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.qrisApiToken
            ? { authorization: `Bearer ${this.qrisApiToken}` }
            : {}),
        },
        body: JSON.stringify({
          amount: input.amount,
          nominal: input.amount,
          deposit_id: input.depositId,
          merchant_ref: input.depositId,
          product_name: input.productName,
          user_id: input.userId,
        }),
      });

      const payload = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        throw new Error(`QRIS API failed with status ${response.status}`);
      }

      return this.extractQrisUrl(payload) ?? this.qrisImageUrl;
    } catch (error) {
      this.logger.error({ err: error }, "QRIS API request failed");
      return this.qrisImageUrl;
    }
  }

  private extractQrisUrl(payload: Record<string, unknown>): string | undefined {
    const directKeys = [
      "qris_url",
      "qrisUrl",
      "qr_url",
      "qrUrl",
      "image_url",
      "imageUrl",
      "url",
    ];

    for (const key of directKeys) {
      const value = payload[key];
      if (typeof value === "string" && value.startsWith("http")) {
        return value;
      }
    }

    const data = payload["data"];
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return this.extractQrisUrl(data as Record<string, unknown>);
    }

    return undefined;
  }

  private chunk<T>(items: T[], size: number) {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  private async sendMessage(
    chatId: number,
    text: string,
    replyMarkup?: Record<string, unknown>,
  ) {
    await this.api("sendMessage", {
      chat_id: chatId,
      text,
      reply_markup: replyMarkup,
    });
  }

  private async sendPhoto(chatId: number, photo: string, caption: string) {
    await this.api("sendPhoto", {
      chat_id: chatId,
      photo,
      caption,
    });
  }

  private async answerCallbackQuery(callbackQueryId: string) {
    await this.api("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
    });
  }

  private async api<T>(method: string, body: Record<string, unknown>) {
    if (!this.token) {
      throw new Error("TELEGRAM_BOT_TOKEN is required.");
    }

    const response = await fetch(
      `https://api.telegram.org/bot${this.token}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    const payload = (await response.json()) as TelegramApiResponse<T>;

    if (!response.ok || !payload.ok) {
      throw new Error(
        payload.description ?? `Telegram request failed: ${method}`,
      );
    }

    return payload.result;
  }

  private formatRupiah(value: number) {
    return new Intl.NumberFormat("id-ID").format(value);
  }

  private formatPaymentAmount(value: number) {
    return new Intl.NumberFormat("en-US").format(value);
  }
}
