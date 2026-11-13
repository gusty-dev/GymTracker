import os
from dotenv import load_dotenv
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import Application, CommandHandler, ContextTypes

load_dotenv()
BOT_TOKEN = os.getenv("BOT_TOKEN")
WEBAPP_URL = os.getenv("WEBAPP_URL")


async def start(update, context: ContextTypes.DEFAULT_TYPE):
    if not WEBAPP_URL:
        await update.message.reply_text("Mini App пока не настроен. Задайте WEBAPP_URL в .env.")
        return
    keyboard = [[InlineKeyboardButton("Открыть GymTracker", web_app=WebAppInfo(url=WEBAPP_URL))]]
    await update.message.reply_text(
        "Записывайте тренировки и следите за историей.",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


def main():
    if not BOT_TOKEN:
        raise SystemExit("Укажите BOT_TOKEN в .env")
    application = Application.builder().token(BOT_TOKEN).build()
    application.add_handler(CommandHandler("start", start))
    application.run_polling()


if __name__ == "__main__":
    main()
