import type { Logger } from "pino";
import { storeService, products, depositAmounts, type Product } from "./store";

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

type InlineKeyboard = {
  inline_keyboard: { text: string; callback_data?: string; url?: string }[][];
};

type RamaCreateResponse = {
  success: boolean;
  data?: {
    depositId: string;
    amount: number;
    uniqueCode: number;
    totalAmount: number;
    fee: number;
    qrImage: string;
    qrString: string;
    status: string;
    expiredAt: string;
  };
  message?: string;
};

type RamaStatusResponse = {
  status: boolean;
  data?: {
    status: "success" | "pending" | "already";
    paidAmount?: number;
    paidAt?: string;
  };
};

type PendingEntry = {
  internalRef: string;
  userId: number;
  chatId: number;
  type: "transaction" | "deposit";
  product?: Product;
  amount: number;
};

export class TelegramStoreBot {
  private offset = 0;
  private running = false;
  private readonly token = process.env["TELEGRAM_BOT_TOKEN"];
  private readonly qrisBase = (process.env["QRIS_API_URL"] ?? "").replace(/\/deposit\/create$/, "").replace(/\/$/, "");
  private readonly qrisApiToken = process.env["QRIS_API_TOKEN"];

  private readonly pendingMap = new Map<string, PendingEntry>();
  private readonly pollTimers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly expireTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly logger: Logger) {}

  start() {
    if (!this.token) {
      this.logger.warn("TELEGRAM_BOT_TOKEN is not set. Telegram bot polling is disabled.");
      return;
    }
    if (this.running) return;
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
    if (!this.token) return;

    if (payload.type === "paid") {
      await this.sendNew(
        userId,
        `✅ Pembayaran berhasil!\n\n🔑 Key kamu:\n<code>${this.esc(payload.key)}</code>`,
      );
      return;
    }
    if (payload.type === "already_paid") {
      await this.sendNew(
        userId,
        payload.key
          ? `⚠️ Invoice sudah dibayar.\n\n🔑 Key kamu:\n<code>${this.esc(payload.key)}</code>`
          : "⚠️ Invoice sudah dibayar sebelumnya.",
      );
      return;
    }
    if (payload.type === "deposit_paid") {
      await this.sendNew(
        userId,
        `✅ Deposit berhasil!\n\n💰 Masuk: Rp ${this.fmt(payload.amount)}\n👛 Balance: Rp ${this.fmt(payload.balance)}`,
      );
      return;
    }
    if (payload.type === "deposit_already_paid") {
      await this.sendNew(userId, `⚠️ Deposit Rp ${this.fmt(payload.amount)} sudah pernah diproses.`);
      return;
    }
    await this.sendNew(userId, "⚠️ Pembayaran berhasil, tapi stok habis.\nHubungi: @qyotyt");
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
        await new Promise((r) => setTimeout(r, 5_000));
      }
    }
  }

  private async handleUpdate(update: TelegramUpdate) {
    if (update.message) await this.handleMessage(update.message);
    if (update.callback_query) await this.handleCallback(update.callback_query);
  }

  private async handleMessage(message: TelegramMessage) {
    if (!message.text) return;
    const text = message.text.trim();

    if (text === "/start") {
      const name = this.esc(
        message.from?.first_name ?? message.from?.username ?? "Pengguna",
      );
      await this.sendNew(
        message.chat.id,
        `Halo, <b>${name}!</b> 👋\n\nSelamat datang di <b>AUTO STORE SYSTEM</b>\nPilih menu di bawah:`,
        this.mainMenuKeyboard(),
      );
      return;
    }

    await this.sendNew(message.chat.id, "Ketik /start untuk membuka menu.", {
      inline_keyboard: [[{ text: "🏠 Menu Utama", callback_data: "main_menu" }]],
    });
  }

  private async handleCallback(query: TelegramCallbackQuery) {
    await this.answerCallbackQuery(query.id);

    const chatId = query.message?.chat.id ?? query.from.id;
    const messageId = query.message?.message_id;
    const data = query.data ?? "";

    if (data === "main_menu") {
      await this.editOrSend(
        chatId,
        messageId,
        "🛒 <b>AUTO STORE SYSTEM</b>\nPilih menu:",
        this.mainMenuKeyboard(),
      );
      return;
    }

    if (data === "cat:root") {
      await this.showProducts(chatId, messageId, "root");
      return;
    }

    if (data === "cat:apkmod") {
      await this.showProducts(chatId, messageId, "apkmod");
      return;
    }

    if (data === "balance") {
      await this.showBalance(chatId, messageId, query);
      return;
    }

    if (data === "deposit_menu") {
      await this.showDepositMenu(chatId, messageId, query.from.id);
      return;
    }

    if (data === "support") {
      await this.editOrSend(
        chatId,
        messageId,
        "📞 <b>Support</b>\n\nHubungi kami di @qyotyt untuk bantuan.",
        {
          inline_keyboard: [
            [{ text: "💬 Chat @qyotyt", url: "https://t.me/qyotyt" }],
            [{ text: "🔙 Kembali", callback_data: "main_menu" }],
          ],
        },
      );
      return;
    }

    if (data.startsWith("deposit:")) {
      await this.createDepositInvoice(chatId, messageId, query);
      return;
    }

    if (products.some((p) => p.id === data)) {
      await this.createProductInvoice(chatId, messageId, query);
      return;
    }
  }

  private mainMenuKeyboard(): InlineKeyboard {
    return {
      inline_keyboard: [
        [{ text: "🟣 Drip Client Root", callback_data: "cat:root" }],
        [{ text: "⭐ DripClient ApkMod", callback_data: "cat:apkmod" }],
        [
          { text: "💳 Deposit", callback_data: "deposit_menu" },
          { text: "👛 My Balance", callback_data: "balance" },
        ],
        [{ text: "📢 Update Channel", url: "https://t.me/DRIPCLIENT_UPDATE" }],
        [{ text: "📞 Support", callback_data: "support" }],
      ],
    };
  }

  private async showProducts(
    chatId: number,
    messageId: number | undefined,
    category: Product["category"],
  ) {
    const allWithStock = await storeService.getProductsWithStock();
    const categoryProducts = allWithStock.filter((p) => p.category === category);
    const icon = category === "apkmod" ? "⭐" : "🟣";
    const title = category === "apkmod" ? "DRIP CLIENT APKMOD" : "DRIP CLIENT ROOT";

    const lines = [
      `${icon} <b>${title} SELECTION</b>`,
      "⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯",
      ...categoryProducts.flatMap((p) => [
        `${icon} ${this.esc(this.getPlanLabel(p))} ➔ Rp ${this.fmt(p.price)}`,
        `┗ ${icon} [IN STOCK: ${p.stockDisplay ?? 0}]`,
        "",
      ]),
      "⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯",
      "Pilih plan untuk buat invoice:",
    ];

    const keyboard: InlineKeyboard = {
      inline_keyboard: [
        ...categoryProducts.map((p) => [
          {
            text: `${icon} ${this.getPlanLabel(p)} — Rp ${this.fmt(p.price)}`,
            callback_data: p.id,
          },
        ]),
        [{ text: "🔙 Kembali", callback_data: "main_menu" }],
      ],
    };

    await this.editOrSend(chatId, messageId, lines.join("\n"), keyboard);
  }

  private async showBalance(
    chatId: number,
    messageId: number | undefined,
    query: TelegramCallbackQuery,
  ) {
    const userId = query.from.id;
    const username = query.from.username
      ? `@${this.esc(query.from.username)}`
      : this.esc(query.from.first_name ?? "verified_user");
    const holder = this.esc(process.env["CREDIT_HOLDER_NAME"] ?? "JOOEL X DRIPCLIENT");
    const { balance, transactions } = await storeService.getCreditMatrix(userId);

    const txLines =
      transactions.length === 0
        ? ["  — Belum ada transaksi"]
        : transactions.map(
            (t) =>
              `  • <code>${this.esc(t.merchantRef)}</code>\n    Rp ${this.fmt(t.total)} | <b>${t.status.toUpperCase()}</b>`,
          );

    const text = [
      "🏦 <b>CREDIT MATRIX</b>",
      "━━━━━━━━━━━━━━━━━━━━",
      `👤 User    : ${username}`,
      `👑 Holder  : ${holder}`,
      "",
      `💳 Balance : <b>Rp ${this.fmt(balance)}</b>`,
      "",
      "📊 5 Transaksi Terakhir:",
      ...txLines,
      "",
      "⚡ Status  : Online",
    ].join("\n");

    await this.editOrSend(chatId, messageId, text, {
      inline_keyboard: [[{ text: "🔙 Kembali", callback_data: "main_menu" }]],
    });
  }

  private async showDepositMenu(
    chatId: number,
    messageId: number | undefined,
    userId: number,
  ) {
    const { balance } = await storeService.getCreditMatrix(userId);

    const text = [
      "💳 <b>TOP UP BALANCE</b>",
      "━━━━━━━━━━━━━━━━━━━━",
      `💵 Balance saat ini: <b>Rp ${this.fmt(balance)}</b>`,
      "",
      "Pilih nominal deposit:",
    ].join("\n");

    await this.editOrSend(chatId, messageId, text, {
      inline_keyboard: [
        ...this.chunk(
          depositAmounts.map((amount) => ({
            text: `Rp ${this.fmt(amount)}`,
            callback_data: `deposit:${amount}`,
          })),
          2,
        ),
        [{ text: "🔙 Kembali", callback_data: "main_menu" }],
      ],
    });
  }

  private async createProductInvoice(
    chatId: number,
    messageId: number | undefined,
    query: TelegramCallbackQuery,
  ) {
    const { transaction, product } = await storeService.createInvoice(
      query.from.id,
      query.data!,
    );

    const icon = product.category === "apkmod" ? "⭐" : "🟣";
    const title = product.category === "apkmod" ? "DRIP CLIENT APKMOD" : "DRIP CLIENT ROOT";

    const keyboard: InlineKeyboard = {
      inline_keyboard: [
        [{ text: "🔙 Kembali ke Menu", callback_data: "main_menu" }],
      ],
    };

    const ramaData = await this.callRamaApi(product.price);

    if (!ramaData) {
      await this.editOrSend(
        chatId,
        messageId,
        "❌ Gagal membuat QRIS. Coba lagi beberapa saat.",
        keyboard,
      );
      return;
    }

    const invoiceText = [
      `${icon} <b>INVOICE: ${title}</b>`,
      "⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯",
      `${icon} Plan      : ${this.esc(this.getPlanLabel(product))}`,
      `${icon} Harga     : Rp ${this.fmt(product.price)}`,
      `${icon} Kode Unik : +${ramaData.uniqueCode}`,
      "⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯",
      "",
      "⚡ <b>QRIS PAYMENT</b>",
      `┗ Total Bayar : <b>Rp ${this.fmt(ramaData.totalAmount)}</b>`,
      `┗ Ref         : <code>${this.esc(transaction.merchantRef)}</code>`,
      "",
      "⏳ Status  : Menunggu pembayaran...",
      "⏱ Expired : 5 menit",
    ].join("\n");

    await this.editOrSend(chatId, messageId, invoiceText, keyboard);
    await this.sendPhoto(chatId, ramaData.qrImage, `Scan QR untuk bayar Rp ${this.fmt(ramaData.totalAmount)}`);

    this.startPolling({
      ramaDepositId: ramaData.depositId,
      internalRef: transaction.merchantRef,
      userId: query.from.id,
      chatId,
      type: "transaction",
      product,
      amount: ramaData.totalAmount,
      internalId: transaction.id,
    });
  }

  private async createDepositInvoice(
    chatId: number,
    messageId: number | undefined,
    query: TelegramCallbackQuery,
  ) {
    const rawAmount = query.data?.split(":")[1];
    const amount = Number(rawAmount);

    if (!depositAmounts.includes(amount)) {
      await this.editOrSend(chatId, messageId, "❌ Nominal deposit tidak valid.", {
        inline_keyboard: [[{ text: "🔙 Kembali", callback_data: "deposit_menu" }]],
      });
      return;
    }

    const deposit = await storeService.createDeposit(query.from.id, amount);

    const keyboard: InlineKeyboard = {
      inline_keyboard: [
        [{ text: "🔙 Kembali ke Menu", callback_data: "main_menu" }],
      ],
    };

    const ramaData = await this.callRamaApi(amount);

    if (!ramaData) {
      await this.editOrSend(
        chatId,
        messageId,
        "❌ Gagal membuat QRIS. Coba lagi beberapa saat.",
        keyboard,
      );
      return;
    }

    const invoiceText = [
      "💳 <b>DEPOSIT INVOICE</b>",
      "━━━━━━━━━━━━━━━━━━━━",
      `💰 Nominal     : Rp ${this.fmt(amount)}`,
      `🔢 Kode Unik   : +${ramaData.uniqueCode}`,
      `💵 Total Bayar : <b>Rp ${this.fmt(ramaData.totalAmount)}</b>`,
      `🆔 Ref         : <code>${this.esc(deposit.merchantRef)}</code>`,
      "",
      "📌 <b>Cara bayar:</b>",
      "1. Scan QR code di bawah",
      "2. Bayar sesuai Total (termasuk kode unik)",
      "3. Saldo otomatis masuk dalam 1-2 menit",
      "",
      "⏱ Expired: 5 menit",
    ].join("\n");

    await this.editOrSend(chatId, messageId, invoiceText, keyboard);
    await this.sendPhoto(chatId, ramaData.qrImage, `Scan QR untuk deposit Rp ${this.fmt(ramaData.totalAmount)}`);

    this.startPolling({
      ramaDepositId: ramaData.depositId,
      internalRef: deposit.merchantRef,
      userId: query.from.id,
      chatId,
      type: "deposit",
      amount: ramaData.totalAmount,
      internalId: deposit.id,
    });
  }

  private async callRamaApi(amount: number): Promise<{
    depositId: string;
    uniqueCode: number;
    totalAmount: number;
    qrImage: string;
    qrString: string;
  } | null> {
    if (!this.qrisBase || !this.qrisApiToken) {
      this.logger.warn("QRIS_API_URL or QRIS_API_TOKEN not set");
      return null;
    }

    try {
      const response = await fetch(`${this.qrisBase}/deposit/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.qrisApiToken,
        },
        body: JSON.stringify({ amount, method: "qris" }),
      });

      const payload = (await response.json()) as RamaCreateResponse;
      this.logger.info({ status: response.status, depositId: payload.data?.depositId }, "Rama create response");

      if (!payload.success || !payload.data) {
        throw new Error(`Rama API error: ${payload.message ?? "unknown"}`);
      }

      return {
        depositId: payload.data.depositId,
        uniqueCode: payload.data.uniqueCode,
        totalAmount: payload.data.totalAmount,
        qrImage: payload.data.qrImage,
        qrString: payload.data.qrString,
      };
    } catch (error) {
      this.logger.error({ err: error }, "callRamaApi failed");
      return null;
    }
  }

  private startPolling(opts: {
    ramaDepositId: string;
    internalRef: string;
    userId: number;
    chatId: number;
    type: "transaction" | "deposit";
    product?: Product;
    amount: number;
    internalId: number;
  }) {
    const { ramaDepositId, internalRef, userId, chatId, type, product, amount, internalId } = opts;

    const pollInterval = setInterval(() => {
      void this.checkDepositStatus(ramaDepositId, internalRef, userId, chatId, type, amount);
    }, 5_000);

    const expireTimer = setTimeout(async () => {
      clearInterval(pollInterval);
      this.pollTimers.delete(ramaDepositId);
      this.expireTimers.delete(ramaDepositId);

      if (type === "transaction") {
        const expired = await storeService.expireTransaction(internalId);
        if (expired) {
          void this.sendNew(
            chatId,
            `⌛ Invoice <code>${this.esc(internalRef)}</code> expired.\n\nTekan tombol untuk kembali ke menu.`,
            { inline_keyboard: [[{ text: "🏠 Menu Utama", callback_data: "main_menu" }]] },
          );
        }
      } else {
        const expired = await storeService.expireDeposit(internalId);
        if (expired) {
          void this.sendNew(
            chatId,
            `⌛ Deposit <code>${this.esc(internalRef)}</code> expired.`,
            { inline_keyboard: [[{ text: "💳 Deposit Lagi", callback_data: "deposit_menu" }]] },
          );
        }
      }
    }, 5 * 60 * 1000);

    this.pollTimers.set(ramaDepositId, pollInterval);
    this.expireTimers.set(ramaDepositId, expireTimer);

    void product;
  }

  private async checkDepositStatus(
    ramaDepositId: string,
    internalRef: string,
    userId: number,
    chatId: number,
    type: "transaction" | "deposit",
    amount: number,
  ) {
    if (!this.qrisBase || !this.qrisApiToken) return;

    try {
      const response = await fetch(`${this.qrisBase}/deposit/status/${ramaDepositId}`, {
        headers: {
          "X-API-Key": this.qrisApiToken,
          "Content-Type": "application/json",
        },
      });

      const payload = (await response.json()) as RamaStatusResponse;
      const status = payload.data?.status;

      if (status === "success" || status === "already") {
        this.clearPoll(ramaDepositId);

        if (type === "transaction") {
          const result = await storeService.markTransactionPaid(internalRef);
          if (result.status === "paid" && result.key) {
            await this.sendNew(
              chatId,
              `✅ <b>Pembayaran Diterima!</b>\n\n🔑 Key kamu:\n<code>${this.esc(result.key)}</code>`,
            );
          } else if (result.status === "paid") {
            await this.sendNew(
              chatId,
              "✅ Pembayaran diterima!\n\n⚠️ Stok habis. Hubungi @qyotyt.",
            );
          }
        } else {
          const result = await storeService.markDepositPaid(internalRef);
          if (result.status === "paid" && result.balance !== undefined) {
            await this.sendNew(
              chatId,
              `✅ <b>Deposit Berhasil!</b>\n\n💰 Masuk  : Rp ${this.fmt(amount)}\n👛 Balance: Rp ${this.fmt(result.balance)}`,
            );
          }
        }
      }
    } catch (error) {
      this.logger.error({ err: error, ramaDepositId }, "checkDepositStatus failed");
    }
  }

  private clearPoll(ramaDepositId: string) {
    const interval = this.pollTimers.get(ramaDepositId);
    if (interval) clearInterval(interval);
    this.pollTimers.delete(ramaDepositId);

    const timer = this.expireTimers.get(ramaDepositId);
    if (timer) clearTimeout(timer);
    this.expireTimers.delete(ramaDepositId);
  }

  private async editOrSend(
    chatId: number,
    messageId: number | undefined,
    text: string,
    replyMarkup?: InlineKeyboard,
  ) {
    if (messageId) {
      try {
        await this.api("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text,
          reply_markup: replyMarkup,
          parse_mode: "HTML",
        });
        return;
      } catch {
        // fallback ke pesan baru jika edit gagal
      }
    }
    await this.sendNew(chatId, text, replyMarkup);
  }

  private async sendNew(
    chatId: number,
    text: string,
    replyMarkup?: InlineKeyboard,
  ) {
    await this.api("sendMessage", {
      chat_id: chatId,
      text,
      reply_markup: replyMarkup,
      parse_mode: "HTML",
    });
  }

  private async sendPhoto(chatId: number, photo: string, caption: string) {
    await this.api("sendPhoto", {
      chat_id: chatId,
      photo,
      caption,
      parse_mode: "HTML",
    });
  }

  private async answerCallbackQuery(callbackQueryId: string) {
    await this.api("answerCallbackQuery", { callback_query_id: callbackQueryId });
  }

  private getPlanLabel(product: Product) {
    const match = product.name.match(/(\d+\s*Day)/i);
    return match?.[1] ?? product.name;
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks;
  }

  private esc(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  private async api<T>(method: string, body: Record<string, unknown>): Promise<T> {
    if (!this.token) throw new Error("TELEGRAM_BOT_TOKEN is required.");

    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as TelegramApiResponse<T>;

    if (!response.ok || !payload.ok) {
      throw new Error(payload.description ?? `Telegram request failed: ${method}`);
    }

    return payload.result;
  }

  private fmt(value: number) {
    return new Intl.NumberFormat("id-ID").format(value);
  }
}
