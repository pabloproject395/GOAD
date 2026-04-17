# QRIS Telegram Bot System

## Overview
This is a complete QRIS Telegram Bot system designed to facilitate transactions using QRIS through Telegram.

## Features
- Telegram Bot artifact to interact with users
- QRIS services for processing transactions
- Database schema for storing transaction details
- Scheduled jobs for processing and sending notifications
- Admin dashboard to manage and monitor the bot
- Comprehensive environment configuration
- Detailed documentation for setup and usage

## Getting Started

### Prerequisites
- Go programming language installed
- Telegram Bot API token

### Installation
1. Clone the repository:
   ```
   git clone https://github.com/pabloproject395/GOAD.git
   ```
2. Navigate to the project directory:
   ```
   cd GOAD
   ```
3. Install dependencies:
   ```
   go mod tidy
   ```
4. Configure environment variables:
   - Create a `.env` file in the root directory
   - Add your Telegram API token and database connection details

### Running the Bot
1. Execute the bot:
   ```
   go run main.go
   ```

## Database Schema
```sql
CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255),
    amount DECIMAL(10, 2),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Scheduled Jobs
- Use a task scheduler or cron jobs to run periodic tasks such as sending reminders or checking transaction statuses.

## Admin Dashboard
- Access the admin dashboard via the specified route to manage bot settings.

## Documentation
Refer to the `docs` folder for detailed documentation on each component of the system.
