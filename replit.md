# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Telegram Store Bot untuk jual key/lisensi (Drip Client Root & ApkMod) via QRIS payment.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Architecture

### Bot (`artifacts/api-server/src/bot.ts`)
Telegram bot polling dengan fitur:
- Menu utama: Drip Client Root, DripClient ApkMod, Deposit, My Balance, Support
- Invoice generation dengan kode unik (price + random 1-999)
- Auto-expire invoice setelah 5 menit
- QRIS payment support (via `QRIS_IMAGE_URL` atau `QRIS_API_URL`)
- Greeting personal di `/start`
- Format produk konsisten untuk kedua kategori (root & apkmod)

### Store Service (`artifacts/api-server/src/store.ts`)
- `createInvoice(telegramUserId, productId)` — buat invoice + simpan ke DB
- `createDeposit(telegramUserId, amount)` — buat deposit invoice
- `expireTransaction(id)` / `expireDeposit(id)` — expire jika masih pending
- `getCreditMatrix(userId)` — balance + 5 transaksi terakhir
- `markTransactionPaid(merchantRef)` — tandai paid + deliver key
- `markDepositPaid(merchantRef)` — tandai paid + top up balance
- `getProductsWithStock()` — produk dengan jumlah stok real-time dari DB

### Database Schema (`lib/db/src/schema/`)
| Tabel | Fungsi |
|-------|--------|
| `users` | User Telegram, balance saldo |
| `products` | Katalog produk (id, name, category, price) |
| `product_keys` | Stok key/lisensi yang bisa dijual |
| `transactions` | Riwayat pembelian produk |
| `deposits` | Riwayat top up saldo |

## Environment Variables yang Dibutuhkan

| Variabel | Wajib | Fungsi |
|----------|-------|--------|
| `TELEGRAM_BOT_TOKEN` | ✅ | Token bot Telegram dari @BotFather |
| `QRIS_IMAGE_URL` | Optional | URL gambar QRIS statis |
| `QRIS_API_URL` | Optional | URL API untuk generate QRIS dinamis |
| `QRIS_API_TOKEN` | Optional | Token auth untuk QRIS API |
| `CREDIT_HOLDER_NAME` | Optional | Nama holder di tampilan balance (default: JOOEL X DRIPCLIENT) |
| `DATABASE_URL` | ✅ | Auto-set oleh Replit |

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
