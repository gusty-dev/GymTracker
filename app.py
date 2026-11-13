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
BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
MAX_INIT_DATA_AGE = int(os.getenv("MAX_INIT_DATA_AGE", "86400"))
app = Flask(__name__)

EXERCISE_CATEGORIES = [
    {"id": "chest", "name": "Грудь", "exercises": [
        ("Жим лёжа", ["chest", "triceps", "shoulders"]),
        ("Жим гантелей лёжа", ["chest", "triceps", "shoulders"]),
        ("Жим на наклонной скамье", ["chest", "shoulders", "triceps"]),
        ("Отжимания", ["chest", "triceps", "shoulders"]),
        ("Сведения в кроссовере", ["chest"]),
    ]},
    {"id": "back", "name": "Спина", "exercises": [
        ("Подтягивания", ["lats", "upperback", "biceps"]),
        ("Тяга верхнего блока", ["lats", "biceps"]),
        ("Тяга штанги в наклоне", ["upperback", "lats", "biceps"]),
        ("Горизонтальная тяга блока", ["lats", "upperback", "biceps"]),
        ("Становая тяга", ["hamstrings", "glutes", "upperback", "lats"]),
    ]},
    {"id": "shoulders", "name": "Плечи", "exercises": [
        ("Жим над головой", ["shoulders", "triceps"]),
        ("Разведения гантелей в стороны", ["shoulders"]),
        ("Разведения гантелей в наклоне", ["upperback", "shoulders"]),
        ("Тяга к подбородку", ["shoulders", "biceps"]),
        ("Шраги", ["upperback"]),
    ]},
    {"id": "biceps", "name": "Бицепс", "exercises": [
        ("Сгибание рук со штангой", ["biceps"]),
        ("Сгибание гантелей молотком", ["biceps"]),
        ("Сгибание гантелей сидя", ["biceps"]),
    ]},
    {"id": "triceps", "name": "Трицепс", "exercises": [
        ("Разгибание рук на блоке", ["triceps"]),
        ("Французский жим", ["triceps"]),
        ("Разгибание гантели над головой", ["triceps"]),
        ("Отжимания на брусьях", ["triceps", "chest", "shoulders"]),
    ]},
    {"id": "legs", "name": "Ноги и ягодицы", "exercises": [
        ("Приседания со штангой", ["quads", "glutes"]),
        ("Жим ногами", ["quads", "glutes"]),
        ("Выпады", ["quads", "glutes"]),
        ("Румынская тяга", ["hamstrings", "glutes"]),
        ("Сгибание ног в тренажёре", ["hamstrings"]),
        ("Разгибание ног в тренажёре", ["quads"]),
        ("Ягодичный мостик", ["glutes", "hamstrings"]),
        ("Подъём на носки", ["calves"]),
    ]},
    {"id": "abs", "name": "Пресс", "exercises": [
        ("Планка", ["abs"]),
        ("Скручивания", ["abs"]),
        ("Подъём ног", ["abs"]),
    ]},
]


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
        CREATE TABLE IF NOT EXISTS custom_exercises (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            category TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, category, name)
        );
        CREATE INDEX IF NOT EXISTS custom_exercises_user_category
            ON custom_exercises(user_id, category);
        CREATE TABLE IF NOT EXISTS planned_exercises (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
            category TEXT NOT NULL,
            name TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            UNIQUE(user_id, weekday, category, name)
        );
        CREATE INDEX IF NOT EXISTS planned_exercises_user_day
            ON planned_exercises(user_id, weekday, position);
        CREATE TABLE IF NOT EXISTS profiles (
            user_id TEXT PRIMARY KEY,
            weight_kg REAL,
            height_cm REAL,
            goal TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    """)
    db.commit()


@app.before_request
def ensure_database():
    init_db()


def authenticated_user():
    """Validate Telegram's raw initData using the Bot API HMAC scheme."""
    if not BOT_TOKEN:
        app.logger.error("Telegram auth rejected: server_bot_token_missing")
        return None, ("Server authentication is not configured", 503)
    raw = request.headers.get("X-Telegram-Init-Data", "")
    if not raw or len(raw) > 16_384:
        app.logger.warning("Telegram auth rejected: init_data_missing_or_too_large")
        return None, ("Открой GymTracker кнопкой внутри Telegram.", 401)
    try:
        pairs = parse_qsl(raw, keep_blank_values=True, strict_parsing=True)
        data = dict(pairs)
        if len(data) != len(pairs) or "hash" not in data:
            app.logger.warning("Telegram auth rejected: malformed_init_data")
            return None, ("Telegram прислал некорректные данные. Закрой Mini App и открой её заново из бота.", 401)
        received_hash = data.pop("hash")
        # Keep `signature` here: Telegram's HMAC check string excludes only `hash`.
        check_string = "\n".join(f"{key}={value}" for key, value in sorted(data.items()))
        secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest() 
        expected_hash = hmac.new(secret_key, check_string.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected_hash, received_hash):
            app.logger.warning("Telegram auth rejected: hmac_hash_mismatch")
            return None, ("Подпись данных Telegram не совпала. Проверь, что на Render развернута последняя версия app.py и указан токен этого бота.", 401)
        auth_date = int(data["auth_date"])
        now = int(time.time())
        if auth_date > now + 60:
            app.logger.warning("Telegram auth rejected: auth_date_in_future")
            return None, ("Время авторизации Telegram некорректно. Перезапусти Mini App.", 401)
        if now - auth_date > MAX_INIT_DATA_AGE:
            app.logger.warning("Telegram auth rejected: auth_data_expired")
            return None, ("Данные авторизации устарели. Закрой Mini App и снова открой её через бота.", 401)
        user = json.loads(data["user"])
        user_id = user.get("id")
        if not isinstance(user_id, (int, str)) or not str(user_id).isdigit():
            app.logger.warning("Telegram auth rejected: invalid_user_field")
            return None, ("Telegram не передал данные пользователя. Открой Mini App через бота.", 401)
        g.telegram_user = user
        return str(user_id), None
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        app.logger.warning("Telegram auth rejected: malformed_or_incomplete_init_data")
        return None, ("Invalid or expired Telegram authentication", 401)


@app.get("/")
def index():
    catalog = [
        {
            "id": category["id"],
            "name": category["name"],
            "exercises": [
                {"name": name, "muscles": muscles, "custom": False}
                for name, muscles in category["exercises"]
            ],
        }
        for category in EXERCISE_CATEGORIES
    ]
    return render_template("index.html", exercise_catalog=catalog)


@app.get("/api/exercises")
def list_exercises():
    user_id, error = authenticated_user()
    if error:
        return jsonify(error=error[0]), error[1]
    custom_rows = get_db().execute(
        "SELECT category, name FROM custom_exercises WHERE user_id = ? ORDER BY name COLLATE NOCASE",
        (user_id,),
    ).fetchall()
    custom_by_category = {}
    for row in custom_rows:
        custom_by_category.setdefault(row["category"], []).append(row["name"])
    categories = []
    for category in EXERCISE_CATEGORIES:
        items = [
            {"name": name, "muscles": muscles, "custom": False}
            for name, muscles in category["exercises"]
        ]
        items.extend(
            {"name": name, "muscles": [], "custom": True}
            for name in custom_by_category.get(category["id"], [])
        )
        categories.append({"id": category["id"], "name": category["name"], "exercises": items})
    return jsonify(categories=categories)


@app.post("/api/exercises")
def create_custom_exercise():
    user_id, error = authenticated_user()
    if error:
        return jsonify(error=error[0]), error[1]
    payload = request.get_json(silent=True) or {}
    category = str(payload.get("category", ""))
    name = str(payload.get("name", "")).strip()
    allowed_categories = {item["id"] for item in EXERCISE_CATEGORIES}
    if category not in allowed_categories or not name or len(name) > 100:
        return jsonify(error="Укажите категорию и название до 100 символов."), 400
    category_data = next(item for item in EXERCISE_CATEGORIES if item["id"] == category)
    if any(name.casefold() == builtin_name.casefold() for builtin_name, _ in category_data["exercises"]):
        return jsonify(error="Это упражнение уже есть в базовом списке."), 409
    try:
        get_db().execute(
            "INSERT INTO custom_exercises(user_id, category, name) VALUES (?, ?, ?)",
            (user_id, category, name),
        )
        get_db().commit()
    except sqlite3.IntegrityError:
        return jsonify(error="Такое личное упражнение уже добавлено."), 409
    return jsonify(name=name, category=category, custom=True), 201


def exercise_exists_for_user(user_id, category_id, name):
    category = next((item for item in EXERCISE_CATEGORIES if item["id"] == category_id), None)
    if not category:
        return False
    if any(name == builtin_name for builtin_name, _ in category["exercises"]):
        return True
    return get_db().execute(
        "SELECT 1 FROM custom_exercises WHERE user_id = ? AND category = ? AND name = ?",
        (user_id, category_id, name),
    ).fetchone() is not None


@app.get("/api/plan")
def list_weekly_plan():
    user_id, error = authenticated_user()
    if error:
        return jsonify(error=error[0]), error[1]
    rows = get_db().execute(
        "SELECT id, weekday, category, name FROM planned_exercises WHERE user_id = ? ORDER BY weekday, position, id",
        (user_id,),
    ).fetchall()
    return jsonify(plan=[dict(row) for row in rows])


@app.post("/api/plan")
def add_weekly_plan_exercise():
    user_id, error = authenticated_user()
    if error:
        return jsonify(error=error[0]), error[1]
    payload = request.get_json(silent=True) or {}
    try:
        weekday = int(payload.get("weekday"))
    except (TypeError, ValueError):
        return jsonify(error="Выбери день недели."), 400
    category = str(payload.get("category", ""))
    name = str(payload.get("name", "")).strip()
    if weekday not in range(7) or len(name) > 100 or not name or not exercise_exists_for_user(user_id, category, name):
        return jsonify(error="Выбери упражнение из каталога."), 400
    try:
        cursor = get_db().execute(
            "INSERT INTO planned_exercises(user_id, weekday, category, name) VALUES (?, ?, ?, ?)",
            (user_id, weekday, category, name),
        )
        get_db().commit()
    except sqlite3.IntegrityError:
        return jsonify(error="Это упражнение уже добавлено на этот день."), 409
    return jsonify(id=cursor.lastrowid, weekday=weekday, category=category, name=name), 201


@app.delete("/api/plan/<int:plan_id>")
def remove_weekly_plan_exercise(plan_id):
    user_id, error = authenticated_user()
    if error:
        return jsonify(error=error[0]), error[1]
    cursor = get_db().execute(
        "DELETE FROM planned_exercises WHERE id = ? AND user_id = ?",
        (plan_id, user_id),
    )
    get_db().commit()
    if not cursor.rowcount:
        return jsonify(error="Упражнение не найдено."), 404
    return jsonify(ok=True)


@app.get("/api/profile")
def get_profile():
    user_id, error = authenticated_user()
    if error:
        return jsonify(error=error[0]), error[1]
    row = get_db().execute(
        "SELECT weight_kg, height_cm, goal FROM profiles WHERE user_id = ?", (user_id,)
    ).fetchone()
    telegram_user = getattr(g, "telegram_user", {})
    return jsonify({
        "first_name": telegram_user.get("first_name", ""),
        "last_name": telegram_user.get("last_name", ""),
        "username": telegram_user.get("username", ""),
        "weight_kg": row["weight_kg"] if row else None,
        "height_cm": row["height_cm"] if row else None,
        "goal": row["goal"] if row else "",
    })


@app.put("/api/profile")
def update_profile():
    user_id, error = authenticated_user()
    if error:
        return jsonify(error=error[0]), error[1]
    payload = request.get_json(silent=True) or {}
    try:
        weight = float(payload["weight_kg"]) if payload.get("weight_kg") not in (None, "") else None
        height = float(payload["height_cm"]) if payload.get("height_cm") not in (None, "") else None
        goal = str(payload.get("goal", "")).strip()[:200]
        if weight is not None and (not math.isfinite(weight) or not 20 <= weight <= 500):
            raise ValueError
        if height is not None and (not math.isfinite(height) or not 80 <= height <= 250):
            raise ValueError
    except (ValueError, TypeError, OverflowError):
        return jsonify(error="Проверь вес и рост."), 400
    get_db().execute("""
        INSERT INTO profiles(user_id, weight_kg, height_cm, goal, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
            weight_kg = excluded.weight_kg,
            height_cm = excluded.height_cm,
            goal = excluded.goal,
            updated_at = CURRENT_TIMESTAMP
    """, (user_id, weight, height, goal))
    get_db().commit()
    return jsonify(ok=True)


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
