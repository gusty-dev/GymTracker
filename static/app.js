const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const historyEl = document.querySelector("#history");
const statusEl = document.querySelector("#status");
const dialog = document.querySelector("#workout-dialog");
const exerciseList = document.querySelector("#exercises");
const initData = tg?.initData || "";
let exerciseCategories = [];

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": initData, ...options.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Не удалось выполнить запрос.");
  return body;
}

function showError(error) {
  statusEl.textContent = error.message;
  statusEl.classList.add("visible");
}

async function loadHistory() {
  try {
    const workouts = await api("/api/workouts");
    document.querySelector("#count").textContent = workouts.length;
    if (!workouts.length) {
      historyEl.innerHTML = '<div class="empty"><span>✳</span><strong>Пока нет тренировок</strong><p>Добавь первую — история начнётся здесь.</p></div>';
      return;
    }
    historyEl.innerHTML = workouts.map((workout) => {
      const dateText = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${workout.date}T12:00:00`));
      const details = workout.exercises.map((exercise) => `<div class="history-exercise"><span>${escapeHtml(exercise.name)}</span><span>${exercise.sets.map((s) => `${s.reps} × ${s.weight} кг`).join(" · ")}</span></div>`).join("");
      return `<article class="workout-card"><div class="workout-date">${dateText}</div>${details}</article>`;
    }).join("");
  } catch (error) { showError(error); }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
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
  [...container.children].forEach((row, index) => row.querySelector(".set-number").textContent = index + 1);
}

async function loadExerciseCatalog() {
  const result = await api("/api/exercises");
  exerciseCategories = result.categories;
}

function selectedCategory(card) {
  return exerciseCategories.find((category) => category.id === card.querySelector(".exercise-category").value);
}

function updateAnatomy(card) {
  const category = selectedCategory(card);
  const exercise = category?.exercises.find((item) => item.name === card.querySelector(".exercise-name").value);
  card.querySelector(".anatomy-title").textContent = exercise?.name || "Выбери упражнение";
  const targetLabels = { chest: "грудь", shoulders: "плечи", triceps: "трицепс", biceps: "бицепс", abs: "пресс", quads: "квадрицепсы", calves: "икры", upperback: "верх спины", lats: "широчайшие", glutes: "ягодицы", hamstrings: "бицепс бедра" };
  const categoryMuscles = { chest: ["chest"], back: ["lats", "upperback"], shoulders: ["shoulders"], biceps: ["biceps"], triceps: ["triceps"], legs: ["quads", "hamstrings", "glutes", "calves"], abs: ["abs"] };
  const activeMuscles = exercise?.custom ? categoryMuscles[category.id] : exercise?.muscles;
  const targets = activeMuscles?.map((muscle) => targetLabels[muscle]).filter(Boolean) || [];
  card.querySelector(".anatomy-hint").textContent = !exercise ? "Выбери упражнение из списка" : exercise.custom ? `Личное · ${targets.join(", ")}` : `Основная нагрузка: ${targets.join(", ") || category.name.toLowerCase()}`;
  card.querySelectorAll("[data-muscle]").forEach((muscle) => muscle.classList.toggle("active", Boolean(activeMuscles?.includes(muscle.dataset.muscle))));
}

function renderExerciseOptions(card, selectedName = "") {
  const category = selectedCategory(card);
  const select = card.querySelector(".exercise-name");
  select.replaceChildren(new Option("Выбери упражнение", ""));
  for (const exercise of category?.exercises || []) {
    select.add(new Option(exercise.custom ? `${exercise.name} · личное` : exercise.name, exercise.name));
  }
  select.value = category?.exercises.some((item) => item.name === selectedName) ? selectedName : (category?.exercises[0]?.name || "");
  updateAnatomy(card);
}

function addExercise() {
  const element = document.querySelector("#exercise-template").content.cloneNode(true);
  const card = element.querySelector(".exercise-card");
  const sets = card.querySelector(".sets");
  const categorySelect = card.querySelector(".exercise-category");
  for (const category of exerciseCategories) categorySelect.add(new Option(category.name, category.id));
  categorySelect.addEventListener("change", () => renderExerciseOptions(card));
  card.querySelector(".exercise-name").addEventListener("change", () => updateAnatomy(card));
  card.querySelector(".add-set").addEventListener("click", () => addSet(sets));
  card.querySelector(".remove-exercise").addEventListener("click", () => card.remove());
  const customForm = card.querySelector(".custom-exercise-form");
  card.querySelector(".add-custom-exercise").addEventListener("click", () => {
    customForm.hidden = false;
    card.querySelector(".custom-exercise-name").focus();
  });
  card.querySelector(".cancel-custom-exercise").addEventListener("click", () => {
    customForm.hidden = true;
    card.querySelector(".custom-exercise-error").textContent = "";
  });
  card.querySelector(".save-custom-exercise").addEventListener("click", async () => {
    const name = card.querySelector(".custom-exercise-name").value.trim();
    const error = card.querySelector(".custom-exercise-error");
    if (!name) { error.textContent = "Введи название упражнения."; return; }
    try {
      const categoryId = categorySelect.value;
      await api("/api/exercises", { method: "POST", body: JSON.stringify({ name, category: categoryId }) });
      await loadExerciseCatalog();
      renderExerciseOptions(card, name);
      card.querySelector(".custom-exercise-name").value = "";
      customForm.hidden = true;
    } catch (requestError) { error.textContent = requestError.message; }
  });
  categorySelect.value = exerciseCategories[0]?.id || "";
  renderExerciseOptions(card);
  addSet(sets);
  exerciseList.append(card);
}

document.querySelector("#open-form").addEventListener("click", async () => {
  try {
    if (!exerciseCategories.length) await loadExerciseCatalog();
  } catch (error) { showError(error); return; }
  document.querySelector("#workout-date").value = new Date().toLocaleDateString("en-CA");
  exerciseList.replaceChildren();
  addExercise();
  statusEl.classList.remove("visible");
  dialog.showModal();
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
    dialog.close();
    await loadHistory();
  } catch (error) { showError(error); }
  finally { submit.disabled = false; }
});

loadHistory();
