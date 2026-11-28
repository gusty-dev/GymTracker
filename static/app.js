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
let selectedPlanDay = (new Date().getDay() + 6) % 7;
let planPickerActive = false;
let planEditMode = false;
let onboardingComplete = true;
let profileEditMode = false;

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

function exerciseArtwork(exercise, muscles, mode = "card") {
  const images = exercise.images || {};
  const urls = (mode === "detail" ? [images.start, images.peak] : [images.peak || images.start]).filter(Boolean);
  if (!urls.length) {
    const fallback = document.createElement("span");
    fallback.className = "exercise-art-fallback";
    fallback.append(makeMuscleFigure(muscles));
    return fallback;
  }
  const wrapper = document.createElement("span");
  wrapper.className = mode === "detail" ? "exercise-art-pair" : "exercise-artwork";
  for (const [index, url] of urls.entries()) {
    const image = document.createElement("img");
    image.src = url;
    image.alt = `${exercise.name}: ${index === 0 ? "положение в движении" : "начало упражнения"}`;
    image.loading = "lazy";
    image.onerror = () => {
      const fallback = document.createElement("span");
      fallback.className = "exercise-art-fallback";
      fallback.append(makeMuscleFigure(muscles));
      image.replaceWith(fallback);
    };
    wrapper.append(image);
  }
  return wrapper;
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
  document.querySelector("#browser-title").textContent = planPickerActive ? "Каталог" : currentCategory.name;
  document.querySelector("#selected-exercise").hidden = true;
  const list = document.querySelector("#exercise-list");
  list.replaceChildren();
  for (const exercise of currentCategory.exercises) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "library-exercise";
    if (planPickerActive) button.classList.add("plan-picker-exercise");
    const muscles = exercise.custom ? musclesForCategory(currentCategory.id) : (exercise.muscles || []);
    const targets = muscles.map((muscle) => targetLabels[muscle]).filter(Boolean);
    const visual = document.createElement("span");
    visual.className = "library-exercise-visual";
    visual.append(exerciseArtwork(exercise, muscles));
    const copy = document.createElement("span");
    copy.className = "library-exercise-copy";
    const title = document.createElement("strong");
    title.textContent = exercise.name;
    copy.append(title);
    const muscleLabel = document.createElement("small");
    muscleLabel.className = "library-muscle-label";
    muscleLabel.textContent = planPickerActive ? currentCategory.name : (exercise.custom ? "Личное упражнение · мышцы группы" : "Задействованы мышцы");
    copy.append(muscleLabel);
    const tags = document.createElement("span");
    tags.className = "library-muscle-tags";
    for (const [index, target] of (planPickerActive ? [] : targets).entries()) {
      const tag = document.createElement("em");
      tag.textContent = target;
      if (index === 0) tag.classList.add("primary-muscle");
      tags.append(tag);
    }
    if (!planPickerActive && !targets.length) {
      const tag = document.createElement("em");
      tag.textContent = currentCategory.name.toLowerCase();
      tags.append(tag);
    }
    copy.append(tags);
    const arrow = document.createElement("b");
    const alreadyPlanned = weeklyPlan.some((item) => item.weekday === planTargetDay && item.category === currentCategory.id && item.name === exercise.name);
    arrow.textContent = planPickerActive ? (alreadyPlanned ? "✓" : "＋") : "›";
    if (planPickerActive) arrow.classList.add("plan-picker-plus");
    if (alreadyPlanned) button.classList.add("added-to-plan");
    button.append(visual, copy, arrow);
    button.addEventListener("click", () => planPickerActive ? addExerciseToPlan(exercise) : selectLibraryExercise(exercise));
    list.append(button);
  }
}

