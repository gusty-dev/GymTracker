const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const statusEl = document.querySelector("#status");
const dialog = document.querySelector("#workout-dialog");
const exerciseList = document.querySelector("#exercises");
const initData = tg?.initData || "";
let exerciseCategories = JSON.parse(document.querySelector("#exercise-catalog").textContent);
let weeklyPlan = [];
let currentCategory = null;
let selectedExercise = null;
let planTargetDay = 0;

const weekdays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const targetLabels = { chest: "грудь", shoulders: "плечи", triceps: "трицепс", biceps: "бицепс", abs: "пресс", quads: "квадрицепсы", calves: "икры", upperback: "верх спины", lats: "широчайшие", glutes: "ягодицы", hamstrings: "бицепс бедра" };
const categoryMuscles = { chest: ["chest"], back: ["lats", "upperback"], shoulders: ["shoulders"], biceps: ["biceps"], triceps: ["triceps"], legs: ["quads", "hamstrings", "glutes", "calves"], abs: ["abs"] };

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": initData, ...options.headers },
  });
  let body = {};
  try { body = await response.json(); } catch { /* server may return an HTML error page */ }
  if (!response.ok) throw new Error(body.error || `Запрос не выполнен (${response.status}).`);
  return body;
}

function showError(error) {
  statusEl.textContent = error.message;
  statusEl.classList.remove("success");
  statusEl.classList.add("visible");
}

function showSuccess(message) {
  statusEl.textContent = message;
  statusEl.classList.add("visible", "success");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

async function loadExerciseCatalog() {
  const result = await api("/api/exercises");
  exerciseCategories = result.categories;
  renderCategories();
}

function musclesForCategory(category) {
  return categoryMuscles[category] || [];
}

function makeMuscleFigure(activeMuscles = []) {
  const figure = document.querySelector("#muscle-figure-template").content.cloneNode(true).firstElementChild;
  figure.querySelectorAll("[data-muscle]").forEach((part) => {
    part.classList.toggle("active", activeMuscles.includes(part.dataset.muscle));
  });
  return figure;
}

function renderCategories() {
  const grid = document.querySelector("#category-grid");
  grid.replaceChildren();
  for (const category of exerciseCategories) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "category-card";
    button.append(makeMuscleFigure(musclesForCategory(category.id)));
    const copy = document.createElement("span");
    copy.className = "category-copy";
    copy.innerHTML = `<strong>${escapeHtml(category.name)}</strong><small>${category.exercises.length} упражнений</small>`;
    button.append(copy);
    const arrow = document.createElement("span");
    arrow.className = "category-arrow";
    arrow.textContent = "›";
    button.append(arrow);
    button.addEventListener("click", () => openCategory(category.id));
    grid.append(button);
  }
}

function openCategory(categoryId) {
  currentCategory = exerciseCategories.find((category) => category.id === categoryId);
  if (!currentCategory) return;
  document.querySelector("#category-grid").hidden = true;
  document.querySelector("#exercise-browser").hidden = false;
  document.querySelector("#browser-title").textContent = currentCategory.name;
  document.querySelector("#selected-exercise").hidden = true;
  const list = document.querySelector("#exercise-list");
  list.replaceChildren();
  for (const exercise of currentCategory.exercises) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "library-exercise";
    const detail = exercise.muscles?.length ? exercise.muscles.map((muscle) => targetLabels[muscle]).filter(Boolean).join(", ") : currentCategory.name.toLowerCase();
    button.innerHTML = `<span><strong>${escapeHtml(exercise.name)}</strong><small>${exercise.custom ? "Личное упражнение" : `Основная нагрузка: ${escapeHtml(detail)}`}</small></span><b>›</b>`;
    button.addEventListener("click", () => selectLibraryExercise(exercise));
    list.append(button);
  }
}

