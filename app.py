import hashlib
import hmac
import json
import math
import os
import sqlite3
import time
from datetime import date
from pathlib import Path
from urllib.parse import parse_qsl

from dotenv import load_dotenv
from flask import Flask, g, jsonify, render_template, request

load_dotenv()
BASE_DIR = Path(__file__).resolve().parent
DATABASE = Path(os.getenv("DATABASE_PATH", BASE_DIR / "gymtracker.db"))
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
MAX_INIT_DATA_AGE = int(os.getenv("MAX_INIT_DATA_AGE", "86400"))
app = Flask(__name__)


def get_db():
    if "db" not in g:
        DATABASE.parent.mkdir(parents=True, exist_ok=True)
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = get_db()
    db.executescript("""
        CREATE TABLE IF NOT EXISTS workouts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            workout_date TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS workouts_user_date ON workouts(user_id, workout_date DESC);
        CREATE TABLE IF NOT EXISTS exercises (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            position INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
            reps INTEGER NOT NULL,
            weight REAL NOT NULL,
            position INTEGER NOT NULL
        );
    """)
    db.commit()


@app.before_request
def ensure_database():
    init_db()


def authenticated_user():
    """Validate Telegram's raw initData using the Bot API HMAC scheme."""
    if not BOT_TOKEN:
        return None, ("Server authentication is not configured", 503)
    raw = request.headers.get("X-Telegram-Init-Data", "")
    if not raw or len(raw) > 16_384:
        return None, ("Telegram authentication required", 401)
    try:
        pairs = parse_qsl(raw, keep_blank_values=True, strict_parsing=True)
        data = dict(pairs)
        if len(data) != len(pairs) or "hash" not in data:
            raise ValueError("invalid fields")
        received_hash = data.pop("hash")
        data.pop("signature", None)
        check_string = "\n".join(f"{key}={value}" for key, value in sorted(data.items()))
        secret_key = hmac.new(BOT_TOKEN.encode(), b"WebAppData", hashlib.sha256).digest()
        expected_hash = hmac.new(secret_key, check_string.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected_hash, received_hash):
            raise ValueError("invalid signature")
        auth_date = int(data["auth_date"])
        now = int(time.time())
        if auth_date > now + 60 or now - auth_date > MAX_INIT_DATA_AGE:
            raise ValueError("expired authentication")
        user = json.loads(data["user"])
        user_id = user.get("id")
        if not isinstance(user_id, (int, str)) or not str(user_id).isdigit():
            raise ValueError("invalid user")
        return str(user_id), None
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        return None, ("Invalid or expired Telegram authentication", 401)


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/workouts")
def list_workouts():
    user_id, error = authenticated_user()
    if error:
        return jsonify(error=error[0]), error[1]
    rows = get_db().execute("""
        SELECT id, workout_date FROM workouts WHERE user_id = ?
        ORDER BY workout_date DESC, id DESC
    """, (user_id,)).fetchall()
    workouts = []
    for row in rows:
        exercises = get_db().execute(
            "SELECT id, name FROM exercises WHERE workout_id = ? ORDER BY position", (row["id"],)
        ).fetchall()
        items = []
        for exercise in exercises:
            sets = get_db().execute(
                "SELECT reps, weight FROM sets WHERE exercise_id = ? ORDER BY position", (exercise["id"],)
            ).fetchall()
            items.append({"name": exercise["name"], "sets": [dict(s) for s in sets]})
        workouts.append({"id": row["id"], "date": row["workout_date"], "exercises": items})
    return jsonify(workouts)


@app.post("/api/workouts")
def create_workout():
    user_id, error = authenticated_user()
    if error:
        return jsonify(error=error[0]), error[1]
    payload = request.get_json(silent=True) or {}
    workout_date = payload.get("date")
    exercises = payload.get("exercises")
    try:
        date.fromisoformat(workout_date)
    except (TypeError, ValueError):
        return jsonify(error="Укажите корректную дату."), 400
    if not isinstance(exercises, list) or not exercises:
        return jsonify(error="Добавьте хотя бы одно упражнение."), 400
    if len(exercises) > 30:
        return jsonify(error="Слишком много упражнений."), 400
    normalized = []
    try:
        for exercise in exercises:
            name = str(exercise.get("name", "")).strip()
            sets = exercise.get("sets")
            if not name or len(name) > 100 or not isinstance(sets, list) or not sets or len(sets) > 50:
                raise ValueError
            clean_sets = []
            for item in sets:
                reps, weight = int(item["reps"]), float(item["weight"])
                if reps < 1 or reps > 1000 or not math.isfinite(weight) or weight < 0 or weight > 10000:
                    raise ValueError
                clean_sets.append((reps, weight))
            normalized.append((name, clean_sets))
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
        return jsonify(error="Проверьте упражнения, повторы и вес."), 400

    db = get_db()
    cursor = db.execute("INSERT INTO workouts(user_id, workout_date) VALUES (?, ?)", (user_id, workout_date))
    workout_id = cursor.lastrowid
    for exercise_index, (name, sets) in enumerate(normalized):
        exercise_id = db.execute(
            "INSERT INTO exercises(workout_id, name, position) VALUES (?, ?, ?)",
            (workout_id, name, exercise_index),
        ).lastrowid
        db.executemany(
            "INSERT INTO sets(exercise_id, reps, weight, position) VALUES (?, ?, ?, ?)",
            [(exercise_id, reps, weight, index) for index, (reps, weight) in enumerate(sets)],
        )
    db.commit()
    return jsonify(id=workout_id), 201


if __name__ == "__main__":
    app.run(host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8000")), debug=False)