function selectLibraryExercise(exercise) {
  selectedExercise = exercise;
  const detail = document.querySelector("#selected-exercise");
  const muscles = exercise.custom ? musclesForCategory(currentCategory.id) : (exercise.muscles || []);
  document.querySelector("#selected-figure").replaceChildren(exerciseArtwork(exercise, muscles, "detail"));
  document.querySelector("#selected-exercise-name").textContent = exercise.name;
  document.querySelector("#selected-exercise-target").textContent = exercise.custom ? `Личное · ${currentCategory.name}` : muscles.map((muscle) => targetLabels[muscle]).filter(Boolean).join(", ");
  const daySelect = document.querySelector("#plan-target-day");
  daySelect.replaceChildren(...weekdays.map((day, index) => new Option(day, String(index))));
  daySelect.value = String(planTargetDay);
  detail.hidden = false;
  document.querySelector("#exercise-log-date").value = new Date().toLocaleDateString("en-CA");
  document.querySelector("#exercise-log-time").value = new Date().toTimeString().slice(0, 5);
  document.querySelector("#exercise-log-notes").value = "";
  document.querySelector("#exercise-log-superset").checked = false;
  document.querySelector("#exercise-log-error").textContent = "";
  const logSets = document.querySelector("#exercise-log-sets");
  logSets.replaceChildren();
  addSet(logSets);
  detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

document.querySelector("#close-exercise-detail").addEventListener("click", () => {
  document.querySelector("#selected-exercise").hidden = true;
});

document.querySelector("#exercise-log-add-set").addEventListener("click", () => addSet(document.querySelector("#exercise-log-sets")));

document.querySelector("#finish-exercise").addEventListener("click", async (event) => {
  if (!currentCategory || !selectedExercise) return;
  const button = event.currentTarget;
  const sets = [...document.querySelectorAll("#exercise-log-sets .set-row")].map((row) => ({
    reps: row.querySelector(".reps").value,
    weight: row.querySelector(".weight").value,
  }));
  const error = document.querySelector("#exercise-log-error");
  button.disabled = true;
  try {
    await api("/api/workouts", { method: "POST", body: JSON.stringify({
      date: document.querySelector("#exercise-log-date").value,
      time: document.querySelector("#exercise-log-time").value,
      exercises: [{
        name: selectedExercise.name,
        sets,
        notes: document.querySelector("#exercise-log-notes").value,
        is_superset: document.querySelector("#exercise-log-superset").checked,
      }],
    }) });
    document.querySelector("#selected-exercise").hidden = true;
    switchTab("history");
    await loadHistory();
    showSuccess(`${selectedExercise.name}: упражнение записано.`);
  } catch (requestError) {
    error.textContent = requestError.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#back-categories").addEventListener("click", () => {
  document.querySelector("#exercise-browser").hidden = true;
  document.querySelector("#category-grid").hidden = false;
  document.querySelector("#catalog-title").textContent = planPickerActive ? "Каталог" : "Категории";
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
  if (!onboardingComplete && tabName !== "profile") tabName = "profile";
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
  const days = document.querySelector("#plan-days");
  days.replaceChildren();
  const shortDays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  weekdays.forEach((day, index) => {
    const items = weeklyPlan.filter((item) => item.weekday === index);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `plan-day${selectedPlanDay === index ? " active" : ""}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(selectedPlanDay === index));
    button.innerHTML = `<strong>${shortDays[index]}</strong><span>${items.length}</span>`;
    button.addEventListener("click", () => { selectedPlanDay = index; renderWeeklyPlan(); });
    days.append(button);
  });
  const items = weeklyPlan.filter((item) => item.weekday === selectedPlanDay);
  document.querySelector("#plan-day-title").textContent = weekdays[selectedPlanDay];
  document.querySelector("#plan-day-count").textContent = items.length;
  const list = document.querySelector("#plan-exercises");
  list.replaceChildren();
  document.querySelector("#plan-empty").hidden = items.length > 0;
  list.hidden = items.length === 0;
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "planned-exercise";
    row.innerHTML = `<span>${escapeHtml(item.name)}</span><button type="button" aria-label="Убрать ${escapeHtml(item.name)} из плана" ${planEditMode ? "" : "hidden"}>×</button>`;
    row.querySelector("button").addEventListener("click", () => deletePlanExercise(item.id));
    list.append(row);
  }
  if (items.length) {
    const startButton = document.createElement("button");
    startButton.type = "button";
    startButton.className = "primary plan-start-workout";
    startButton.textContent = "Начать тренировку";
    startButton.addEventListener("click", () => openWorkoutForm({ weekday: selectedPlanDay, planned: items }));
    list.append(startButton);
  }
  document.querySelector("#plan-edit").textContent = planEditMode ? "Готово" : "Изменить　•••";
}

function openPlanCatalog() {
  planTargetDay = selectedPlanDay;
  planPickerActive = true;
  document.querySelector("#catalog-title").textContent = "Каталог";
  document.querySelector("#catalog-note").textContent = `Добавь упражнения на ${weekdays[selectedPlanDay].toLowerCase()}`;
  document.querySelector("#cancel-plan-picker").hidden = false;
  document.querySelector("#exercise-browser").hidden = true;
  document.querySelector("#category-grid").hidden = false;
  switchTab("exercises");
}

async function addExerciseToPlan(exercise) {
  if (weeklyPlan.some((item) => item.weekday === planTargetDay && item.category === currentCategory.id && item.name === exercise.name)) return;
  try {
    await api("/api/plan", { method: "POST", body: JSON.stringify({ weekday: planTargetDay, category: currentCategory.id, name: exercise.name }) });
    await loadWeeklyPlan();
    const button = [...document.querySelectorAll("#exercise-list .library-exercise")].find((item) => item.querySelector("strong")?.textContent === exercise.name);
    if (button) { button.classList.add("added-to-plan"); button.querySelector("b").textContent = "✓"; }
    showSuccess(`${exercise.name} добавлено на ${weekdays[planTargetDay].toLowerCase()}.`);
  } catch (error) { showError(error); }
}

document.querySelector("#plan-add").addEventListener("click", openPlanCatalog);
document.querySelector("#plan-add-empty").addEventListener("click", openPlanCatalog);
document.querySelector("#plan-edit").addEventListener("click", () => { planEditMode = !planEditMode; renderWeeklyPlan(); });
document.querySelector("#cancel-plan-picker").addEventListener("click", () => {
  planPickerActive = false;
  document.querySelector("#cancel-plan-picker").hidden = true;
  document.querySelector("#catalog-title").textContent = "Категории";
  document.querySelector("#catalog-note").textContent = "Выберите группу мышц";
  document.querySelector("#exercise-browser").hidden = true;
  document.querySelector("#category-grid").hidden = false;
  switchTab("workouts");
});

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
    const details = workout.exercises.map((exercise) => `<div class="history-exercise"><span>${escapeHtml(exercise.name)}${exercise.is_superset ? " · суперсет" : ""}</span><span>${exercise.sets.map((set) => `${set.reps} × ${set.weight} кг`).join(" · ")}</span>${exercise.notes ? `<small>${escapeHtml(exercise.notes)}</small>` : ""}</div>`).join("");
    return `<article class="workout-card"><div class="workout-date">${dateText}${workout.time ? ` · ${escapeHtml(workout.time)}` : ""}</div>${details}</article>`;
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
    const name = profile.name || [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Профиль Telegram";
    document.querySelector("#profile-name").textContent = name;
    document.querySelector("#profile-username").textContent = `${profile.age ? `Возраст ${profile.age}` : "Возраст не указан"}${profile.username ? ` · @${profile.username}` : ""}`;
    document.querySelector("#profile-avatar").textContent = (profile.first_name?.[0] || "G").toUpperCase();
    document.querySelector("#profile-display-name").value = profile.name || "";
    document.querySelector("#profile-gender").value = profile.gender || "";
    document.querySelector("#profile-age").value = profile.age ?? "";
    document.querySelector("#nutrition-activity").value = profile.activity_level ?? "";
    document.querySelector("#profile-weight").value = profile.weight_kg ?? "";
    document.querySelector("#profile-height").value = profile.height_cm ?? "";
    document.querySelector("#profile-target-weight").value = profile.target_weight_kg ?? "";
    document.querySelector("#overview-age").textContent = profile.age ? `${profile.age} лет` : "—";
    document.querySelector("#overview-height").textContent = profile.height_cm ? `${profile.height_cm} см` : "—";
    document.querySelector("#overview-gender").textContent = profile.gender === "male" ? "Мужской" : profile.gender === "female" ? "Женский" : "—";
    document.querySelector("#overview-weight").textContent = profile.weight_kg ? `${Number(profile.weight_kg).toFixed(1)} кг` : "—";
    document.querySelector("#overview-target").textContent = profile.target_weight_kg ? `${Number(profile.target_weight_kg).toFixed(1)} кг` : "—";
    const complete = Boolean(profile.gender && profile.name && profile.age && profile.weight_kg && profile.height_cm && profile.activity_level);
    if (!complete) {
      onboardingComplete = false;
      profileEditMode = true;
      document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.tab === "profile"));
      document.querySelectorAll(".tab-panel").forEach((panel) => { panel.hidden = panel.dataset.panel !== "profile"; panel.classList.toggle("active", panel.dataset.panel === "profile"); });
      document.querySelector("#profile-status").textContent = "Заполни данные и выбери уровень активности.";
    } else {
      onboardingComplete = true;
      profileEditMode = false;
    }
    setProfileMode(profileEditMode, complete);
    if (complete) await loadNutrition();
  } catch (error) { showError(error); }
}

function setProfileMode(editing, complete) {
  profileEditMode = editing;
  document.querySelector("#profile-form").hidden = !editing;
  document.querySelector("#profile-overview").hidden = editing || !complete;
  document.querySelector("#nutrition-panel").hidden = editing || !complete;
  document.querySelector("#edit-profile").hidden = !complete || editing;
  document.querySelector("#cancel-profile-edit").hidden = !complete || !editing;
}

document.querySelector("#edit-profile").addEventListener("click", () => setProfileMode(true, true));
document.querySelector("#cancel-profile-edit").addEventListener("click", () => loadProfile());

document.querySelector("#profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.querySelector("#profile-status");
  try {
    await api("/api/profile", { method: "PUT", body: JSON.stringify({
      name: document.querySelector("#profile-display-name").value,
      gender: document.querySelector("#profile-gender").value,
      age: document.querySelector("#profile-age").value,
      activity_level: document.querySelector("#nutrition-activity").value,
      weight_kg: document.querySelector("#profile-weight").value,
      height_cm: document.querySelector("#profile-height").value,
      target_weight_kg: document.querySelector("#profile-target-weight").value,
    }) });
    await loadProfile();
    message.textContent = "Профиль сохранён.";
  } catch (error) { message.textContent = error.message; }
});

async function loadNutrition() {
  const result = document.querySelector("#nutrition-result");
  try {
    const data = await api("/api/nutrition", { method: "POST", body: JSON.stringify({}) });
    const rows = [
      ["Белки", data.protein_g, data.protein_pct],
      ["Жиры", data.fat_g, data.fat_pct],
      ["Углеводы", data.carbs_g, data.carbs_pct],
    ];
    result.innerHTML = `<h3>План питания</h3><p class="nutrition-goal">${data.goal === "набор веса" ? "Для набора массы" : data.goal === "снижение веса" ? "Для снижения веса" : "Для поддержания веса"} на основе ваших данных.</p><strong class="nutrition-calories">${Number(data.calories).toLocaleString("ru-RU")} ккал</strong><div class="nutrition-macros">${rows.map(([label, grams, percent]) => `<div class="macro-row"><div class="macro-label"><span>${label}</span><span>${grams} г · ${percent}%</span></div><div class="macro-track"><i style="width:${percent}%"></i></div></div>`).join("")}</div>`;
  } catch (error) { result.innerHTML = `<p class="nutrition-error">${escapeHtml(error.message)}</p>`; }
}

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
  card.querySelector(".anatomy .body-map").replaceWith(makeMuscleFigure(muscles));
}

function renderWorkoutOptions(card, selectedName = "") {
  const category = selectedCategory(card);
  const select = card.querySelector(".exercise-name");
  select.replaceChildren(new Option("Выбери упражнение", ""));
  for (const exercise of category?.exercises || []) select.add(new Option(exercise.custom ? `${exercise.name} · личное` : exercise.name, exercise.name));
  select.value = category?.exercises.some((item) => item.name === selectedName) ? selectedName : "";
  updateWorkoutAnatomy(card);
}

function addExercise(categoryId = "", exerciseName = "") {
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
  categorySelect.value = exerciseCategories.some((item) => item.id === categoryId) ? categoryId : (exerciseCategories[0]?.id || "");
  renderWorkoutOptions(card, exerciseName);
  addSet(sets);
  exerciseList.append(card);
}

function dateForWeekday(weekday) {
  const date = new Date();
  const today = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() + (weekday - today + 7) % 7);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

async function openWorkoutForm({ weekday = null, planned = [] } = {}) {
  exerciseList.replaceChildren();
  document.querySelector("#workout-error").textContent = "";
  document.querySelector("#workout-date").value = weekday === null ? new Date().toLocaleDateString("en-CA") : dateForWeekday(weekday);
  if (!dialog.open) dialog.showModal();
  try {
    await loadExerciseCatalog();
    exerciseList.replaceChildren();
    if (planned.length) planned.forEach((item) => addExercise(item.category, item.name));
    else addExercise();
  } catch (error) { showError(error); }
}

document.querySelector("#open-form").addEventListener("click", () => openWorkoutForm());
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
  await loadProfile();
  try { await loadExerciseCatalog(); } catch (error) { showError(error); }
}

initialize();