function selectLibraryExercise(exercise) {
  selectedExercise = exercise;
  const detail = document.querySelector("#selected-exercise");
  const muscles = exercise.custom ? musclesForCategory(currentCategory.id) : (exercise.muscles || []);
  document.querySelector("#selected-figure").replaceChildren(makeMuscleFigure(muscles));
  document.querySelector("#selected-exercise-name").textContent = exercise.name;
  document.querySelector("#selected-exercise-target").textContent = exercise.custom ? `Личное · ${currentCategory.name}` : muscles.map((muscle) => targetLabels[muscle]).filter(Boolean).join(", ");
  const daySelect = document.querySelector("#plan-target-day");
  daySelect.replaceChildren(...weekdays.map((day, index) => new Option(day, String(index))));
  daySelect.value = String(planTargetDay);
  detail.hidden = false;
  detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

document.querySelector("#back-categories").addEventListener("click", () => {
  document.querySelector("#exercise-browser").hidden = true;
  document.querySelector("#category-grid").hidden = false;
});

document.querySelector("#library-add-custom").addEventListener("click", () => {
  const form = document.querySelector("#library-custom-form");
  form.hidden = false;
  document.querySelector("#library-custom-name").focus();
});
document.querySelector("#library-cancel-custom").addEventListener("click", () => {
  document.querySelector("#library-custom-form").hidden = true;
  document.querySelector("#library-custom-error").textContent = "";
});
document.querySelector("#library-save-custom").addEventListener("click", async () => {
  const name = document.querySelector("#library-custom-name").value.trim();
  const error = document.querySelector("#library-custom-error");
  if (!name) { error.textContent = "Введи название упражнения."; return; }
  try {
    await api("/api/exercises", { method: "POST", body: JSON.stringify({ name, category: currentCategory.id }) });
    await loadExerciseCatalog();
    openCategory(currentCategory.id);
    document.querySelector("#library-custom-name").value = "";
    document.querySelector("#library-custom-form").hidden = true;
    showSuccess("Личное упражнение добавлено в твою библиотеку.");
  } catch (requestError) { error.textContent = requestError.message; }
});

document.querySelector("#add-to-plan").addEventListener("click", async () => {
  if (!currentCategory || !selectedExercise) return;
  planTargetDay = Number(document.querySelector("#plan-target-day").value);
  try {
    await api("/api/plan", { method: "POST", body: JSON.stringify({ weekday: planTargetDay, category: currentCategory.id, name: selectedExercise.name }) });
    await loadWeeklyPlan();
    switchTab("workouts");
    showSuccess(`${selectedExercise.name} добавлено в план на ${weekdays[planTargetDay].toLowerCase()}.`);
  } catch (error) { showError(error); }
});

function switchTab(tabName) {
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.tab === tabName));
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    const active = panel.dataset.panel === tabName;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  statusEl.classList.remove("visible");
  if (tabName === "workouts") loadWeeklyPlan();
  if (tabName === "history") loadHistory();
  if (tabName === "stats") loadHistory();
  if (tabName === "profile") loadProfile();
}

document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));

async function loadWeeklyPlan() {
  try {
    const result = await api("/api/plan");
    weeklyPlan = result.plan;
    renderWeeklyPlan();
  } catch (error) { showError(error); }
}

function renderWeeklyPlan() {
  const grid = document.querySelector("#week-grid");
  grid.replaceChildren();
  weekdays.forEach((day, index) => {
    const card = document.createElement("article");
    card.className = "day-card";
    const items = weeklyPlan.filter((item) => item.weekday === index);
    card.innerHTML = `<div class="day-card-head"><div><span class="day-index">${String(index + 1).padStart(2, "0")}</span><h3>${day}</h3></div><span class="day-count">${items.length}</span></div>`;
    const list = document.createElement("div");
    list.className = "day-exercises";
    if (!items.length) list.innerHTML = '<p class="day-empty">Пока свободно</p>';
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "planned-exercise";
      row.innerHTML = `<span>${escapeHtml(item.name)}</span><button type="button" aria-label="Убрать ${escapeHtml(item.name)} из плана">×</button>`;
      row.querySelector("button").addEventListener("click", () => deletePlanExercise(item.id));
      list.append(row);
    }
    card.append(list);
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "add-day-exercise";
    addButton.textContent = "＋ Добавить упражнение";
    addButton.addEventListener("click", () => {
      planTargetDay = index;
      document.querySelector("#exercise-browser").hidden = true;
      document.querySelector("#category-grid").hidden = false;
      switchTab("exercises");
      showSuccess(`Выбери группу и упражнение для ${day.toLowerCase()}.`);
    });
    card.append(addButton);
    grid.append(card);
  });
}

async function deletePlanExercise(planId) {
  try { await api(`/api/plan/${planId}`, { method: "DELETE" }); await loadWeeklyPlan(); }
  catch (error) { showError(error); }
}

async function loadHistory() {
  try {
    const workouts = await api("/api/workouts");
    renderHistory(workouts);
    renderStatistics(workouts);
  } catch (error) { showError(error); }
}

function renderHistory(workouts) {
  document.querySelector("#count").textContent = workouts.length;
  const historyEl = document.querySelector("#history");
  if (!workouts.length) {
    historyEl.innerHTML = '<div class="empty"><span>✳</span><strong>Пока нет тренировок</strong><p>Запиши первую тренировку — история начнётся здесь.</p></div>';
    return;
  }
  historyEl.innerHTML = workouts.map((workout) => {
    const dateText = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${workout.date}T12:00:00`));
    const details = workout.exercises.map((exercise) => `<div class="history-exercise"><span>${escapeHtml(exercise.name)}</span><span>${exercise.sets.map((set) => `${set.reps} × ${set.weight} кг`).join(" · ")}</span></div>`).join("");
    return `<article class="workout-card"><div class="workout-date">${dateText}</div>${details}</article>`;
  }).join("");
}

function renderStatistics(workouts) {
  const totalSets = workouts.reduce((sum, workout) => sum + workout.exercises.reduce((inner, exercise) => inner + exercise.sets.length, 0), 0);
  const volume = workouts.reduce((sum, workout) => sum + workout.exercises.reduce((inner, exercise) => inner + exercise.sets.reduce((setSum, set) => setSum + Number(set.reps) * Number(set.weight), 0), 0), 0);
  document.querySelector("#stats-summary").innerHTML = [
    [workouts.length, "тренировок"], [totalSets, "подходов"], [`${Math.round(volume).toLocaleString("ru-RU")} кг`, "общий объём"],
  ].map(([value, label]) => `<article class="stat-card"><strong>${value}</strong><span>${label}</span></article>`).join("");
  const activity = document.querySelector("#weekly-activity");
  const today = new Date();
  const points = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - offset));
    const key = date.toLocaleDateString("en-CA");
    const count = workouts.filter((workout) => workout.date === key).length;
    return { day: new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(date), count };
  });
  const max = Math.max(1, ...points.map((point) => point.count));
  activity.innerHTML = points.map((point) => `<div class="activity-day"><span class="activity-bar-wrap"><i style="height:${Math.max(point.count ? 18 : 5, point.count / max * 100)}%"></i></span><small>${point.day}</small></div>`).join("");
  const lastWorkout = workouts[0];
  document.querySelector("#last-workout-stats").textContent = lastWorkout ? `${lastWorkout.date}: ${lastWorkout.exercises.length} упражнений` : "Добавь тренировку, чтобы увидеть статистику.";
}

async function loadProfile() {
  try {
    const profile = await api("/api/profile");
    const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Профиль Telegram";
    document.querySelector("#profile-name").textContent = name;
    document.querySelector("#profile-username").textContent = profile.username ? `@${profile.username}` : "Личные данные видны только тебе";
    document.querySelector("#profile-avatar").textContent = (profile.first_name?.[0] || "G").toUpperCase();
    document.querySelector("#profile-weight").value = profile.weight_kg ?? "";
    document.querySelector("#profile-height").value = profile.height_cm ?? "";
    document.querySelector("#profile-goal").value = profile.goal || "";
  } catch (error) { showError(error); }
}

document.querySelector("#profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.querySelector("#profile-status");
  try {
    await api("/api/profile", { method: "PUT", body: JSON.stringify({
      weight_kg: document.querySelector("#profile-weight").value,
      height_cm: document.querySelector("#profile-height").value,
      goal: document.querySelector("#profile-goal").value,
    }) });
    message.textContent = "Профиль сохранён.";
  } catch (error) { message.textContent = error.message; }
});

function addSet(container, reps = "", weight = "") {
  const row = document.createElement("div");
  row.className = "set-row";
  row.innerHTML = `<span class="set-number"></span><input class="reps" type="number" min="1" max="1000" placeholder="8" aria-label="Повторы" required value="${reps}"><input class="weight" type="number" min="0" max="10000" step="0.5" placeholder="40" aria-label="Вес в килограммах" required value="${weight}"><button type="button" class="remove-set" aria-label="Удалить подход">×</button>`;
  row.querySelector(".remove-set").addEventListener("click", () => { row.remove(); renumberSets(container); });
  container.append(row);
  renumberSets(container);
}

function renumberSets(container) {
  [...container.children].forEach((row, index) => { row.querySelector(".set-number").textContent = index + 1; });
}

function selectedCategory(card) {
  return exerciseCategories.find((category) => category.id === card.querySelector(".exercise-category").value);
}

function updateWorkoutAnatomy(card) {
  const category = selectedCategory(card);
  const exercise = category?.exercises.find((item) => item.name === card.querySelector(".exercise-name").value);
  const muscles = exercise?.custom ? musclesForCategory(category.id) : (exercise?.muscles || []);
  card.querySelector(".anatomy-title").textContent = exercise?.name || "Выбери упражнение";
  const targets = muscles.map((muscle) => targetLabels[muscle]).filter(Boolean);
  card.querySelector(".anatomy-hint").textContent = exercise ? `${exercise.custom ? "Личное · " : "Основная нагрузка: "}${targets.join(", ")}` : "Выбери упражнение из списка";
  card.querySelectorAll("[data-muscle]").forEach((part) => part.classList.toggle("active", muscles.includes(part.dataset.muscle)));
}

function renderWorkoutOptions(card, selectedName = "") {
  const category = selectedCategory(card);
  const select = card.querySelector(".exercise-name");
  select.replaceChildren(new Option("Выбери упражнение", ""));
  for (const exercise of category?.exercises || []) select.add(new Option(exercise.custom ? `${exercise.name} · личное` : exercise.name, exercise.name));
  select.value = category?.exercises.some((item) => item.name === selectedName) ? selectedName : "";
  updateWorkoutAnatomy(card);
}

function addExercise() {
  const element = document.querySelector("#exercise-template").content.cloneNode(true);
  const card = element.querySelector(".exercise-card");
  const sets = card.querySelector(".sets");
  const categorySelect = card.querySelector(".exercise-category");
  for (const category of exerciseCategories) categorySelect.add(new Option(category.name, category.id));
  categorySelect.addEventListener("change", () => renderWorkoutOptions(card));
  card.querySelector(".exercise-name").addEventListener("change", () => updateWorkoutAnatomy(card));
  card.querySelector(".add-set").addEventListener("click", () => addSet(sets));
  card.querySelector(".remove-exercise").addEventListener("click", () => card.remove());
  const customForm = card.querySelector(".custom-exercise-form");
  card.querySelector(".add-custom-exercise").addEventListener("click", () => { customForm.hidden = false; card.querySelector(".custom-exercise-name").focus(); });
  card.querySelector(".cancel-custom-exercise").addEventListener("click", () => { customForm.hidden = true; card.querySelector(".custom-exercise-error").textContent = ""; });
  card.querySelector(".save-custom-exercise").addEventListener("click", async () => {
    const name = card.querySelector(".custom-exercise-name").value.trim();
    const error = card.querySelector(".custom-exercise-error");
    if (!name) { error.textContent = "Введи название упражнения."; return; }
    try {
      await api("/api/exercises", { method: "POST", body: JSON.stringify({ name, category: categorySelect.value }) });
      await loadExerciseCatalog();
      categorySelect.value = categorySelect.value;
      renderWorkoutOptions(card, name);
      card.querySelector(".custom-exercise-name").value = "";
      customForm.hidden = true;
    } catch (requestError) { error.textContent = requestError.message; }
  });
  categorySelect.value = exerciseCategories[0]?.id || "";
  renderWorkoutOptions(card);
  addSet(sets);
  exerciseList.append(card);
}

document.querySelector("#open-form").addEventListener("click", async () => {
  exerciseList.replaceChildren();
  document.querySelector("#workout-error").textContent = "";
  addExercise();
  document.querySelector("#workout-date").value = new Date().toLocaleDateString("en-CA");
  if (!dialog.open) dialog.showModal();
  try { await loadExerciseCatalog(); exerciseList.replaceChildren(); addExercise(); }
  catch (error) { showError(error); }
});
document.querySelector("#close-form").addEventListener("click", () => dialog.close());
document.querySelector("#add-exercise").addEventListener("click", () => addExercise());

document.querySelector("#workout-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('[type="submit"]');
  const exercises = [...exerciseList.querySelectorAll(".exercise-card")].map((card) => ({
    name: card.querySelector(".exercise-name").value.trim(),
    sets: [...card.querySelectorAll(".set-row")].map((row) => ({ reps: row.querySelector(".reps").value, weight: row.querySelector(".weight").value })),
  }));
  submit.disabled = true;
  try {
    await api("/api/workouts", { method: "POST", body: JSON.stringify({ date: document.querySelector("#workout-date").value, exercises }) });
    document.querySelector("#workout-error").textContent = "";
    dialog.close();
    switchTab("history");
    await loadHistory();
    showSuccess("Тренировка сохранена.");
  } catch (error) { document.querySelector("#workout-error").textContent = error.message; }
  finally { submit.disabled = false; }
});

async function initialize() {
  renderCategories();
  const date = new Date();
  planTargetDay = (date.getDay() + 6) % 7;
  try { await loadExerciseCatalog(); } catch (error) { showError(error); }
}

initialize();
